-- Users no longer have an Arabic spelling of their name.
-- psql "$DATABASE_URL" -f database/migrations/2026-10-24-drop-user-arabic-names.sql
ALTER TABLE users
    DROP COLUMN IF EXISTS first_name_ar,
    DROP COLUMN IF EXISTS last_name_ar;
