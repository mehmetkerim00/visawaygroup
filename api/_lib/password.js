/*
 * password.js — требования к паролю и его хеширование.
 *
 * Хеш — bcrypt, cost 12. На этом компьютере один такой хеш считается
 * около 300 мс: достаточно медленно, чтобы перебор был бессмысленным,
 * и достаточно быстро, чтобы вход не казался зависшим.
 *
 * Открытый пароль не хранится и не попадает в записи журнала: ни в
 * одном месте этого файла и ни в одном обработчике его нет в тексте
 * сообщения об ошибке.
 */

"use strict";

const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const COST = 12;
const MIN_LENGTH = 12;

function hash(plain) {
  return bcrypt.hashSync(plain, COST);
}

function check(plain, stored) {
  if (!stored) {
    /* Пользователя нет. Всё равно считаем хеш, чтобы по времени ответа
       нельзя было понять, заведён такой адрес или нет. */
    bcrypt.compareSync(plain, "$2a$12$" + "x".repeat(53));
    return false;
  }
  try {
    return bcrypt.compareSync(plain, stored);
  } catch (e) {
    return false;
  }
}

/* --------------------------------------------------------------- */
/* Проверка по списку утёкших паролей                               */
/* --------------------------------------------------------------- */

/* Обращение к базе Have I Been Pwned по методу k-анонимности: наружу
   уходят только первые пять знаков SHA-1 от пароля, в ответ приходит
   список окончаний. Сам пароль и его полный хеш сервер не покидают.
   Это единственное обращение наружу во всей панели. */
const PWNED_URL = "https://api.pwnedpasswords.com/range/";

/* Если до базы не достучались — работает этот список. Он короткий и
   ловит только совсем очевидное, но лучше так, чем пропустить всё. */
const OBVIOUS = new Set([
  "password", "passw0rd", "123456789012", "1234567890123", "qwertyuiop12",
  "administrator", "adminadmin12", "letmein12345", "welcome12345",
  "visawaygroup", "visawaygroup1", "ashgabat12345", "turkmenistan",
  "qwerty123456", "iloveyou1234", "monkey123456", "dragon123456",
  "password1234", "password123!", "123123123123", "111111111111",
  "aaaaaaaaaaaa", "abcdefghijkl", "zaq12wsxcde3", "1qaz2wsx3edc"
]);

async function isBreached(plain) {
  const lower = String(plain).toLowerCase();
  if (OBVIOUS.has(lower)) return { breached: true, source: "список очевидных" };

  const sha1 = crypto.createHash("sha1").update(plain, "utf8").digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const res = await fetch(PWNED_URL + prefix, {
      headers: { "Add-Padding": "true", "User-Agent": "VisaWayGroup-admin" },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return { breached: false, source: "база недоступна" };
    const text = await res.text();
    for (const line of text.split("\n")) {
      const [tail, count] = line.trim().split(":");
      if (tail === suffix && Number(count) > 0) {
        return { breached: true, source: "база утечек", count: Number(count) };
      }
    }
    return { breached: false, source: "база утечек" };
  } catch (e) {
    return { breached: false, source: "база недоступна" };
  }
}

/* --------------------------------------------------------------- */
/* Требования к паролю                                              */
/* --------------------------------------------------------------- */

async function validate(plain, email) {
  const problems = [];
  const p = String(plain || "");

  if ([...p].length < MIN_LENGTH) {
    problems.push(`Пароль короче ${MIN_LENGTH} знаков. Сейчас ${[...p].length}.`);
  }
  if (/^\s|\s$/.test(p)) {
    problems.push("Пароль начинается или кончается пробелом — это легко потерять при наборе.");
  }
  if (email && p.toLowerCase().includes(String(email).split("@")[0].toLowerCase())) {
    problems.push("Пароль содержит имя из вашей почты — такой подбирают первым.");
  }
  if (/^(.)\1+$/.test(p)) {
    problems.push("Пароль состоит из одного повторяющегося знака.");
  }

  if (!problems.length) {
    const pwned = await isBreached(p);
    if (pwned.breached) {
      problems.push(pwned.count
        ? `Этот пароль встречается в утечках (${pwned.count.toLocaleString("ru")} раз). Возьмите другой.`
        : "Этот пароль есть в списке утёкших. Возьмите другой.");
    }
  }
  return problems;
}

module.exports = { hash, check, validate, isBreached, MIN_LENGTH, COST };
