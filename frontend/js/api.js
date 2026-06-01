/**
 * API Client — handles all backend communication with retry logic.
 * Designed to survive Render free-tier cold starts (up to ~30s).
 */

const API_BASE = window.__API_BASE__ || 'http://localhost:3000';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff in ms

/**
 * Make an API request with automatic retries for retryable errors.
 * @param {string} endpoint - API path (e.g., '/api/session/verify')
 * @param {object} options - Fetch options
 * @returns {Promise<object>} Parsed JSON response
 */
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };

  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, config);
      const data = await response.json();

      // If response is OK, return data
      if (response.ok) {
        return { ok: true, data, status: response.status };
      }

      // If error is retryable and we have retries left
      if (data.retryable && attempt < MAX_RETRIES) {
        lastError = data;
        await sleep(RETRY_DELAYS[attempt] || 4000);
        continue;
      }

      // Non-retryable error or out of retries
      return { ok: false, data, status: response.status };
    } catch (err) {
      // Network error — likely cold start or connectivity issue
      lastError = { error: 'Network error. The server may be waking up...', code: 'NETWORK_ERROR', retryable: true };

      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAYS[attempt] || 4000);
        continue;
      }

      return {
        ok: false,
        data: {
          error: 'Could not connect to the server. Please check your connection and try again.',
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
   */
  async verifyToken(token) {
    return apiRequest('/api/session/verify', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
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
