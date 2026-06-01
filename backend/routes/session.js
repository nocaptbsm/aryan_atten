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
    const { data: existingToken } = await supabase
      .from('used_tokens')
      .select('token_jti')
      .eq('token_jti', jti)
      .single();

    if (existingToken) {
      return res.status(401).json({
        valid: false,
        error: 'This QR code has already been used. Please scan the current one.',
        code: 'TOKEN_ALREADY_USED',
        retryable: false,
      });
    }

    // Step 3: Mark token as used
    const { error: insertError } = await supabase
      .from('used_tokens')
      .insert({ token_jti: jti });

    if (insertError) {
      // If insert fails due to unique constraint, it was a race condition — token was used
      if (insertError.code === '23505') {
        return res.status(401).json({
          valid: false,
          error: 'This QR code has already been used. Please scan the current one.',
          code: 'TOKEN_ALREADY_USED',
          retryable: false,
        });
      }
      console.error('Token insert error:', insertError);
      return res.status(500).json({
        valid: false,
        error: 'Failed to process token. Please try again.',
        code: 'TOKEN_PROCESSING_FAILED',
        retryable: true,
      });
    }

    // Token is valid and now consumed
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
