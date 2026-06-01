const rateLimit = require('express-rate-limit');

/**
 * General API rate limiter — 100 requests per minute per IP.
 */
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please try again in a minute.',
    code: 'RATE_LIMITED',
    retryable: true,
  },
});

/**
 * Strict rate limiter for registration — 10 requests per minute per IP.
 */
const registrationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many registration attempts. Please try again in a minute.',
    code: 'RATE_LIMITED',
    retryable: true,
  },
});

/**
 * Token generation limiter — 20 requests per minute per IP.
 * Prevents abuse of token endpoint.
 */
const tokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many token requests. Please slow down.',
    code: 'RATE_LIMITED',
    retryable: true,
  },
});

module.exports = { generalLimiter, registrationLimiter, tokenLimiter };
