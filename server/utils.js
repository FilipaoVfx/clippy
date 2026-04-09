const { v4: uuidv4 } = require('uuid');

/**
 * Generate a unique pairing code in format ABC-12K
 * 3 uppercase letters + hyphen + 2 digits + 1 uppercase letter
 * ~2 billion possible combinations
 */
function generateCode(existingCodes) {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // No I or O (ambiguous)
  const digits = '0123456789';

  let code;
  let attempts = 0;
  const maxAttempts = 100;

  do {
    const part1 =
      letters[Math.floor(Math.random() * letters.length)] +
      letters[Math.floor(Math.random() * letters.length)] +
      letters[Math.floor(Math.random() * letters.length)];

    const part2 =
      digits[Math.floor(Math.random() * digits.length)] +
      digits[Math.floor(Math.random() * digits.length)] +
      letters[Math.floor(Math.random() * letters.length)];

    code = `${part1}-${part2}`;
    attempts++;
  } while (existingCodes.has(code) && attempts < maxAttempts);

  if (attempts >= maxAttempts) {
    throw new Error('Failed to generate unique code');
  }

  return code;
}

/**
 * Generate a UUID v4
 */
function generateId() {
  return uuidv4();
}

/**
 * Generate a cryptographically random resume token.
 */
function generateResumeToken() {
  const crypto = require('crypto');
  return crypto.randomBytes(32).toString('hex');
}

module.exports = { generateCode, generateId, generateResumeToken };
