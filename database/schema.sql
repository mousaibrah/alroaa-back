-- PostgreSQL schema (bilingual EN / AR), for creating a new database.
-- Existing databases are upgraded with the files in database/migrations.
--
-- Conventions:
-- - Every table has created_at and updated_at (kept current by a trigger);
--   all but media also have is_deleted (soft delete).
-- - Translatable columns are suffixed _en / _ar.
-- - Uploaded files live in S3-compatible storage (RustFS); the media table
--   keeps their metadata. A *_media_id column points at the media item and
--   the matching *_url column holds its public URL.
-- - Background media processing runs on pg-boss, which creates and owns its
--   own `pgboss` schema (not modelled here).

-- ---------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------
CREATE TYPE course_status      AS ENUM ('draft', 'published', 'archived');
CREATE TYPE lesson_type        AS ENUM ('video', 'text');
CREATE TYPE question_type      AS ENUM ('single_choice', 'multiple_choice', 'true_false');
CREATE TYPE payment_status     AS ENUM ('pending', 'paid', 'failed', 'refunded');
CREATE TYPE transaction_type   AS ENUM ('charge', 'refund', 'void');
CREATE TYPE transaction_status AS ENUM ('pending', 'success', 'failed');
CREATE TYPE enrollment_status  AS ENUM ('active', 'completed', 'cancelled', 'expired');
CREATE TYPE attempt_status     AS ENUM ('in_progress', 'submitted', 'expired');
CREATE TYPE media_type         AS ENUM ('image', 'video');
CREATE TYPE media_status       AS ENUM ('pending', 'uploaded', 'processing', 'ready', 'failed');

