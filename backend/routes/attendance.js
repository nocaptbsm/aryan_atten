const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

/**
 * POST /api/attendance/mark
 * Marks entry or exit for a student. Backend enforces the correct sequence:
 *   - "entry" only if no record exists for today (or entry_time is null)
 *   - "exit" only if entry_time exists and exit_time is null
 *   - Rejects if attendance is already "done" for today
 *
 * Body: { regNo: string, action: "entry" | "exit", sessionId: string }
 */
router.post('/mark', async (req, res) => {
  try {
    const { regNo, action, sessionId } = req.body;

    // --- Validation ---
    if (!sessionId) {
      return res.status(400).json({
        error: 'Session ID is required. Please scan the QR code.',
        code: 'MISSING_SESSION',
        retryable: false,
      });
    }

    if (!regNo || typeof regNo !== 'string') {
      return res.status(400).json({
        error: 'Registration number is required.',
        code: 'MISSING_REG_NO',
        retryable: false,
      });
    }

    if (!action || !['entry', 'exit'].includes(action)) {
      return res.status(400).json({
        error: 'Action must be "entry" or "exit".',
        code: 'INVALID_ACTION',
        retryable: false,
      });
    }

    const cleanRegNo = regNo.trim().toUpperCase();

    // --- Check student exists ---
    const { data: student } = await supabase
      .from('students')
      .select('reg_no, name')
      .eq('reg_no', cleanRegNo)
      .single();

    if (!student) {
      return res.status(404).json({
        error: 'Student not found. Please register first.',
        code: 'STUDENT_NOT_FOUND',
        retryable: false,
      });
    }

    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toISOString();

    // --- Get today's record ---
    const { data: record } = await supabase
      .from('attendance_records')
      .select('id, entry_time, exit_time')
      .eq('reg_no', cleanRegNo)
      .eq('date', today)
      .single();

    // --- Handle ENTRY ---
    if (action === 'entry') {
      if (record && record.entry_time) {
        // Entry already exists
        const msg = record.exit_time
          ? 'Attendance is already complete for today.'
          : 'Entry already marked. You can now mark exit.';
        return res.status(400).json({
          error: msg,
          code: 'ENTRY_ALREADY_MARKED',
          retryable: false,
          attendanceState: {
            nextAction: record.exit_time ? 'done' : 'exit',
            entryTime: record.entry_time,
            exitTime: record.exit_time,
          },
        });
      }

      // Create new attendance record with entry time
      const { data: newRecord, error: insertError } = await supabase
        .from('attendance_records')
        .insert({
          reg_no: cleanRegNo,
          date: today,
          entry_time: now,
        })
        .select()
        .single();

      if (insertError) {
        // Race condition: record was just created by another request
        if (insertError.code === '23505') {
          return res.status(400).json({
            error: 'Entry already marked for today.',
            code: 'ENTRY_ALREADY_MARKED',
            retryable: false,
          });
        }
        console.error('Entry insert error:', insertError);
        return res.status(500).json({
          error: 'Failed to mark entry. Please try again.',
          code: 'MARK_FAILED',
          retryable: true,
        });
      }

      return res.json({
        success: true,
        action: 'entry',
        studentName: student.name,
        entryTime: newRecord.entry_time,
        message: 'Entry marked successfully!',
        attendanceState: {
          nextAction: 'exit',
          entryTime: newRecord.entry_time,
          exitTime: null,
          durationMinutes: null,
        },
      });
    }

    // --- Handle EXIT ---
    if (action === 'exit') {
      if (!record || !record.entry_time) {
        return res.status(400).json({
          error: 'You must mark entry before marking exit.',
          code: 'ENTRY_NOT_MARKED',
          retryable: false,
          attendanceState: {
            nextAction: 'entry',
            entryTime: null,
            exitTime: null,
          },
        });
      }

      if (record.exit_time) {
        return res.status(400).json({
          error: 'Exit already marked. Attendance is complete for today.',
          code: 'EXIT_ALREADY_MARKED',
          retryable: false,
          attendanceState: {
            nextAction: 'done',
            entryTime: record.entry_time,
            exitTime: record.exit_time,
          },
        });
      }

      // Compute duration in minutes
      const entryDate = new Date(record.entry_time);
      const exitDate = new Date(now);
      const durationMinutes = Math.round((exitDate - entryDate) / (1000 * 60));

      // Update record with exit time and duration
      const { data: updatedRecord, error: updateError } = await supabase
        .from('attendance_records')
        .update({
          exit_time: now,
          duration_minutes: durationMinutes,
        })
        .eq('id', record.id)
        .select()
        .single();

      if (updateError) {
        console.error('Exit update error:', updateError);
        return res.status(500).json({
          error: 'Failed to mark exit. Please try again.',
          code: 'MARK_FAILED',
          retryable: true,
        });
      }

      // Format duration for display
      const hours = Math.floor(durationMinutes / 60);
      const mins = durationMinutes % 60;
      const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

      return res.json({
        success: true,
        action: 'exit',
        studentName: student.name,
        entryTime: updatedRecord.entry_time,
        exitTime: updatedRecord.exit_time,
        durationMinutes: updatedRecord.duration_minutes,
        message: `Exit marked! Duration: ${durationStr}`,
        attendanceState: {
          nextAction: 'done',
          entryTime: updatedRecord.entry_time,
          exitTime: updatedRecord.exit_time,
          durationMinutes: updatedRecord.duration_minutes,
        },
      });
    }
  } catch (err) {
    console.error('Attendance mark error:', err);
    res.status(500).json({
      error: 'Failed to mark attendance. Please try again.',
      code: 'MARK_FAILED',
      retryable: true,
    });
  }
});

