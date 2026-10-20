-- Adds certificates to an existing database (schema.sql already has it).
-- psql "$DATABASE_URL" -f database/migrations/2026-10-19-certificates.sql

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
    course_title     VARCHAR(255) NOT NULL,
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
