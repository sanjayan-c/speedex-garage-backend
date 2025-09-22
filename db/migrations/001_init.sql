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

CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);


CREATE TABLE IF NOT EXISTS leave_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_staff ON leave_requests(staff_id);

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS leave_type TEXT NOT NULL DEFAULT 'full_day'
    CHECK (leave_type IN ('full_day','half_day'));

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS half_type TEXT
    CHECK (half_type IN ('first_half','second_half'));

ALTER TABLE leave_requests
  ALTER COLUMN start_date TYPE TIMESTAMPTZ USING start_date::timestamptz,
  ALTER COLUMN end_date TYPE TIMESTAMPTZ USING end_date::timestamptz;

ALTER TABLE  IF NOT EXISTS staff
ADD COLUMN IF NOT EXISTS shift_start_local_time TIME NULL,
ADD COLUMN IF NOT EXISTS shift_end_local_time TIME NULL;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS untime_approved BOOLEAN NOT NULL DEFAULT false;

-- 1.1 A sequence to generate the numeric part of EmployeeID
CREATE SEQUENCE IF NOT EXISTS staff_employee_seq START 1001; -- pick your start

-- 1.2 Add new columns
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS employee_id TEXT UNIQUE
    DEFAULT ('SDX-' || nextval('staff_employee_seq')::text),
  ADD COLUMN IF NOT EXISTS birthday DATE,
  ADD COLUMN IF NOT EXISTS joining_date DATE,
  ADD COLUMN IF NOT EXISTS leave_balance NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS position TEXT,
  ADD COLUMN IF NOT EXISTS manager_id UUID NULL REFERENCES staff (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS job_family TEXT;

-- -- 1.3 Enforce format of employee_id
-- ALTER TABLE staff
--   ADD CONSTRAINT staff_employee_id_format_chk
--   CHECK (employee_id ~ '^SDX-[0-9]+$');


-- 1.4 Prevent self-managing
ALTER TABLE staff
  ADD CONSTRAINT staff_manager_not_self_chk
  CHECK (manager_id IS NULL OR manager_id <> id);

-- 1.5 Make employee_id immutable (reject updates if changed)
CREATE OR REPLACE FUNCTION prevent_employee_id_update()
RETURNS trigger AS $$
BEGIN
  IF NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN
    RAISE EXCEPTION 'employee_id is immutable and cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_staff_employee_id_immutable ON staff;
CREATE TRIGGER trg_staff_employee_id_immutable
BEFORE UPDATE ON staff
FOR EACH ROW EXECUTE FUNCTION prevent_employee_id_update();

-- Permissions table
CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL, -- e.g. "approve_leave", "delete_leave"
    description TEXT
);

-- User-Permissions mapping table
CREATE TABLE IF NOT EXISTS user_permissions (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, permission_id)
);

INSERT INTO permissions (name, description)
VALUES 
  ('approve_leave', 'Can approve or reject leave requests'),
  ('delete_leave', 'Can delete leave requests'),
  ('view_attendance', 'Can view attendance'),
  ('mark_attendance', 'Can mark attendance')
ON CONFLICT DO NOTHING;