/**
 * GET /api/attendance/live?date=YYYY-MM-DD
 * Returns all attendance records for a given date (defaults to today).
 * Used by the admin dashboard.
 */
router.get('/live', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        error: 'Date must be in YYYY-MM-DD format.',
        code: 'INVALID_DATE',
        retryable: false,
      });
    }

    // Fetch all records for the date, joined with student names
    const { data: records, error } = await supabase
      .from('attendance_records')
      .select(`
        reg_no,
        entry_time,
        exit_time,
        duration_minutes,
        students (name)
      `)
      .eq('date', date)
      .order('entry_time', { ascending: true });

    if (error) {
      console.error('Live attendance fetch error:', error);
      return res.status(500).json({
        error: 'Failed to fetch attendance records.',
        code: 'FETCH_FAILED',
        retryable: true,
      });
    }

    // Get total registered student count
    const { count: totalStudents } = await supabase
      .from('students')
      .select('reg_no', { count: 'exact', head: true });

    // Transform records
    const transformedRecords = (records || []).map((r) => {
      let status = 'in_session';
      if (r.entry_time && r.exit_time) {
        status = 'completed';
      } else if (!r.entry_time) {
        status = 'pending';
      }

      return {
        regNo: r.reg_no,
        name: r.students?.name || 'Unknown',
        entryTime: r.entry_time,
        exitTime: r.exit_time,
        durationMinutes: r.duration_minutes,
        status,
      };
    });

    const presentCount = transformedRecords.length;
    const inSessionCount = transformedRecords.filter((r) => r.status === 'in_session').length;
    const completedCount = transformedRecords.filter((r) => r.status === 'completed').length;

    res.json({
      date,
      totalStudents: totalStudents || 0,
      presentCount,
      inSessionCount,
      completedCount,
      records: transformedRecords,
    });
  } catch (err) {
    console.error('Live attendance error:', err);
    res.status(500).json({
      error: 'Failed to fetch attendance records.',
      code: 'FETCH_FAILED',
      retryable: true,
    });
  }
});

module.exports = router;
