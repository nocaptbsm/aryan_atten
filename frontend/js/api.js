/**
 * API Client — handles all backend communication with retry logic.
 * Designed to survive Render free-tier cold starts (up to ~50s).
 */

const API_BASE = window.__API_BASE__ || 'https://aryan-atten.onrender.com';

// Render free-tier cold starts can take 30–50s. We retry aggressively on
// network errors with short delays so we catch the server as soon as it wakes.
const MAX_RETRIES = 8;
// Short delays: hit the server often so we don't miss the moment it wakes up.
const RETRY_DELAYS = [2000, 3000, 4000, 5000, 5000, 5000, 5000, 5000]; // up to ~34s total

/**
 * Make an API request with automatic retries for retryable errors.
 * @param {string} endpoint - API path (e.g., '/api/session/verify')
 * @param {object} options - Fetch options
 * @param {function} [onRetry] - Called on each retry with (attempt, maxRetries, message)
 * @returns {Promise<object>} Parsed JSON response
 */
async function apiRequest(endpoint, options = {}, onRetry = null) {
  const url = `${API_BASE}${endpoint}`;
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };

  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        ...config,
        // 10s per-attempt timeout — Render wakes up within this window once
        // the request hits the server, so short timeouts + many retries work
        // better than a single long timeout that lets the token expire.
        signal: AbortSignal.timeout(10000),
      });
      const data = await response.json();

      // If response is OK, return data
      if (response.ok) {
        return { ok: true, data, status: response.status };
      }

      // If error is retryable and we have retries left
      if (data.retryable && attempt < MAX_RETRIES) {
        lastError = data;
        if (onRetry) onRetry(attempt, MAX_RETRIES, 'Server is busy, retrying…');
        await sleep(RETRY_DELAYS[attempt] || 5000);
        continue;
      }

      // Non-retryable error or out of retries
      return { ok: false, data, status: response.status };
    } catch (err) {
      // Network error or timeout — Render cold-start in progress
      lastError = {
        error: 'Network error. The server may be waking up…',
        code: 'NETWORK_ERROR',
        retryable: true,
      };

      if (attempt < MAX_RETRIES) {
        if (onRetry) {
          const elapsed = RETRY_DELAYS.slice(0, attempt).reduce((a, b) => a + b, 0) / 1000;
          onRetry(attempt, MAX_RETRIES, `Server is waking up… (${Math.round(elapsed)}s)`);
        }
        await sleep(RETRY_DELAYS[attempt] || 5000);
        continue;
      }

      return {
        ok: false,
        data: {
          error: 'Could not connect to the server. Please check your connection and try again later.',
          code: 'NETWORK_ERROR',
          retryable: false,
        },
        status: 0,
      };
    }
  }

  return { ok: false, data: lastError, status: 0 };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Public API methods ---

const API = {
  /**
   * Verify a scanned QR token.
   * @param {string} token - JWT from QR code
   * @param {function} [onRetry] - Progress callback (attempt, max, message)
   */
  async verifyToken(token, onRetry = null) {
    return apiRequest(
      '/api/session/verify',
      { method: 'POST', body: JSON.stringify({ token }) },
      onRetry
    );
  },

  /**
   * Look up a student by registration number.
   * @param {string} regNo - Student registration number
   * @param {string} sessionId - Verified session ID
   */
  async lookupStudent(regNo, sessionId) {
    return apiRequest('/api/student/lookup', {
      method: 'POST',
      body: JSON.stringify({ regNo, sessionId }),
    });
  },

  /**
   * Register a new student.
   * @param {object} data - { regNo, name, mobile, sessionId }
   */
  async registerStudent(data) {
    return apiRequest('/api/student/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * Mark attendance (entry or exit).
   * @param {string} regNo
   * @param {string} action - 'entry' or 'exit'
   * @param {string} sessionId
   */
  async markAttendance(regNo, action, sessionId) {
    return apiRequest('/api/attendance/mark', {
      method: 'POST',
      body: JSON.stringify({ regNo, action, sessionId }),
    });
  },

  /**
   * Fetch live attendance records for a date.
   * @param {string} date - YYYY-MM-DD format
   */
  async getLiveAttendance(date) {
    const query = date ? `?date=${date}` : '';
    return apiRequest(`/api/attendance/live${query}`, {
      method: 'GET',
    });
  },
};
