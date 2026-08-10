from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse


APP_ROOT = Path(__file__).resolve().parents[1]
GVMGEN_ROOT = Path(os.environ.get("GVMGEN_ROOT", APP_ROOT.parent / "services" / "GVMGen")).resolve()
CHECKPOINT_ROOT = Path(os.environ.get("GVMGEN_CHECKPOINTS", GVMGEN_ROOT / "checkpoints" / "small")).resolve()
OUTPUT_ROOT = Path(os.environ.get("GVMGEN_OUTPUT", APP_ROOT / ".gvmgen-output")).resolve()
FFMPEG = Path(os.environ.get("GVMGEN_FFMPEG", Path(sys.prefix) / "Library" / "bin" / "ffmpeg.exe"))
MAX_UPLOAD_BYTES = 750 * 1024 * 1024
LM_WEIGHT_BYTES = 987_396_005
CODEC_WEIGHT_BYTES = 236_001_935
OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="HeartArt Video2Music Service")
jobs: dict[str, dict[str, Any]] = {}
jobs_lock = threading.Lock()
model_lock = threading.Lock()
executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="gvmgen")
model = None


def model_ready() -> bool:
    weights = CHECKPOINT_ROOT / "state_dict.bin"
    codec = CHECKPOINT_ROOT / "compression_state_dict.bin"
    return (
        torch.cuda.is_available()
        and weights.is_file()
        and weights.stat().st_size == LM_WEIGHT_BYTES
        and codec.is_file()
        and codec.stat().st_size == CODEC_WEIGHT_BYTES
    )


def update_job(job_id: str, **values: Any) -> None:
    with jobs_lock:
        jobs[job_id].update(values)


def public_brand(message: str) -> str:
    return (
        message
        .replace("GVMGEN", "HeartArt")
        .replace("GVMGen", "HeartArt")
        .replace("gvmgen", "HeartArt")
        .replace("ACE-Step 1.5", "HeartArt")
        .replace("ACE-Step", "HeartArt")
    )


def get_model():
    global model
    with model_lock:
        if model is not None:
            return model
        if not torch.cuda.is_available():
            raise RuntimeError("HeartArt CUDA 环境未就绪")
        if str(GVMGEN_ROOT) not in sys.path:
            sys.path.insert(0, str(GVMGEN_ROOT))
        from omegaconf import OmegaConf
        from module.decoder.models import builders, gvmgen, loaders
        from module.decoder.modules.conditioners import CLIPConditioner

        # The official exported small checkpoint keeps only `dim: 768` in its
        # conditioner config, while its state contains the six-layer Q-Former.
        # Restore the official video2music defaults without rewriting the 942MB
        # checkpoint on disk.
        if not getattr(builders.CLIPConditioner, "_heartart_checkpoint_compat", False):
            class CheckpointCompatibleCLIPConditioner(CLIPConditioner):
                _heartart_checkpoint_compat = True

                def __init__(self, output_dim, device, dim=768, **kwargs):
                    del dim
                    qformer = kwargs.pop("qformer", None) or OmegaConf.create({
                        "query_num": 16,
                        "query_type": "mean",
                        "layer_norm_eps": 1e-12,
                        "hidden_dropout_prob": 0.1,
                        "qformer_layers": 6,
                        "cross_attention_frequency": 2,
                    })
                    super().__init__(
                        name=kwargs.pop("name", "ViT-L/14@336px"),
                        output_dim=output_dim,
                        device=device,
                        video_len=kwargs.pop("video_len", 30),
                        finetune=kwargs.pop("finetune", True),
                        is_qformer=kwargs.pop("is_qformer", True),
                        qformer=qformer,
                    )

            builders.CLIPConditioner = CheckpointCompatibleCLIPConditioner

        if not getattr(gvmgen.load_lm_model, "_heartart_checkpoint_compat", False):
            def load_checkpoint_compatible_lm(file_or_url_or_id, device="cpu", cache_dir=None):
                package = loaders.load_lm_model_ckpt(file_or_url_or_id, cache_dir=cache_dir)
                config = OmegaConf.create(package["xp.cfg"])
                config.device = str(device)
                config.dtype = "float32" if config.device == "cpu" else "float16"
                loaders._delete_param(config, "conditioners.self_wav.chroma_stem.cache_path")
                loaders._delete_param(config, "conditioners.args.merge_text_conditions_p")
                loaders._delete_param(config, "conditioners.args.drop_desc_p")
                loaded_model = builders.get_lm_model(config)

                state = dict(package["best_state"])
                old_query_key = "condition_provider.conditioners.visual_content.clip.visual.query_token"
                new_query_key = f"{old_query_key}s"
                if old_query_key in state and new_query_key not in state:
                    state[new_query_key] = state.pop(old_query_key)
                incompatible = loaded_model.load_state_dict(state, strict=False)
                allowed_missing_prefix = "condition_provider.conditioners.visual_content.clip.visual."
                invalid_missing = [key for key in incompatible.missing_keys if not key.startswith(allowed_missing_prefix)]
                if invalid_missing or incompatible.unexpected_keys:
                    raise RuntimeError(
                        f"HeartArt checkpoint mismatch: missing={invalid_missing}, unexpected={incompatible.unexpected_keys}"
                    )
                loaded_model.eval()
                loaded_model.cfg = config
                return loaded_model

            load_checkpoint_compatible_lm._heartart_checkpoint_compat = True
            gvmgen.load_lm_model = load_checkpoint_compatible_lm

        model = gvmgen.GVMGen.get_pretrained(str(CHECKPOINT_ROOT), device="cuda")
        return model


