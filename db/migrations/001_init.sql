CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE
  IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'staff', 'user')),
    is_login BOOLEAN NOT NULL DEFAULT false,
    untime JSONB NULL,
    created_by UUID NULL REFERENCES users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW ()
  );

CREATE TABLE
  IF NOT EXISTS staff (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    contact_no TEXT NOT NULL,
    emergency_contact_no TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW ()
  );

CREATE TABLE
  IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW ()
  );

CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens (user_id);

ALTER TABLE staff
ADD COLUMN IF NOT EXISTS shift_start_local_time TIME NULL,
ADD COLUMN IF NOT EXISTS shift_end_local_time TIME NULL;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS untime_approved BOOLEAN NOT NULL DEFAULT false;