from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
import torchaudio

from gvmgen_service import get_model, video_duration


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--audio", required=True)
    parser.add_argument("--metadata", required=True)
    parser.add_argument("--duration", required=True, type=int)
    args = parser.parse_args()

    video_path = Path(args.video).resolve()
    audio_path = Path(args.audio).resolve()
    metadata_path = Path(args.metadata).resolve()
    duration = max(5, min(float(args.duration), video_duration(video_path), 30.0))

    generator = get_model()
    from data_preprocess.utils.video import capture_video

    frames = capture_video(str(video_path), 1, "cuda", int(round(duration)))
    if frames.shape[0] == 0:
        raise RuntimeError("没有从视频中读取到可用画面")
    generator.set_generation_params(duration=frames.shape[0])
    with torch.inference_mode():
        outputs = generator.generate(descriptions=[frames], progress=False)

    waveform = outputs[0].detach().cpu().float()
    peak = float(waveform.abs().max())
    if peak > 0:
        waveform = waveform * (0.95 / peak)
    torchaudio.save(str(audio_path), waveform, generator.sample_rate)
    metadata_path.write_text(
        json.dumps({"duration": duration, "sample_rate": generator.sample_rate}),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