def video_duration(video_path: Path) -> float:
    from moviepy.editor import VideoFileClip

    clip = VideoFileClip(str(video_path))
    try:
        return float(clip.duration)
    finally:
        clip.close()


def render_video(video_path: Path, audio_path: Path, output_path: Path, duration: float) -> None:
    ffmpeg = str(FFMPEG if FFMPEG.exists() else "ffmpeg")
    base = [ffmpeg, "-y", "-i", str(video_path), "-i", str(audio_path), "-t", f"{duration:.3f}", "-map", "0:v:0", "-map", "1:a:0"]
    copy_command = [*base, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", str(output_path)]
    completed = subprocess.run(copy_command, capture_output=True, text=True)
    if completed.returncode == 0:
        return
    encode_command = [*base, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-shortest", str(output_path)]
    subprocess.run(encode_command, check=True, capture_output=True, text=True)


def run_generation(job_id: str, video_path: Path, requested_duration: int) -> None:
    job_dir = OUTPUT_ROOT / job_id
    audio_path = job_dir / "music.wav"
    rendered_path = job_dir / "rendered-video.mp4"
    metadata_path = job_dir / "worker-result.json"
    try:
        update_job(job_id, status="loading", progress=18, message="正在加载 HeartArt 视频配乐模型…")
        update_job(job_id, status="generating", progress=34, message="HeartArt 正在进行空间层级注意力分析…")
        worker = subprocess.run(
            [
                sys.executable,
                str(APP_ROOT / "services" / "gvmgen_worker.py"),
                "--video", str(video_path),
                "--audio", str(audio_path),
                "--metadata", str(metadata_path),
                "--duration", str(requested_duration),
            ],
            cwd=str(APP_ROOT),
            capture_output=True,
            text=True,
            timeout=19 * 60,
        )
        if worker.returncode != 0:
            details = public_brand((worker.stderr or worker.stdout or "HeartArt worker failed").strip())
            raise RuntimeError(details[-4_000:])
        duration = float(json.loads(metadata_path.read_text(encoding="utf-8"))["duration"])

        update_job(job_id, status="rendering", progress=82, message="正在把音乐与视频对齐渲染…")
        render_video(video_path, audio_path, rendered_path, duration)
        update_job(
            job_id,
            status="completed",
            progress=100,
            message="HeartArt 配乐与视频渲染完成",
            duration=duration,
            audio_url=f"/files/{job_id}/music.wav",
            video_url=f"/files/{job_id}/rendered-video.mp4",
        )
    except Exception as error:
        update_job(job_id, status="failed", progress=100, message="HeartArt 生成失败", error=public_brand(str(error)))


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ready": model_ready(),
        "cuda": torch.cuda.is_available(),
        "model": "HeartArt-Video2Music",
    }


@app.post("/generate")
async def generate(video: UploadFile = File(...), duration: int = Form(30)) -> dict[str, str]:
    if not model_ready():
        raise HTTPException(status_code=503, detail="HeartArt 模型正在准备，请稍后再试")
    with jobs_lock:
        if any(job["status"] not in {"completed", "failed"} for job in jobs.values()):
            raise HTTPException(status_code=429, detail="HeartArt 正在处理另一个视频，请稍后再试")
    if not video.filename or not video.filename.lower().endswith((".mp4", ".mov", ".m4v", ".webm")):
        raise HTTPException(status_code=400, detail="请上传 MP4、MOV、M4V 或 WebM 视频")
    job_id = uuid.uuid4().hex
    job_dir = OUTPUT_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=False)
    suffix = Path(video.filename).suffix.lower()
    video_path = job_dir / f"source{suffix}"
    size = 0
    with video_path.open("wb") as destination:
        while chunk := await video.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail="视频不能超过 750MB")
            destination.write(chunk)
    await video.close()
    with jobs_lock:
        jobs[job_id] = {"id": job_id, "status": "queued", "progress": 10, "message": "视频已上传，等待 HeartArt…"}
    executor.submit(run_generation, job_id, video_path, max(5, min(duration, 30)))
    return {"job_id": job_id}


@app.get("/jobs/{job_id}")
def job_status(job_id: str) -> dict[str, Any]:
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="任务不存在")
        return dict(job)


@app.get("/files/{job_id}/{filename}")
def download(job_id: str, filename: str):
    if filename not in {"music.wav", "rendered-video.mp4"}:
        raise HTTPException(status_code=404, detail="文件不存在")
    path = (OUTPUT_ROOT / job_id / filename).resolve()
    if not path.is_file() or path.parent != (OUTPUT_ROOT / job_id).resolve():
        raise HTTPException(status_code=404, detail="文件不存在")
    media_type = "audio/wav" if filename.endswith(".wav") else "video/mp4"
    return FileResponse(path, media_type=media_type, filename=filename)
