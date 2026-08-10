## Evaluation model

Once you want to employ the evaluation model, please prepare your data following this document.

### 1. data preprocessing

In this paper, video features are extracted from a pretrained ViT with a hidden dimesion of 768, music features are extracted from a pretrained Encodec with a hidden dimension of 128. You can follow our work or try any other features, but remember to modify the ```in_video_dim``` and ```in_music_dim``` parameters when initializing the model.

### 2. training

```
python train_clip_eval.py --video_dir /path/to/your/video --music_dir /path/to/your/music
```

for global music-video correspondence
```
python train_attn_eval.py --video_dir /path/to/your/video --music_dir /path/to/your/music
```
for local temporal alignment

These two models share the same model structure, you could try training them together.

### 3. test
```
python infer_clip_eval.py --video_dir /path/to/your/video --music_dir /path/to/your/music
```

for global music-video correspondence
```
python infer_attn_eval.py --video_dir /path/to/your/video --music_dir /path/to/your/music
```
for local temporal alignment