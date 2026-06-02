const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const JWT_SECRET = process.env.JWT_SECRET;
// 90s gives enough runway for: Render cold-start (~50s) + ESP32 fetch + user scan + page load.
// The ESP32 refreshes every 15s, so an active token is always much fresher than this in practice.
const JWT_EXPIRY = process.env.JWT_EXPIRY || '90s';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5500';

if (!JWT_SECRET) {
  console.error('Missing JWT_SECRET environment variable');
  process.exit(1);
}

/**
 * Generate a short-lived session token for QR code display.
 * Each token has a unique `jti` (JWT ID) for one-time-use enforcement.
 * @returns {{ token: string, qrUrl: string, expiresIn: number, jti: string }}
 */
function generateSessionToken() {
  const jti = uuidv4();

  const token = jwt.sign(
    {
      jti,
      type: 'attendance_session',
    },
    JWT_SECRET,
    {
      expiresIn: JWT_EXPIRY,
    }
  );

  // Parse expiry to seconds for the response
  const expiresInSeconds = parseExpiry(JWT_EXPIRY);

  const qrUrl = `${FRONTEND_URL}/?token=${token}`;

  return { token, qrUrl, expiresIn: expiresInSeconds, jti };
}

/**
 * Verify a session token. Checks signature and expiry.
 * Does NOT check one-time-use (caller must check `used_tokens` table).
 * @param {string} token
 * @returns {{ valid: boolean, payload?: object, error?: string }}
 */
function verifySessionToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);

    if (payload.type !== 'attendance_session') {
      return { valid: false, error: 'Invalid token type' };
    }

    return { valid: true, payload };
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return { valid: false, error: 'Token expired. Please scan the QR code again.' };
    }
    if (err.name === 'JsonWebTokenError') {
      return { valid: false, error: 'Invalid token. Please scan a valid QR code.' };
    }
    return { valid: false, error: 'Token verification failed.' };
  }
}

/**
 * Parse JWT expiry string (e.g., '20s', '1m', '1h') to seconds.
 */
function parseExpiry(expiry) {
  const match = expiry.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 20; // default

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    default: return 20;
  }
}

module.exports = { generateSessionToken, verifySessionToken };
