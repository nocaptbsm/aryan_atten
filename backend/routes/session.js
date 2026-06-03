const express = require('express');
const router = express.Router();
const { generateSessionToken, verifySessionToken } = require('../lib/jwt');
const supabase = require('../lib/supabase');
const { tokenLimiter } = require('../middleware/rateLimiter');

/**
 * GET /api/session/token
 * Called by ESP32 every 15 seconds to get a fresh QR code token.
 * Returns signed JWT + full QR URL for display.
 */
router.get('/token', tokenLimiter, (req, res) => {
  try {
    const { token, qrUrl, expiresIn } = generateSessionToken();

    res.json({
      token,
      qrUrl,
      expiresIn,
    });
  } catch (err) {
    console.error('Token generation error:', err);
    res.status(500).json({
      error: 'Failed to generate session token.',
      code: 'TOKEN_GENERATION_FAILED',
      retryable: true,
    });
  }
});

/**
 * POST /api/session/verify
 * Validates a scanned token. Checks JWT signature, expiry, and one-time-use.
 * On success, marks the token's jti as used in the database.
 *
 * Body: { token: string }
 * Returns: { valid: boolean, sessionId?: string, error?: string }
 */
router.post('/verify', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        valid: false,
        error: 'Token is required.',
        code: 'MISSING_TOKEN',
        retryable: false,
      });
    }

    // Step 1: Verify JWT signature and expiry
    const result = verifySessionToken(token);
    if (!result.valid) {
      return res.status(401).json({
        valid: false,
        error: result.error,
        code: 'INVALID_TOKEN',
        retryable: false,
      });
    }

    const { jti } = result.payload;

    // Step 2: Check if token has already been used
    // Non-fatal: if Supabase is unreachable, skip replay check (JWT expiry is the main guard)
    let replayCheckOk = true;
    const { data: existingToken, error: selectError } = await supabase
      .from('used_tokens')
      .select('token_jti')
      .eq('token_jti', jti)
      .single();

    if (selectError && selectError.code !== 'PGRST116') {
      // PGRST116 = "no rows returned" (expected when token is new)
      // Any other error = Supabase unavailable — log and continue
      console.warn('used_tokens select error (non-fatal):', selectError.message || selectError);
      replayCheckOk = false;
    }

    if (existingToken) {
      return res.status(401).json({
        valid: false,
        error: 'This QR code has already been used. Please scan the current one.',
        code: 'TOKEN_ALREADY_USED',
        retryable: false,
      });
    }

    // Step 3: Mark token as used
    if (replayCheckOk) {
      const { error: insertError } = await supabase
        .from('used_tokens')
        .insert({ token_jti: jti });

      if (insertError) {
        // Unique constraint = race condition, token already used
        if (insertError.code === '23505') {
          return res.status(401).json({
            valid: false,
            error: 'This QR code has already been used. Please scan the current one.',
            code: 'TOKEN_ALREADY_USED',
            retryable: false,
          });
        }
        // Any other insert error = Supabase issue — log and continue
        console.warn('used_tokens insert error (non-fatal):', insertError.message || insertError);
      }
    }

    // Token is valid and consumed (or Supabase unavailable — JWT expiry protects us)
    res.json({
      valid: true,
      sessionId: jti,
    });

  } catch (err) {
    console.error('Token verification error:', err);
    res.status(500).json({
      valid: false,
      error: 'Token verification failed. Please try again.',
      code: 'VERIFICATION_FAILED',
      retryable: true,
    });
  }
});

module.exports = router;
