from torch.utils.data import Dataset
import torch
import os


class VideoFeatureDataset(Dataset):
    def __init__(self, dir_name, duration=30) -> None:
        super().__init__()
        self.dir_name = dir_name
        self.duration = duration
        self.data = []
        self.name_list = []
        video_map = [f for f in sorted(os.listdir(dir_name)) if f.endswith('.pt')]
        for video in video_map:
            name, _ = os.path.splitext(video)
            if os.path.exists(os.path.join(dir_name, video)):
                self.data.append(os.path.join(dir_name, video))
                self.name_list.append(name)
        
    def __len__(self) -> int:
        return len(self.data)
    
    def __getitem__(self, index) -> torch.Tensor:
        video = torch.load(self.data[index])
        return video
    
    def get_name(self,index) -> str:
        return self.name_list[index]

class MusicFeatureDataset(Dataset):
    def __init__(self, dir_name, duration=30) -> None:
        super().__init__()
        self.dir_name = dir_name
        self.duration = duration
        self.data = []
        self.name_list = []
        music_map = [f for f in sorted(os.listdir(dir_name)) if f.endswith('.pt')]
        for music in music_map:
            name, _ = os.path.splitext(music)
            if os.path.exists(os.path.join(dir_name, music)):
                self.data.append(os.path.join(dir_name, music))
                self.name_list.append(name)
        
    def __len__(self) -> int:
        return len(self.data)
    
    def __getitem__(self, index) -> torch.Tensor:
        music = torch.load(self.data[index])
        return music[0]
    
    def get_name(self,index) -> str:
        return self.name_list[index]

class MultiModalDataset(Dataset):
    def __init__(self,VideoFeatureDataset,MusicFeatureDataset,fake_sample=0) -> None:
        super().__init__()
        self.VideoFeatureDataset = VideoFeatureDataset
        self.MusicFeatureDataset = MusicFeatureDataset
        print(len(self.VideoFeatureDataset))
        print(len(self.MusicFeatureDataset))
        self.data = combine(VideoFeatureDataset, MusicFeatureDataset,fake_sample)
    def __len__(self) -> int:
        return len(self.data)
    def __getitem__(self, index) -> torch.Tensor:
        return self.data[index]

def combine(VideoFeatureDataset, MusicFeatureDataset, fake_sample=0):
    result = []
    for i in range(len(VideoFeatureDataset)):
        result.append([VideoFeatureDataset[i], MusicFeatureDataset[i]])#,torch.tensor([1])
    return result