-- Exam attempts: one row per time a learner takes an exam.
-- Run once on databases created before this table existed:
--   psql "$DATABASE_URL" -f database/migrations/001_exam_attempts.sql
-- (database/schema.sql already contains it for fresh databases.)

CREATE TYPE attempt_status AS ENUM ('in_progress', 'submitted', 'expired');

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
    -- What the learner sent, and the graded snapshot (question text, options,
    -- correct answers) so a review never changes when the exam is edited later
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
