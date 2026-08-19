from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path
from typing import Callable

import torch


CONDITIONING_FPS = 1
MIN_CONDITIONING_FRAMES = 15
MAX_CONDITIONING_FRAMES = 30
FADE_SECONDS = 0.03
LOUDNESS_HEADROOM_DB = 14.0
PEAK_HEADROOM_DB = 1.0


def loop_conditioning_frames(frames: torch.Tensor, target_frames: int) -> torch.Tensor:
    """Loop captured frames until the model has a supported conditioning window."""
    if frames.dim() < 1 or frames.shape[0] == 0:
        raise RuntimeError("No usable frames were captured from the video")
    if target_frames <= 0:
        raise ValueError("target_frames must be positive")
    if frames.shape[0] >= target_frames:
        return frames[:target_frames]
    repeats = math.ceil(target_frames / frames.shape[0])
    repeat_shape = [repeats, *([1] * (frames.dim() - 1))]
    return frames.repeat(*repeat_shape)[:target_frames]


def trim_pad_and_fade(
    waveform: torch.Tensor,
    sample_rate: int,
    duration: float,
    fade_seconds: float = FADE_SECONDS,
) -> tuple[torch.Tensor, int]:
    """Return exactly round(duration * sample_rate) samples with click-safe ends."""
    if sample_rate <= 0 or not math.isfinite(duration) or duration <= 0:
        raise ValueError("A positive sample rate and duration are required")
    if waveform.dim() == 1:
        waveform = waveform.unsqueeze(0)
    if waveform.dim() != 2:
        raise ValueError("Generated audio must have shape [channels, samples]")
    if not torch.isfinite(waveform).all():
        raise ValueError("Generated audio contains non-finite samples")

    target_samples = max(1, int(round(duration * sample_rate)))
    waveform = waveform[..., :target_samples]
    content_samples = int(waveform.shape[-1])
    missing_samples = target_samples - waveform.shape[-1]
    if missing_samples > 0:
        waveform = torch.nn.functional.pad(waveform, (0, missing_samples))

    fade_samples = min(int(round(fade_seconds * sample_rate)), content_samples // 2)
    if fade_samples > 0:
        fade_in = torch.linspace(0.0, 1.0, fade_samples, dtype=waveform.dtype, device=waveform.device)
        fade_out = torch.linspace(1.0, 0.0, fade_samples, dtype=waveform.dtype, device=waveform.device)
        waveform = waveform.clone()
        waveform[..., :fade_samples] *= fade_in
        waveform[..., content_samples - fade_samples:content_samples] *= fade_out
    return waveform, fade_samples


def normalize_for_delivery(
    waveform: torch.Tensor,
    sample_rate: int,
    loudness_meter: Callable[[torch.Tensor], torch.Tensor] | None = None,
) -> torch.Tensor:
    """Apply the official BS.1770/-14 LUFS algorithm without its slow package import."""
    energy = float(waveform.pow(2).mean().sqrt())
    if energy >= 2e-3:
        if loudness_meter is None:
            import torchaudio

            loudness_meter = torchaudio.transforms.Loudness(sample_rate)
        input_loudness = float(loudness_meter(waveform).item())
        if math.isfinite(input_loudness):
            gain = 10.0 ** ((-LOUDNESS_HEADROOM_DB - input_loudness) / 20.0)
            waveform = torch.tanh(waveform * gain)
    peak = waveform.abs().max()
    peak_ceiling = 10.0 ** (-PEAK_HEADROOM_DB / 20.0)
    if float(peak) > peak_ceiling:
        waveform = waveform * (peak_ceiling / peak)
    return waveform


def measured_loudness(waveform: torch.Tensor, sample_rate: int) -> float | None:
    """Best-effort diagnostic only; a metric failure must not lose a render."""
    try:
        import torchaudio

        value = float(torchaudio.transforms.Loudness(sample_rate)(waveform).item())
        return value if math.isfinite(value) else None
    except (ImportError, RuntimeError, ValueError):
        return None


def main() -> None:
    try:
        from .gvmgen_service import get_model, video_duration
    except ImportError:  # Executed as a standalone worker process.
        from gvmgen_service import get_model, video_duration

    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--audio", required=True)
    parser.add_argument("--metadata", required=True)
    parser.add_argument("--duration", required=True, type=float)
    parser.add_argument("--seed", required=True, type=int)
    args = parser.parse_args()

    video_path = Path(args.video).resolve()
    audio_path = Path(args.audio).resolve()
    metadata_path = Path(args.metadata).resolve()
    analysis_duration = video_duration(video_path)
    final_duration = min(float(args.duration), float(MAX_CONDITIONING_FRAMES))
    if (
        not math.isfinite(analysis_duration)
        or analysis_duration <= 0
        or not math.isfinite(final_duration)
        or final_duration <= 0
    ):
        raise RuntimeError("The video has no usable duration")

    generator = get_model()
    from data_preprocess.utils.video import capture_video

    capture_frame_limit = min(MAX_CONDITIONING_FRAMES, max(1, math.ceil(final_duration)))
    captured_frames = capture_video(
        str(video_path),
        CONDITIONING_FPS,
        "cuda",
        capture_frame_limit,
    )
    captured_frame_count = int(captured_frames.shape[0])
    conditioning_frame_count = min(
        MAX_CONDITIONING_FRAMES,
        max(MIN_CONDITIONING_FRAMES, math.ceil(final_duration)),
    )
    frames = loop_conditioning_frames(captured_frames, conditioning_frame_count)

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)
    generator.set_generation_params(duration=int(frames.shape[0]))
    with torch.inference_mode():
        outputs = generator.generate(descriptions=[frames], progress=False)

    # Keep post-processing on the generation device. In the deployment's
    # torchaudio build, BS.1770 filtering is GPU accelerated while the CPU
    # fallback is prohibitively slow for even a short clip.
    waveform = outputs[0].detach().float()
    if waveform.dim() == 1:
        waveform = waveform.unsqueeze(0)
    generated_samples = int(waveform.shape[-1])
    waveform, fade_samples = trim_pad_and_fade(waveform, generator.sample_rate, final_duration)
    waveform = normalize_for_delivery(waveform, generator.sample_rate)

    # Normalization cannot lengthen the tensor, but assert this contract before saving.
    final_samples = int(round(final_duration * generator.sample_rate))
    if waveform.shape[-1] != final_samples:
        raise RuntimeError("Final audio does not match the requested sample count")

    final_peak = float(waveform.abs().max())
    final_loudness = measured_loudness(waveform, generator.sample_rate)
    waveform = waveform.cpu()

    import torchaudio

    torchaudio.save(str(audio_path), waveform, generator.sample_rate)
    exact_duration = final_samples / generator.sample_rate
    metadata_path.write_text(
        json.dumps(
            {
                "schema_version": 2,
                "duration": exact_duration,
                "final_duration": exact_duration,
                "requested_duration": float(args.duration),
                "analysis_duration": analysis_duration,
                "sample_rate": generator.sample_rate,
                "channels": int(waveform.shape[0]),
                "generated_samples": generated_samples,
                "final_samples": final_samples,
                "fade_samples": fade_samples,
                "captured_frame_count": captured_frame_count,
                "conditioning_frame_count": int(frames.shape[0]),
                "conditioning_fps": CONDITIONING_FPS,
                "conditioning_padding": "loop" if captured_frame_count < frames.shape[0] else "none",
                "seed": args.seed,
                "peak": final_peak,
                "peak_dbfs": 20.0 * math.log10(max(final_peak, torch.finfo(waveform.dtype).tiny)),
                "loudness_lufs": final_loudness,
                "normalization": "official_loudness_-14_lufs_compressor_peak_ceiling_-1_dbfs",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
