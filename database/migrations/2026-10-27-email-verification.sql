-- Email verification: new accounts get a 6-digit code by email and can't log
-- in until they enter it. Accounts that already exist count as verified.
-- psql "$DATABASE_URL" -f database/migrations/2026-10-27-email-verification.sql
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS email_verification_codes (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    code_hash  CHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
