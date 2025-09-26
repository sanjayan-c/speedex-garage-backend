-- attendance records: one row per staff per date, in/out times, overtime flag
CREATE TABLE IF NOT EXISTS attendance_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  time_in TIMESTAMPTZ NULL,
  time_out TIMESTAMPTZ NULL,
  overtime_in TIMESTAMPTZ NULL,
  overtime_out TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (staff_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_staff_date ON attendance_records(staff_id, attendance_date);

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS is_forced_out BOOLEAN NOT NULL DEFAULT false;


-- Add JSONB array to store multiple UnTime sessions per day
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS untime_sessions JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Drop overtime fields if they exist
ALTER TABLE attendance_records DROP COLUMN IF EXISTS overtime_in;
ALTER TABLE attendance_records DROP COLUMN IF EXISTS overtime_out;


ALTER TABLE attendance_records
ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE attendance_records
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
