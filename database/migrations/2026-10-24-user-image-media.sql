-- Adds the uploaded profile picture (needs 2026-10-22-media-uploads.sql first).
-- psql "$DATABASE_URL" -f database/migrations/2026-10-24-user-image-media.sql
--
-- users.image keeps the picture's URL (the 320px WebP once processed);
-- image_media_id is the uploaded media item behind it.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS image_media_id UUID REFERENCES media(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_image_media_id ON users(image_media_id);
