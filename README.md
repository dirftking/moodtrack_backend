# MoodTrack

MoodTrack 是一个 Vue 3 / Vite 音乐创作页面。页面将情绪曲线、场景、风格、
BPM、调性和歌词等参数交给 ACE-Step 生成音乐。

当前版本有两条彼此独立的生成链路：

- 普通配乐、人声歌曲、情绪参考和局部重绘使用本机 ACE-Step 1.5。浏览器只访问
  Vite 网关 `/ace-step`，ACE API 本身仅监听 `127.0.0.1:8001`。
- 视频配乐使用 `frontend/services/` 中的本地 GVMGen 服务。浏览器先在本地分析画面，
  再通过 Vite 网关 `/gvmgen` 上传视频；GVMGen 生成音乐，并由 FFmpeg 输出独立 WAV
  与带配乐的 MP4。视频不会交给 ACE-Step，ACE 也不直接理解视频内容。

两条链路使用不同的模型、端口与守护逻辑：ACE-Step 使用 `8001`，GVMGen 使用 `8002`。
切换或恢复 ACE-Step 不应修改视频上传、Supabase Storage、GVMGen 或 FFmpeg 配置。

视频链路的架构、算法、接口、安全、部署、测试与故障排查详见
[《MoodTrack 视频配乐技术文档》](docs/VIDEO_SOUNDTRACK_TECHNICAL_GUIDE.md)。

## 目录

```text
frontend/             MoodTrack 页面、本地 ACE 网关、GVMGen 视频服务与公网守护
backend/              早期独立后端实现（当前 Vite 模式不使用）
heartbeat/            独立 HeartArt / Video2Music 页面
services/GVMGen/      MoodTrack 视频配乐使用的 GVMGen 模型源码与本地权重目录
```

## 运行要求

- Windows 10/11 与 PowerShell
- Node.js 18+ 和 pnpm
- NVIDIA CUDA 显卡（当前验证机为 RTX 4090 24GB）
- Python/uv 与 `frontend/services/ACE-Step-1.5` 本地模型

视频配乐还需要独立的 GVMGen Python 环境和 FFmpeg，配置方法见下文。不要把 ACE
依赖安装到 GVMGen 的 Conda 环境，也不要让两个 GPU 生成任务同时运行。

## 配置本地 ACE-Step

默认配置为：

```dotenv
ACESTEP_PROVIDER=local
ACESTEP_LOCAL_API_URL=http://127.0.0.1:8001
ACESTEP_LOCAL_MODEL=acestep-v15-turbo
```

复制 `frontend/.env.example` 为 `frontend/.env.local`，然后启动本地服务：

```powershell
cd frontend
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-ace-step.ps1
```

启动脚本加载 Turbo DiT、1.7B 5Hz 歌词 LM，并使用 CUDA。模型只绑定回环地址，
不要把 `8001` 配置为公网端口映射。云端配置仍可作为显式手动备用，但不会自动回退。

## 启动 MoodTrack

```powershell
cd frontend
pnpm install
pnpm dev --host 127.0.0.1
```

打开 <http://127.0.0.1:5173/>，然后验证本地主模型与歌词模型均已就绪：

```powershell
Invoke-RestMethod http://127.0.0.1:5173/ace-step/health
```

正常时返回 `status: ok`、`service: ACE-Step Local API`。本地原始健康接口是
`http://127.0.0.1:8001/health`；它还应报告 `models_initialized: true` 和
`llm_initialized: true`。

## 当前支持的功能

- 情绪曲线到音乐描述的转换
- Text Emotion Agent：将自由情绪描述归一到标准情绪类别
- Emotion Reference Library：自动选择主情绪参考音频并传给 ACE-Step
- 纯音乐生成
- 人声歌曲与自动原创歌词
- BPM、调性、时长和编曲方向控制
- 音频播放与下载
- 已生成音频的局部重绘
- 视频画面预分析、本地 GVMGen 配乐、WAV 下载和带配乐 MP4 下载

