-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CREATE TABLE
--   IF NOT EXISTS users (
--     id UUID PRIMARY KEY,
--     username TEXT UNIQUE NOT NULL,
--     password_hash TEXT NOT NULL,
--     role TEXT NOT NULL CHECK (role IN ('admin', 'staff', 'user')),
--     is_login BOOLEAN NOT NULL DEFAULT false,
--     untime JSONB NULL,
--     created_by UUID NULL REFERENCES users (id) ON DELETE SET NULL,
--     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW ()
--   );

-- CREATE TABLE
--   IF NOT EXISTS staff (
--     id UUID PRIMARY KEY,
--     user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
--     first_name TEXT NOT NULL,
--     last_name TEXT NOT NULL,
--     email TEXT UNIQUE NOT NULL,
--     contact_no TEXT NOT NULL,
--     emergency_contact_no TEXT NOT NULL,
--     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW ()
--   );

-- CREATE TABLE
--   IF NOT EXISTS refresh_tokens (
--     id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
--     user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
--     token_hash TEXT NOT NULL,
--     expires_at TIMESTAMPTZ NOT NULL,
--     revoked BOOLEAN NOT NULL DEFAULT false,
--     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW ()
--   );

-- CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);


-- CREATE TABLE IF NOT EXISTS leave_requests (
--   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
--   staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
--   start_date DATE NOT NULL,
--   end_date DATE NOT NULL,
--   reason TEXT NOT NULL,
--   status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
--   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
--   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
-- );

-- CREATE INDEX IF NOT EXISTS idx_leave_staff ON leave_requests(staff_id);

-- ALTER TABLE leave_requests
--   ADD COLUMN IF NOT EXISTS leave_type TEXT NOT NULL DEFAULT 'full_day'
--     CHECK (leave_type IN ('full_day','half_day'));

-- ALTER TABLE leave_requests
--   ADD COLUMN IF NOT EXISTS half_type TEXT
--     CHECK (half_type IN ('first_half','second_half'));

-- ALTER TABLE leave_requests
--   ALTER COLUMN start_date TYPE TIMESTAMPTZ USING start_date::timestamptz,
--   ALTER COLUMN end_date TYPE TIMESTAMPTZ USING end_date::timestamptz;

-- ALTER TABLE staff
--   ADD COLUMN IF NOT EXISTS shift_start_local_time TIME NULL,
--   ADD COLUMN IF NOT EXISTS shift_end_local_time TIME NULL;

-- ALTER TABLE users
-- ADD COLUMN IF NOT EXISTS untime_approved BOOLEAN NOT NULL DEFAULT false;

-- -- 1.1 A sequence to generate the numeric part of EmployeeID
-- CREATE SEQUENCE IF NOT EXISTS staff_employee_seq START 1001; -- pick your start

-- -- 1.2 Add new columns
-- ALTER TABLE staff
--   ADD COLUMN IF NOT EXISTS employee_id TEXT UNIQUE
--     DEFAULT ('SDX-' || nextval('staff_employee_seq')::text),
--   ADD COLUMN IF NOT EXISTS birthday DATE,
--   ADD COLUMN IF NOT EXISTS joining_date DATE,
--   ADD COLUMN IF NOT EXISTS leave_balance NUMERIC(10,2) NOT NULL DEFAULT 0,
--   ADD COLUMN IF NOT EXISTS position TEXT,
--   ADD COLUMN IF NOT EXISTS manager_id UUID NULL REFERENCES staff (id) ON DELETE SET NULL,
--   ADD COLUMN IF NOT EXISTS job_family TEXT;

-- -- -- 1.3 Enforce format of employee_id
-- -- ALTER TABLE staff
-- --   ADD CONSTRAINT staff_employee_id_format_chk
-- --   CHECK (employee_id ~ '^SDX-[0-9]+$');


