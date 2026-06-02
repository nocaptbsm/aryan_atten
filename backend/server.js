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

// Build the allowed origins list from the FRONTEND_URL env var.
// Supports comma-separated values, e.g. "https://foo.vercel.app,https://bar.vercel.app"
const ALLOWED_ORIGINS = FRONTEND_URL
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean)
  .concat(['http://localhost:5500', 'http://127.0.0.1:5500', 'http://localhost:3000']);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g., ESP32 / Postman / health checks)
      if (!origin) return callback(null, true);

      // Allow any *.vercel.app subdomain automatically (handles preview deployments)
      if (origin.endsWith('.vercel.app')) return callback(null, true);

      // Allow explicitly configured origins
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);

      // Reject everything else
      console.warn(`CORS blocked: ${origin}`);
      return callback(new Error(`CORS policy: origin '${origin}' is not allowed.`));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    optionsSuccessStatus: 204,
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