网关把经过校验的任务转发到本机 `/release_task`，通过 `/query_result` 轮询，并安全代理
本地 `/v1/audio`。浏览器不能指定任意上游网址、本地文件路径、模型目录或批量大小。
网关最多同时接受两个 ACE 生成任务，并将单个公网 IP 限制为每十分钟六个任务。

## 视频配乐（本地 GVMGen，可选）

视频配乐不调用 ACE-Step。完整流程如下：

1. 浏览器从视频中抽取低分辨率画面采样，估算亮度、饱和度、运动、切点、BPM、调性、
   能量曲线和情绪走向；这一步在浏览器本地完成。
2. 配置 S3 兼容存储后，浏览器先向 `/gvmgen/object-uploads` 获取短时预签名地址，再把
   原始视频直接 PUT 到私有 Supabase Storage Bucket；大文件不再绕 Cloudflare Tunnel
   传回本机。
3. 浏览器只通过 MoodTrack 网关提交很小的任务控制请求。本机服务校验云端对象的大小、
   类型和 ETag，然后通过 S3 高速下载；未配置对象存储时仍保留原有 1 MiB 分片上传作为回退。
4. GVMGen 根据视频画面生成音乐，FFmpeg 用生成音乐替换原视频音轨，并提供
   `music.wav` 与 `rendered-video.mp4` 下载。

当前限制：

- 支持 MP4、WebM、MOV 和 M4V；
- 单个文件最多 95 MiB；
- 每次生成取视频前 5–30 秒，页面分析计划默认至少 15 秒、最多 30 秒；
- 本地服务一次只处理一个视频任务；公网网关还会限制单个 IP 每 30 分钟最多三次生成；
- 原视频音轨不会作为 ACE 的 Reference Audio，合成 MP4 使用 GVMGen 新配乐替换原音轨。

### 视频环境

GVMGen 源码位于 `services/GVMGen/`。建议使用 Python 3.9 的独立 Conda 环境，按该目录
中的 `requirements.txt` 安装依赖，并额外确认 FastAPI 上传依赖可用：

```powershell
conda create -n gvmgen python=3.9
conda activate gvmgen
cd services\GVMGen
pip install -r requirements.txt
pip install -r ..\..\frontend\services\requirements-gvmgen.txt
```

PyTorch、CUDA 与显卡驱动必须相互兼容。还需要可用的 FFmpeg；服务默认查找当前
Python 环境的 `Library\bin\ffmpeg.exe`，也可通过 `GVMGEN_FFMPEG` 指定完整路径。

服务默认从以下位置读取已下载的 small 模型权重：

```text
services/GVMGen/checkpoints/small/state_dict.bin
services/GVMGen/checkpoints/small/compression_state_dict.bin
```

可以分别使用 `GVMGEN_ROOT`、`GVMGEN_CHECKPOINTS` 和 `GVMGEN_OUTPUT` 覆盖源码、
权重与输出目录。模型权重很大且不应提交 Git。

### 启动视频服务

在 `frontend` 目录运行视频守护脚本，并把 `PythonPath` 改成实际的 GVMGen 环境：

```powershell
cd frontend
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\video-watchdog.ps1 `
  -PythonPath 'E:\anaconda3\envs\gvmgen\python.exe'
```

该脚本会在隐藏窗口启动 `services.gvmgen_service:app`，监听 `127.0.0.1:8002`，并在
服务进程退出时恢复它。也可以在 `frontend` 目录直接前台启动，便于查看初始化错误：

```powershell
& 'E:\anaconda3\envs\gvmgen\python.exe' -m uvicorn `
  services.gvmgen_service:app --host 127.0.0.1 --port 8002
```

先检查本地服务，再检查 MoodTrack 网关：

```powershell
Invoke-RestMethod http://127.0.0.1:8002/health
Invoke-RestMethod http://127.0.0.1:5173/gvmgen/health
```

