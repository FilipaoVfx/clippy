/**
 * Clippy — Minimal QR encoder
 *
 * Byte mode, error correction level M, versions 1-10 (up to 216 bytes), which
 * is far more than a pairing URL needs. Written in-tree rather than pulled from
 * a CDN because the PWA has to work offline and loads no external resources.
 *
 * Output is a boolean matrix; render() turns it into an inline SVG so it stays
 * crisp at any size.
 */
const QR = (() => {
  // ── Galois field GF(256), primitive polynomial 0x11D ─────────────────────
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (() => {
    let x = 1;
    for (let i = 0; i < 255; i += 1) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
  })();

  const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

  /** Generator polynomial for `degree` error-correction codewords. */
  function rsGenerator(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i += 1) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j += 1) {
        next[j] ^= poly[j];
        next[j + 1] ^= mul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    const gen = rsGenerator(ecLen);
    const remainder = new Array(ecLen).fill(0);

    for (const byte of data) {
      const factor = byte ^ remainder[0];
      remainder.shift();
      remainder.push(0);
      for (let i = 0; i < ecLen; i += 1) {
        remainder[i] ^= mul(gen[i + 1], factor);
      }
    }
    return remainder;
  }

  // ── Version tables (error correction level M) ────────────────────────────
  // [total codewords, ec codewords per block, [blocks, data codewords] groups]
  const VERSIONS = {
    1: [26, 10, [[1, 16]]],
    2: [44, 16, [[1, 28]]],
    3: [70, 26, [[1, 44]]],
    4: [100, 18, [[2, 32]]],
    5: [134, 24, [[2, 43]]],
    6: [172, 16, [[4, 27]]],
    7: [196, 18, [[4, 31]]],
    8: [242, 22, [[2, 38], [2, 39]]],
    9: [292, 22, [[3, 36], [2, 37]]],
    10: [346, 26, [[4, 43], [1, 44]]],
  };

  const ALIGNMENT = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  };

  const dataCapacity = (version) =>
    VERSIONS[version][2].reduce((sum, [blocks, count]) => sum + blocks * count, 0);

  function pickVersion(byteLength) {
    for (let v = 1; v <= 10; v += 1) {
      // 4 bits mode + 8 or 16 bits length + payload
      const headerBits = 4 + (v < 10 ? 8 : 16);
      if (dataCapacity(v) * 8 >= headerBits + byteLength * 8) return v;
    }
    throw new Error('Content too long for a version-10 QR code');
  }

  // ── Data encoding ────────────────────────────────────────────────────────
  function encodeData(bytes, version) {
    const bits = [];
    const push = (value, length) => {
      for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
    };

    push(0b0100, 4);                       // byte mode
    push(bytes.length, version < 10 ? 8 : 16);
    for (const byte of bytes) push(byte, 8);

    const capacityBits = dataCapacity(version) * 8;
    push(0, Math.min(4, capacityBits - bits.length)); // terminator
    while (bits.length % 8 !== 0) bits.push(0);

    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
      codewords.push(byte);
    }

    // Alternating pad bytes until the version is full.
    const pad = [0xec, 0x11];
    let p = 0;
    while (codewords.length < dataCapacity(version)) {
      codewords.push(pad[p++ % 2]);
    }
    return codewords;
  }

  /** Split into blocks, add error correction, then interleave as the spec requires. */
  function buildCodewords(dataCodewords, version) {
    const [, ecLen, groups] = VERSIONS[version];
    const blocks = [];
    let offset = 0;

    for (const [blockCount, dataCount] of groups) {
      for (let i = 0; i < blockCount; i += 1) {
        const chunk = dataCodewords.slice(offset, offset + dataCount);
        offset += dataCount;
        blocks.push({ data: chunk, ec: rsEncode(chunk, ecLen) });
      }
    }

    const result = [];
    const maxData = Math.max(...blocks.map((b) => b.data.length));
    for (let i = 0; i < maxData; i += 1) {
      for (const block of blocks) {
        if (i < block.data.length) result.push(block.data[i]);
      }
    }
    for (let i = 0; i < ecLen; i += 1) {
      for (const block of blocks) result.push(block.ec[i]);
    }
    return result;
  }

  // ── Matrix construction ──────────────────────────────────────────────────
  function createMatrix(version) {
    const size = version * 4 + 17;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

    const setArea = (row, col, height, width, fn) => {
      for (let r = 0; r < height; r += 1) {
        for (let c = 0; c < width; c += 1) {
          const rr = row + r;
          const cc = col + c;
          if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
          modules[rr][cc] = fn(r, c);
          reserved[rr][cc] = true;
        }
      }
    };

    // Finder patterns plus their separators.
    const finder = (row, col) => {
      setArea(row - 1, col - 1, 9, 9, () => false);
      setArea(row, col, 7, 7, (r, c) => {
        const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
        return ring !== 2;
      });
    };
    finder(0, 0);
    finder(0, size - 7);
    finder(size - 7, 0);

    // Timing patterns.
    for (let i = 8; i < size - 8; i += 1) {
      modules[6][i] = i % 2 === 0;
      modules[i][6] = i % 2 === 0;
      reserved[6][i] = true;
      reserved[i][6] = true;
    }

    // Alignment patterns, skipping the three finder corners.
    const centers = ALIGNMENT[version];
    for (const r of centers) {
      for (const c of centers) {
        const nearFinder =
          (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
        if (nearFinder) continue;
        setArea(r - 2, c - 2, 5, 5, (rr, cc) => Math.max(Math.abs(rr - 2), Math.abs(cc - 2)) !== 1);
      }
    }

    // Dark module and the format-information areas.
    modules[size - 8][8] = true;
    reserved[size - 8][8] = true;
    for (let i = 0; i < 9; i += 1) {
      if (!reserved[8][i]) reserved[8][i] = true;
      if (!reserved[i][8]) reserved[i][8] = true;
    }
    for (let i = 0; i < 8; i += 1) {
      reserved[8][size - 1 - i] = true;
      reserved[size - 1 - i][8] = true;
    }

    // Version information blocks (version 7 and up).
    if (version >= 7) {
      const bits = versionBits(version);
      for (let i = 0; i < 18; i += 1) {
        const bit = ((bits >> i) & 1) === 1;
        const r = Math.floor(i / 3);
        const c = i % 3;
        modules[r][size - 11 + c] = bit;
        reserved[r][size - 11 + c] = true;
        modules[size - 11 + c][r] = bit;
        reserved[size - 11 + c][r] = true;
      }
    }

    return { size, modules, reserved };
  }

  // Both of these are shift-register polynomial divisions: the loop leaves the
  // remainder alone in `rem`, which is then appended to the data bits.
  function versionBits(version) {
    let rem = version;
    for (let i = 0; i < 12; i += 1) {
      rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    }
    return (version << 12) | rem;
  }

  function formatBits(mask) {
    const data = (0b00 << 3) | mask; // level M is 0b00
    let rem = data;
    for (let i = 0; i < 10; i += 1) {
      rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    }
    return ((data << 10) | rem) ^ 0x5412;
  }

  function placeData(matrix, codewords) {
    const { size, modules, reserved } = matrix;
    let bitIndex = 0;
    let upward = true;

    for (let right = size - 1; right > 0; right -= 2) {
      if (right === 6) right -= 1; // skip the vertical timing column
      for (let step = 0; step < size; step += 1) {
        const row = upward ? size - 1 - step : step;
        for (let c = 0; c < 2; c += 1) {
          const col = right - c;
          if (reserved[row][col]) continue;
          const byte = codewords[bitIndex >> 3];
          const bit = byte === undefined ? 0 : (byte >> (7 - (bitIndex & 7))) & 1;
          modules[row][col] = bit === 1;
          bitIndex += 1;
        }
      }
      upward = !upward;
    }
  }

  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];

  function applyMask(matrix, mask) {
    const { size, modules, reserved } = matrix;
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        if (!reserved[r][c] && MASKS[mask](r, c)) modules[r][c] = !modules[r][c];
      }
    }
  }

  function writeFormat(matrix, mask) {
    const { size, modules } = matrix;
    const bits = formatBits(mask);
    // The module nearest each finder carries the most significant bit.
    const bit = (i) => ((bits >> (14 - i)) & 1) === 1;

    for (let i = 0; i <= 5; i += 1) modules[8][i] = bit(i);
    modules[8][7] = bit(6);
    modules[8][8] = bit(7);
    modules[7][8] = bit(8);
    for (let i = 9; i <= 14; i += 1) modules[14 - i][8] = bit(i);

    // Second copy: bits 0-6 run up column 8, bits 7-14 run along row 8. The
    // always-dark module sits between them and is not part of the format data.
    for (let i = 0; i <= 6; i += 1) modules[size - 1 - i][8] = bit(i);
    modules[size - 8][8] = true;
    for (let i = 7; i <= 14; i += 1) modules[8][size - 15 + i] = bit(i);
  }

  /** Standard penalty rules, used to pick the mask that scans most reliably. */
  function penalty(matrix) {
    const { size, modules } = matrix;
    let score = 0;

    const runPenalty = (run) => (run >= 5 ? run - 2 : 0);

    for (let i = 0; i < size; i += 1) {
      let rowRun = 1;
      let colRun = 1;
      for (let j = 1; j < size; j += 1) {
        rowRun = modules[i][j] === modules[i][j - 1] ? rowRun + 1 : (score += runPenalty(rowRun), 1);
        colRun = modules[j][i] === modules[j - 1][i] ? colRun + 1 : (score += runPenalty(colRun), 1);
      }
      score += runPenalty(rowRun) + runPenalty(colRun);
    }

    for (let r = 0; r < size - 1; r += 1) {
      for (let c = 0; c < size - 1; c += 1) {
        const v = modules[r][c];
        if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) {
          score += 3;
        }
      }
    }

    // Rule 3: the finder-like sequence 1011101 flanked by four light modules,
    // counted in both orientations.
    const FINDER_A = [true, false, true, true, true, false, true, false, false, false, false];
    const FINDER_B = [false, false, false, false, true, false, true, true, true, false, true];
    const matches = (get) => {
      let found = 0;
      for (let i = 0; i + 11 <= size; i += 1) {
        let hitA = true;
        let hitB = true;
        for (let j = 0; j < 11; j += 1) {
          const v = get(i + j);
          if (v !== FINDER_A[j]) hitA = false;
          if (v !== FINDER_B[j]) hitB = false;
          if (!hitA && !hitB) break;
        }
        if (hitA) found += 1;
        if (hitB) found += 1;
      }
      return found;
    };
    for (let i = 0; i < size; i += 1) {
      score += 40 * matches((k) => modules[i][k]);
      score += 40 * matches((k) => modules[k][i]);
    }

    let dark = 0;
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) if (modules[r][c]) dark += 1;
    }
    const percent = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(percent - 50) / 5) * 10;

    return score;
  }

  /**
   * Encode text into a QR module matrix.
   * Returns { size, modules } where modules[row][col] is true for a dark cell.
   */
  function encode(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    const version = pickVersion(bytes.length);
    const codewords = buildCodewords(encodeData(bytes, version), version);

    let best = null;
    for (let mask = 0; mask < 8; mask += 1) {
      const matrix = createMatrix(version);
      placeData(matrix, codewords);
      applyMask(matrix, mask);
      writeFormat(matrix, mask);
      const score = penalty(matrix);
      if (!best || score < best.score) best = { score, matrix };
    }

    return { size: best.matrix.size, modules: best.matrix.modules };
  }

  /**
   * Render text as an inline SVG string.
   * `quiet` is the mandatory light border, in modules.
   */
  function render(text, { quiet = 4 } = {}) {
    const { size, modules } = encode(text);
    const total = size + quiet * 2;

    let path = '';
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        if (modules[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
      }
    }

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" ` +
      `shape-rendering="crispEdges" role="img" aria-label="Pairing QR code">` +
      `<rect width="${total}" height="${total}" fill="#fff"/>` +
      `<path d="${path}" fill="#000"/></svg>`
    );
  }

  return { encode, render };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = QR;
}
