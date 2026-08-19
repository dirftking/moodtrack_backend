from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import boto3
import torch
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response, StreamingResponse


APP_ROOT = Path(__file__).resolve().parents[1]


def load_private_environment(path: Path) -> None:
    """Load server-only settings without ever sending them through Vite."""
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        os.environ.setdefault(name, value)


load_private_environment(APP_ROOT / ".env.gvmgen.local")

GVMGEN_ROOT = Path(os.environ.get("GVMGEN_ROOT", APP_ROOT.parent / "services" / "GVMGen")).resolve()
CHECKPOINT_ROOT = Path(os.environ.get("GVMGEN_CHECKPOINTS", GVMGEN_ROOT / "checkpoints" / "small")).resolve()
OUTPUT_ROOT = Path(os.environ.get("GVMGEN_OUTPUT", APP_ROOT / ".gvmgen-output")).resolve()
UPLOAD_ROOT = (OUTPUT_ROOT / ".uploads").resolve()
FFMPEG = Path(os.environ.get("GVMGEN_FFMPEG", Path(sys.prefix) / "Library" / "bin" / "ffmpeg.exe"))
try:
    MAX_UPLOAD_BYTES = max(1, min(95, int(os.environ.get("GVMGEN_MAX_UPLOAD_MB", "95")))) * 1024 * 1024
except ValueError:
    MAX_UPLOAD_BYTES = 95 * 1024 * 1024
UPLOAD_CHUNK_BYTES = 1024 * 1024
MULTIPART_THRESHOLD_BYTES = 6 * 1024 * 1024
MULTIPART_PART_BYTES = 8 * 1024 * 1024
UPLOAD_SESSION_TTL_SECONDS = 6 * 60 * 60
SERVICE_VERSION = "3.0.0"
SAFE_ID = re.compile(r"^[a-f0-9]{32}$", re.IGNORECASE)
SAFE_CLIENT_ID = re.compile(r"^[A-Za-z0-9_-]{16,80}$")
ALLOWED_VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v", ".webm"}
VIDEO_CONTENT_TYPES = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".m4v": "video/x-m4v",
    ".webm": "video/webm",
}
R2_ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID", "").strip()
STORAGE_PROVIDER = os.environ.get("S3_PROVIDER", "r2").strip().lower() or "r2"
S3_ACCESS_KEY_ID = os.environ.get("S3_ACCESS_KEY_ID", os.environ.get("R2_ACCESS_KEY_ID", "")).strip()
S3_SECRET_ACCESS_KEY = os.environ.get("S3_SECRET_ACCESS_KEY", os.environ.get("R2_SECRET_ACCESS_KEY", "")).strip()
S3_BUCKET_NAME = os.environ.get("S3_BUCKET_NAME", os.environ.get("R2_BUCKET_NAME", "")).strip()
S3_ENDPOINT_URL = os.environ.get(
    "S3_ENDPOINT_URL",
    os.environ.get(
        "R2_ENDPOINT_URL",
        f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com" if R2_ACCOUNT_ID else "",
    ),
).rstrip("/")
S3_REGION = os.environ.get("S3_REGION", os.environ.get("R2_REGION", "auto")).strip() or "auto"
S3_PREFIX = (os.environ.get("S3_PREFIX", os.environ.get("R2_PREFIX", "incoming")).strip().strip("/") or "incoming")
S3_FORCE_PATH_STYLE = os.environ.get("S3_FORCE_PATH_STYLE", "false").strip().lower() in {"1", "true", "yes", "on"}
try:
    S3_PRESIGN_TTL_SECONDS = max(60, min(3600, int(os.environ.get("S3_PRESIGN_TTL_SECONDS", os.environ.get("R2_PRESIGN_TTL_SECONDS", "900")))))
except ValueError:
    S3_PRESIGN_TTL_SECONDS = 900
LM_WEIGHT_BYTES = 987_396_005
CODEC_WEIGHT_BYTES = 236_001_935
OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="MoodTrack Video2Music Service")
jobs: dict[str, dict[str, Any]] = {}
jobs_lock = threading.Lock()
upload_sessions: dict[str, dict[str, Any]] = {}
uploads_by_client: dict[str, str] = {}
uploads_lock = threading.Lock()
submission_lock = threading.Lock()
model_lock = threading.Lock()
storage_lock = threading.Lock()
executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="gvmgen")
model = None
storage_client = None


