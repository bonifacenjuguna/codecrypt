const crypto = require('crypto');
const config = require('../config');

const ALGO = 'aes-256-gcm';
const KEY = Buffer.from(config.TOKEN_ENCRYPTION_KEY, 'hex'); // must be 32 bytes (64 hex chars)

if (KEY.length !== 32) {
  console.error('❌ TOKEN_ENCRYPTION_KEY must be a 32-byte hex string (64 hex characters).');
  console.error('   Generate one with: openssl rand -hex 32');
  process.exit(1);
}

/**
 * Encrypts a plaintext string (e.g. a GitHub access token) for storage.
 * Returns a single string: iv:authTag:ciphertext (all hex-encoded).
 */
function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a string produced by encrypt().
 */
function decrypt(payload) {
  const [ivHex, tagHex, dataHex] = payload.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

module.exports = { encrypt, decrypt };
