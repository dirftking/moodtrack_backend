# MoodTrack 视频直传 Supabase Storage

MoodTrack 可以把浏览器中的原始视频直接上传到 Supabase 的 S3 兼容端点。本机只接收很小的
任务控制请求，再从 Supabase Storage 下载视频进行 GVMGen 推理，避免大视频绕行
Cloudflare Quick Tunnel。

## 数据流

```text
浏览器 ──小 JSON──> MoodTrack /gvmgen/object-uploads
浏览器 ──预签名 PUT──> Supabase Storage 私有 Bucket
本机 GVMGen <──S3 GET── Supabase Storage
本机 GVMGen ──> music.wav + rendered-video.mp4
```

预签名地址有效期默认为 15 分钟。S3 Access Key 只存在服务端，浏览器得到的只是限定到单个
随机对象路径的短期 PUT 地址。

## 1. 在 Supabase 启用 S3

1. 打开目标项目，在 **Storage > Settings > S3** 中启用 S3 协议。
2. 创建一组 S3 Access Key ID 与 Secret Access Key。Secret 通常只显示一次。
3. 记下页面显示的 Project ref 和 Region。

S3 Access Key 会绕过 Storage RLS，并具有项目 Storage 的服务器级权限，因此不能放入网页、
`VITE_*` 环境变量、Git、截图或聊天记录。

当前项目的默认配置为：

```text
Project ref: hskupbnysmzraxghvsxp
Region:      ap-southeast-2
Bucket:      moodtrack-video-input
Endpoint:    https://hskupbnysmzraxghvsxp.storage.supabase.co/storage/v1/s3
```

## 2. 运行本地安全配置脚本

在 `frontend` 目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  .\scripts\configure-supabase-storage.ps1
```

脚本会：

- 使用隐藏输入读取 Secret Access Key，且不会把 Secret 输出到终端；
- 使用 `E:\anaconda3\envs\gvmgen\python.exe` 和 boto3 验证连接；
- Bucket 不存在时，通过 S3 `CreateBucket` 创建它；Supabase 新 Bucket 默认为 Private；
- Bucket 已存在时要求你在 Dashboard 确认 **Public bucket** 已关闭；
- 原子写入被 Git 忽略的 `frontend/.env.gvmgen.local`；
- 更新自己管理的 `S3_*` 配置，同时保留该文件中其他已有变量。

若 Python 路径不同，可显式传入：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  .\scripts\configure-supabase-storage.ps1 `
  -PythonPath 'D:\path\to\python.exe'
```

请勿把 Secret 当作命令行参数；脚本不会要求这样做。

## 3. 生成的服务端配置

脚本写入以下通用 S3 变量：

```dotenv
S3_PROVIDER=supabase
S3_ENDPOINT_URL=https://PROJECT_REF.storage.supabase.co/storage/v1/s3
S3_REGION=PROJECT_REGION
S3_ACCESS_KEY_ID=仅服务端使用
S3_SECRET_ACCESS_KEY=仅服务端使用
S3_BUCKET_NAME=moodtrack-video-input
S3_PREFIX=incoming
S3_PRESIGN_TTL_SECONDS=900
S3_FORCE_PATH_STYLE=true
GVMGEN_MAX_UPLOAD_MB=50
```

Supabase 的 S3 端点需要 path-style addressing，因此 `S3_FORCE_PATH_STYLE` 必须保持为 `true`。
`.env.gvmgen.local` 已被 `.gitignore` 忽略；不要手动执行 `git add -f`。

## 4. 重启与验收

配置成功后重启视频服务，或让现有视频 watchdog 在服务正常退出后恢复它。然后检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8002/health
Invoke-RestMethod http://127.0.0.1:5173/gvmgen/health
```

应看到：

```json
{
  "upload_mode": "object-store",
  "storage_ready": true
}
```

在浏览器上传视频时，Network 面板中的大文件 PUT Host 应为
`hskupbnysmzraxghvsxp.storage.supabase.co`，而不是 MoodTrack 的 `trycloudflare.com` 地址。
上传完成后，本机服务会校验对象大小、类型和 ETag，下载完成后删除云端临时对象。

## 安全与限制

- Bucket 必须是 Private；不要为临时原始视频启用 Public bucket。
- Supabase S3 不实现 ACL、Bucket CORS 和 Lifecycle API。Bucket 隐私在 Dashboard 中确认，
  正常任务的临时对象由 MoodTrack 下载后主动删除。
- 浏览器中断或从未提交 complete 的孤儿对象不会自动获得 S3 生命周期清理；应定期清理
  `incoming/` 下的过期对象。
- 免费项目可能有单文件大小、存储和流量限制；超过项目限制时上传会由 Supabase 拒绝。
- 不要记录预签名 URL；在有效期内它相当于仅对目标对象有效的临时写入凭证。

## 常见故障

| 现象 | 检查项 |
| --- | --- |
| 脚本返回 `AccessDenied` 或 `InvalidAccessKeyId` | S3 是否启用，Access Key/Secret 是否来自当前项目 |
| 返回签名错误 | Project ref、Region、Endpoint 是否与 Storage S3 页面一致 |
| `storage_ready: false` | `.env.gvmgen.local` 是否含完整 `S3_*` 变量，视频服务是否已重启 |
| 浏览器 PUT 403 | 预签名地址是否过期，上传的 `Content-Type` 是否与签名一致 |
| 上传超过项目限制 | 缩小视频，或在 Supabase Dashboard 检查项目与 Bucket 限额 |

官方参考：

- [S3 Authentication](https://supabase.com/docs/guides/storage/s3/authentication)
- [S3 Compatibility](https://supabase.com/docs/guides/storage/s3/compatibility)
- [S3 Uploads](https://supabase.com/docs/guides/storage/uploads/s3-uploads)
- [Creating Buckets](https://supabase.com/docs/guides/storage/buckets/creating-buckets)
