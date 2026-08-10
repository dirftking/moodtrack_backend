import argparse
from eval_clip import CLIP
import torch
import torch.nn.functional as F
from dataloader import VideoFeatureDataset, MusicFeatureDataset, MultiModalDataset
from torch.utils.data import DataLoader

def attn_loss(attn_map):
    loss = 0.0
    for i in range(attn_map.shape[0]):
        diag = torch.diag(attn_map[i])
        label = torch.ones_like(diag).to(device)
        loss += F.mse_loss(diag, label)
    return loss / attn_map.shape[0]

def clip_loss(logits):
    probs = logits.softmax(dim=-1).cpu().numpy()
    consistency = probs.diagonal()
    return consistency

def calculate_mean(numbers):
        return sum(numbers) / len(numbers)
    
if __name__ == "main":
    parser = argparse.ArgumentParser(description='Script for processing video and music paths.')
    
    parser.add_argument('--model_path', type=str, required=True,
                        help='Path to the model checkpoint.')
    parser.add_argument('--video_dir', type=str, required=True, 
                        help='Path to the input video folder.')
    parser.add_argument('--music_dir', type=str, required=True, 
                        help='Path to the input music folder.')
    args = parser.parse_args()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = CLIP(
        len=30,
        in_video_dim=768,
        in_music_dim=128,
        hidden_dim=512,
        layers=4,
        heads=4,
        need_atten=True,
    )
    pre_dict = torch.load(args.model_path, map_location=torch.device(device))
    model.load_state_dict(pre_dict)
    model.to(device)

    video_dir = args.video_dir
    music_dir = args.music_dir

    videos = VideoFeatureDataset(video_dir, duration=30)
    musics = MusicFeatureDataset(music_dir, duration=30)
    dataset = MultiModalDataset(videos, musics)
    test_loader = DataLoader(dataset, batch_size=16, shuffle=False)

    with torch.no_grad():
        model.eval()
        for iteration, item in enumerate(test_loader):
            video, music = item
            video = video.to(device)
            video = video.to(torch.float32)
            music = music.to(device)
            logits, attn_map = model(video, music)
            loss1 = clip_loss(logits, device)
            total_mean = calculate_mean(loss1)
            print("total_loss: ", total_mean)