import torch
import torch.nn as nn
import math
from collections import OrderedDict
import numpy as np

class LayerNorm(nn.LayerNorm):
    """Subclass torch's LayerNorm to handle fp16."""

    def forward(self, x: torch.Tensor):
        orig_type = x.dtype
        ret = super().forward(x.type(torch.float32))
        return ret.type(orig_type)


class QuickGELU(nn.Module):
    def forward(self, x: torch.Tensor):
        return x * torch.sigmoid(1.702 * x)

class PositionalEncoding(nn.Module):
    def __init__(self,d_model,dropout=0.2,max_len=30):
        super(PositionalEncoding, self).__init__()

        self.dropout = nn.Dropout(p=dropout)
        pe = torch.zeros(max_len,d_model)
        position = torch.arange(0,max_len).unsqueeze(1)
        div_term = torch.exp(torch.arange(0,d_model,2) * -(math.log(1000.0) / d_model))
        pe[:,0::2] = torch.sin(position * div_term)
        pe[:,1::2] = torch.cos(position * div_term)
        pe = pe.unsqueeze(0)
        self.register_buffer('pe',pe)

    def forward(self,x):
        x = x + self.pe[:,:x.size(1)]
        return self.dropout(x)
    
class ResidualAttentionBlock(nn.Module):
    def __init__(self, d_model: int, n_head: int, attn_mask: torch.Tensor = None, need_atten: bool = False, drop = 0.2):
        super().__init__()

        self.attn = nn.MultiheadAttention(d_model, n_head)
        self.ln_1 = LayerNorm(d_model)
        self.ln_3 = LayerNorm(d_model)
        self.mlp = nn.Sequential(OrderedDict([
            ("c_fc", nn.Linear(d_model, d_model * 2)),
            ("dropout", nn.Dropout(drop)),
            ("c_proj", nn.Linear(d_model * 2, d_model))
        ]))
        self.mlp_2 = nn.Sequential(OrderedDict([
            ("c_fc", nn.Linear(d_model, d_model * 2)),
            ("dropout", nn.Dropout(drop)),
            ("c_proj", nn.Linear(d_model * 2, d_model))
        ]))
        self.ln_2 = LayerNorm(d_model)
        self.ln_4 = LayerNorm(d_model)
        self.attn_mask = attn_mask

        self.need_atten = need_atten

    def attention(self, x: torch.Tensor, need_atten: bool = False):
        v, m = x
        self.attn_mask = self.attn_mask.to(dtype=v.dtype, device=m.device) if self.attn_mask is not None else None
        if need_atten:
            return [self.attn(v, m, m, need_weights=need_atten, attn_mask=self.attn_mask),\
                self.attn(v, m, v, need_weights=need_atten, attn_mask=self.attn_mask)]
        else:
            return [self.attn(v, m, m, output_attentions=need_atten, head_mask=self.attn_mask)[0],\
                self.attn(v, m, v, output_attentions=need_atten, head_mask=self.attn_mask)[0]]

    def forward(self, x: torch.Tensor):
        v, m = x
        if len(v) == 2:
            v_atten, m_atten = self.attention([self.ln_1(v[0]),self.ln_3(m[0])], True)
            v_a, v_map = v_atten
            m_a, m_map = m_atten
            v_tmp = v[0] + v_a
            m_tmp = m[0] + m_a
            v_tmp = v_tmp + self.mlp(self.ln_2(v_tmp))
            m_tmp = m_tmp + self.mlp_2(self.ln_4(m_tmp))
            return [v_tmp, v_map], [m_tmp, m_map]
        else:
            v_atten, m_atten = self.attention([self.ln_1(v),self.ln_3(m)], True)
            v_a, v_map = v_atten
            m_a, m_map = m_atten
            v = v + v_a
            m = m + m_a
            v = v + self.mlp(self.ln_2(v))
            m = m + self.mlp_2(self.ln_4(m))
            return [v, v_map], [m, m_map]
 
class Transformer(nn.Module):
    def __init__(self, width: int, layers: int, heads: int, attn_mask: torch.Tensor = None, need_atten: bool = False, drop=0.3):
        super().__init__()
        self.width = width
        self.layers = layers
        self.resblocks = nn.Sequential(*[ResidualAttentionBlock(width, heads, attn_mask, need_atten = need_atten, drop=drop) for _ in range(layers)])
        self.need_atten = need_atten

    def forward(self, x: torch.Tensor):
        return self.resblocks(x)

class CLIP(nn.Module):
    def __init__(self, len:int, in_video_dim: int, in_music_dim: int, hidden_dim: int, layers: int, heads: int, drop = 0.45, need_atten: bool = False) -> None:
        super().__init__()
        self.video_linear = nn.Linear(in_video_dim, hidden_dim)
        self.music_linear = nn.Linear(in_music_dim, hidden_dim)
        self.cross_transformer = Transformer(hidden_dim, layers, heads, need_atten = need_atten, drop=drop)
        self.initialize_parameters()
    
    def initialize_parameters(self):
        nn.init.normal_(self.video_linear.weight, std=0.02)
        nn.init.normal_(self.music_linear.weight, std=0.02)

    def build_attention_mask(self):
        mask = torch.empty(self.conmusic_length, self.conmusic_length)
        mask.fill_(float("-inf"))
        mask.triu_(1)  # zero out the lower diagonal
        return mask

    @property
    def dtype(self):
        return self.visual.conv1.weight.dtype

    def encode_video(self, video):
        video = self.video_linear(video)
        return video

    def encode_music(self, music):
        music = self.music_linear(music)
        return music
    
    def forward(self, video, music):

        video_features = self.encode_video(video)
        music_features = self.encode_music(music)
        
        video_features = video_features.permute(1, 0, 2)
        music_features = music_features.permute(1, 0, 2)
        
        video_atten, music_atten = self.cross_transformer([video_features,music_features])
        video_features, video_map = video_atten

        return video_map