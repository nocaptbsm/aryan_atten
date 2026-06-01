const express = require('express');
const cors = require('cors');
const { generalLimiter } = require('./middleware/rateLimiter');

// --- Route imports ---
const sessionRoutes = require('./routes/session');
const studentRoutes = require('./routes/student');
const attendanceRoutes = require('./routes/attendance');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CORS ---
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5500';
app.use(
  cors({
    origin: [FRONTEND_URL, 'http://localhost:5500', 'http://127.0.0.1:5500'],
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
  })
);

// --- Body parsing ---
app.use(express.json());

// --- General rate limiting ---
app.use(generalLimiter);

// --- Health check (no DB call — instant response for UptimeRobot) ---
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// --- Mount routes ---
app.use('/api/session', sessionRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/attendance', attendanceRoutes);

// --- 404 handler ---
app.use((req, res) => {
  res.status(404).json({
    error: `Route ${req.method} ${req.path} not found.`,
    code: 'NOT_FOUND',
    retryable: false,
  });
});

// --- Global error handler ---
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error.',
    code: 'INTERNAL_ERROR',
    retryable: true,
  });
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`🚀 Attendance backend running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔗 Frontend URL: ${FRONTEND_URL}`);
});
