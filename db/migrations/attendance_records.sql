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
