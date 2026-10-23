-- Lesson content is no longer per language: one URL and one media item.
-- Existing lessons keep their English content, else the Arabic one.
-- Run after 2026-10-22-media-uploads.sql. Safe to run again, and works whether
-- or not content_url was already merged by hand.
BEGIN;

ALTER TABLE lessons
    ADD COLUMN IF NOT EXISTS content_url TEXT,
    ADD COLUMN IF NOT EXISTS content_media_id UUID REFERENCES media(id) ON DELETE SET NULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'lessons' AND column_name = 'content_url_en') THEN
        UPDATE lessons SET content_url = COALESCE(content_url, content_url_en, content_url_ar);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'lessons' AND column_name = 'content_media_en_id') THEN
        UPDATE lessons SET content_media_id =
            COALESCE(content_media_id, content_media_en_id, content_media_ar_id);
    END IF;
END $$;

DROP INDEX IF EXISTS idx_lessons_content_media_en_id;
DROP INDEX IF EXISTS idx_lessons_content_media_ar_id;

ALTER TABLE lessons
    DROP COLUMN IF EXISTS content_url_en,
    DROP COLUMN IF EXISTS content_url_ar,
    DROP COLUMN IF EXISTS content_media_en_id,
    DROP COLUMN IF EXISTS content_media_ar_id;

CREATE INDEX IF NOT EXISTS idx_lessons_content_media_id ON lessons(content_media_id);

COMMIT;
