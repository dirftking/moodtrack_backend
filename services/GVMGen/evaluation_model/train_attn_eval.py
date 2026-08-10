import torch
import torch.nn as nn
from collections import OrderedDict
from dataloader import VideoFeatureDataset, MusicFeatureDataset, MultiModalDataset
import torch.optim as optim
from tqdm import tqdm
from torch.utils.data import DataLoader
import torch.nn.functional as F
from torch.utils.tensorboard import SummaryWriter
from eval_clip_atten import CLIP
import argparse


def attn_loss(attn_map, device='cuda:0'):
    loss = 0.0
    for i in range(attn_map.shape[0]):
        diag = torch.diag(attn_map[i])
        label = torch.ones_like(diag).to(device)
        loss += F.mse_loss(diag, label)
    return loss / attn_map.shape[0]

if __name__ == "main":
    parser = argparse.ArgumentParser(description='Script for processing video and music paths.')
    
    parser.add_argument('--video_dir', type=str, required=True, 
                        help='Path to the input video folder.')
    parser.add_argument('--music_dir', type=str, required=True, 
                        help='Path to the input music folder.')
    parser.add_argument('--batch_size', type=int, default=128)
    parser.add_argument('--n_epochs',type=int,default=1000)
    parser.add_argument('--duration', type=int, default=30,
                        help='duration of each video')
    parser.add_argument('--train_proportion',type=float,default=0.8)
    parser.add_argument('--save_per_epoch', type=int, default=50)
    args = parser.parse_args()
    
    tensorboard_dir = "./tensorboard"
    videos = VideoFeatureDataset(
        args.video_dir, duration=args.duration
    )
    musics = MusicFeatureDataset(
        args.music_dir, duration=args.duration
    )
    writer = SummaryWriter(tensorboard_dir)
    dataset = MultiModalDataset(videos, musics)
    # train test split
    torch.manual_seed(0)
    train_size = int(args.train_proportion * len(dataset))
    test_size = len(dataset) - train_size
    train_dataset, test_dataset = torch.utils.data.random_split(
        dataset, [train_size, test_size]
    )

    train_loader = DataLoader(train_dataset, batch_size=args.batch_size, shuffle=True)
    test_loader = DataLoader(test_dataset, batch_size=args.batch_size, shuffle=True)


    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = CLIP(
        len=args.duration,
        in_video_dim=768,
        in_music_dim=128,
        hidden_dim=512,
        layers=4,
        heads=4,
        need_atten=True,
    )

    model.to(device)
    optimizer = optim.Adam(model.parameters(), lr=1e-4)


    for epoch in range(args.n_epochs):
        pbar = tqdm(
            total=int(len(train_dataset) / args.batch_size) + 1,
            desc=f"Epoch {epoch + 1}/{args.n_epochs}",
            postfix=dict,
        )
        model.train()
        train_loss = 0.0
        for iteration, item in enumerate(train_loader):
            video, music = item
            video = video.to(device)
            video = video.to(torch.float32)
            music = music.to(device)
            attn_map = model(video, music)
            if iteration == 0:
                tmp_attention_map = attn_map[0] * 255
                tmp_attention_map = tmp_attention_map.to(torch.uint8)
                tmp_attention_map = tmp_attention_map.unsqueeze(0)
                tmp_attention_map = tmp_attention_map.unsqueeze(0)
                writer.add_images(
                    f"Attention_Layer6",
                    tmp_attention_map,
                    global_step=epoch,
                )
            loss = attn_loss(attn_map)
            pbar.set_postfix(
                **{
                    "train_loss": loss.item(),
                }
            )
            train_loss += loss.item()
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            pbar.update(1)
        writer.add_scalar(
            "loss / train_loss", train_loss / len(train_loader), global_step=epoch
        )
        pbar.close()
        with torch.no_grad():
            pbar = tqdm(
                total=int(len(test_dataset) / args.batch_size) + 1,
                desc=f"Epoch {epoch + 1}/{args.n_epochs}",
                postfix=dict,
                mininterval=0.3,
            )
            model.eval()
            test_loss = 0.0
            for iteration, item in enumerate(test_loader):
                video, music = item
                video = video.to(device)
                video = video.to(torch.float32)
                music = music.to(device)
                attn_map = model(video, music)
                loss = attn_loss(attn_map)
                test_loss += loss.item()
                pbar.set_postfix(
                    **{
                        "test_loss": loss.item(),
                    }
                )
                pbar.update(1)
            writer.add_scalar(
                "loss / test_loss", loss / len(test_loader), global_step=epoch
            )
            pbar.close()
        if (epoch + 1) % args.save_per_epoch == 0:
            torch.save(model.state_dict(), f"eval{epoch+1}.pth")
