from dataloader import VideoFeatureDataset, MusicFeatureDataset, MultiModalDataset
from eval_clip import CLIP
import torch
import torch.nn as nn
import torch.optim as optim
from tqdm import tqdm
from torch.utils.data import DataLoader
import torch.nn.functional as F
from torch.utils.tensorboard import SummaryWriter
import argparse

def clip_loss(logits, device="cuda:0"):
    n = logits.shape[1]
    labels = torch.arange(n).to(device)
    # assert not torch.any(torch.isnan(logits))
    loss_i = F.cross_entropy(logits.transpose(0, 1), labels, reduction="mean")
    loss_t = F.cross_entropy(logits, labels, reduction="mean")
    loss = (loss_i + loss_t) / 2
    return loss


def accu(pre, device="cuda:0"):
    n = pre.shape[1]
    labels = torch.arange(n).to(device)
    predicted_i = torch.argmax(pre, 1)
    predicted_t = torch.argmax(pre.transpose(0, 1), 1)
    correct = 0
    correct += (predicted_i == labels).sum().item()
    correct += (predicted_t == labels).sum().item()
    return correct / (2 * n)


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


    device = "cuda:0"
    model = CLIP(
        len=args.duration,
        in_video_dim=768,
        in_music_dim=128,
        hidden_dim=512,
        layers=4,
        heads=4,
        need_atten=True,
    ).to(device)

    optimizer = optim.Adam(model.parameters(), lr=1e-4, weight_decay=1e-3)

    for epoch in range(args.n_epochs):
        pbar = tqdm(
            total=int(len(train_dataset) / args.batch_size) + 1,
            desc=f"Epoch {epoch + 1}/{args.n_epochs}",
            postfix=dict,
        )
        model.train()
        train_loss = 0.0
        train_accu = 0.0
        for iteration, item in enumerate(train_loader):
            video, music = item
            video = video.to(device)
            video = video.to(torch.float32)
            music = music.to(device)
            logits, attn_map = model(video, music)
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
            loss = clip_loss(logits, device)
            accuracy = accu(logits, device)
            pbar.set_postfix(
                **{
                    "train_loss": loss.item(),
                    "train_accu": accuracy,
                }
            )
            train_loss += loss.item()
            train_accu += accuracy
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            pbar.update(1)

        writer.add_scalar(
            "loss / train_loss", train_loss / len(train_loader), global_step=epoch
        )
        writer.add_scalar("lr / lr", optimizer.param_groups[0]["lr"], global_step=epoch)
        writer.add_scalar(
            "accu / train_accu", train_accu / len(train_loader), global_step=epoch
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
            test_accu = 0.0
            for iteration, item in enumerate(test_loader):
                video, music = item
                video = video.to(device)
                video = video.to(torch.float32)
                music = music.to(device)
                logits, attn_map = model(video, music)
                loss = clip_loss(logits, device)
                accuracy = accu(logits, device)
                test_loss += loss.item()
                test_accu += accuracy

                pbar.set_postfix(
                    **{
                        "test_loss": loss.item(),
                        "test_accu": accuracy,
                    }
                )
                pbar.update(1)
            writer.add_scalar(
                "loss / test_loss", test_loss / len(test_loader), global_step=epoch
            )
            writer.add_scalar(
                "accu / test_accu", test_accu / len(test_loader), global_step=epoch
            )
            pbar.close()
        if (epoch + 1) % args.save_per_epoch == 0:
            torch.save(model.state_dict(), f"clip{epoch+1}.pth")
    writer.close()
