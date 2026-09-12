/*
 * totp.js — одноразовые коды из приложения-аутентификатора.
 *
 * Это RFC 6238 (TOTP) поверх RFC 4226 (HOTP). Реализовано здесь, а не
 * взято готовой библиотекой, по двум причинам: алгоритм короткий и
 * целиком проверяется контрольными векторами из самого стандарта
 * (scripts/admin-selftest.js), а лишняя зависимость в проверке входа —
 * это лишний код, которому приходится доверять на слово.
 *
 * Совместимо с Google Authenticator, Authy, 1Password, Aegis и прочими:
 * SHA-1, 6 цифр, шаг 30 секунд.
 */

"use strict";

const crypto = require("crypto");

const DIGITS = 6;
const STEP = 30;
/* Допуск в одно окно в каждую сторону: часы на телефоне и на сервере
   расходятся на секунды, и человек не должен из-за этого не войти. */
const WINDOW = 1;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/* Новый секрет для нового пользователя: 20 случайных байт — длина,
   рекомендованная RFC 4226 для SHA-1. */
function newSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/* Одно значение HOTP для заданного счётчика */
function hotp(secretBuf, counter, algorithm = "sha1", digits = DIGITS) {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const mac = crypto.createHmac(algorithm, secretBuf).update(buf).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) |
              (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

function codeAt(secretBase32, seconds, algorithm = "sha1", digits = DIGITS, step = STEP) {
  return hotp(base32Decode(secretBase32), Math.floor(seconds / step), algorithm, digits);
}

/* Сравнение за одинаковое время: обычное === выходит из цикла на первом
   несовпавшем знаке, и по задержке можно подбирать код посимвольно. */
function sameCode(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/* Проверка кода, введённого человеком. Возвращает номер окна, в котором
   код совпал (нужен, чтобы не дать использовать один код дважды),
   либо null. */
function verify(secretBase32, code, atSeconds = Date.now() / 1000) {
  const clean = String(code || "").replace(/\D/g, "");
  if (clean.length !== DIGITS) return null;
  const current = Math.floor(atSeconds / STEP);
  for (let shift = -WINDOW; shift <= WINDOW; shift++) {
    const counter = current + shift;
    const expected = hotp(base32Decode(secretBase32), counter);
    if (sameCode(expected, clean)) return counter;
  }
  return null;
}

/* Строка, которую понимает приложение-аутентификатор. Из неё делается
   картинка с квадратным кодом. */
function otpauthUrl(secretBase32, email, issuer = "VisaWay Group") {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP)
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

module.exports = { newSecret, verify, codeAt, otpauthUrl, base32Encode, base32Decode, hotp, STEP, DIGITS };
