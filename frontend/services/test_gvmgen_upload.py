from __future__ import annotations

import io
import tempfile
import time
import unittest
from pathlib import Path

import httpx
from botocore.exceptions import ClientError

from services import gvmgen_service as service


class DummyExecutor:
    def __init__(self) -> None:
        self.calls = []

    def submit(self, function, *args):
        self.calls.append((function, args))


class FakeR2:
    def __init__(self) -> None:
        self.objects = {}
        self.multipart_uploads = {}
        self.next_multipart_id = 1
        self.omit_multipart_sizes = False

    def generate_presigned_url(self, operation, Params, ExpiresIn):
        del ExpiresIn
        suffix = f"operation={operation}"
        if "UploadId" in Params:
            suffix += f"&uploadId={Params['UploadId']}&partNumber={Params['PartNumber']}"
        return f"https://example.r2.cloudflarestorage.com/{Params['Key']}?{suffix}"

    def create_multipart_upload(self, Bucket, Key, ContentType):
        del Bucket
        upload_id = f"multipart-{self.next_multipart_id}"
        self.next_multipart_id += 1
        self.multipart_uploads[upload_id] = {
            "key": Key,
            "content_type": ContentType,
            "parts": {},
        }
        return {"UploadId": upload_id}

    def put_multipart_part(self, upload_id, part_number, body):
        upload = self.multipart_uploads[upload_id]
        etag = f'"part-{part_number}"'
        upload["parts"][part_number] = {"body": body, "etag": etag}
        return etag

    def list_parts(self, Bucket, Key, UploadId, PartNumberMarker=None):
        del Bucket, PartNumberMarker
        upload = self.multipart_uploads[UploadId]
        if upload["key"] != Key:
            raise AssertionError("multipart key mismatch")
        parts = [
            {
                "PartNumber": part_number,
                "Size": len(value["body"]),
                "ETag": value["etag"],
            }
            for part_number, value in sorted(upload["parts"].items())
        ]
        if self.omit_multipart_sizes:
            for part in parts:
                part.pop("Size", None)
        return {
            "IsTruncated": False,
            "Parts": parts,
        }

    def complete_multipart_upload(self, Bucket, Key, UploadId, MultipartUpload):
        del Bucket
        upload = self.multipart_uploads[UploadId]
        if upload["key"] != Key:
            raise AssertionError("multipart key mismatch")
        body = b"".join(upload["parts"][part["PartNumber"]]["body"] for part in MultipartUpload["Parts"])
        self.objects[Key] = {
            "body": body,
            "content_type": upload["content_type"],
            "etag": "multipart-complete",
        }
        del self.multipart_uploads[UploadId]
        return {"ETag": '"multipart-complete"'}

    def abort_multipart_upload(self, Bucket, Key, UploadId):
        del Bucket, Key
        self.multipart_uploads.pop(UploadId, None)
        return {}

    def head_object(self, Bucket, Key):
        del Bucket
        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey", "Message": "missing"}}, "HeadObject")
        value = self.objects[Key]
        return {
            "ContentLength": len(value["body"]),
            "ContentType": value["content_type"],
            "ETag": f'"{value["etag"]}"',
        }

    def get_object(self, Bucket, Key, IfMatch):
        del Bucket
        value = self.objects[Key]
        if IfMatch != f'"{value["etag"]}"':
            raise ClientError({"Error": {"Code": "PreconditionFailed"}}, "GetObject")
        return {"Body": io.BytesIO(value["body"])}

    def delete_object(self, Bucket, Key):
        del Bucket
        self.objects.pop(Key, None)
        return {}


class ChunkedUploadTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.original_output_root = service.OUTPUT_ROOT
        self.original_upload_root = service.UPLOAD_ROOT
        service.OUTPUT_ROOT = Path(self.temporary.name)
        service.UPLOAD_ROOT = service.OUTPUT_ROOT / ".uploads"
        service.UPLOAD_ROOT.mkdir(parents=True)
        service.upload_sessions.clear()
        service.uploads_by_client.clear()
        service.jobs.clear()
        self.original_model_ready = service.model_ready
        self.original_executor = service.executor
        self.original_storage_configured = service.storage_configured
        self.original_get_storage_client = service.get_storage_client
        service.model_ready = lambda: True
        service.executor = DummyExecutor()
        self.storage = FakeR2()
        service.storage_configured = lambda: True
        service.get_storage_client = lambda: self.storage
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=service.app),
            base_url="http://moodtrack.test",
        )

    async def asyncTearDown(self) -> None:
        await self.client.aclose()
        service.model_ready = self.original_model_ready
        service.executor = self.original_executor
        service.storage_configured = self.original_storage_configured
        service.get_storage_client = self.original_get_storage_client
        service.OUTPUT_ROOT = self.original_output_root
        service.UPLOAD_ROOT = self.original_upload_root
        self.temporary.cleanup()

    async def test_chunk_retry_and_idempotent_completion(self) -> None:
        video = b"a" * (service.UPLOAD_CHUNK_BYTES + 17)
        request_id = "0123456789abcdef0123456789abcdef"
        created = await self.client.post("/uploads", json={
            "filename": "clip.mp4",
            "size": len(video),
            "duration": 15,
            "client_request_id": request_id,
        })
        self.assertEqual(created.status_code, 201)
        upload = created.json()
        self.assertEqual(upload["total_chunks"], 2)

        repeated = await self.client.post("/uploads", json={
            "filename": "clip.mp4",
            "size": len(video),
            "duration": 15,
            "client_request_id": request_id,
        })
        self.assertEqual(repeated.json()["upload_id"], upload["upload_id"])

        for index in range(upload["total_chunks"]):
            start = index * upload["chunk_size"]
            end = min(len(video), start + upload["chunk_size"])
            headers = {"Content-Range": f"bytes {start}-{end - 1}/{len(video)}"}
            response = await self.client.put(
                f"/uploads/{upload['upload_id']}/chunks/{index}",
                headers=headers,
                content=video[start:end],
            )
            self.assertEqual(response.status_code, 200)
            retry = await self.client.put(
                f"/uploads/{upload['upload_id']}/chunks/{index}",
                headers=headers,
                content=video[start:end],
            )
            self.assertEqual(retry.status_code, 200)

        completed = await self.client.post(f"/uploads/{upload['upload_id']}/complete")
        self.assertEqual(completed.status_code, 202)
        job_id = completed.json()["job_id"]
        self.assertRegex(job_id, r"^[a-f0-9]{32}$")
        self.assertEqual(len(service.executor.calls), 1)

        completed_again = await self.client.post(f"/uploads/{upload['upload_id']}/complete")
        self.assertEqual(completed_again.json()["job_id"], job_id)
        self.assertEqual(len(service.executor.calls), 1)
        self.assertEqual((service.OUTPUT_ROOT / job_id / "source.mp4").read_bytes(), video)

    async def test_rejects_wrong_chunk_range(self) -> None:
        created = (await self.client.post("/uploads", json={
            "filename": "clip.webm",
            "size": 12,
            "duration": 5,
            "client_request_id": "fedcba9876543210fedcba9876543210",
        })).json()
        response = await self.client.put(
            f"/uploads/{created['upload_id']}/chunks/0",
            headers={"Content-Range": "bytes 1-12/12"},
            content=b"hello world!",
        )
        self.assertEqual(response.status_code, 409)

    async def test_r2_upload_is_idempotent_and_downloads_outside_api(self) -> None:
        video = b"r2-video" * 1024
        request_id = "aaaabbbbccccddddeeeeffff00001111"
        created = await self.client.post("/object-uploads", json={
            "filename": "cloud.mp4",
            "size": len(video),
            "duration": 9,
            "client_request_id": request_id,
        })
        self.assertEqual(created.status_code, 201)
        upload = created.json()
        self.assertEqual(upload["upload_strategy"], "single")
        self.assertIn("upload_url", upload)
        self.assertEqual(upload["upload_headers"], {"Content-Type": "video/mp4"})

        repeated = await self.client.post("/object-uploads", json={
            "filename": "cloud.mp4",
            "size": len(video),
            "duration": 9,
            "client_request_id": request_id,
        })
        self.assertEqual(repeated.json()["upload_id"], upload["upload_id"])

        session = service.upload_sessions[upload["upload_id"]]
        self.storage.objects[session["object_key"]] = {
            "body": video,
            "content_type": "video/mp4",
            "etag": "test-etag",
        }
        completed = await self.client.post(f"/object-uploads/{upload['upload_id']}/complete")
        self.assertEqual(completed.status_code, 202)
        job_id = completed.json()["job_id"]
        self.assertEqual(len(service.executor.calls), 1)
        self.assertIs(service.executor.calls[0][0], service.run_object_generation)

        service.download_object_video(
            job_id,
            dict(session),
            service.OUTPUT_ROOT / job_id / "source.mp4",
        )
        self.assertEqual((service.OUTPUT_ROOT / job_id / "source.mp4").read_bytes(), video)
        self.assertNotIn(session["object_key"], self.storage.objects)

        completed_again = await self.client.post(f"/object-uploads/{upload['upload_id']}/complete")
        self.assertEqual(completed_again.json()["job_id"], job_id)
        self.assertEqual(len(service.executor.calls), 1)

    async def test_large_object_uses_multipart_and_completes_listed_parts(self) -> None:
        video = b"m" * (service.MULTIPART_PART_BYTES + 17)
        created = await self.client.post("/object-uploads", json={
            "filename": "large.mp4",
            "size": len(video),
            "duration": 12,
            "client_request_id": "abcddcbaabcddcbaabcddcbaabcddcba",
        })
        self.assertEqual(created.status_code, 201)
        upload = created.json()
        self.assertEqual(upload["upload_strategy"], "multipart")
        self.assertEqual(upload["part_size"], service.MULTIPART_PART_BYTES)
        self.assertEqual(upload["total_parts"], 2)
        self.assertEqual([part["part_number"] for part in upload["parts"]], [1, 2])
        self.assertNotIn("upload_url", upload)

        session = service.upload_sessions[upload["upload_id"]]
        multipart_id = session["multipart_upload_id"]
        # Supabase's S3-compatible ListParts response omits the optional Size
        # field, unlike AWS/R2. Completion must remain compatible and rely on
        # the final HeadObject byte-count check.
        self.storage.omit_multipart_sizes = True
        self.storage.put_multipart_part(
            multipart_id,
            1,
            video[:service.MULTIPART_PART_BYTES],
        )
        refreshed = await self.client.get(f"/object-uploads/{upload['upload_id']}")
        self.assertEqual(refreshed.status_code, 200)
        self.assertEqual(refreshed.json()["uploaded_parts"], [1])
        self.assertEqual([part["part_number"] for part in refreshed.json()["parts"]], [2])

        incomplete = await self.client.post(f"/object-uploads/{upload['upload_id']}/complete")
        self.assertEqual(incomplete.status_code, 409)
        self.assertIn("1 个云存储分片", incomplete.json()["detail"])
        self.assertEqual(len(service.executor.calls), 0)

        self.storage.put_multipart_part(
            multipart_id,
            2,
            video[service.MULTIPART_PART_BYTES:],
        )
        completed = await self.client.post(f"/object-uploads/{upload['upload_id']}/complete")
        self.assertEqual(completed.status_code, 202)
        job_id = completed.json()["job_id"]
        self.assertEqual(len(service.executor.calls), 1)
        self.assertIs(service.executor.calls[0][0], service.run_object_generation)

        service.download_object_video(
            job_id,
            dict(session),
            service.OUTPUT_ROOT / job_id / "source.mp4",
        )
        self.assertEqual((service.OUTPUT_ROOT / job_id / "source.mp4").read_bytes(), video)
        self.assertNotIn(session["object_key"], self.storage.objects)

    async def test_multipart_rejects_wrong_reported_part_size(self) -> None:
        session = {
            "part_size": service.MULTIPART_PART_BYTES,
            "total_size": service.MULTIPART_PART_BYTES + 17,
            "total_parts": 2,
        }
        parts = [
            {"PartNumber": 1, "Size": service.MULTIPART_PART_BYTES - 1, "ETag": '"part-1"'},
            {"PartNumber": 2, "Size": 18, "ETag": '"part-2"'},
        ]
        with self.assertRaisesRegex(service.MultipartUploadIncomplete, "第 1 个视频分片大小不匹配"):
            service.validate_multipart_parts(session, parts)

    async def test_r2_rejects_wrong_object_size(self) -> None:
        created = (await self.client.post("/object-uploads", json={
            "filename": "cloud.webm",
            "size": 12,
            "duration": 5,
            "client_request_id": "11112222333344445555666677778888",
        })).json()
        session = service.upload_sessions[created["upload_id"]]
        self.storage.objects[session["object_key"]] = {
            "body": b"too short",
            "content_type": "video/webm",
            "etag": "wrong-size",
        }
        response = await self.client.post(f"/object-uploads/{created['upload_id']}/complete")
        self.assertEqual(response.status_code, 409)
        self.assertNotIn(session["object_key"], self.storage.objects)

    async def test_same_video_with_new_request_id_creates_new_job(self) -> None:
        video = b"fresh-soundtrack" * 128
        upload_ids = []
        job_ids = []
        for index, request_id in enumerate((
            "01230123012301230123012301230123",
            "45674567456745674567456745674567",
        )):
            response = await self.client.post("/object-uploads", json={
                "filename": "same-video.mp4",
                "size": len(video),
                "duration": 8,
                "client_request_id": request_id,
            })
            self.assertEqual(response.status_code, 201)
            upload = response.json()
            upload_ids.append(upload["upload_id"])
            session = service.upload_sessions[upload["upload_id"]]
            self.storage.objects[session["object_key"]] = {
                "body": video,
                "content_type": "video/mp4",
                "etag": f"fresh-{index}",
            }
            completed = await self.client.post(f"/object-uploads/{upload['upload_id']}/complete")
            self.assertEqual(completed.status_code, 202)
            job_id = completed.json()["job_id"]
            job_ids.append(job_id)
            service.jobs[job_id]["status"] = "completed"

        self.assertEqual(len(set(upload_ids)), 2)
        self.assertEqual(len(set(job_ids)), 2)
        self.assertEqual(len(service.executor.calls), 2)

    async def test_dynamic_responses_disable_http_cache(self) -> None:
        response = await self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("cache-control"), "no-store, max-age=0")
        self.assertEqual(response.headers.get("pragma"), "no-cache")
        self.assertEqual(response.headers.get("expires"), "0")

    async def test_expired_object_upload_is_deleted(self) -> None:
        created = (await self.client.post("/object-uploads", json={
            "filename": "expired.mp4",
            "size": 12,
            "duration": 5,
            "client_request_id": "99990000111122223333444455556666",
        })).json()
        session = service.upload_sessions[created["upload_id"]]
        session["created_at"] = time.time() - service.UPLOAD_SESSION_TTL_SECONDS - 1
        self.storage.objects[session["object_key"]] = {
            "body": b"hello world!",
            "content_type": "video/mp4",
            "etag": "expired",
        }
        service.cleanup_upload_sessions()
        self.assertNotIn(created["upload_id"], service.upload_sessions)
        self.assertNotIn(session["object_key"], self.storage.objects)


if __name__ == "__main__":
    unittest.main()
