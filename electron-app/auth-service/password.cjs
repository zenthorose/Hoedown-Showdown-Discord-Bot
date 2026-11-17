const crypto = require('node:crypto');

function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let password = '';
  while (password.length < 24) {
    const byte = crypto.randomBytes(1)[0];
    if (byte < Math.floor(256 / alphabet.length) * alphabet.length) {
      password += alphabet[byte % alphabet.length];
    }
  }
  return password;
}

module.exports = { generatePassword };
