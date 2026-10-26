-- Phone number collected at signup: dialing code (defaults to Saudi Arabia)
-- and the national number, digits only. Older accounts keep a NULL number.
-- psql "$DATABASE_URL" -f database/migrations/2026-10-26-user-phone.sql
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS country_code VARCHAR(5) NOT NULL DEFAULT '+966'
        CONSTRAINT users_country_code_check CHECK (country_code ~ '^\+[0-9]{1,4}$'),
    ADD COLUMN IF NOT EXISTS phone_number VARCHAR(15)
        CONSTRAINT users_phone_number_check CHECK (phone_number ~ '^[0-9]{4,15}$');

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_phone_unique') THEN
        ALTER TABLE users
            ADD CONSTRAINT users_phone_unique UNIQUE (country_code, phone_number);
    END IF;
END $$;
