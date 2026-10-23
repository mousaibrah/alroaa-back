-- Adds the course introduction video (needs 2026-10-22-media-uploads.sql first).
-- psql "$DATABASE_URL" -f database/migrations/2026-10-24-course-intro-video.sql
--
-- intro_video_url: the uploaded video's public URL (the web MP4 once processed).
-- intro_video_media_id: the uploaded media item behind it.
ALTER TABLE courses
    ADD COLUMN IF NOT EXISTS intro_video_url TEXT,
    ADD COLUMN IF NOT EXISTS intro_video_media_id UUID REFERENCES media(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_courses_intro_video_media_id ON courses(intro_video_media_id);
