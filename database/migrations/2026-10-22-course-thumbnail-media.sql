-- Adds the course cover upload (needs 2026-10-22-media-uploads.sql first).
-- psql "$DATABASE_URL" -f database/migrations/2026-10-22-course-thumbnail-media.sql

-- A course cover can be an uploaded image. thumbnail_url stays for external URLs;
-- when a media item is set it takes precedence.
ALTER TABLE courses
    ADD COLUMN thumbnail_media_id UUID REFERENCES media(id) ON DELETE SET NULL;

CREATE INDEX idx_courses_thumbnail_media_id ON courses(thumbnail_media_id);
