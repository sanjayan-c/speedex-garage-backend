-- create extension if not exists "uuid-ossp"; -- you already have it

-- table to store currently active QR sessions and history
CREATE TABLE IF NOT EXISTS qr_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_code TEXT NOT NULL UNIQUE, -- a short code embedded in the QR link
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL, -- who created (admin)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_qr_sessions_active ON qr_sessions(active, expires_at);

