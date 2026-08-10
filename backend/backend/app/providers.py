import json
import os
import shutil
import tempfile
import time
import wave
from pathlib import Path
from urllib.parse import quote, urlparse

import requests


class MusicGenerationProvider:
    name = "base"

    def generate_text2music(self, prompt: str, duration: int, output_path: Path) -> Path:
        raise NotImplementedError

    def repaint(self, source_audio: Path, start_time: int, end_time: int, instruction: str, output_path: Path) -> Path:
        raise NotImplementedError


class MockProvider(MusicGenerationProvider):
    name = "mock"

    def generate_text2music(self, prompt: str, duration: int, output_path: Path) -> Path:
        create_silent_wav(output_path, min(duration, 10))
        return output_path

    def repaint(self, source_audio: Path, start_time: int, end_time: int, instruction: str, output_path: Path) -> Path:
        shutil.copyfile(source_audio, output_path)
        return output_path


class AceStepProvider(MusicGenerationProvider):
    name = "acestep"

    def __init__(self, base_url: str, token: str = "no-token"):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = int(os.getenv("ACESTEP_TIMEOUT_SECONDS", "3600"))
        self.poll_interval = float(os.getenv("ACESTEP_POLL_INTERVAL", "2"))
        self.request_timeout = float(os.getenv("ACESTEP_REQUEST_TIMEOUT_SECONDS", "300"))

    def generate_text2music(self, prompt: str, duration: int, output_path: Path) -> Path:
        task_id = self.release_task(
            {
                "task_type": "text2music",
                "prompt": prompt[:512],
                "lyrics": "[Instrumental]",
                "audio_duration": duration,
                "audio_format": output_path.suffix.lstrip(".") or "wav",
                "batch_size": 1,
                "inference_steps": int(os.getenv("ACESTEP_INFERENCE_STEPS", "8")),
                "shift": float(os.getenv("ACESTEP_SHIFT", "3.0")),
                "infer_method": os.getenv("ACESTEP_INFER_METHOD", "ode"),
                "thinking": os.getenv("ACESTEP_THINKING", "false").lower() == "true",
                "use_random_seed": True,
            }
        )
        audio_file = self.wait_for_audio_file(task_id)
        self.download_audio(audio_file, output_path)
        return output_path

    def repaint(self, source_audio: Path, start_time: int, end_time: int, instruction: str, output_path: Path) -> Path:
        temp_source_path = self.copy_audio_to_temp(source_audio)
        try:
            task_id = self.release_task(
                {
                    "task_type": "repaint",
                    "prompt": instruction[:512],
                    "src_audio_path": str(temp_source_path),
                    "repainting_start": float(start_time),
                    "repainting_end": float(end_time),
                    "audio_format": output_path.suffix.lstrip(".") or "wav",
                    "batch_size": 1,
                    "inference_steps": int(os.getenv("ACESTEP_INFERENCE_STEPS", "8")),
                    "shift": float(os.getenv("ACESTEP_SHIFT", "3.0")),
                    "infer_method": os.getenv("ACESTEP_INFER_METHOD", "ode"),
                }
            )
            audio_file = self.wait_for_audio_file(task_id)
            self.download_audio(audio_file, output_path)
            return output_path
        finally:
            try:
                temp_source_path.unlink(missing_ok=True)
            except OSError:
                pass

    def release_task(self, payload: dict) -> str:
        response = requests.post(
            f"{self.base_url}/release_task",
            json=payload,
            headers=self.auth_headers(),
            timeout=self.request_timeout,
        )
        response.raise_for_status()
        body = response.json()
        task_id = (body.get("data") or {}).get("task_id")
        if not task_id:
            raise RuntimeError(f"ACE-Step /release_task did not return task_id: {body}")
        return task_id

    def wait_for_audio_file(self, task_id: str) -> str:
        deadline = time.time() + self.timeout
        last_payload = None
        while time.time() < deadline:
            try:
                payload = self.query_result(task_id)
                last_payload = payload
            except requests.Timeout as exc:
                last_payload = {"timeout": str(exc)}
                time.sleep(self.poll_interval)
                continue
            status = payload.get("status")
            result_items = parse_result_items(payload.get("result"))
            if status == 1 and result_items:
                file_path = result_items[0].get("file")
                if file_path:
                    return file_path
            if status == 2:
                raise RuntimeError(f"ACE-Step task failed: {payload}")
            time.sleep(self.poll_interval)
        raise TimeoutError(f"ACE-Step task timed out: {task_id}, last={last_payload}")

    def query_result(self, task_id: str) -> dict:
        response = requests.post(
            f"{self.base_url}/query_result",
            json={"task_id_list": json.dumps([task_id])},
            headers=self.auth_headers(),
            timeout=self.request_timeout,
        )
        response.raise_for_status()
        body = response.json()
        data = body.get("data") or []
        if not data:
            raise RuntimeError(f"ACE-Step /query_result returned empty data: {body}")
        return data[0]

    def download_audio(self, audio_file: str, output_path: Path) -> None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        if audio_file.startswith("/v1/audio"):
            url = f"{self.base_url}{audio_file}"
        elif audio_file.startswith("http://") or audio_file.startswith("https://"):
            parsed = urlparse(audio_file)
            if parsed.path == "/v1/audio":
                url = f"{self.base_url}/v1/audio?{parsed.query}"
            else:
                url = audio_file
        else:
            url = f"{self.base_url}/v1/audio?path={quote(audio_file, safe='')}"
        with requests.get(url, headers=self.auth_headers(), stream=True, timeout=1800) as response:
            response.raise_for_status()
            with output_path.open("wb") as file:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        file.write(chunk)

    def auth_headers(self) -> dict:
        return {"Authorization": f"Bearer {self.token}"}

    def copy_audio_to_temp(self, source_audio: Path) -> Path:
        suffix = source_audio.suffix or ".wav"
        fd, temp_path = tempfile.mkstemp(prefix="moodtrack_repaint_", suffix=suffix)
        os.close(fd)
        target = Path(temp_path)
        shutil.copyfile(source_audio, target)
        return target


def get_provider() -> MusicGenerationProvider:
    provider = os.getenv("MUSIC_PROVIDER", "acestep").lower()
    if provider == "mock":
        return MockProvider()
    return AceStepProvider(
        base_url=os.getenv("ACESTEP_API_URL", "http://localhost:8080"),
        token=os.getenv("ACESTEP_API_TOKEN", "no-token"),
    )


def parse_result_items(raw_result) -> list[dict]:
    if isinstance(raw_result, list):
        return raw_result
    if isinstance(raw_result, str):
        try:
            value = json.loads(raw_result)
            return value if isinstance(value, list) else []
        except json.JSONDecodeError:
            return []
    return []


def create_silent_wav(output_path: Path, duration: int) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    sample_rate = 44100
    frames = sample_rate * max(1, duration)
    with wave.open(str(output_path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(b"\x00\x00" * frames)