-- Keeps updated_at current on every UPDATE
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------
-- Roles & permissions (internal identifiers, not translated)
-- ---------------------------------------------------------------
CREATE TABLE roles (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_roles_updated_at BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE permissions (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_permissions_updated_at BEFORE UPDATE ON permissions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE role_permissions (
    id            SERIAL PRIMARY KEY,
    role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    is_deleted    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_role_permissions_permission_id ON role_permissions(permission_id);
CREATE TRIGGER trg_role_permissions_updated_at BEFORE UPDATE ON role_permissions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------
-- Users
-- first_name / last_name = the name as entered at sign-up (any language)
-- ---------------------------------------------------------------
CREATE TABLE users (
    id                  SERIAL PRIMARY KEY,
    first_name          VARCHAR(100) NOT NULL,
    last_name           VARCHAR(100) NOT NULL,
    email               VARCHAR(255) NOT NULL UNIQUE,
    password            VARCHAR(255) NOT NULL, -- a bcrypt hash, never plain text
    -- Access tokens issued before this are refused (signs out other sessions
    -- after a password change).
    password_changed_at TIMESTAMPTZ,
    -- NULL until the emailed code is entered; unverified accounts can't log in.
    email_verified_at   TIMESTAMPTZ,
    -- Profile picture: its URL (the 320px WebP once processed) and the media
    -- item behind it. The foreign key is added after the media table.
    image               TEXT,
    image_media_id      UUID,
    gender              BIGINT CHECK (gender IN (0, 1)), -- 0 = male, 1 = female
    dob                 DATE,                            -- date of birth
    -- Phone: dialing code (e.g. +966) and the national number, digits only.
    country_code        VARCHAR(5) NOT NULL DEFAULT '+966'
                        CHECK (country_code ~ '^\+[0-9]{1,4}$'),
    phone_number        VARCHAR(15)
                        CHECK (phone_number ~ '^[0-9]{4,15}$'),

    role_id             INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- The same full number can't belong to two accounts.
    CONSTRAINT users_phone_unique UNIQUE (country_code, phone_number)
);

CREATE INDEX idx_users_role_id ON users(role_id);
CREATE INDEX idx_users_image_media_id ON users(image_media_id);
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The pending email verification code of an account (one at a time). Only a
-- hash is kept; the row is deleted once the email is verified.
CREATE TABLE email_verification_codes (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose    VARCHAR(20) NOT NULL DEFAULT 'verify_email', -- or 'reset_password'
    code_hash  CHAR(64) NOT NULL,              -- sha256 hex
    expires_at TIMESTAMPTZ NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,     -- wrong guesses so far
    sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, purpose)
);

-- ---------------------------------------------------------------
-- Media uploads: metadata of the files in storage
-- ---------------------------------------------------------------
CREATE TABLE media (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    key            TEXT NOT NULL UNIQUE,              -- object key in the bucket
    type           media_type NOT NULL,
    mime_type      VARCHAR(100) NOT NULL,
    size           BIGINT NOT NULL CHECK (size >= 0), -- bytes, as declared then verified
    original_name  VARCHAR(255) NOT NULL,
    status         media_status NOT NULL DEFAULT 'pending',
    width          INTEGER,
    height         INTEGER,
    duration_sec   INTEGER CHECK (duration_sec >= 0),
    thumbnail_key  TEXT,
    variants       JSONB,                             -- e.g. {"medium": {"key": "...", "width": 1280}}
    is_private     BOOLEAN NOT NULL DEFAULT FALSE,    -- private = only served via short-lived presigned URLs
    failure_reason TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_media_owner_id ON media(owner_id);
CREATE INDEX idx_media_status ON media(status);
CREATE TRIGGER trg_media_updated_at BEFORE UPDATE ON media FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- users and media point at each other, so one of the two keys comes last.
ALTER TABLE users
    ADD CONSTRAINT users_image_media_id_fkey
    FOREIGN KEY (image_media_id) REFERENCES media(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------
-- Courses
-- ---------------------------------------------------------------
CREATE TABLE courses (
    id                   SERIAL PRIMARY KEY,
    title_en             VARCHAR(255) NOT NULL,
    title_ar             VARCHAR(255) NOT NULL,
    slug                 VARCHAR(255) NOT NULL UNIQUE, -- single latin slug for URLs
    description_en       TEXT,
    description_ar       TEXT,
    price                NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
    currency             CHAR(3) NOT NULL DEFAULT 'SAR', -- ISO 4217 code
    status               course_status NOT NULL DEFAULT 'draft',
    author_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    -- Cover image; the media item takes precedence over a plain URL.
    thumbnail_url        TEXT,
    thumbnail_media_id   UUID REFERENCES media(id) ON DELETE SET NULL,
    -- Introduction video on the overview page (the web MP4 once processed).
    intro_video_url      TEXT,
    intro_video_media_id UUID REFERENCES media(id) ON DELETE SET NULL,
    is_deleted           BOOLEAN NOT NULL DEFAULT FALSE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_courses_author_id ON courses(author_id);
CREATE INDEX idx_courses_thumbnail_media_id ON courses(thumbnail_media_id);
CREATE INDEX idx_courses_intro_video_media_id ON courses(intro_video_media_id);
CREATE TRIGGER trg_courses_updated_at BEFORE UPDATE ON courses FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE course_sections (
    id             SERIAL PRIMARY KEY,
    course_id      INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title_en       VARCHAR(255) NOT NULL,
    title_ar       VARCHAR(255) NOT NULL,
    description_en TEXT,
    description_ar TEXT,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    is_deleted     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_course_sections_course_id ON course_sections(course_id);
CREATE TRIGGER trg_course_sections_updated_at BEFORE UPDATE ON course_sections FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The lesson's content (a video, or an image for a text lesson), one for both
-- languages: the uploaded media item and its public URL.
CREATE TABLE lessons (
    id               SERIAL PRIMARY KEY,
    section_id       INTEGER NOT NULL REFERENCES course_sections(id) ON DELETE CASCADE,
    title_en         VARCHAR(255) NOT NULL,
    title_ar         VARCHAR(255) NOT NULL,
    description_en   TEXT,
    description_ar   TEXT,
    lesson_type      lesson_type NOT NULL,
    content_url      TEXT,
    content_media_id UUID REFERENCES media(id) ON DELETE SET NULL,
    duration_sec     INTEGER CHECK (duration_sec >= 0),
    sort_order       INTEGER NOT NULL DEFAULT 0,
    is_preview       BOOLEAN NOT NULL DEFAULT FALSE,
    is_deleted       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lessons_section_id ON lessons(section_id);
CREATE INDEX idx_lessons_content_media_id ON lessons(content_media_id);
CREATE TRIGGER trg_lessons_updated_at BEFORE UPDATE ON lessons FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------
-- Exams
-- ---------------------------------------------------------------
CREATE TABLE exams (
    id             SERIAL PRIMARY KEY,
    course_id      INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title_en       VARCHAR(255) NOT NULL,
    title_ar       VARCHAR(255) NOT NULL,
    description_en TEXT,
    description_ar TEXT,
    passing_score  NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (passing_score >= 0),
    duration_sec   INTEGER CHECK (duration_sec >= 0),
    is_deleted     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_exams_course_id ON exams(course_id);
CREATE TRIGGER trg_exams_updated_at BEFORE UPDATE ON exams FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE questions (
    id            SERIAL PRIMARY KEY,
    exam_id       INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    text_en       TEXT NOT NULL,
    text_ar       TEXT NOT NULL,
    question_type question_type NOT NULL,
    points        NUMERIC(5, 2) NOT NULL DEFAULT 1 CHECK (points >= 0),
    sort_order    INTEGER NOT NULL DEFAULT 0,
    is_deleted    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_questions_exam_id ON questions(exam_id);
CREATE TRIGGER trg_questions_updated_at BEFORE UPDATE ON questions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE question_options (
    id             SERIAL PRIMARY KEY,
    question_id    INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    option_text_en TEXT NOT NULL,
    option_text_ar TEXT NOT NULL,
    is_correct     BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    is_deleted     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_question_options_question_id ON question_options(question_id);
CREATE TRIGGER trg_question_options_updated_at BEFORE UPDATE ON question_options FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------
-- Payments, enrollments & progress (no translatable text)
-- ---------------------------------------------------------------
CREATE TABLE payments (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    course_id           INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
    amount              NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
    currency            CHAR(3) NOT NULL DEFAULT 'USD', -- ISO 4217 code
    status              payment_status NOT NULL DEFAULT 'pending',
    provider            VARCHAR(50) NOT NULL,           -- e.g. stripe, paypal
    provider_payment_id VARCHAR(255) NOT NULL,          -- payment/intent id at the provider
    paid_at             TIMESTAMPTZ,
    is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, provider_payment_id)
);

CREATE INDEX idx_payments_user_id ON payments(user_id);
CREATE INDEX idx_payments_course_id ON payments(course_id);
CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every attempt/event against a payment (charge, refund, ...) as reported by the provider
CREATE TABLE payment_transactions (
    id                        SERIAL PRIMARY KEY,
    payment_id                INTEGER NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
    provider                  VARCHAR(50) NOT NULL,
    provider_transaction_id   VARCHAR(255) NOT NULL,
    transaction_type          transaction_type NOT NULL,
    amount                    NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
    currency                  CHAR(3) NOT NULL DEFAULT 'USD',
    status                    transaction_status NOT NULL DEFAULT 'pending',
    response_code_provider    VARCHAR(100),
    response_message_provider TEXT,
    is_deleted                BOOLEAN NOT NULL DEFAULT FALSE,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, provider_transaction_id)
);

CREATE INDEX idx_payment_transactions_payment_id ON payment_transactions(payment_id);
CREATE TRIGGER trg_payment_transactions_updated_at BEFORE UPDATE ON payment_transactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE enrollments (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    course_id    INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
    payment_id   INTEGER REFERENCES payments(id) ON DELETE SET NULL, -- NULL for free courses
    status       enrollment_status NOT NULL DEFAULT 'active',
    enrolled_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    is_deleted   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, course_id)
);

CREATE INDEX idx_enrollments_course_id ON enrollments(course_id);
CREATE INDEX idx_enrollments_payment_id ON enrollments(payment_id);
CREATE TRIGGER trg_enrollments_updated_at BEFORE UPDATE ON enrollments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE lesson_progress (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id    INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    progress_sec INTEGER NOT NULL DEFAULT 0 CHECK (progress_sec >= 0),
    completed    BOOLEAN NOT NULL DEFAULT FALSE,
    last_access  TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    is_deleted   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, lesson_id)
);

CREATE INDEX idx_lesson_progress_lesson_id ON lesson_progress(lesson_id);
CREATE TRIGGER trg_lesson_progress_updated_at BEFORE UPDATE ON lesson_progress FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------
-- Exam attempts
-- ---------------------------------------------------------------
CREATE TABLE exam_attempts (
    id           SERIAL PRIMARY KEY,
    exam_id      INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       attempt_status NOT NULL DEFAULT 'in_progress',
    started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- NULL when the exam has no time limit; enforced by the server
    expires_at   TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    score        NUMERIC(7, 2),
    max_score    NUMERIC(7, 2),
    passed       BOOLEAN,
    -- What the learner sent, and the graded snapshot (question and option
    -- text in both languages, correct answers) so a review never changes when
    -- the exam is edited later.
    answers      JSONB,
    result       JSONB,
    is_deleted   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_exam_attempts_exam_user ON exam_attempts(exam_id, user_id);
-- A learner can have only one unfinished attempt per exam
CREATE UNIQUE INDEX ux_exam_attempts_one_active
    ON exam_attempts(exam_id, user_id) WHERE status = 'in_progress';
CREATE TRIGGER trg_exam_attempts_updated_at BEFORE UPDATE ON exam_attempts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------
-- Certificates: issued once a learner has passed every exam of a course
-- ---------------------------------------------------------------
CREATE TABLE certificates (
    id               SERIAL PRIMARY KEY,
    -- Public verification code printed on the certificate, e.g. RNEC-7K2M9-XQ4PD
    code             VARCHAR(32) NOT NULL UNIQUE,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id        INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    -- The attempt that completed the course
    attempt_id       INTEGER REFERENCES exam_attempts(id) ON DELETE SET NULL,
    -- Snapshots, so the certificate never changes when the user or course is edited
    holder_name      VARCHAR(255) NOT NULL,
    holder_name_ar   VARCHAR(255),
    course_title_en  VARCHAR(255) NOT NULL,
    course_title_ar  VARCHAR(255) NOT NULL,
    learning_seconds INTEGER NOT NULL DEFAULT 0,
    issued_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_certificates_user_id ON certificates(user_id);
-- One certificate per learner and course
CREATE UNIQUE INDEX ux_certificates_user_course
    ON certificates(user_id, course_id) WHERE is_deleted = FALSE;
CREATE TRIGGER trg_certificates_updated_at BEFORE UPDATE ON certificates FOR EACH ROW EXECUTE FUNCTION set_updated_at();
