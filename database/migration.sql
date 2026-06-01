-- ============================================================
-- Attendance System — Supabase Database Migration
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- 1. Students table
CREATE TABLE IF NOT EXISTS students (
    reg_no VARCHAR(20) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    mobile VARCHAR(15) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Attendance records
CREATE TABLE IF NOT EXISTS attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reg_no VARCHAR(20) NOT NULL REFERENCES students(reg_no) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    entry_time TIMESTAMPTZ,
    exit_time TIMESTAMPTZ,
    duration_minutes INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(reg_no, date)
);

-- 3. Used tokens (replay prevention)
CREATE TABLE IF NOT EXISTS used_tokens (
    token_jti VARCHAR(36) PRIMARY KEY,
    used_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(date);
CREATE INDEX IF NOT EXISTS idx_attendance_reg_date ON attendance_records(reg_no, date);
CREATE INDEX IF NOT EXISTS idx_used_tokens_used_at ON used_tokens(used_at);

-- 5. Auto-cleanup: purge used tokens older than 2 hours
-- Requires pg_cron extension (enable in Supabase Dashboard → Database → Extensions)
-- Uncomment after enabling pg_cron:
-- SELECT cron.schedule(
--     'cleanup-expired-tokens',
--     '0 * * * *',
--     $$DELETE FROM used_tokens WHERE used_at < NOW() - INTERVAL '2 hours'$$
-- );

-- ============================================================
-- VERIFICATION: Run these queries to confirm tables were created
-- ============================================================
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'students';
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'attendance_records';
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'used_tokens';