-- DO $$
-- BEGIN
--   IF NOT EXISTS (
--     SELECT 1
--     FROM pg_constraint
--     WHERE conname = 'staff_employee_id_format_chk'
--       AND conrelid = 'staff'::regclass
--   ) THEN
--     ALTER TABLE staff
--       ADD CONSTRAINT staff_employee_id_format_chk
--       CHECK (employee_id ~ '^SDX-[0-9]+$');
--   END IF;
-- END$$;

-- -- 1.4 Prevent self-managing (idempotent too, in case it already exists)
-- DO $$
-- BEGIN
--   IF NOT EXISTS (
--     SELECT 1
--     FROM pg_constraint
--     WHERE conname = 'staff_manager_not_self_chk'
--       AND conrelid = 'staff'::regclass
--   ) THEN
--     ALTER TABLE staff
--       ADD CONSTRAINT staff_manager_not_self_chk
--       CHECK (manager_id IS NULL OR manager_id <> id);
--   END IF;
-- END$$;


-- -- 1.5 Make employee_id immutable (reject updates if changed)
-- CREATE OR REPLACE FUNCTION prevent_employee_id_update()
-- RETURNS trigger AS $$
-- BEGIN
--   IF NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN
--     RAISE EXCEPTION 'employee_id is immutable and cannot be changed';
--   END IF;
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;

-- DROP TRIGGER IF EXISTS trg_staff_employee_id_immutable ON staff;
-- CREATE TRIGGER trg_staff_employee_id_immutable
-- BEFORE UPDATE ON staff
-- FOR EACH ROW EXECUTE FUNCTION prevent_employee_id_update();

-- -- Permissions table
-- CREATE TABLE IF NOT EXISTS permissions (
--     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--     name TEXT UNIQUE NOT NULL, -- e.g. "approve_leave", "delete_leave"
--     description TEXT
-- );

-- -- User-Permissions mapping table
-- CREATE TABLE IF NOT EXISTS user_permissions (
--     user_id UUID REFERENCES users(id) ON DELETE CASCADE,
--     permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
--     PRIMARY KEY (user_id, permission_id)
-- );

-- INSERT INTO permissions (name, description)
-- VALUES 
--   ('approve_leave', 'Can approve or reject leave requests'),
--   ('delete_leave', 'Can delete leave requests'),
--   ('view_attendance', 'Can view attendance'),
--   ('mark_attendance', 'Can mark attendance')
-- ON CONFLICT DO NOTHING;

-- -- 1.6 Add total_leaves to staff (annual entitlement, supports half-days)
-- ALTER TABLE staff
--   ADD COLUMN IF NOT EXISTS total_leaves NUMERIC(10,2) NOT NULL DEFAULT 0;

-- -- 1.7 (OLD) balance constraint on leave_balance -> only if column exists
-- DO $$
-- BEGIN
--   IF EXISTS (
--     SELECT 1 FROM information_schema.columns
--     WHERE table_name='staff' AND column_name='leave_balance'
--   ) THEN
--     IF NOT EXISTS (
--       SELECT 1 FROM pg_constraint
--       WHERE conname = 'staff_leave_balance_le_total_chk'
--         AND conrelid = 'staff'::regclass
--     ) THEN
--       ALTER TABLE staff
--         ADD CONSTRAINT staff_leave_balance_le_total_chk
--         CHECK (leave_balance <= total_leaves) NOT VALID;
--     END IF;

--     -- Try to validate if possible (ignore errors to keep idempotent)
--     BEGIN
--       IF EXISTS (
--         SELECT 1 FROM pg_constraint
--         WHERE conname = 'staff_leave_balance_le_total_chk'
--           AND conrelid = 'staff'::regclass
--           AND NOT convalidated
--       ) THEN
--         ALTER TABLE staff VALIDATE CONSTRAINT staff_leave_balance_le_total_chk;
--       END IF;
--     EXCEPTION WHEN others THEN NULL; END;
--   END IF;
-- END$$;

