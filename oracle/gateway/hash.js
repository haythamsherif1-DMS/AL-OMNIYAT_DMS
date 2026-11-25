// نفس تشفير كلمات السر اللي في Code.gs (hash_): sha256 متكرر 300 مرة على "salt|password"
// كده Apps Script بيقدر يتأكد من كلمة السر بنفسه، وكلمة السر مش بتتخزن كنص في Oracle.
const crypto = require('crypto');

function hash(salt, password) {
  let h = salt + '|' + password;
  for (let i = 0; i < 300; i++) h = crypto.createHash('sha256').update(h, 'utf8').digest('hex');
  return h;
}

function newSalt() { return crypto.randomBytes(8).toString('hex'); }

/** لو الصف فيه كلمة سر نص عادي: بنحوّلها لـ PasswordHash + Salt ونفضّي Password */
function protectUser(o) {
  const pw = o.Password === null || o.Password === undefined ? '' : String(o.Password).trim();
  if (!pw) return o;
  const salt = newSalt();
  return { ...o, Password: '', PasswordHash: hash(salt, pw), Salt: salt };
}

module.exports = { hash, newSalt, protectUser };
