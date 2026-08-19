from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import torch

FRONTEND_ROOT = Path(__file__).resolve().parents[1]
if str(FRONTEND_ROOT) not in sys.path:
    sys.path.insert(0, str(FRONTEND_ROOT))

try:
    from services import gvmgen_service as service
except ModuleNotFoundError:
    service = None
from services import gvmgen_worker as worker


class WorkerAudioTest(unittest.TestCase):
    def test_short_conditioning_frames_are_looped_to_fifteen(self) -> None:
        frames = torch.arange(6, dtype=torch.float32).reshape(6, 1)

        conditioned = worker.loop_conditioning_frames(frames, 15)

        self.assertEqual(tuple(conditioned.shape), (15, 1))
        self.assertEqual(conditioned[:, 0].tolist(), [0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5, 0, 1, 2])

    def test_trim_is_sample_exact_and_fades_both_ends(self) -> None:
        waveform = torch.ones(1, 20)

        final, fade_samples = worker.trim_pad_and_fade(
            waveform,
            sample_rate=10,
            duration=1.5,
            fade_seconds=0.2,
        )

        self.assertEqual(final.shape[-1], 15)
        self.assertEqual(fade_samples, 2)
        self.assertEqual(float(final[0, 0]), 0.0)
        self.assertEqual(float(final[0, -1]), 0.0)
        self.assertEqual(float(final[0, 7]), 1.0)

    def test_padding_fades_the_real_content_before_silence(self) -> None:
        waveform = torch.ones(1, 5)

        final, _ = worker.trim_pad_and_fade(
            waveform,
            sample_rate=10,
            duration=1.0,
            fade_seconds=0.2,
        )

        self.assertEqual(final.shape[-1], 10)
        self.assertEqual(float(final[0, 4]), 0.0)
        self.assertTrue(torch.equal(final[0, 5:], torch.zeros(5)))

    def test_official_loudness_target_and_peak_ceiling_are_enforced(self) -> None:
        measured = []

        def fake_loudness_meter(waveform: torch.Tensor) -> torch.Tensor:
            measured.append(waveform)
            return torch.tensor(-20.0)

        normalized = worker.normalize_for_delivery(
            torch.ones(1, 100),
            sample_rate=32_000,
            loudness_meter=fake_loudness_meter,
        )

        self.assertEqual(len(measured), 1)
        self.assertEqual(worker.LOUDNESS_HEADROOM_DB, 14.0)
        expected_ceiling = 10 ** (-1 / 20)
        self.assertLessEqual(float(normalized.abs().max()), expected_ceiling + 1e-6)


@unittest.skipIf(service is None, "optional GVMGen service test dependencies are not installed")
class ServiceAudioAlignmentTest(unittest.TestCase):
    def test_render_relies_on_exact_faded_audio_without_second_time_trim(self) -> None:
        completed = subprocess.CompletedProcess([], 0, "", "")
        with mock.patch.object(service.subprocess, "run", return_value=completed) as run:
            service.render_video(Path("source.mp4"), Path("music.wav"), Path("rendered.mp4"))

        command = run.call_args.args[0]
        self.assertNotIn("-t", command)
        self.assertIn("-shortest", command)
        self.assertEqual(command[command.index("-map") + 1], "0:v:0")

    def test_generation_uses_precise_source_duration_and_sample_metadata(self) -> None:
        job_id = "0123456789abcdef0123456789abcdef"
        source_duration = 6.016713
        sample_rate = 32_000
        calls = {}

        def fake_worker(command, **kwargs):
            del kwargs
            calls["worker_command"] = command
            target_duration = float(command[command.index("--duration") + 1])
            metadata_path = Path(command[command.index("--metadata") + 1])
            final_samples = round(target_duration * sample_rate)
            metadata_path.write_text(
                json.dumps({
                    "duration": final_samples / sample_rate,
                    "final_duration": final_samples / sample_rate,
                    "sample_rate": sample_rate,
                    "final_samples": final_samples,
                }),
                encoding="utf-8",
            )
            return subprocess.CompletedProcess(command, 0, "", "")

        with tempfile.TemporaryDirectory() as temporary:
            original_output_root = service.OUTPUT_ROOT
            service.OUTPUT_ROOT = Path(temporary)
            (service.OUTPUT_ROOT / job_id).mkdir()
            service.jobs[job_id] = {}
            try:
                with (
                    mock.patch.object(service, "video_duration", return_value=source_duration),
                    mock.patch.object(service, "normalize_video", side_effect=lambda video, output, duration: calls.update(normalized_duration=duration)),
                    mock.patch.object(service, "render_video", side_effect=lambda *args: calls.update(render_args=args)),
                    mock.patch.object(service.subprocess, "run", side_effect=fake_worker),
                ):
                    service.run_generation(job_id, Path("source.mp4"), requested_duration=15)
                completed_duration = service.jobs[job_id]["duration"]
            finally:
                service.jobs.pop(job_id, None)
                service.OUTPUT_ROOT = original_output_root

        self.assertAlmostEqual(calls["normalized_duration"], source_duration, places=6)
        worker_duration = float(calls["worker_command"][calls["worker_command"].index("--duration") + 1])
        self.assertAlmostEqual(worker_duration, source_duration, places=6)
        self.assertEqual(len(calls["render_args"]), 3)
        self.assertAlmostEqual(completed_duration, source_duration, places=4)


if __name__ == "__main__":
    unittest.main()
