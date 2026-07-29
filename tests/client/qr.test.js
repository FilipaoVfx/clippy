/**
 * Tests for the in-tree QR encoder.
 *
 * The golden hashes below were produced after verifying every one of these
 * inputs module-for-module against the `qrcode` npm package (byte mode, error
 * correction level M). They lock that verified output in so a regression in the
 * Reed-Solomon step, the mask choice or the format bits is caught here rather
 * than by a phone that fails to scan.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import QR from '../../public/js/qr.js';

const GOLDEN = [
  ['A', 21, '2092585037e9da56'],
  ['HELLO WORLD', 21, 'f516d851861750f4'],
  ['https://clippy-pages.pages.dev/?code=ABC-12K', 33, '59ede0b7de7abf97'],
  ['ñ acentos y emoji 🎬 utf-8', 29, '1eb89287bd826153'],
  [`https://example.com/${'y'.repeat(150)}`, 53, '2e9951a8dd054297'],
];

function fingerprint(matrix) {
  const flat = matrix.modules.map((row) => row.map((v) => (v ? '1' : '0')).join('')).join('');
  return createHash('sha256').update(flat).digest('hex').slice(0, 16);
}

describe('QR encoder — output matches the verified reference', () => {
  for (const [text, size, hash] of GOLDEN) {
    const label = text.length > 30 ? `${text.slice(0, 27)}...` : text;
    it(`encodes ${JSON.stringify(label)} identically`, () => {
      const matrix = QR.encode(text);
      expect(matrix.size).toBe(size);
      expect(fingerprint(matrix)).toBe(hash);
    });
  }
});

describe('QR encoder — structure', () => {
  it('places the three finder patterns', () => {
    const { size, modules } = QR.encode('https://example.com/?code=ABC-12K');

    // A finder is a 7x7 ring: dark border, light ring, dark 3x3 core.
    const isFinder = (row, col) => {
      for (let r = 0; r < 7; r += 1) {
        for (let c = 0; c < 7; c += 1) {
          const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
          if (modules[row + r][col + c] !== (ring !== 2)) return false;
        }
      }
      return true;
    };

    expect(isFinder(0, 0)).toBe(true);
    expect(isFinder(0, size - 7)).toBe(true);
    expect(isFinder(size - 7, 0)).toBe(true);
  });

  it('alternates the timing patterns', () => {
    const { size, modules } = QR.encode('timing');
    for (let i = 8; i < size - 8; i += 1) {
      expect(modules[6][i]).toBe(i % 2 === 0);
      expect(modules[i][6]).toBe(i % 2 === 0);
    }
  });

  it('always sets the dark module', () => {
    const { size, modules } = QR.encode('dark module');
    expect(modules[size - 8][8]).toBe(true);
  });

  it('grows the version with the payload', () => {
    expect(QR.encode('A').size).toBeLessThan(QR.encode('x'.repeat(100)).size);
  });

  it('rejects content beyond the supported capacity', () => {
    expect(() => QR.encode('x'.repeat(300))).toThrow(/too long/i);
  });
});

describe('QR encoder — SVG rendering', () => {
  it('renders self-contained SVG with a quiet zone', () => {
    const svg = QR.render('https://example.com/?code=ABC-12K');

    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain('shape-rendering="crispEdges"');
    // Default quiet zone of 4 modules on each side.
    const size = QR.encode('https://example.com/?code=ABC-12K').size;
    expect(svg).toContain(`viewBox="0 0 ${size + 8} ${size + 8}"`);
    // No external references — the PWA has to render this offline.
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });
});
