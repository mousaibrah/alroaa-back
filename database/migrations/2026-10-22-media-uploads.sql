-- Adds media uploads to an existing database (schema.sql already has it).
-- psql "$DATABASE_URL" -f database/migrations/2026-10-22-media-uploads.sql

-- ---------------------------------------------------------------
-- Media uploads: file bytes live in S3-compatible storage (RustFS), the
-- database keeps only metadata. Background processing runs on pg-boss, which
-- creates and owns its own `pgboss` schema (not modelled here).
-- ---------------------------------------------------------------
CREATE TYPE media_type AS ENUM ('image', 'video');
CREATE TYPE media_status AS ENUM ('pending', 'uploaded', 'processing', 'ready', 'failed');

CREATE TABLE media (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    key            TEXT NOT NULL UNIQUE,            -- object key in the bucket
    type           media_type NOT NULL,
    mime_type      VARCHAR(100) NOT NULL,
    size           BIGINT NOT NULL CHECK (size >= 0), -- bytes, as declared then verified
    original_name  VARCHAR(255) NOT NULL,
    status         media_status NOT NULL DEFAULT 'pending',
    width          INTEGER,
    height         INTEGER,
    duration_sec   INTEGER CHECK (duration_sec >= 0),
    thumbnail_key  TEXT,
    variants       JSONB,                           -- e.g. {"medium": {"key": "...", "width": 1280}}
    is_private     BOOLEAN NOT NULL DEFAULT FALSE,  -- private = only served via short-lived presigned URLs
    failure_reason TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_media_owner_id ON media(owner_id);
CREATE INDEX idx_media_status ON media(status);

CREATE TRIGGER trg_media_updated_at BEFORE UPDATE ON media FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A lesson can use an uploaded file per language. content_url_en / content_url_ar
-- stay for external URLs; when a media item is set it takes precedence.
ALTER TABLE lessons
    ADD COLUMN content_media_en_id UUID REFERENCES media(id) ON DELETE SET NULL,
    ADD COLUMN content_media_ar_id UUID REFERENCES media(id) ON DELETE SET NULL;

CREATE INDEX idx_lessons_content_media_en_id ON lessons(content_media_en_id);
CREATE INDEX idx_lessons_content_media_ar_id ON lessons(content_media_ar_id);
