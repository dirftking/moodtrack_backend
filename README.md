# MoodTrack

MoodTrack is a Vue/Vite music-creation interface with a local ACE-Step 1.5
generation API. The browser application runs on port `5173`; ACE-Step runs on
`127.0.0.1:8001` and is exposed to the app through `/ace-step`.

## Project layout

```text
frontend/                         Vue 3 + Vite application and local watchdog
frontend/services/ACE-Step-1.5/   ACE-Step 1.5 inference service
backend/                          Earlier standalone backend implementation
heartbeat/                        HeartArt/Video2Music application variant
services/GVMGen/                  Video-to-music service source
```

## Requirements

- Windows 10/11 and PowerShell 7 or Windows PowerShell
- Python 3.11 or 3.12
- [uv](https://docs.astral.sh/uv/) available on `PATH`
- Node.js 18+ and pnpm
- NVIDIA driver and CUDA-capable GPU recommended (the checked-in configuration
  uses `cuda`)
- Internet access on the first run so ACE-Step can fetch its model weights

Model weights, virtual environments, generated audio, and local databases are
intentionally ignored by Git. They must be downloaded or generated locally.

## ACE-Step setup

### 1. Install the ACE-Step environment

```powershell
cd frontend\services\ACE-Step-1.5
uv sync
```

`uv sync` creates the local environment and installs the dependency versions
defined by ACE-Step. Do not commit the resulting `.venv` directory.

### 2. Configure the API

The project startup script is
[`frontend/scripts/start-ace-step.ps1`](frontend/scripts/start-ace-step.ps1).
It sets the following defaults before it invokes `uv run acestep-api`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `ACESTEP_API_HOST` | `127.0.0.1` | Local-only API binding |
| `ACESTEP_API_PORT` | `8001` | ACE-Step HTTP port |
| `ACESTEP_CONFIG_PATH` | `acestep-v15-turbo` | Main inference model |
| `ACESTEP_INIT_LLM` | `true` | Load the language model at startup |
| `ACESTEP_LM_MODEL_PATH` | `acestep-5Hz-lm-1.7B` | Language-model checkpoint |
| `ACESTEP_LM_BACKEND` | `pt` | PyTorch language-model backend |
| `ACESTEP_DEVICE` | `cuda` | Inference device; use `cpu` only for troubleshooting |
| `ACESTEP_BATCH_SIZE` | `1` | GPU batch size; keep at `1` on lower-VRAM cards |
| `ACESTEP_DOWNLOAD_SOURCE` | `auto` | Automatically obtain missing supported weights |

For a different GPU setup, copy the script or set variables in the PowerShell
session before starting it. For example, to run on CPU for a connectivity test:

```powershell
$env:ACESTEP_DEVICE = 'cpu'
$env:ACESTEP_BATCH_SIZE = '1'
uv run acestep-api
```

CPU inference is much slower and is not suitable for normal music generation.

### 3. Start ACE-Step

From `frontend`, run:

```powershell
.\scripts\start-ace-step.ps1
```

On the first start, wait for model initialization to finish. Confirm that the
API is ready in a second PowerShell window:

```powershell
Invoke-RestMethod http://127.0.0.1:8001/health
```

The response should contain `status: ok` and `models_initialized: true`.

## Start MoodTrack

```powershell
cd frontend
pnpm install
pnpm dev
```

Open <http://127.0.0.1:5173/>. With ACE-Step running, verify the Vite proxy:

```powershell
Invoke-RestMethod http://127.0.0.1:5173/ace-step/health
```

## Start the local watchdog

The watchdog verifies the Vite app, ACE-Step API, and Cloudflare tunnel. Run
it in a dedicated PowerShell window from `frontend`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\watchdog.ps1
```

It only restarts a component when that component has exited. Do not run
multiple watchdog instances at the same time.

## Troubleshooting

- **`uv` is not found:** install uv, reopen PowerShell, then run `uv --version`.
- **ACE-Step health check fails:** inspect the ACE-Step terminal first; verify
  Python, CUDA driver compatibility, available disk space, and model download.
- **`models_initialized` is false:** wait for the first model load or remove a
  partial checkpoint and restart so it can download again.
- **Frontend works but generation fails:** confirm both
  `http://127.0.0.1:8001/health` and
  `http://127.0.0.1:5173/ace-step/health` return `ok`.
- **Out-of-memory errors:** keep batch size at `1`, close other GPU workloads,
  and use the Turbo configuration.

## Git hygiene

This repository includes integration code plus third-party service sources.
Do not commit checkpoints, `.venv`, `node_modules`, generated audio, databases,
or tunnel URLs. See [`.gitignore`](.gitignore) for the complete local-only
file list.
