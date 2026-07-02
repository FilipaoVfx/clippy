const MAX_MESSAGE_SIZE = parseInt(process.env.MAX_MESSAGE_SIZE || '10240', 10); // 10KB
const IMAGE_MAX_BYTES = parseInt(process.env.IMAGE_MAX_BYTES || String(5 * 1024 * 1024), 10); // 5 MB
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
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
 * Validate an image data URI.
 * Returns { valid, mimeType? } or { valid: false, error }
 */
function validateImage(dataUri) {
  if (typeof dataUri !== 'string') {
    return { valid: false, error: 'Image data must be a string' };
  }

  const match = dataUri.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/);
  if (!match) {
    return { valid: false, error: 'Invalid image format. Use PNG, JPG, or WEBP as a data URI.' };
  }

  const mimeType = match[1];
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    return { valid: false, error: 'Unsupported format. Use PNG, JPG, or WEBP.' };
  }

  const base64Data = match[2];
  const paddingChars = base64Data.endsWith('==') ? 2 : base64Data.endsWith('=') ? 1 : 0;
  const byteSize = (base64Data.length * 3) / 4 - paddingChars;

  if (byteSize > IMAGE_MAX_BYTES) {
    return { valid: false, error: `Image exceeds ${Math.floor(IMAGE_MAX_BYTES / (1024 * 1024))} MB limit` };
  }

  return { valid: true, mimeType };
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
  validateImage,
  validateCode,
};
