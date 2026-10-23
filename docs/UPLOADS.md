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

All need a bearer token with `courses.update` (admins only). Owners see their own media; admins see all.

| | |
|---|---|
| `POST /media/presign` | `{filename, mimeType, size, isPrivate?}` → `{mediaId, key, url, headers}` |
| `POST /media/:id/confirm` | Verifies the object (size and type), queues processing |
| `POST /media/multipart` | Large files: same body as presign → `{mediaId, uploadId, partSize, partCount}` |
| `POST /media/:id/multipart/part` | `{uploadId, partNumber}` → `{url}`: PUT bytes `[(n-1)·partSize, n·partSize)` there |
| `POST /media/:id/multipart/complete` | `{uploadId}`: joins the parts, verifies, queues processing |
| `POST /media/:id/multipart/abort` | `{uploadId}`: drops the parts and the media row |
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
// attach to a lesson
await fetch(`${api}/lessons/${lessonId}`, { method: 'PATCH', headers: auth,
  body: JSON.stringify({ contentMediaId: mediaId }) });
```

## Where uploads are used

Lessons and course covers are uploaded with the form itself (multipart), not through presign:

| Where | File field | Accepts |
|---|---|---|
| `POST /sections/:id/lessons`, `PATCH /lessons/:id` | `file` | video (video lesson) or image (text lesson); see Lessons below |
| `POST /courses`, `PATCH /courses/:id` | `thumbnail` | image, up to `MAX_IMAGE_SIZE_MB`; optional (`introVideo`: video, optional) |
| `POST /auth/register` | `image` | image; optional. Public: the file has no owner until the account exists |
| `PUT /users/me/image` | `image` | image; required. Any logged-in user, for their own picture |

Both work the same way: the file is stored in RustFS (public `media/` prefix) as a media item, its URL is
saved right away (`contentUrl` / `thumbnailUrl` / `introVideoUrl` / `image`), and processing runs in the background.
Once processed, a course cover switches to the 1280px WebP, videos to the web MP4, and a profile picture to
the 320px WebP. Sending a new file replaces the
old one, whose files are deleted.

```js
const form = new FormData();
form.append('titleEn', 'Intro to TS'); form.append('titleAr', 'مقدمة');
form.append('price', '49.99');
form.append('thumbnail', imageFile);
await fetch(`${api}/courses`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
```

The presign endpoints above stay for other uses. Run `database/migrations/2026-10-22-course-thumbnail-media.sql`
after the media one, then `database/migrations/2026-10-23-single-lesson-content.sql` (one content column per lesson).
Run `database/migrations/2026-10-24-user-image-media.sql` for profile pictures.

## Lessons

The admin frontend uploads lesson files with the multipart endpoints above (parts in parallel, each
retried on its own, straight to storage) and then creates or updates the lesson with JSON
`{ ..., contentMediaId }`. The bytes never pass through the API, so request timeouts and the API's
bandwidth do not limit video size. The media must be the caller's, public, of the lesson's type and
not `pending` / `failed`. The multipart form below still works (fine for small files and curl).

A lesson is created in one multipart request: the lesson fields plus the file. The request returns
right away; the file is processed in the background and its URL saved on the lesson.

| Field | |
|---|---|
| `titleEn`, `titleAr` | required |
| `descriptionEn`, `descriptionAr` | optional |
| `lessonType` | `video` or `text` |
| `durationSec` | optional; left empty it is read from the video |
| `isPreview` | optional, `true` / `false` |
| `file` | required on create (video for a `video` lesson, image for a `text` lesson); optional on `PATCH`, where it replaces the content |

```js
const form = new FormData();
form.append('titleEn', 'Intro'); form.append('titleAr', 'مقدمة');
form.append('lessonType', 'video');
form.append('file', file); // a File or Blob from <input type="file">
const lesson = await (await fetch(`${api}/sections/${sectionId}/lessons`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form, // no Content-Type: the browser sets it
})).json();
// lesson.contentUrl is the uploaded file's URL, lesson.contentStatus === 'processing'
```

What happens:

1. During the request: the file is checked (type, size) and stored in RustFS under the public `media/` prefix as a media item, the lesson is saved with `content_url` = that file's URL, and a pg-boss job is queued.
2. In the background: ffprobe/ffmpeg make the poster and a web-friendly MP4. Then `content_url` is switched to
   that MP4's public URL (images keep the original) and `duration_sec` is filled if it was empty.
   This needs `ffmpeg` and `ffprobe` installed (`brew install ffmpeg`).
3. The lesson's `contentStatus` (in the lesson and course responses for editors) goes
   `processing` → `ready`, or `failed`. On `PATCH` with a new file the old file is deleted.

Lesson content is one file for both languages. Its URL is public, so anyone with the link can open it,
paid lessons included.

## When we deploy later (not part of this task)

- Run RustFS under PM2 bound to localhost, with `S3_ENDPOINT=http://127.0.0.1:9000` and `S3_PUBLIC_ENDPOINT` set to the public storage host (the presigned URLs are signed for that host).
- Put a reverse proxy in front of the public `media/*` path with caching; keep `private/*` going through presigned URLs.
- Optionally move the pg-boss worker into its own process (it only needs `DATABASE_URL`, storage env, ffmpeg).
- Change `.env` values (credentials, origins, endpoints); no code changes.