-- -- 2. RENAME leave_balance -> leave_taken, but only when appropriate
-- DO $$
-- DECLARE
--   has_balance boolean;
--   has_taken   boolean;
-- BEGIN
--   SELECT EXISTS (
--     SELECT 1 FROM information_schema.columns
--     WHERE table_name='staff' AND column_name='leave_balance'
--   ) INTO has_balance;

--   SELECT EXISTS (
--     SELECT 1 FROM information_schema.columns
--     WHERE table_name='staff' AND column_name='leave_taken'
--   ) INTO has_taken;

--   -- Case A: balance exists and taken does not -> rename
--   IF has_balance AND NOT has_taken THEN
--     ALTER TABLE staff RENAME COLUMN leave_balance TO leave_taken;

--   -- Case B: both exist (someone already created leave_taken and left old balance) -> drop the old one
--   ELSIF has_balance AND has_taken THEN
--     -- optional: copy any non-null values over before dropping, if needed
--     -- UPDATE staff SET leave_taken = COALESCE(leave_taken, leave_balance);
--     ALTER TABLE staff DROP COLUMN leave_balance;
--   END IF;

--   -- If only leave_taken exists, do nothing.
-- END$$;

-- -- 3. Constraint on leave_taken <= total_leaves (idempotent)
-- DO $$
-- BEGIN
--   IF EXISTS (
--     SELECT 1 FROM information_schema.columns
--     WHERE table_name='staff' AND column_name='leave_taken'
--   ) THEN
--     IF NOT EXISTS (
--       SELECT 1 FROM pg_constraint
--       WHERE conname = 'staff_leave_taken_le_total_chk'
--         AND conrelid = 'staff'::regclass
--     ) THEN
--       ALTER TABLE staff
--         ADD CONSTRAINT staff_leave_taken_le_total_chk
--         CHECK (leave_taken <= total_leaves) NOT VALID;
--     END IF;

--     -- Try to validate if possible (ignore errors so reruns are safe)
--     BEGIN
--       IF EXISTS (
--         SELECT 1 FROM pg_constraint
--         WHERE conname = 'staff_leave_taken_le_total_chk'
--           AND conrelid = 'staff'::regclass
--           AND NOT convalidated
--       ) THEN
--         ALTER TABLE staff VALIDATE CONSTRAINT staff_leave_taken_le_total_chk;
--       END IF;
--     EXCEPTION WHEN others THEN NULL; END;
--   END IF;
-- END$$;


-- /* --- Make leave_requests date-only and remove half-day columns --- */

-- -- 1) Drop half-day columns if they exist
-- ALTER TABLE leave_requests DROP COLUMN IF EXISTS leave_type;
-- ALTER TABLE leave_requests DROP COLUMN IF EXISTS half_type;

-- -- 2) Ensure start_date / end_date are DATE (idempotent + safe conversion)
-- DO $$
-- DECLARE
--   start_type text;
--   end_type   text;
-- BEGIN
--   SELECT data_type INTO start_type
--   FROM information_schema.columns
--   WHERE table_name = 'leave_requests' AND column_name = 'start_date';

--   SELECT data_type INTO end_type
--   FROM information_schema.columns
--   WHERE table_name = 'leave_requests' AND column_name = 'end_date';

--   -- Convert TIMESTAMPTZ -> DATE using Toronto local day; if already DATE, skip.
--   IF start_type IS NOT NULL AND start_type <> 'date' THEN
--     EXECUTE $sql$
--       ALTER TABLE leave_requests
--       ALTER COLUMN start_date TYPE date
--       USING ( (start_date AT TIME ZONE 'America/Toronto')::date )
--     $sql$;
--   END IF;

--   IF end_type IS NOT NULL AND end_type <> 'date' THEN
--     EXECUTE $sql$
--       ALTER TABLE leave_requests
--       ALTER COLUMN end_date TYPE date
--       USING ( (end_date AT TIME ZONE 'America/Toronto')::date )
--     $sql$;
--   END IF;
-- END$$;

