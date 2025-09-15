-- Global shift hours in Toronto (store as TIME WITHOUT TIME ZONE)
CREATE TABLE IF NOT EXISTS shift_hours (
  id               SMALLINT PRIMARY KEY DEFAULT 1,
  start_local_time TIME NOT NULL,   -- e.g., '09:00:00' for 9AM Toronto time
  end_local_time   TIME NOT NULL,   -- e.g., '17:30:00' for 5:30PM Toronto time
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- seed a default (9:00–17:00) if missing
INSERT INTO shift_hours (id, start_local_time, end_local_time)
VALUES (1, '09:00:00'::time, '17:00:00'::time)
ON CONFLICT (id) DO NOTHING;