正常时应看到 `ready: true` 和 `cuda: true`。公网同样通过当前 MoodTrack 地址的
`/gvmgen/health`、`/gvmgen/object-uploads`、`/gvmgen/jobs/...` 和 `/gvmgen/files/...` 工作；
不要把 `8002` 直接暴露到公网。

Supabase S3 的启用、私有 Bucket 与服务端环境变量配置见
[Supabase 视频直传配置](docs/SUPABASE_VIDEO_UPLOAD.md)。密钥只能放在被 Git 忽略的
`frontend/.env.gvmgen.local`，不能使用 `VITE_` 前缀。

## Text Emotion Agent 与参考音频库

生成前，页面会把“总体情绪描述”、情绪曲线、场景和音乐方向一次性交给服务端
Text Emotion Agent。Agent 会保留原始文字，同时归一到以下十个标准类别：

`开心`、`悲伤`、`紧张`、`治愈`、`平静`、`希望`、`怀念`、`胜利`、`神秘`、`愤怒`。

复合描述会保留主次关系。例如“失落但充满希望”会归为“希望”为主、“悲伤”为辅；
“雨天的孤独感”会归为“悲伤”。Agent 使用服务端的确定性多语言分类规则，不依赖本地
机器学习模型，也不会额外消耗 ACE 音乐生成额度。分类失败或置信度不足时，生成仍会
保留用户原文并安全降级为纯文本引导。

参考库位于 `frontend/emotion-reference-library/`，不在 `public/` 下，并由 Vite 文件拒绝规则
和服务端中间件双重拦截，因此浏览器不能直接下载参考音频，静态 Sites 构建也不会包含它们。
库中预置十段 MoodTrack 原创程序化音频，
每个标准情绪一段。生成时只把主情绪对应的一段音频复制到受控临时目录，再通过
`reference_audio_path` 传给本地 ACE-Step；次情绪和完整曲线继续写入 Prompt。

这些预置片段不含第三方录音、采样、商业歌曲或人声，按 CC0-1.0 提供。重新生成：

```powershell
cd frontend
pnpm generate:emotion-library
```

自定义素材时，先阅读 `frontend/emotion-reference-library/README.md`。每段应保持单一情绪、
无长静音、低于 8 MiB，并在 `manifest.json` 记录来源和授权。不要使用没有授权的商业音乐。

ACE-Step 的 Reference Audio 用于全局音色、混音、演奏表达和氛围引导，不等同于 Cover
或 Repaint 的 Source Audio。MoodTrack 对 `text2music` 发送“文本 + 一段参考”；局部重绘
发送“文本 + 已生成源音频 + 原情绪参考”。源音频和参考音频采用不同的受控临时路径，
浏览器不能传入任意磁盘路径。

局部重绘使用本地原生 `repaint` 任务，保留源版本歌词、人声模式、语言和情绪参考，
并传递区间、`repaint_strength` 与交叉淡化参数。

### 生成完整性与防缓存

- 每次生成先分配 MoodTrack 公共任务号，再在后台完成歌词准备与本地 ACE-Step 提交，避免
  公网请求因歌词推理过久而返回 502/524。
- 歌词只允许目标语言和标准段落标签，并按目标时长限制字数；本地歌词 LM 输出不合格时，
  自动改用与标准情绪匹配的受控原创歌词。歌词必须包含有内容的 `[Chorus]`，不会留下空段落。
- 每个浏览器会话只能查询、下载和重绘自己的任务；音频路径必须与任务一一对应。
- 任务完成时由服务端校验 WAV 结构、实际时长和 SHA-256。旧路径、重复内容、时长不符或
  文件在完成后发生变化都会被拒绝，响应同时设置 `no-store`，播放器地址还包含任务号与
  随机防缓存参数。
- 局部重绘显式绑定源任务与源文件，并始终保留源版本歌词；重绘期间锁定版本选择，避免
  用户操作导致结果串到另一个版本。
