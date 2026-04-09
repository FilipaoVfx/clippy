const MAX_MESSAGE_SIZE = parseInt(process.env.MAX_MESSAGE_SIZE || '10240', 10); // 10KB
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '30', 10);
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);

// Sliding window rate limiter per IP
const rateLimitMap = new Map();

/**
 * Check if an IP has exceeded the rate limit.
 * Returns true if the request is allowed, false if rate-limited.
 */
function checkRateLimit(ip) {
  const now = Date.now();
  let record = rateLimitMap.get(ip);

  if (!record) {
    record = { timestamps: [], blocked: false };
    rateLimitMap.set(ip, record);
  }

  // Remove timestamps outside the window
  record.timestamps = record.timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);

  if (record.timestamps.length >= RATE_LIMIT_MAX) {
    return false;
  }

  record.timestamps.push(now);
  return true;
}

/**
 * Periodically clean up old rate limit entries
 */
function cleanRateLimits() {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap) {
    record.timestamps = record.timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
    if (record.timestamps.length === 0) {
      rateLimitMap.delete(ip);
    }
  }
}

/**
 * Sanitize text to prevent XSS.
 * Escapes HTML entities.
 */
function sanitizeText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Validate message content.
 * Returns { valid: boolean, error?: string }
 */
function validateMessage(content) {
  if (typeof content !== 'string') {
    return { valid: false, error: 'Content must be a string' };
  }

  if (content.length === 0) {
    return { valid: false, error: 'Content cannot be empty' };
  }

  const byteSize = Buffer.byteLength(content, 'utf8');
  if (byteSize > MAX_MESSAGE_SIZE) {
    return { valid: false, error: `Content exceeds maximum size of ${MAX_MESSAGE_SIZE} bytes` };
  }

  return { valid: true };
}

/**
 * Validate a pairing code format (ABC-12K)
 */
function validateCode(code) {
  if (typeof code !== 'string') return false;
  return /^[A-Z]{3}-[0-9]{2}[A-Z]$/.test(code);
}

module.exports = {
  checkRateLimit,
  cleanRateLimits,
  sanitizeText,
  validateMessage,
  validateCode,
};
