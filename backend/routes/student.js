const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { registrationLimiter } = require('../middleware/rateLimiter');

/**
 * POST /api/student/register
 * Registers a new student with registration number, name, and mobile.
 * Returns the student record and today's attendance state.
 *
 * Body: { regNo: string, name: string, mobile: string, sessionId: string }
 */
router.post('/register', registrationLimiter, async (req, res) => {
  try {
    const { regNo, name, mobile, sessionId } = req.body;

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

    const cleanRegNo = regNo.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(cleanRegNo)) {
      return res.status(400).json({
        error: 'Registration number must be 3-20 alphanumeric characters.',
        code: 'INVALID_REG_NO',
        retryable: false,
      });
    }

    if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
      return res.status(400).json({
        error: 'Name must be between 2 and 100 characters.',
        code: 'INVALID_NAME',
        retryable: false,
      });
    }

    if (!mobile || typeof mobile !== 'string' || !/^\d{10,15}$/.test(mobile.trim())) {
      return res.status(400).json({
        error: 'Mobile number must be 10-15 digits.',
        code: 'INVALID_MOBILE',
        retryable: false,
      });
    }

    // --- Check if student already exists ---
    const { data: existing } = await supabase
      .from('students')
      .select('reg_no')
      .eq('reg_no', cleanRegNo)
      .single();

    if (existing) {
      return res.status(409).json({
        error: 'A student with this registration number already exists.',
        code: 'DUPLICATE_REG_NO',
        retryable: false,
      });
    }

    // --- Insert student ---
    const { data: student, error: insertError } = await supabase
      .from('students')
      .insert({
        reg_no: cleanRegNo,
        name: name.trim(),
        mobile: mobile.trim(),
      })
      .select()
      .single();

    if (insertError) {
      // Handle race condition: another request registered the same student
      if (insertError.code === '23505') {
        return res.status(409).json({
          error: 'A student with this registration number already exists.',
          code: 'DUPLICATE_REG_NO',
          retryable: false,
        });
      }
      console.error('Student insert error:', insertError);
      return res.status(500).json({
        error: 'Failed to register student. Please try again.',
        code: 'REGISTRATION_FAILED',
        retryable: true,
      });
    }

    // --- Return with attendance state ---
    res.status(201).json({
      registered: true,
      student: {
        regNo: student.reg_no,
        name: student.name,
      },
      attendanceState: {
        nextAction: 'entry',
        entryTime: null,
        exitTime: null,
        durationMinutes: null,
      },
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({
      error: 'Registration failed. Please try again.',
      code: 'REGISTRATION_FAILED',
      retryable: true,
    });
  }
});

/**
 * POST /api/student/lookup
 * Checks if a student exists by registration number.
 * Returns student info + today's attendance state.
 *
 * Body: { regNo: string, sessionId: string }
 */
router.post('/lookup', async (req, res) => {
  try {
    const { regNo, sessionId } = req.body;

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

    const cleanRegNo = regNo.trim().toUpperCase();

    // --- Look up student ---
    const { data: student } = await supabase
      .from('students')
      .select('reg_no, name')
      .eq('reg_no', cleanRegNo)
      .single();

    if (!student) {
      return res.json({
        found: false,
        student: null,
        attendanceState: null,
      });
    }

    // --- Get today's attendance ---
    const today = new Date().toISOString().split('T')[0];
    const { data: record } = await supabase
      .from('attendance_records')
      .select('entry_time, exit_time, duration_minutes')
      .eq('reg_no', cleanRegNo)
      .eq('date', today)
      .single();

    let nextAction = 'entry';
    if (record) {
      if (record.entry_time && record.exit_time) {
        nextAction = 'done';
      } else if (record.entry_time) {
        nextAction = 'exit';
      }
    }

    res.json({
      found: true,
      student: {
        regNo: student.reg_no,
        name: student.name,
      },
      attendanceState: {
        nextAction,
        entryTime: record?.entry_time || null,
        exitTime: record?.exit_time || null,
        durationMinutes: record?.duration_minutes || null,
      },
    });
  } catch (err) {
    console.error('Student lookup error:', err);
    res.status(500).json({
      error: 'Failed to look up student. Please try again.',
      code: 'LOOKUP_FAILED',
      retryable: true,
    });
  }
});

module.exports = router;