-- -- 3) Enforce valid range (inclusive); idempotent
-- DO $$
-- BEGIN
--   IF NOT EXISTS (
--     SELECT 1 FROM pg_constraint
--     WHERE conname = 'leave_dates_valid_chk'
--       AND conrelid = 'leave_requests'::regclass
--   ) THEN
--     ALTER TABLE leave_requests
--       ADD CONSTRAINT leave_dates_valid_chk
--       CHECK (end_date >= start_date);
--   END IF;
-- END$$;

-- -- Add access control flags on users (idempotent)
-- ALTER TABLE users
--   ADD COLUMN IF NOT EXISTS allowed    BOOLEAN NOT NULL DEFAULT false,
--   ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE staff
ADD COLUMN IF NOT EXISTS documents TEXT[] DEFAULT '{}';


-- === Convert single TIME columns → TIME[] with 7 elements (Mon..Sun) ===
DO $$
DECLARE
  start_udt text;
  end_udt   text;
BEGIN
  -- Detect current types
  SELECT data_type INTO start_udt
  FROM information_schema.columns
  WHERE table_name = 'staff' AND column_name = 'shift_start_local_time';

  SELECT data_type INTO end_udt
  FROM information_schema.columns
  WHERE table_name = 'staff' AND column_name = 'shift_end_local_time';

  -- If start is scalar TIME, convert to TIME[]
  IF start_udt = 'time without time zone' THEN
    ALTER TABLE staff
      ALTER COLUMN shift_start_local_time TYPE time[] USING (
        CASE
          WHEN shift_start_local_time IS NULL THEN ARRAY[]::time[]
          ELSE array_fill(shift_start_local_time, ARRAY[7])
        END
      );
  END IF;

  -- If end is scalar TIME, convert to TIME[]
  IF end_udt = 'time without time zone' THEN
    ALTER TABLE staff
      ALTER COLUMN shift_end_local_time TYPE time[] USING (
        CASE
          WHEN shift_end_local_time IS NULL THEN ARRAY[]::time[]
          ELSE array_fill(shift_end_local_time, ARRAY[7])
        END
      );
  END IF;
END$$;

-- === Ensure arrays have exactly 7 elements (or are NULL) ===
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'staff_shift_start_len7_chk'
      AND conrelid = 'staff'::regclass
  ) THEN
    ALTER TABLE staff
      ADD CONSTRAINT staff_shift_start_len7_chk
      CHECK (shift_start_local_time IS NULL OR array_length(shift_start_local_time, 1) = 7);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'staff_shift_end_len7_chk'
      AND conrelid = 'staff'::regclass
  ) THEN
    ALTER TABLE staff
      ADD CONSTRAINT staff_shift_end_len7_chk
      CHECK (shift_end_local_time IS NULL OR array_length(shift_end_local_time, 1) = 7);
  END IF;
END$$;

-- Optional: set NULL default (app fills); or uncomment a 7-null default
-- ALTER TABLE staff ALTER COLUMN shift_start_local_time SET DEFAULT ARRAY[
--   NULL::time,NULL::time,NULL::time,NULL::time,NULL::time,NULL::time,NULL::time
-- ];
-- ALTER TABLE staff ALTER COLUMN shift_end_local_time SET DEFAULT ARRAY[
--   NULL::time,NULL::time,NULL::time,NULL::time,NULL::time,NULL::time,NULL::time
-- ];

-- Optional: add column comments with index mapping (1..7 = Mon..Sun)
COMMENT ON COLUMN staff.shift_start_local_time IS
  'Weekly shift starts as TIME[7], indexes 1..7 = Mon..Sun (local time).';
COMMENT ON COLUMN staff.shift_end_local_time IS
  'Weekly shift ends   as TIME[7], indexes 1..7 = Mon..Sun (local time).';
  
-- ALTER TABLE staff
-- ADD COLUMN IF NOT EXISTS documents TEXT[] DEFAULT '{}';

-- 4) Add additional columns (idempotent)
ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS note TEXT;

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW();
