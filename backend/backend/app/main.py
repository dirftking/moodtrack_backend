"""MoodTrack + ACE-Step 1.5 — single merged server.

Combines ACE-Step 1.5 music generation inference with MoodTrack business
logic in one FastAPI process.  ACE-Step's lifespan loads models and starts
worker tasks; MoodTrack routes handle projects, emotion tracks, music plans,
and generation orchestration.

Start with:
    cd backend
    uvicorn app.main:app --host 0.0.0.0 --port 8080

ACE-Step endpoints (same port):
    POST /release_task · POST /query_result · GET /v1/audio · GET /health
MoodTrack endpoints:
    /api/health · /api/projects · /api/projects/{id}/plan · …
"""
import os
import sys

# ---------------------------------------------------------------------------
# Make the neighbouring ace-step package importable
# ---------------------------------------------------------------------------
_ACE_STEP_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "ace-step")
)
if _ACE_STEP_DIR not in sys.path:
    sys.path.insert(0, _ACE_STEP_DIR)

# ---------------------------------------------------------------------------
# Import the ACE-Step FastAPI app (model loading happens in its lifespan)
# ACE-Step already registers CORS for localhost:*, /release_task,
# /query_result, /v1/audio, /health, etc.
# ---------------------------------------------------------------------------
from acestep.api_server import app  # noqa: E402

# ---------------------------------------------------------------------------
# Standard library / MoodTrack imports
# ---------------------------------------------------------------------------
from pathlib import Path  # noqa: E402
from uuid import uuid4  # noqa: E402

from fastapi import BackgroundTasks, HTTPException  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

from app.providers import get_provider  # noqa: E402
from app.schemas import (  # noqa: E402
    EmotionTrackUpdate,
    Generation,
    GenerationCreate,
    GenerationStatus,
    MusicPlan,
    Project,
    ProjectCreate,
    RepaintCreate,
)
from app.services import build_music_plan  # noqa: E402
from app.store import AUDIO_DIR, generations, plans, projects  # noqa: E402

# ---------------------------------------------------------------------------
# Customise the merged app
# ---------------------------------------------------------------------------
app.title = "MoodTrack + ACE-Step 1.5"
app.version = "0.1.0"

app.mount("/files/audio", StaticFiles(directory=str(AUDIO_DIR)), name="audio")


@app.get("/api/health")
def health():
    return {"status": "ok", "provider": get_provider().name}


@app.post("/api/projects", response_model=Project)
def create_project(payload: ProjectCreate):
    project_id = f"project_{uuid4().hex[:8]}"
    project = Project(id=project_id, **payload.model_dump())
    projects[project_id] = project
    (AUDIO_DIR / project_id).mkdir(parents=True, exist_ok=True)
    return project


@app.get("/api/projects", response_model=list[Project])
def list_projects():
    return list(projects.values())


@app.get("/api/projects/{project_id}", response_model=Project)
def get_project(project_id: str):
    project = projects.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@app.post("/api/projects/{project_id}/emotion-track", response_model=Project)
def update_emotion_track(project_id: str, payload: EmotionTrackUpdate):
    project = projects.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project.emotion_nodes = sorted(payload.nodes, key=lambda node: node.time)
    projects[project_id] = project
    return project


@app.post("/api/projects/{project_id}/plan", response_model=MusicPlan)
def create_plan(project_id: str):
    project = projects.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    plan_id = f"plan_{uuid4().hex[:8]}"
    plan = build_music_plan(project, plan_id)
    plans[plan_id] = plan
    return plan


@app.post("/api/projects/{project_id}/generations", response_model=Generation)
def create_generation(project_id: str, payload: GenerationCreate, background_tasks: BackgroundTasks):
    project = projects.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    prompt = payload.prompt
    if payload.plan_id:
        plan = plans.get(payload.plan_id)
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found")
        prompt = plan.prompt
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt or plan_id is required")

    generation_id = f"gen_{uuid4().hex[:8]}"
    generation = Generation(
        id=generation_id,
        project_id=project_id,
        status=GenerationStatus.pending,
        prompt=prompt,
        provider=get_provider().name,
    )
    generations[generation_id] = generation
    duration = payload.duration or project.duration
    background_tasks.add_task(run_generation, generation_id, prompt, duration, payload.audio_format)
    return generation


@app.get("/api/projects/{project_id}/generations", response_model=list[Generation])
def list_project_generations(project_id: str):
    return [generation for generation in generations.values() if generation.project_id == project_id]


@app.get("/api/generations/{generation_id}", response_model=Generation)
def get_generation(generation_id: str):
    generation = generations.get(generation_id)
    if not generation:
        raise HTTPException(status_code=404, detail="Generation not found")
    return generation


@app.post("/api/generations/{generation_id}/repaint", response_model=Generation)
def repaint_generation(generation_id: str, payload: RepaintCreate, background_tasks: BackgroundTasks):
    source = generations.get(generation_id)
    if not source:
        raise HTTPException(status_code=404, detail="Generation not found")
    if source.status != GenerationStatus.success or not source.audio_url:
        raise HTTPException(status_code=400, detail="Source generation is not ready")

    new_id = f"gen_{uuid4().hex[:8]}"
    generation = Generation(
        id=new_id,
        project_id=source.project_id,
        status=GenerationStatus.pending,
        prompt=payload.instruction,
        provider=get_provider().name,
    )
    generations[new_id] = generation
    background_tasks.add_task(run_repaint, new_id, source.audio_url, payload)
    return generation


def run_generation(generation_id: str, prompt: str, duration: int, audio_format: str):
    generation = generations[generation_id]
    generation.status = GenerationStatus.running
    generations[generation_id] = generation
    output_path = AUDIO_DIR / generation.project_id / f"{generation_id}.{audio_format}"
    try:
        get_provider().generate_text2music(prompt, duration, output_path)
        generation.status = GenerationStatus.success
        generation.audio_url = f"/files/audio/{generation.project_id}/{output_path.name}"
        generation.error = None
    except Exception as exc:
        generation.status = GenerationStatus.failed
        generation.error = str(exc)
    generations[generation_id] = generation


def run_repaint(generation_id: str, source_audio_url: str, payload: RepaintCreate):
    generation = generations[generation_id]
    generation.status = GenerationStatus.running
    generations[generation_id] = generation
    source_path = url_to_audio_path(source_audio_url)
    output_path = AUDIO_DIR / generation.project_id / f"{generation_id}.wav"
    try:
        get_provider().repaint(source_path, payload.start_time, payload.end_time, payload.instruction, output_path)
        generation.status = GenerationStatus.success
        generation.audio_url = f"/files/audio/{generation.project_id}/{output_path.name}"
        generation.error = None
    except Exception as exc:
        generation.status = GenerationStatus.failed
        generation.error = str(exc)
    generations[generation_id] = generation


def url_to_audio_path(audio_url: str) -> Path:
    prefix = "/files/audio/"
    if not audio_url.startswith(prefix):
        raise RuntimeError(f"Unsupported local audio url: {audio_url}")
    relative = audio_url.removeprefix(prefix)
    return AUDIO_DIR / relative
