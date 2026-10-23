-- Signs out other sessions after a password or email change: access tokens
-- issued before password_changed_at are refused.
-- psql "$DATABASE_URL" -f database/migrations/2026-10-24-user-password-changed-at.sql
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
