-- Forgot password: the emailed reset code lives next to the email
-- verification code, one of each per account at a time.
-- psql "$DATABASE_URL" -f database/migrations/2026-10-28-password-reset-codes.sql
ALTER TABLE email_verification_codes
    ADD COLUMN IF NOT EXISTS purpose VARCHAR(20) NOT NULL DEFAULT 'verify_email';

ALTER TABLE email_verification_codes DROP CONSTRAINT IF EXISTS email_verification_codes_pkey;
ALTER TABLE email_verification_codes ADD PRIMARY KEY (user_id, purpose);
