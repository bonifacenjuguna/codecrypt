const crypto = require('crypto');

/**
 * Computes the same SHA-1 hash Git uses for blob objects:
 * sha1("blob " + byteLength + "\0" + content)
 *
 * This lets us compare a locally-uploaded file against GitHub's tree
 * (which already includes each existing file's blob sha) WITHOUT an
 * extra API call per file — just hash locally and compare strings.
 * This is what powers the 🆕 New / ✏️ Modified / ➖ Unchanged detection.
 */
function gitBlobSha(bufferOrString) {
  const buf = Buffer.isBuffer(bufferOrString) ? bufferOrString : Buffer.from(bufferOrString, 'utf8');
  const header = `blob ${buf.length}\0`;
  const hash = crypto.createHash('sha1');
  hash.update(Buffer.concat([Buffer.from(header), buf]));
  return hash.digest('hex');
}

module.exports = { gitBlobSha };
