# MoodTrack 视频直传 R2 配置

## 目标架构

公网用户选择视频后，浏览器只向 MoodTrack 请求一个短期预签名 PUT 地址。视频主体直接
进入私有 Cloudflare R2，不经过 MoodTrack 的 Quick Tunnel。上传完成后，本机 GVMGen
服务执行 `HeadObject` 校验，再使用固定 Bucket 和 Object Key 下载到本地临时文件：

```text
浏览器 ──小 JSON──> MoodTrack /gvmgen
   │
   └──视频原始字节──> 私有 R2 Bucket
                          │
本机 GVMGen <──高速 GET───┘
   │
   ├──生成 music.wav
   ├──渲染 rendered-video.mp4
   └──删除 R2 临时对象
```

25.2 MB 到 95 MiB 的 MoodTrack 视频使用单次 PUT。它比 multipart 简单，并已避开原来
约 36 KB/s 的 Tunnel 上传瓶颈。单次 PUT 失败时会整文件重试；以后支持超过约 100 MB
或必须断点续传时，再升级为 S3 multipart。

## 1. 创建私有 Bucket

1. 登录 Cloudflare Dashboard，进入 **R2 Object Storage**。
2. 创建私有 Bucket，例如 `moodtrack-video-input`，存储类型使用 `STANDARD`。
3. 不要开启公开 `r2.dev` 地址，也不需要公开自定义域名。
4. 创建只限定到这个 Bucket 的 **Object Read & Write** R2 API Token。不要使用 Global
   API Key 或账户级管理员 Token。

需要记录四项服务端配置：Account ID、Access Key ID、Secret Access Key、Bucket 名。
Secret 只写入下一节的本地私有文件，不要贴到网页、Git、日志或 `VITE_*` 变量中。

## 2. 配置本机服务

在 `frontend` 目录复制示例：

```powershell
Copy-Item .env.gvmgen.example .env.gvmgen.local
```

编辑 `.env.gvmgen.local`：

```dotenv
R2_ACCOUNT_ID=你的账户ID
R2_ACCESS_KEY_ID=仅限目标Bucket的AccessKeyID
R2_SECRET_ACCESS_KEY=对应SecretAccessKey
R2_BUCKET_NAME=moodtrack-video-input
R2_REGION=auto
R2_PREFIX=incoming
R2_PRESIGN_TTL_SECONDS=900
```

服务默认使用 `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`。特殊 jurisdiction 才需要显式
设置 `R2_ENDPOINT_URL`。`.env.gvmgen.local` 已被 Git 忽略，服务启动时只在 Python
进程内读取；Vite 构建和浏览器不会获得这些值。

安装新增依赖：

```powershell
& 'E:\anaconda3\envs\gvmgen\python.exe' -m pip install `
  -r .\services\requirements-gvmgen.txt
```

重启视频服务后检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8002/health
```

成功配置时应为 `service_version: 3.0.0`、`upload_mode: object-store`、
`storage_ready: true`。没有 R2 配置时服务保持 `upload_mode: chunked`，旧链路仍可用。

## 3. 配置 Bucket CORS

浏览器直接 PUT 必须允许 MoodTrack 的前端 Origin。最小配置如下；Origin 不能包含路径或
结尾斜杠：

```json
[
  {
    "AllowedOrigins": [
      "http://127.0.0.1:5173",
      "http://localhost:5173",
      "https://monitored-peterson-checklist-pharmacy.trycloudflare.com"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

如果公网 Quick Tunnel 地址改变，必须把新的精确 Origin 加入 CORS。长期部署更适合
Named Tunnel 加固定域名。不要在 `AllowedMethods` 中手动加入 `OPTIONS`；R2 会处理
预检。配置传播偶尔需要约 30 秒。

## 4. 配置临时对象生命周期

正常流程会在本机完整落盘后主动 `DeleteObject`。再为 `incoming/` 前缀增加 1 天过期的
生命周期规则，兜底清理浏览器上传成功、但用户没有提交生成任务时留下的孤儿对象。
临时视频使用 `STANDARD`；`STANDARD_IA` 有最低保存期，不适合这种短生命周期数据。

## 5. API 与安全约束

- `POST /gvmgen/object-uploads`：校验文件名、后缀、大小、时长和客户端幂等编号，返回
  15 分钟内有效的 PUT URL。响应禁止缓存。
- 浏览器用 XHR 直接 PUT 原始 `File`，并发送签名响应中的完全相同 `Content-Type`。
- `POST /gvmgen/object-uploads/{id}/complete`：只提交服务端生成的上传编号，不接受 URL
  或任意 Object Key，因此不存在让浏览器诱导本机抓取任意地址的 SSRF 通道。
- 本机使用固定 Endpoint、Bucket 和 session 绑定的随机 Key，先核对 `ContentLength`、
  `ContentType`、ETag，再用 `IfMatch` 下载，避免 HEAD 与 GET 之间被替换。
- 下载使用 95 MiB 硬上限、`.part` 临时文件和原子改名；完整落盘后才启动模型。
- 预签名 URL 是临时 bearer token，不写入 sessionStorage、日志或错误提示。

## 6. 验收

1. 浏览器 Network 中，大视频 PUT 的 Host 应为 `*.r2.cloudflarestorage.com`。
2. MoodTrack Tunnel 上只有 `/object-uploads`、`/complete` 与 `/jobs` 的小 JSON。
3. 页面上传状态只显示一个明确百分比和预计剩余时间。
4. `/jobs/{id}` 依次显示 R2 下载、模型生成、视频渲染并最终完成。
5. WAV、MP4 下载和 HTTP Range 播放保持原样。
6. R2 Bucket 中正常完成的临时对象会被删除；中断对象由生命周期兜底。

## 故障排查

- `storage_ready: false`：四个必需的 `R2_*` 配置至少缺一个，或服务尚未重启。
- 浏览器 PUT 显示 CORS：检查当前地址的精确 Origin、`PUT`、`Content-Type` 和 `ETag`。
- PUT 返回 403：Content-Type 与签名不一致、URL 超过 15 分钟，或 Token 权限不正确。
- complete 返回大小/类型不匹配：对象不是当前 session 签名上传的原始视频，会被拒绝并
  尝试删除。
- R2 暂时不可用：生成不会回退启动其他模型；可稍后重试，旧分片模式只在 R2 未配置时
  作为显式兼容回退。

官方参考：[Presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)、
[CORS](https://developers.cloudflare.com/r2/buckets/cors/)、
[上传方式](https://developers.cloudflare.com/r2/objects/upload-objects/)、
[生命周期](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)。
