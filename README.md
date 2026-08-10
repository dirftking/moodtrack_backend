# MoodTrack Demo

MoodTrack 是一个课程 demo 项目，采用前后端分离架构，**后端与 ACE-Step 1.5 合并为同一个服务**。

```text
frontend/   Vue 3 + Vite 前端
backend/    MoodTrack 业务路由（启动时合并 ACE-Step）
ace-step/   ACE-Step 1.5 官方开源模型
```

## 环境要求

- Python 3.11（推荐 conda 环境）
- NVIDIA GPU（RTX 3070 8 GB 可跑 2B turbo 模型）
- Node.js ≥ 18（前端）

## 1. 安装 ACE-Step 依赖

```powershell
conda activate py11
cd ace-step
pip install -e .
# 或者使用 uv:  uv sync
```

> ACE-Step 会自动安装 torch、transformers、fastapi、uvicorn 等依赖。
> MoodTrack 后端额外依赖很少，见 `backend/requirements.txt`。

```powershell
cd ..\backend
pip install -r requirements.txt
```

## 2. 启动后端（单服务）

```powershell
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

这个**单进程**同时提供：

| 路径 | 来源 | 说明 |
|------|------|------|
| `POST /release_task` | ACE-Step | 提交音乐生成任务 |
| `POST /query_result` | ACE-Step | 查询任务结果 |
| `GET /v1/audio?path=…` | ACE-Step | 下载生成的音频 |
| `GET /health` | ACE-Step | 健康检查 |
| `GET /api/health` | MoodTrack | MoodTrack 健康检查 |
| `POST /api/projects` | MoodTrack | 创建项目 |
| `POST /api/projects/{id}/plan` | MoodTrack | 生成音乐规划 |
| `POST /api/projects/{id}/generations` | MoodTrack | 提交生成任务 |

**不再需要单独启动 ACE-Step API Server。**

### 仅调试前端（不加载模型）

```powershell
$env:MUSIC_PROVIDER="mock"
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

> mock 模式下 ACE-Step 模型仍会加载，但生成接口返回静音占位音频。
> 如果想完全跳过模型加载，可临时注释 `main.py` 中的 ACE-Step 导入。

## 3. 启动前端

```powershell
cd frontend
pnpm install
pnpm dev
```

前端地址：`http://localhost:5173`

## 4. 使用流程

```text
1. 启动后端:  uvicorn app.main:app --port 8080
2. 启动前端:  pnpm dev
3. 浏览器打开 http://localhost:5173
4. 创建项目 → 编辑情绪轨道 → 生成音乐规划 → 调用 ACE-Step 生成音乐
```

## 5. 项目结构

```text
music/
├── ace-step/                 # ACE-Step 1.5 源码（pip install -e .）
├── backend/
│   ├── app/
│   │   ├── main.py           # 合并入口：ACE-Step app + MoodTrack 路由
│   │   ├── providers.py      # 调用同进程 /release_task 接口
│   │   ├── schemas.py        # Pydantic 数据模型
│   │   ├── services.py       # 情绪轨道 → 音乐规划 → Prompt
│   │   └── store.py          # 内存存储
│   ├── requirements.txt
│   └── storage/audio/        # 生成的音频文件
├── frontend/                 # Vue 3 + Vite 前端
├── docs/                     # 设计文档
└── README.md
```

## 6. 已实现功能

- 情绪轨道编辑 → 音乐结构规划 → ACE-Step Prompt 自动生成
- 调用 ACE-Step `/release_task` 提交 text2music / repaint 任务
- 轮询 `/query_result` 获取结果，下载 `/v1/audio` 音频
- Vue 前端：项目管理、情绪节点编辑、Prompt 预览、音频播放
- **单服务架构**：一个 uvicorn 进程同时运行 ACE-Step 推理 + MoodTrack 业务

## 7. 后续可扩展

- repaint 局部编辑前端交互
- cover 风格转换
- SQLite 持久化
- 视频上传与事件点标记