@app.middleware("http")
async def disable_http_cache(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


def stream_file(path: Path, start: int, end: int):
    with path.open("rb") as source:
        source.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk = source.read(min(1024 * 1024, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def media_response(path: Path, media_type: str, range_header):
    size = path.stat().st_size
    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Content-Disposition": f'inline; filename="{path.name}"',
    }
    if not range_header:
        headers["Content-Length"] = str(size)
        return StreamingResponse(stream_file(path, 0, size - 1), media_type=media_type, headers=headers)

    try:
        unit, value = range_header.split("=", 1)
        if unit.strip().lower() != "bytes" or "," in value:
            raise ValueError
        start_text, end_text = value.split("-", 1)
        if start_text:
            start = int(start_text)
            end = min(int(end_text), size - 1) if end_text else size - 1
        else:
            suffix = int(end_text)
            if suffix <= 0:
                raise ValueError
            start = max(0, size - suffix)
            end = size - 1
        if start < 0 or start >= size or end < start:
            raise ValueError
    except (TypeError, ValueError):
        return Response(status_code=416, headers={"Content-Range": f"bytes */{size}", "Accept-Ranges": "bytes"})

    headers.update({
        "Content-Range": f"bytes {start}-{end}/{size}",
        "Content-Length": str(end - start + 1),
    })
    return StreamingResponse(
        stream_file(path, start, end),
        status_code=206,
        media_type=media_type,
        headers=headers,
    )


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


def storage_configured() -> bool:
    return all((S3_ENDPOINT_URL, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET_NAME))


def get_storage_client():
    global storage_client
    if not storage_configured():
        raise RuntimeError("视频云存储直传尚未配置")
    with storage_lock:
        if storage_client is None:
            storage_client = boto3.client(
                "s3",
                endpoint_url=S3_ENDPOINT_URL,
                aws_access_key_id=S3_ACCESS_KEY_ID,
                aws_secret_access_key=S3_SECRET_ACCESS_KEY,
                region_name=S3_REGION,
                config=Config(
                    signature_version="s3v4",
                    s3={"addressing_style": "path" if S3_FORCE_PATH_STYLE else "auto"},
                ),
            )
        return storage_client


def storage_error_detail(error: Exception, fallback: str) -> str:
    if isinstance(error, ClientError):
        response = error.response or {}
        code = str(response.get("Error", {}).get("Code", ""))
        if code in {"404", "NoSuchKey", "NotFound"}:
            return "云存储中还没有收到这个视频"
        if code in {"401", "403", "AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch"}:
            return "视频云存储认证失败，请检查服务端配置"
        return fallback
    if isinstance(error, BotoCoreError):
        return "视频云存储连接暂时不可用"
    return fallback


def object_key(upload_id: str, suffix: str) -> str:
    return f"{S3_PREFIX}/{upload_id}/source{suffix}"


def create_presigned_upload(session: dict[str, Any]) -> dict[str, Any]:
    content_type = str(session["content_type"])
    url = get_storage_client().generate_presigned_url(
        "put_object",
        Params={
            "Bucket": S3_BUCKET_NAME,
            "Key": str(session["object_key"]),
            "ContentType": content_type,
        },
        ExpiresIn=S3_PRESIGN_TTL_SECONDS,
    )
    return {
        "upload_url": url,
        "upload_headers": {"Content-Type": content_type},
        "expires_in": S3_PRESIGN_TTL_SECONDS,
    }


class MultipartUploadIncomplete(RuntimeError):
    pass


def is_multipart_session(session: dict[str, Any]) -> bool:
    return bool(session.get("multipart_upload_id"))


def start_multipart_upload(session: dict[str, Any]) -> None:
    response = get_storage_client().create_multipart_upload(
        Bucket=S3_BUCKET_NAME,
        Key=str(session["object_key"]),
        ContentType=str(session["content_type"]),
    )
    multipart_upload_id = str(response.get("UploadId", "")).strip()
    if not multipart_upload_id:
        raise RuntimeError("云存储没有返回分片上传编号")
    session["multipart_upload_id"] = multipart_upload_id
    session["part_size"] = MULTIPART_PART_BYTES
    session["total_parts"] = (
        int(session["total_size"]) + MULTIPART_PART_BYTES - 1
    ) // MULTIPART_PART_BYTES


def presigned_multipart_part(session: dict[str, Any], part_number: int) -> dict[str, Any]:
    url = get_storage_client().generate_presigned_url(
        "upload_part",
        Params={
            "Bucket": S3_BUCKET_NAME,
            "Key": str(session["object_key"]),
            "UploadId": str(session["multipart_upload_id"]),
            "PartNumber": part_number,
        },
        ExpiresIn=S3_PRESIGN_TTL_SECONDS,
    )
    return {
        "part_number": part_number,
        "upload_url": url,
        "upload_headers": {},
        "expires_in": S3_PRESIGN_TTL_SECONDS,
    }


def list_multipart_parts(session: dict[str, Any]) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = []
    marker: int | None = None
    while True:
        request: dict[str, Any] = {
            "Bucket": S3_BUCKET_NAME,
            "Key": str(session["object_key"]),
            "UploadId": str(session["multipart_upload_id"]),
        }
        if marker is not None:
            request["PartNumberMarker"] = marker
        response = get_storage_client().list_parts(**request)
        parts.extend(dict(part) for part in response.get("Parts", []))
        if not response.get("IsTruncated"):
            break
        next_marker = response.get("NextPartNumberMarker")
        if next_marker is None:
            raise RuntimeError("云存储返回了无效的分片列表")
        marker = int(next_marker)
    return parts


def expected_multipart_part_size(session: dict[str, Any], part_number: int) -> int:
    part_size = int(session["part_size"])
    total_size = int(session["total_size"])
    start = (part_number - 1) * part_size
    return min(part_size, total_size - start)


def validate_multipart_parts(
    session: dict[str, Any],
    parts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    total_parts = int(session["total_parts"])
    ordered = sorted(parts, key=lambda part: int(part.get("PartNumber", 0)))
    received_numbers = [int(part.get("PartNumber", 0)) for part in ordered]
    expected_numbers = list(range(1, total_parts + 1))
    if received_numbers != expected_numbers:
        missing = len(set(expected_numbers) - set(received_numbers))
        raise MultipartUploadIncomplete(f"视频仍有 {missing} 个云存储分片未上传完成")
    completed: list[dict[str, Any]] = []
    for part in ordered:
        part_number = int(part["PartNumber"])
        expected_size = expected_multipart_part_size(session, part_number)
        # AWS S3 includes Size in ListParts, while Supabase's S3-compatible
        # endpoint currently omits it. Validate per-part sizes when available;
        # after completion validate_uploaded_object still enforces the exact
        # aggregate byte count from HeadObject for every provider.
        reported_size = part.get("Size")
        if reported_size is not None and int(reported_size) != expected_size:
            raise MultipartUploadIncomplete(f"云存储第 {part_number} 个视频分片大小不匹配")
        etag = str(part.get("ETag", "")).strip()
        if not etag:
            raise MultipartUploadIncomplete(f"云存储第 {part_number} 个视频分片缺少校验标识")
        completed.append({"ETag": etag, "PartNumber": part_number})
    return completed


def finish_multipart_upload(session: dict[str, Any]) -> None:
    parts = validate_multipart_parts(session, list_multipart_parts(session))
    get_storage_client().complete_multipart_upload(
        Bucket=S3_BUCKET_NAME,
        Key=str(session["object_key"]),
        UploadId=str(session["multipart_upload_id"]),
        MultipartUpload={"Parts": parts},
    )


def abort_multipart_upload(session: dict[str, Any]) -> None:
    if not is_multipart_session(session):
        return
    get_storage_client().abort_multipart_upload(
        Bucket=S3_BUCKET_NAME,
        Key=str(session["object_key"]),
        UploadId=str(session["multipart_upload_id"]),
    )


def head_uploaded_object(session: dict[str, Any]) -> dict[str, Any] | None:
    try:
        return get_storage_client().head_object(
            Bucket=S3_BUCKET_NAME,
            Key=str(session["object_key"]),
        )
    except ClientError as error:
        code = str((error.response or {}).get("Error", {}).get("Code", ""))
        if code in {"404", "NoSuchKey", "NotFound"}:
            return None
        raise


def validate_uploaded_object(session: dict[str, Any], head: dict[str, Any]) -> str:
    expected_size = int(session["total_size"])
    actual_size = int(head.get("ContentLength", -1))
    expected_type = str(session["content_type"])
    actual_type = str(head.get("ContentType", "")).split(";", 1)[0].strip().lower()
    if actual_size != expected_size:
        raise RuntimeError(f"云存储视频大小不匹配（预期 {expected_size} 字节，实际 {actual_size} 字节）")
    if actual_type != expected_type:
        raise RuntimeError("云存储视频类型与签名不匹配")
    # Keep the exact quoted entity-tag returned by S3/R2. Botocore forwards
    # IfMatch verbatim, while HTTP conditional requests require an entity-tag
    # (for example, `"d41d8cd98f00b204e9800998ecf8427e"`).
    etag = str(head.get("ETag", "")).strip()
    if not etag:
        raise RuntimeError("云存储没有返回视频校验标识")
    return etag


def update_job(job_id: str, **values: Any) -> None:
    with jobs_lock:
        jobs[job_id].update(values)


def public_brand(message: str) -> str:
    return (
        message
        .replace("HeartArt", "MoodTrack")
        .replace("Heart Art", "MoodTrack")
        .replace("GVMGEN", "MoodTrack")
        .replace("GVMGen", "MoodTrack")
        .replace("gvmgen", "MoodTrack")
        .replace("ACE-Step 1.5", "MoodTrack")
        .replace("ACE-Step", "MoodTrack")
    )


def upload_dir(upload_id: str) -> Path:
    return UPLOAD_ROOT / upload_id


def upload_metadata_path(upload_id: str) -> Path:
    return upload_dir(upload_id) / "session.json"


def persist_upload_session(session: dict[str, Any]) -> None:
    directory = upload_dir(session["id"])
    directory.mkdir(parents=True, exist_ok=True)
    metadata = upload_metadata_path(session["id"])
    temporary = metadata.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(session, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, metadata)


def load_upload_sessions() -> None:
    now = time.time()
    for metadata in UPLOAD_ROOT.glob("*/session.json"):
        session: dict[str, Any] | None = None
        try:
            session = json.loads(metadata.read_text(encoding="utf-8"))
            upload_id = str(session["id"])
            client_request_id = str(session["client_request_id"])
            created_at = float(session["created_at"])
            if not SAFE_ID.fullmatch(upload_id) or not SAFE_CLIENT_ID.fullmatch(client_request_id):
                raise ValueError("invalid upload metadata")
            session.setdefault("schema_version", 2)
            session.setdefault("backend", "chunked")
            # Jobs live only in memory. After a service restart, a persisted
            # upload pointing at an old job can no longer be resumed safely.
            if session.get("job_id"):
                if session.get("backend") == "object-store" and storage_configured():
                    try:
                        abort_multipart_upload(session)
                    except (BotoCoreError, ClientError):
                        pass
                    try:
                        get_storage_client().delete_object(Bucket=S3_BUCKET_NAME, Key=str(session["object_key"]))
                    except (BotoCoreError, ClientError):
                        pass
                shutil.rmtree(metadata.parent, ignore_errors=True)
                continue
            if now - created_at > UPLOAD_SESSION_TTL_SECONDS:
                if session.get("backend") == "object-store" and storage_configured():
                    try:
                        abort_multipart_upload(session)
                    except (BotoCoreError, ClientError):
                        pass
                    try:
                        get_storage_client().delete_object(Bucket=S3_BUCKET_NAME, Key=str(session["object_key"]))
                    except (BotoCoreError, ClientError):
                        pass
                shutil.rmtree(metadata.parent, ignore_errors=True)
                continue
            upload_sessions[upload_id] = session
            uploads_by_client[client_request_id] = upload_id
        except Exception:
            shutil.rmtree(metadata.parent, ignore_errors=True)


def cleanup_upload_sessions() -> None:
    now = time.time()
    expired: list[dict[str, Any]] = []
    with uploads_lock:
        for upload_id, session in list(upload_sessions.items()):
            if now - float(session.get("created_at", now)) <= UPLOAD_SESSION_TTL_SECONDS:
                continue
            job_id = str(session.get("job_id") or "")
            if job_id:
                with jobs_lock:
                    job = jobs.get(job_id)
                if job and job.get("status") not in {"completed", "failed"}:
                    continue
            expired.append(dict(session))
            upload_sessions.pop(upload_id, None)
            uploads_by_client.pop(str(session.get("client_request_id", "")), None)
    for session in expired:
        upload_id = str(session["id"])
        if session.get("backend") == "object-store" and storage_configured():
            try:
                abort_multipart_upload(session)
            except (BotoCoreError, ClientError):
                pass
            try:
                get_storage_client().delete_object(Bucket=S3_BUCKET_NAME, Key=str(session["object_key"]))
            except (BotoCoreError, ClientError):
                pass
        shutil.rmtree(upload_dir(upload_id), ignore_errors=True)


def get_upload_session(upload_id: str) -> dict[str, Any]:
    if not SAFE_ID.fullmatch(upload_id):
        raise HTTPException(status_code=404, detail="上传任务不存在")
    with uploads_lock:
        session = upload_sessions.get(upload_id)
        if not session:
            raise HTTPException(status_code=404, detail="上传任务不存在或已经过期")
        return dict(session)


def uploaded_chunk_indexes(session: dict[str, Any]) -> list[int]:
    if session.get("backend", "chunked") != "chunked":
        return []
    chunks = upload_dir(session["id"]) / "chunks"
    indexes: list[int] = []
    for index in range(int(session["total_chunks"])):
        start = index * int(session["chunk_size"])
        expected = min(int(session["chunk_size"]), int(session["total_size"]) - start)
        path = chunks / f"{index}.part"
        if path.is_file() and path.stat().st_size == expected:
            indexes.append(index)
    return indexes


def upload_payload(session: dict[str, Any]) -> dict[str, Any]:
    indexes = uploaded_chunk_indexes(session)
    uploaded_bytes = sum(
        min(int(session["chunk_size"]), int(session["total_size"]) - index * int(session["chunk_size"]))
        for index in indexes
    )
    return {
        "upload_id": session["id"],
        "filename": session["filename"],
        "total_size": session["total_size"],
        "chunk_size": session["chunk_size"],
        "total_chunks": session["total_chunks"],
        "uploaded_chunks": indexes,
        "uploaded_bytes": uploaded_bytes,
        "job_id": session.get("job_id"),
    }


def object_upload_payload(session: dict[str, Any], check_object: bool = False) -> dict[str, Any]:
    uploaded = False
    if session.get("job_id"):
        uploaded = True
    elif check_object:
        head = head_uploaded_object(session)
        if head is not None:
            validate_uploaded_object(session, head)
            uploaded = True
    payload: dict[str, Any] = {
        "upload_id": session["id"],
        "filename": session["filename"],
        "total_size": session["total_size"],
        "content_type": session["content_type"],
        "uploaded": uploaded,
        "job_id": session.get("job_id"),
    }
    if is_multipart_session(session):
        payload["upload_strategy"] = "multipart"
        payload["part_size"] = int(session["part_size"])
        payload["total_parts"] = int(session["total_parts"])
        existing_parts = list_multipart_parts(session) if check_object and not uploaded else []
        uploaded_parts = sorted(int(part["PartNumber"]) for part in existing_parts)
        payload["uploaded_parts"] = uploaded_parts
        if not uploaded:
            uploaded_set = set(uploaded_parts)
            payload["parts"] = [
                presigned_multipart_part(session, part_number)
                for part_number in range(1, int(session["total_parts"]) + 1)
                if part_number not in uploaded_set
            ]
    elif not uploaded:
        payload["upload_strategy"] = "single"
        payload.update(create_presigned_upload(session))
    else:
        payload["upload_strategy"] = "single"
    return payload


load_upload_sessions()


def get_model():
    global model
    with model_lock:
        if model is not None:
            return model
        if not torch.cuda.is_available():
            raise RuntimeError("MoodTrack CUDA 环境未就绪")
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
                        f"MoodTrack checkpoint mismatch: missing={invalid_missing}, unexpected={incompatible.unexpected_keys}"
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


def render_video(video_path: Path, audio_path: Path, output_path: Path) -> None:
    ffmpeg = str(FFMPEG if FFMPEG.exists() else "ffmpeg")
    # The worker already emits an exact, faded sample count. Let that audio be
    # the duration authority so ffmpeg does not introduce a second hard trim.
    base = [ffmpeg, "-y", "-i", str(video_path), "-i", str(audio_path), "-map", "0:v:0", "-map", "1:a:0"]
    copy_command = [*base, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", str(output_path)]
    completed = subprocess.run(copy_command, capture_output=True, text=True)
    if completed.returncode == 0:
        return
    encode_command = [*base, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", str(output_path)]
    subprocess.run(encode_command, check=True, capture_output=True, text=True)


def normalize_video(video_path: Path, output_path: Path, duration: float) -> None:
    ffmpeg = str(FFMPEG if FFMPEG.exists() else "ffmpeg")
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(video_path),
            "-t",
            f"{duration:.6f}",
            "-an",
            "-vf",
            "fps=30",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(output_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )


def download_object_video(job_id: str, session: dict[str, Any], video_path: Path) -> None:
    client = get_storage_client()
    head = head_uploaded_object(session)
    if head is None:
        raise RuntimeError("云存储中还没有收到这个视频")
    etag = validate_uploaded_object(session, head)
    temporary = video_path.with_suffix(f"{video_path.suffix}.part")
    received = 0
    body = None
    try:
        response = client.get_object(
            Bucket=S3_BUCKET_NAME,
            Key=str(session["object_key"]),
            IfMatch=etag,
        )
        body = response["Body"]
        with temporary.open("wb") as destination:
            while block := body.read(1024 * 1024):
                received += len(block)
                if received > MAX_UPLOAD_BYTES or received > int(session["total_size"]):
                    raise RuntimeError("云存储视频超过允许大小")
                destination.write(block)
        if received != int(session["total_size"]):
            raise RuntimeError("云存储视频下载不完整")
        os.replace(temporary, video_path)
        update_job(job_id, progress=26, message="视频已从云存储高速下载到本机，正在准备生成…")
        try:
            client.delete_object(Bucket=S3_BUCKET_NAME, Key=str(session["object_key"]))
        except (BotoCoreError, ClientError):
            # Application-level expiry cleanup retries orphan removal later.
            pass
    finally:
        if body is not None:
            body.close()
        temporary.unlink(missing_ok=True)


def run_object_generation(job_id: str, session: dict[str, Any]) -> None:
    job_dir = OUTPUT_ROOT / job_id
    video_path = job_dir / f"source{session['suffix']}"
    try:
        update_job(job_id, status="loading", progress=22, message="正在从云存储高速下载视频到本机…")
        download_object_video(job_id, session, video_path)
        run_generation(job_id, video_path, int(session["duration"]))
    except Exception as error:
        if storage_configured():
            try:
                get_storage_client().delete_object(Bucket=S3_BUCKET_NAME, Key=str(session["object_key"]))
            except (BotoCoreError, ClientError):
                pass
        update_job(
            job_id,
            status="failed",
            progress=100,
            message="MoodTrack 视频准备失败",
            error=public_brand(storage_error_detail(error, str(error))),
        )


def run_generation(job_id: str, video_path: Path, requested_duration: int) -> None:
    job_dir = OUTPUT_ROOT / job_id
    audio_path = job_dir / "music.wav"
    analysis_path = job_dir / "analysis.mp4"
    rendered_path = job_dir / "rendered-video.mp4"
    metadata_path = job_dir / "worker-result.json"
    generation_seed = int(job_id[:16], 16) % (2**63 - 1)
    try:
        source_duration = video_duration(video_path)
        final_duration = min(source_duration, 30.0)
        if final_duration <= 0:
            raise RuntimeError("MoodTrack could not read a positive video duration")
        update_job(job_id, status="loading", progress=28, message="正在加载 MoodTrack 视频配乐模型…")
        update_job(job_id, status="generating", progress=40, message="MoodTrack 正在进行空间层级注意力分析…")
        normalize_video(video_path, analysis_path, final_duration)
        worker = subprocess.run(
            [
                sys.executable,
                str(APP_ROOT / "services" / "gvmgen_worker.py"),
                "--video", str(analysis_path),
                "--audio", str(audio_path),
                "--metadata", str(metadata_path),
                "--duration", f"{final_duration:.9f}",
                "--seed", str(generation_seed),
            ],
            cwd=str(APP_ROOT),
            capture_output=True,
            text=True,
            timeout=19 * 60,
        )
        if worker.returncode != 0:
            details = public_brand((worker.stderr or worker.stdout or "MoodTrack worker failed").strip())
            raise RuntimeError(details[-4_000:])
        worker_metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        sample_rate = int(worker_metadata["sample_rate"])
        final_samples = int(worker_metadata["final_samples"])
        if sample_rate <= 0 or final_samples <= 0:
            raise RuntimeError("MoodTrack worker returned invalid audio metadata")
        duration = final_samples / sample_rate
        if abs(duration - final_duration) > (0.5 / sample_rate):
            raise RuntimeError("MoodTrack worker audio duration does not match the video")

        update_job(job_id, status="rendering", progress=84, message="正在把音乐与视频对齐渲染…")
        render_video(video_path, audio_path, rendered_path)
        update_job(
            job_id,
            status="completed",
            progress=100,
            message="MoodTrack 配乐与视频渲染完成",
            duration=duration,
            audio_url=f"/files/{job_id}/music.wav",
            video_url=f"/files/{job_id}/rendered-video.mp4",
        )
    except Exception as error:
        update_job(job_id, status="failed", progress=100, message="MoodTrack 生成失败", error=public_brand(str(error)))


@app.get("/health")
def health() -> dict[str, Any]:
    object_store = storage_configured()
    return {
        "ready": model_ready(),
        "cuda": torch.cuda.is_available(),
        "model": "MoodTrack-Video2Music",
        "service_version": SERVICE_VERSION,
        "upload_mode": "object-store" if object_store else "chunked",
        "storage_ready": object_store,
        "storage_provider": STORAGE_PROVIDER if object_store else None,
        "max_upload_bytes": MAX_UPLOAD_BYTES,
        "chunk_size": UPLOAD_CHUNK_BYTES,
    }


@app.post("/object-uploads", status_code=201)
async def create_object_upload(request: Request) -> dict[str, Any]:
    if not model_ready():
        raise HTTPException(status_code=503, detail="MoodTrack 视频模型正在准备，请稍后再试")
    if not storage_configured():
        raise HTTPException(status_code=503, detail="视频云存储直传尚未配置")
    cleanup_upload_sessions()
    try:
        payload = await request.json()
        raw_filename = str(payload.get("filename", ""))
        filename = Path(raw_filename).name
        total_size = int(payload.get("size", 0))
        duration = max(5, min(int(payload.get("duration", 30)), 30))
        client_request_id = str(payload.get("client_request_id", ""))
    except (AttributeError, TypeError, ValueError, json.JSONDecodeError):
        raise HTTPException(status_code=400, detail="上传参数无效") from None
    suffix = Path(filename).suffix.lower()
    if not filename or suffix not in ALLOWED_VIDEO_SUFFIXES:
        raise HTTPException(status_code=400, detail="请上传 MP4、MOV、M4V 或 WebM 视频")
    if total_size <= 0 or total_size > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"视频不能超过 {MAX_UPLOAD_BYTES // (1024 * 1024)}MB")
    if not SAFE_CLIENT_ID.fullmatch(client_request_id):
        raise HTTPException(status_code=400, detail="上传请求编号无效")

    with uploads_lock:
        existing_id = uploads_by_client.get(client_request_id)
        if existing_id:
            existing = upload_sessions.get(existing_id)
            if existing:
                if existing.get("backend") != "object-store":
                    raise HTTPException(status_code=409, detail="旧版上传任务不能用于云存储直传，请重新选择视频")
                if int(existing["total_size"]) != total_size or str(existing["filename"]) != filename:
                    raise HTTPException(status_code=409, detail="上传请求编号已用于另一个文件")
                try:
                    return object_upload_payload(dict(existing), check_object=True)
                except (BotoCoreError, ClientError) as error:
                    raise HTTPException(status_code=503, detail=storage_error_detail(error, "视频云存储暂时不可用")) from None

        upload_id = uuid.uuid4().hex
        session = {
            "id": upload_id,
            "schema_version": 4,
            "backend": "object-store",
            "client_request_id": client_request_id,
            "filename": filename,
            "suffix": suffix,
            "content_type": VIDEO_CONTENT_TYPES[suffix],
            "total_size": total_size,
            "duration": duration,
            "object_key": object_key(upload_id, suffix),
            "created_at": time.time(),
            "job_id": None,
        }
        if total_size > MULTIPART_THRESHOLD_BYTES:
            try:
                start_multipart_upload(session)
            except (BotoCoreError, ClientError) as error:
                raise HTTPException(
                    status_code=503,
                    detail=storage_error_detail(error, "无法创建云存储分片上传任务"),
                ) from None
        persist_upload_session(session)
        upload_sessions[upload_id] = session
        uploads_by_client[client_request_id] = upload_id
    try:
        return object_upload_payload(dict(session))
    except (BotoCoreError, ClientError) as error:
        raise HTTPException(status_code=503, detail=storage_error_detail(error, "无法创建云存储上传地址")) from None


@app.get("/object-uploads/{upload_id}")
def object_upload_status(upload_id: str) -> dict[str, Any]:
    session = get_upload_session(upload_id)
    if session.get("backend") != "object-store":
        raise HTTPException(status_code=410, detail="这是旧版分片上传任务，不能恢复为云存储直传")
    try:
        return object_upload_payload(session, check_object=True)
    except (BotoCoreError, ClientError) as error:
        raise HTTPException(status_code=503, detail=storage_error_detail(error, "视频云存储暂时不可用")) from None
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from None


@app.post("/object-uploads/{upload_id}/complete", status_code=202)
def complete_object_upload(upload_id: str) -> dict[str, str]:
    session = get_upload_session(upload_id)
    if session.get("backend") != "object-store":
        raise HTTPException(status_code=410, detail="这是旧版分片上传任务，不能提交为云存储任务")
    if session.get("job_id"):
        return {"job_id": str(session["job_id"])}

    with submission_lock:
        with uploads_lock:
            live_session = upload_sessions.get(upload_id)
            if not live_session:
                raise HTTPException(status_code=404, detail="上传任务不存在或已经过期")
            if live_session.get("job_id"):
                return {"job_id": str(live_session["job_id"])}
        with jobs_lock:
            if any(job["status"] not in {"completed", "failed"} for job in jobs.values()):
                raise HTTPException(status_code=429, detail="MoodTrack 正在处理另一个视频，请稍后再点击生成")
        try:
            head = head_uploaded_object(session)
            if head is None and is_multipart_session(session):
                finish_multipart_upload(session)
                head = head_uploaded_object(session)
            if head is None:
                raise HTTPException(status_code=409, detail="云存储视频尚未上传完成")
            validate_uploaded_object(session, head)
        except HTTPException:
            raise
        except MultipartUploadIncomplete as error:
            raise HTTPException(status_code=409, detail=str(error)) from None
        except (BotoCoreError, ClientError) as error:
            raise HTTPException(status_code=503, detail=storage_error_detail(error, "视频云存储暂时不可用")) from None
        except RuntimeError as error:
            try:
                get_storage_client().delete_object(Bucket=S3_BUCKET_NAME, Key=str(session["object_key"]))
            except (BotoCoreError, ClientError):
                pass
            raise HTTPException(status_code=409, detail=str(error)) from None

        job_id = uuid.uuid4().hex
        job_dir = OUTPUT_ROOT / job_id
        job_dir.mkdir(parents=True, exist_ok=False)
        with jobs_lock:
            jobs[job_id] = {
                "id": job_id,
                "status": "queued",
                "progress": 20,
                "message": "视频已直传云存储，正在等待本机高速下载…",
            }
        with uploads_lock:
            live_session = upload_sessions[upload_id]
            live_session["job_id"] = job_id
            persist_upload_session(live_session)
        executor.submit(run_object_generation, job_id, dict(session))
        return {"job_id": job_id}


@app.post("/uploads", status_code=201)
async def create_upload(request: Request) -> dict[str, Any]:
    if not model_ready():
        raise HTTPException(status_code=503, detail="MoodTrack 视频模型正在准备，请稍后再试")
    cleanup_upload_sessions()
    try:
        payload = await request.json()
        raw_filename = str(payload.get("filename", ""))
        filename = Path(raw_filename).name
        total_size = int(payload.get("size", 0))
        duration = max(5, min(int(payload.get("duration", 30)), 30))
        client_request_id = str(payload.get("client_request_id", ""))
    except (AttributeError, TypeError, ValueError, json.JSONDecodeError):
        raise HTTPException(status_code=400, detail="上传参数无效") from None
    suffix = Path(filename).suffix.lower()
    if not filename or suffix not in ALLOWED_VIDEO_SUFFIXES:
        raise HTTPException(status_code=400, detail="请上传 MP4、MOV、M4V 或 WebM 视频")
    if total_size <= 0 or total_size > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"视频不能超过 {MAX_UPLOAD_BYTES // (1024 * 1024)}MB")
    if not SAFE_CLIENT_ID.fullmatch(client_request_id):
        raise HTTPException(status_code=400, detail="上传请求编号无效")

    with uploads_lock:
        existing_id = uploads_by_client.get(client_request_id)
        if existing_id:
            existing = upload_sessions.get(existing_id)
            if existing:
                if int(existing["total_size"]) != total_size or str(existing["filename"]) != filename:
                    raise HTTPException(status_code=409, detail="上传请求编号已用于另一个文件")
                return upload_payload(dict(existing))

        upload_id = uuid.uuid4().hex
        total_chunks = (total_size + UPLOAD_CHUNK_BYTES - 1) // UPLOAD_CHUNK_BYTES
        session = {
            "id": upload_id,
            "schema_version": 2,
            "backend": "chunked",
            "client_request_id": client_request_id,
            "filename": filename,
            "suffix": suffix,
            "total_size": total_size,
            "duration": duration,
            "chunk_size": UPLOAD_CHUNK_BYTES,
            "total_chunks": total_chunks,
            "created_at": time.time(),
            "job_id": None,
        }
        directory = upload_dir(upload_id)
        (directory / "chunks").mkdir(parents=True, exist_ok=False)
        persist_upload_session(session)
        upload_sessions[upload_id] = session
        uploads_by_client[client_request_id] = upload_id
        return upload_payload(dict(session))


@app.get("/uploads/{upload_id}")
def upload_status(upload_id: str) -> dict[str, Any]:
    session = get_upload_session(upload_id)
    if session.get("backend", "chunked") != "chunked":
        raise HTTPException(status_code=410, detail="这是云存储直传任务，不能作为分片任务恢复")
    return upload_payload(session)


@app.put("/uploads/{upload_id}/chunks/{index}")
async def upload_chunk(upload_id: str, index: int, request: Request) -> dict[str, Any]:
    session = get_upload_session(upload_id)
    if session.get("backend", "chunked") != "chunked":
        raise HTTPException(status_code=410, detail="云存储直传任务不接受本地分片")
    total_chunks = int(session["total_chunks"])
    chunk_size = int(session["chunk_size"])
    total_size = int(session["total_size"])
    if session.get("job_id"):
        return upload_payload(session)
    if index < 0 or index >= total_chunks:
        raise HTTPException(status_code=416, detail="视频分片编号超出范围")
    start = index * chunk_size
    expected_size = min(chunk_size, total_size - start)
    expected_range = f"bytes {start}-{start + expected_size - 1}/{total_size}"
    if request.headers.get("content-range") != expected_range:
        raise HTTPException(status_code=409, detail="视频分片位置不匹配，请重新续传")
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) != expected_size:
                raise HTTPException(status_code=400, detail="视频分片大小不正确")
        except ValueError:
            raise HTTPException(status_code=400, detail="视频分片长度无效") from None

    chunks = upload_dir(upload_id) / "chunks"
    destination = chunks / f"{index}.part"
    if destination.is_file() and destination.stat().st_size == expected_size:
        return upload_payload(session)

    temporary = chunks / f".{index}.{uuid.uuid4().hex}.tmp"
    received = 0
    try:
        with temporary.open("wb") as output:
            async for block in request.stream():
                received += len(block)
                if received > expected_size:
                    raise HTTPException(status_code=413, detail="视频分片超过允许大小")
                output.write(block)
        if received != expected_size:
            raise HTTPException(status_code=400, detail="视频分片接收不完整，将自动重试")
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return upload_payload(session)


@app.post("/uploads/{upload_id}/complete", status_code=202)
def complete_upload(upload_id: str) -> dict[str, str]:
    session = get_upload_session(upload_id)
    if session.get("backend", "chunked") != "chunked":
        raise HTTPException(status_code=410, detail="云存储直传任务不能作为分片任务提交")
    if session.get("job_id"):
        return {"job_id": str(session["job_id"])}
    indexes = uploaded_chunk_indexes(session)
    if len(indexes) != int(session["total_chunks"]):
        raise HTTPException(
            status_code=409,
            detail=f"视频仍有 {int(session['total_chunks']) - len(indexes)} 个分片未上传完成",
        )

    with submission_lock:
        with uploads_lock:
            live_session = upload_sessions.get(upload_id)
            if not live_session:
                raise HTTPException(status_code=404, detail="上传任务不存在或已经过期")
            if live_session.get("job_id"):
                return {"job_id": str(live_session["job_id"])}
        with jobs_lock:
            if any(job["status"] not in {"completed", "failed"} for job in jobs.values()):
                raise HTTPException(status_code=429, detail="MoodTrack 正在处理另一个视频，请稍后再次点击生成")

        job_id = uuid.uuid4().hex
        job_dir = OUTPUT_ROOT / job_id
        job_dir.mkdir(parents=True, exist_ok=False)
        temporary_video = job_dir / f"source{session['suffix']}.part"
        video_path = job_dir / f"source{session['suffix']}"
        try:
            with temporary_video.open("wb") as destination:
                for index in range(int(session["total_chunks"])):
                    with (upload_dir(upload_id) / "chunks" / f"{index}.part").open("rb") as source:
                        shutil.copyfileobj(source, destination, length=1024 * 1024)
            if temporary_video.stat().st_size != int(session["total_size"]):
                raise RuntimeError("合并后的视频大小不正确")
            os.replace(temporary_video, video_path)
        except Exception:
            shutil.rmtree(job_dir, ignore_errors=True)
            raise

        with jobs_lock:
            jobs[job_id] = {
                "id": job_id,
                "status": "queued",
                "progress": 20,
                "message": "视频已安全上传，等待 MoodTrack 生成…",
            }
        with uploads_lock:
            live_session = upload_sessions[upload_id]
            live_session["job_id"] = job_id
            persist_upload_session(live_session)
        shutil.rmtree(upload_dir(upload_id) / "chunks", ignore_errors=True)
        executor.submit(run_generation, job_id, video_path, int(session["duration"]))
        return {"job_id": job_id}


@app.post("/generate")
async def generate(video: UploadFile = File(...), duration: int = Form(30)) -> dict[str, str]:
    if not model_ready():
        raise HTTPException(status_code=503, detail="MoodTrack 模型正在准备，请稍后再试")
    if not video.filename or Path(video.filename).suffix.lower() not in ALLOWED_VIDEO_SUFFIXES:
        raise HTTPException(status_code=400, detail="请上传 MP4、MOV、M4V 或 WebM 视频")
    job_id = uuid.uuid4().hex
    with jobs_lock:
        if any(job["status"] not in {"completed", "failed"} for job in jobs.values()):
            raise HTTPException(status_code=429, detail="MoodTrack 正在处理另一个视频，请稍后再试")
        jobs[job_id] = {"id": job_id, "status": "uploading", "progress": 4, "message": "正在接收视频…"}
    job_dir = OUTPUT_ROOT / job_id
    try:
        job_dir.mkdir(parents=True, exist_ok=False)
        suffix = Path(video.filename).suffix.lower()
        video_path = job_dir / f"source{suffix}"
        size = 0
        with video_path.open("wb") as destination:
            while chunk := await video.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail=f"视频不能超过 {MAX_UPLOAD_BYTES // (1024 * 1024)}MB")
                destination.write(chunk)
        await video.close()
        update_job(job_id, status="queued", progress=10, message="视频已上传，等待 MoodTrack…")
    except Exception:
        update_job(job_id, status="failed", progress=100, message="视频上传失败")
        raise
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
def download(job_id: str, filename: str, request: Request):
    if filename not in {"music.wav", "rendered-video.mp4"}:
        raise HTTPException(status_code=404, detail="文件不存在")
    path = (OUTPUT_ROOT / job_id / filename).resolve()
    if not path.is_file() or path.parent != (OUTPUT_ROOT / job_id).resolve():
        raise HTTPException(status_code=404, detail="文件不存在")
    media_type = "audio/wav" if filename.endswith(".wav") else "video/mp4"
    return media_response(path, media_type, request.headers.get("range"))