- 视频配乐继续使用独立 GVMGen 服务与 Supabase S3 直传链路；每次生成使用新的
  `client_request_id`、任务目录、结果地址和音频指纹，不复用上一段配乐。

## 后台公网守护

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\watchdog.ps1
```

守护脚本会：

- 保持 `127.0.0.1:5173` 的 Vite 页面运行；
- 仅在 `cloudflared` 进程确实退出时恢复公网隧道；
- 仅在本地 ACE-Step 进程确实退出时重新启动它；进程存在但仍在加载时只等待；
- 检查 `/ace-step/health` 并记录本地 DiT/歌词 LM 状态；
- 保持视频配乐守护脚本与 `127.0.0.1:8002` 的 GVMGen 服务运行；
- 不因 ACE 故障重启 GVMGen 或重建仍在运行的公网隧道。

主 `watchdog.ps1` 会在隐藏窗口启动 `scripts/video-watchdog.ps1`；后者只守护
`127.0.0.1:8002` 的视频服务，不会启动本地 ACE-Step，也不会重建公网隧道。

## 故障排查

- **提示本地 ACE 未启动：** 运行 `scripts/start-ace-step.ps1`，等待模型初始化完成。
- **歌词模型未就绪：** 查看 `.ace-step.err.log`，确认 1.7B 5Hz LM 已加载。
- **HTTP 429：** 本机已有任务或当前公网 IP 触发频率限制，等待后重试。
- **显存不足：** 不要同时运行 ACE 音乐生成和 GVMGen 视频生成；等待其中一个完成。
- **页面能打开但不能生成：** 检查
  `http://127.0.0.1:8001/health` 与 `http://127.0.0.1:5173/ace-step/health`。
- **局部重绘提示源音频过期：** 先重新生成一段音乐，再进行局部重绘。
- **视频按钮一直显示“视频模型准备中”：** 依次检查
  `http://127.0.0.1:8002/health` 和 `http://127.0.0.1:5173/gvmgen/health`；前者失败时启动
  `scripts/video-watchdog.ps1`，后者失败时重启 Vite。
- **视频健康检查返回 `ready: false`：** 检查 CUDA 是否可用、small 权重文件是否完整，
  以及 `GVMGEN_ROOT`、`GVMGEN_CHECKPOINTS` 是否指向正确目录。
- **视频接口 HTTP 502：** Vite 无法连接本地 `8002` 服务；查看
  `frontend/.gvmgen-service.err.log` 和 `.gvmgen-service.log`。
- **视频接口 HTTP 413：** 文件超过 95 MiB；先压缩或裁剪视频。
- **视频接口 HTTP 429：** 已有视频正在生成，或当前公网 IP 触发频率限制；等待任务完成
  后再试。
- **FFmpeg 或编码错误：** 优先使用 H.264 MP4 或 WebM，并确认 `ffmpeg -version` 可运行；
  必要时设置 `GVMGEN_FFMPEG` 后重启视频服务。
- **显存不足或 GVMGen 生成失败：** 关闭其他 GPU 任务，检查视频服务错误日志，并先用
  较短视频测试。视频服务不会回退到 ACE 云 API。

## 部署说明

本地 ACE-Step 与 GVMGen 都只监听回环地址，由 Vite 网关统一暴露必要接口，适用于
本机加 Cloudflare Tunnel 的部署方式。纯静态 Sites 构建不会提供 `/ace-step` 或
`/gvmgen` 生成接口；不要为此重新部署或修改 Sites 访问权限。

公网视频上传和输出均经当前 Vite 服务器的 `/gvmgen` 代理。本地 GVMGen 只监听
`127.0.0.1:8002`；不要配置公网端口映射，也不要把视频能力描述为 ACE 云视频理解。

## Git 安全

不要提交 `.env.local`、GVMGen/ACE 模型权重、虚拟环境、`node_modules`、
`.gvmgen-output`、生成音视频、数据库、日志或临时公网地址。完整规则见
[`.gitignore`](.gitignore)。
