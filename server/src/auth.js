'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);

const R = 8, P = 1, LEN = 64;
async function hashPassword(pw, N) {
  const salt = crypto.randomBytes(16);
  const dk = await scrypt(pw, salt, LEN, { N, r: R, p: P, maxmem: 256 * N * R });
  return `scrypt$${N}$${salt.toString('base64')}$${dk.toString('base64')}`;
}
async function verifyPassword(pw, stored) {
  const [alg, Ns, saltB, dkB] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const N = Number(Ns), want = Buffer.from(dkB, 'base64');
  const dk = await scrypt(pw, Buffer.from(saltB, 'base64'), want.length, { N, r: R, p: P, maxmem: 256 * N * R });
  return crypto.timingSafeEqual(dk, want);
}
// 给人读的临时密码：去掉容易混淆的字符
function tempPassword() {
  const A = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(14), b => A[b % A.length]).join('');
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

function passwordProblem(pw, acc) {
  if (typeof pw !== 'string' || pw.length < 10) return '密码至少要 10 个字符。';
  if (pw.length > 200) return '密码太长了。';
  if (pw.toLowerCase() === String(acc).toLowerCase()) return '密码不能和账号相同。';
  if (/^(.)\1+$/.test(pw) || /^(0123456789|1234567890|password.*|qwertyuiop.*)$/i.test(pw)) return '这个密码太容易被猜到，请换一个。';
  return '';
}
module.exports = { hashPassword, verifyPassword, tempPassword, sha, newToken, passwordProblem };
