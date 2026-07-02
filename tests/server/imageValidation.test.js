/**
 * Unit tests for validateImage() in server/security.js
 * Covers RF-13/RF-14 image validation requirements.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Reload module per suite to reset module-level constants
let validateImage;

beforeEach(async () => {
  vi.resetModules();
  ({ validateImage } = await import('../../server/security.js'));
});

// Minimal valid 1×1 PNG/JPEG as data URI
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVIP/2Q==';
const TINY_WEBP = 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJZgCdAEO/gXOAAA=';

describe('validateImage — valid formats', () => {
  it('accepts a valid PNG data URI', () => {
    const result = validateImage(TINY_PNG);
    expect(result.valid).toBe(true);
    expect(result.mimeType).toBe('image/png');
  });

  it('accepts a valid JPEG data URI', () => {
    const result = validateImage(TINY_JPEG);
    expect(result.valid).toBe(true);
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('accepts a valid WEBP data URI', () => {
    const result = validateImage(TINY_WEBP);
    expect(result.valid).toBe(true);
    expect(result.mimeType).toBe('image/webp');
  });
});

describe('validateImage — type rejection', () => {
  it('rejects non-string input (null)', () => {
    const result = validateImage(null);
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects non-string input (number)', () => {
    const result = validateImage(42);
    expect(result.valid).toBe(false);
  });

  it('rejects plain base64 without data URI prefix', () => {
    const result = validateImage('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/invalid image format/i);
  });

  it('rejects SVG data URI', () => {
    const result = validateImage('data:image/svg+xml;base64,PHN2Zyc+PC9zdmc+');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/invalid image format/i);
  });

  it('rejects GIF data URI', () => {
    const result = validateImage('data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/invalid image format/i);
  });

  it('rejects text/plain data URI', () => {
    const result = validateImage('data:text/plain;base64,aGVsbG8=');
    expect(result.valid).toBe(false);
  });

  it('rejects empty string', () => {
    const result = validateImage('');
    expect(result.valid).toBe(false);
  });

  it('rejects data URI with non-base64 encoding directive', () => {
    const result = validateImage('data:image/png;utf8,hello');
    expect(result.valid).toBe(false);
  });
});

describe('validateImage — size limit', () => {
  it('rejects an image exceeding 5 MB', () => {
    // Build a base64 string representing ~5.1 MB of data
    const targetBytes = 5 * 1024 * 1024 + 1024;
    const base64Chars = Math.ceil((targetBytes * 4) / 3);
    const bigBase64 = 'A'.repeat(base64Chars);
    const result = validateImage(`data:image/png;base64,${bigBase64}`);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/exceeds/i);
  });

  it('accepts an image at exactly the size limit boundary', () => {
    // 5 MB exactly — use the small valid PNG (well under limit)
    const result = validateImage(TINY_PNG);
    expect(result.valid).toBe(true);
  });
});

describe('validateImage — malformed base64', () => {
  it('rejects data URI with invalid base64 characters', () => {
    const result = validateImage('data:image/png;base64,!!!invalid!!!');
    expect(result.valid).toBe(false);
  });

  it('rejects data URI with spaces in base64', () => {
    const result = validateImage('data:image/png;base64,abc def');
    expect(result.valid).toBe(false);
  });
});
