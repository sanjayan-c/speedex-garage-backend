-- Global shift hours in Toronto (store as TIME WITHOUT TIME ZONE)
CREATE TABLE IF NOT EXISTS shift_hours (
  id               SMALLINT PRIMARY KEY DEFAULT 1,
  start_local_time TIME NOT NULL,   -- e.g., '09:00:00' for 9AM Toronto time
  end_local_time   TIME NOT NULL,   -- e.g., '17:30:00' for 5:30PM Toronto time
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- add new columns with defaults
ALTER TABLE shift_hours
  ADD COLUMN IF NOT EXISTS margintime INTEGER NOT NULL DEFAULT 30,  -- minutes
  ADD COLUMN IF NOT EXISTS alerttime  INTEGER NOT NULL DEFAULT 10;  -- minutes

-- if table might be empty, keep the seed insert covering new cols too
INSERT INTO shift_hours (id, start_local_time, end_local_time, margintime, alerttime)
VALUES (1, '09:00:00'::time, '17:00:00'::time, 30, 10)
ON CONFLICT (id) DO NOTHING;