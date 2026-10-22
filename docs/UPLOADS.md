# Image & video uploads

Files go **browser → RustFS (S3 API)** through presigned URLs; the API never touches the bytes.
PostgreSQL keeps only metadata (`media` table). Processing (thumbnails, poster, web MP4) runs in a
[pg-boss](https://github.com/timgit/pg-boss) worker inside the API process, using the `pgboss`
schema of the same database (created automatically on first start). No Redis.

## Local setup (in this order)

1. Prerequisites: `ffmpeg -version` and `ffprobe -version` work (Homebrew); RustFS binary at `~/rustfs/bin/rustfs`.
2. Add the variables from `.env.example` ("Media uploads" block) to your `.env`.
3. Start storage: `yarn dev:rustfs` (S3 API `127.0.0.1:9000`, console `127.0.0.1:9001`).
4. Apply the SQL to your **local** database (we use SQL files, not `prisma migrate`):
   `psql "$DATABASE_URL" -f database/migrations/2026-10-22-media-uploads.sql`, then `yarn prisma:generate`.
5. Start the API: `yarn dev`. On boot it creates the bucket if missing and applies CORS and a
   public-read policy for `media/*`. Storage problems are logged as warnings/errors, the API still starts.

If RustFS does not support `PutBucketCors` / `PutBucketPolicy` you will see a warning at boot. Then
set CORS (PUT, GET, HEAD from your frontend origins) and an anonymous `s3:GetObject` policy on
`media/*` through the RustFS console or `aws --endpoint-url http://127.0.0.1:9000 s3api put-bucket-cors ...`.

## Environment variables

| Variable | Meaning |
|---|---|
| `S3_ENDPOINT` | How the API reaches storage |
| `S3_PUBLIC_ENDPOINT` | Host the browser uses in presigned URLs |
| `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Standard S3 settings |
| `S3_PUBLIC_BASE_URL` | Base of public file URLs (default `S3_PUBLIC_ENDPOINT/S3_BUCKET`) |
| `MAX_IMAGE_SIZE_MB`, `MAX_VIDEO_SIZE_MB` | Upload limits (default 10 / 1024) |
| `CORS_ALLOWED_ORIGINS` | Origins allowed to upload/read (comma separated) |
| `RUSTFS_BIN`, `RUSTFS_DATA_DIR`, `RUSTFS_PORT`, `RUSTFS_CONSOLE_PORT` | Used by `yarn dev:rustfs` only |
| `MEDIA_WORKER_CONCURRENCY` | Parallel processing jobs, 1 (default) or 2 |

## Endpoints

All need a bearer token with `courses.update` (admins and instructors). Owners see their own media; admins see all.

| | |
|---|---|
| `POST /media/presign` | `{filename, mimeType, size, isPrivate?}` → `{mediaId, key, url, headers}` |
| `POST /media/:id/confirm` | Verifies the object (size and type), queues processing |
| `GET /media/:id` | Metadata, status and URLs (signed for private media) |
| `GET /media` | `?page=&limit=` |
| `DELETE /media/:id` | Refused (409) while a lesson uses it |

Allowed types: jpeg, png, webp, gif, mp4, webm, quicktime. Status flow:
`pending → uploaded → processing → ready` (or `failed`).

```sh
TOKEN=...   # login first
curl -s -X POST localhost:3000/media/presign -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"filename":"a.png","mimeType":"image/png","size":'$(stat -f%z a.png)'}'
# PUT the file to the returned url with the same Content-Type
curl -X PUT -H 'Content-Type: image/png' --data-binary @a.png "<url>"
curl -s -X POST localhost:3000/media/<mediaId>/confirm -H "Authorization: Bearer $TOKEN"
curl -s localhost:3000/media/<mediaId> -H "Authorization: Bearer $TOKEN"   # wait for "ready"
```

Browser:

```js
async function upload(file, token, api = 'http://localhost:3000', isPrivate = false) {
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const p = await (await fetch(`${api}/media/presign`, { method: 'POST', headers: auth,
    body: JSON.stringify({ filename: file.name, mimeType: file.type, size: file.size, isPrivate }) })).json();
  const put = await fetch(p.url, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
  if (!put.ok) throw new Error('upload failed');
  await fetch(`${api}/media/${p.mediaId}/confirm`, { method: 'POST', headers: auth });
  return p.mediaId; // poll GET /media/:id until status === 'ready'
}
// attach to a lesson (new field per language; the old contentUrlEn/Ar still work)
await fetch(`${api}/lessons/${lessonId}`, { method: 'PATCH', headers: auth,
  body: JSON.stringify({ contentMediaEnId: mediaId }) });
```

## Where uploads are used

Upload once (presign → PUT → confirm), then pass the `mediaId` in the body:

| Where | Field | Rules |
|---|---|---|
| Lessons: `POST /sections/:id/lessons`, `PATCH /lessons/:id` | `contentMediaEnId`, `contentMediaArId` | see Lessons below |
| `POST /courses`, `PATCH /courses/:id` | `thumbnailMediaId` | READY, **public** image; wins over `thumbnailUrl`; `null` clears |

Course responses keep returning `thumbnailUrl` (the uploaded cover's 1280px WebP when set) plus `thumbnailMediaId`.
Run `database/migrations/2026-10-22-course-thumbnail-media.sql` after the media one.
Not covered: `users.image` (there is no profile-update endpoint yet; registration is public and cannot upload).

## Lessons

- `contentMediaEnId` / `contentMediaArId`: the media must exist, be `ready`, belong to the caller (or an admin), and match the lesson type (`video` lesson → video, `text` lesson → image). `null` clears it.
- Precedence per language: media, else the legacy `contentUrlEn/Ar`; the other language is the fallback.
- An empty `durationSec` is filled from the video.
- **Paid content:** a video in a non-preview lesson must be uploaded with `isPrivate: true`. Private files live under `private/` (never public) and are served only by `GET /lessons/:id/playback`, which runs the enrollment/payment/unlock checks and returns a 1-hour presigned URL. Preview lessons may use public videos.
- Private media's thumbnails and posters are signed too.

## When we deploy later (not part of this task)

- Run RustFS under PM2 bound to localhost, with `S3_ENDPOINT=http://127.0.0.1:9000` and `S3_PUBLIC_ENDPOINT` set to the public storage host (the presigned URLs are signed for that host).
- Put a reverse proxy in front of the public `media/*` path with caching; keep `private/*` going through presigned URLs.
- Optionally move the pg-boss worker into its own process (it only needs `DATABASE_URL`, storage env, ffmpeg).
- Change `.env` values (credentials, origins, endpoints); no code changes.
