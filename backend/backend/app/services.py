from typing import List
from app.schemas import EmotionNode, MusicPlan, Project


def build_music_plan(project: Project, plan_id: str) -> MusicPlan:
    sorted_nodes = sorted(project.emotion_nodes, key=lambda node: node.time)
    emotion_text = format_emotion_track(sorted_nodes)
    instruments = infer_instruments(project.style, sorted_nodes)
    bpm = infer_bpm(project.style, sorted_nodes)
    key = infer_key(sorted_nodes)
    structure = infer_structure(project.duration)

    description = (
        f"这是一首用于{project.scene}的{project.style}音乐，主题是{project.theme}。"
        f"整体情绪轨道为：{emotion_text}。"
    )

    prompt = build_acestep_prompt(project, structure, bpm, key, instruments, emotion_text)

    return MusicPlan(
        id=plan_id,
        project_id=project.id,
        structure=structure,
        bpm=bpm,
        key=key,
        instruments=instruments,
        description=description,
        prompt=prompt,
    )


def format_emotion_track(nodes: List[EmotionNode]) -> str:
    if not nodes:
        return "从平静开始，逐渐发展并自然收束"
    return " → ".join(
        f"{node.time}s {node.emotion}(强度{int(node.intensity * 100)}%)" for node in nodes
    )


def infer_structure(duration: int) -> str:
    if duration <= 45:
        return "Intro - Main Theme - Outro"
    if duration <= 120:
        return "Intro - Verse - Build-up - Chorus - Outro"
    return "Intro - Verse - Pre-Chorus - Chorus - Bridge - Final Chorus - Outro"


def infer_bpm(style: str, nodes: List[EmotionNode]) -> int:
    text = style + " " + " ".join(node.emotion for node in nodes)
    if any(word in text for word in ["热血", "释放", "激烈", "电子", "摇滚", "运动"]):
        return 128
    if any(word in text for word in ["平静", "治愈", "悲伤", "怀念", "温暖"]):
        return 82
    return 100


def infer_key(nodes: List[EmotionNode]) -> str:
    text = " ".join(node.emotion for node in nodes)
    if any(word in text for word in ["悲伤", "孤独", "压抑", "紧张"]):
        return "E minor"
    return "G major"


def infer_instruments(style: str, nodes: List[EmotionNode]) -> List[str]:
    text = style + " " + " ".join(node.emotion for node in nodes)
    instruments = ["piano"]
    if any(word in text for word in ["温暖", "怀念", "不舍", "释然", "电影"]):
        instruments.append("strings")
    if any(word in text for word in ["释放", "热血", "电子", "流行", "摇滚"]):
        instruments.append("soft drums")
    if "电子" in text:
        instruments.append("synth pads")
    return list(dict.fromkeys(instruments))


def build_acestep_prompt(
    project: Project,
    structure: str,
    bpm: int,
    key: str,
    instruments: List[str],
    emotion_text: str,
) -> str:
    vocal_text = "with expressive vocals" if project.vocal else "instrumental, no vocals"
    return (
        f"{project.style} music for {project.scene}, theme: {project.theme}. "
        f"Duration {project.duration} seconds. Structure: {structure}. "
        f"Emotion timeline: {emotion_text}. "
        f"BPM {bpm}, key {key}. Instruments: {', '.join(instruments)}. "
        f"{vocal_text}. Coherent sections, smooth transitions, high quality arrangement."
    )
