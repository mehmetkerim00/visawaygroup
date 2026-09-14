/*
 * auth.js — вход, сессии, роли и защита от перебора.
 *
 * Устройство короче, чем кажется:
 *   пользователь     user:<почта>       — хеш пароля и роль
 *   сессия           sess:<хеш токена>  — живёт 12 часов, дальше пропадает сама
 *   счётчик неудач   fail:<ключ>        — живёт 15 минут
 *
 * Срок жизни у всего перечисленного ставит хранилище, а не наш код.
 * Просроченная сессия не «считается недействительной» — её физически
 * нет, и проверять нечего.
 */

"use strict";

const crypto = require("crypto");
const kv = require("./kv.js");
const password = require("./password.js");

const SESSION_HOURS = 12;
const SESSION_TTL = SESSION_HOURS * 3600;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const LOCK_TTL = LOCK_MINUTES * 60;

const COOKIE = "vw_admin";
const CSRF_COOKIE = "vw_csrf";

const ROLES = { owner: "Владелец", editor: "Редактор" };

/* --------------------------------------------------------------- */
/* Пользователи                                                     */
/* --------------------------------------------------------------- */

const userKey = email => "user:" + String(email).trim().toLowerCase();

async function getUser(email) {
  if (!email) return null;
  return kv.getJson(userKey(email));
}

async function putUser(user) {
  return kv.setJson(userKey(user.email), user);
}

async function createUser({ email, plainPassword, role = "editor" }) {
  const clean = String(email).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error("Это не похоже на адрес почты.");
  if (!ROLES[role]) throw new Error("Роли «" + role + "» не бывает.");
  const problems = await password.validate(plainPassword, clean);
  if (problems.length) throw new Error(problems.join(" "));
  if (await getUser(clean)) throw new Error("Такой пользователь уже есть.");

  const user = {
    email: clean,
    role,
    passwordHash: password.hash(plainPassword),
    createdAt: new Date().toISOString()
  };
  await putUser(user);
  return { user };
}

/* --------------------------------------------------------------- */
/* Перебор паролей                                                  */
/* --------------------------------------------------------------- */

async function lockState(email, ip) {
  const keys = ["fail:mail:" + String(email).toLowerCase(), "fail:ip:" + ip];
  const left = [];
  for (const k of keys) {
    const n = Number(await kv.getJson(k) || 0);
    if (n >= MAX_FAILS) left.push(await kv.ttl(k));
  }
  if (!left.length) return { locked: false };
  return { locked: true, seconds: Math.max(...left.filter(x => x > 0), LOCK_TTL) };
}

async function noteFailure(email, ip) {
  const mailKey = "fail:mail:" + String(email).toLowerCase();
  const n = await kv.incrWithTtl(mailKey, LOCK_TTL);
  await kv.incrWithTtl("fail:ip:" + ip, LOCK_TTL);
  return { count: n, justLocked: n === MAX_FAILS };
}

async function clearFailures(email, ip) {
  await kv.del("fail:mail:" + String(email).toLowerCase(), "fail:ip:" + ip);
}

/* --------------------------------------------------------------- */
/* Сессии                                                           */
/* --------------------------------------------------------------- */

/* В хранилище лежит не сам токен, а его хеш. Если однажды кто-то
   прочитает базу, войти по её содержимому он всё равно не сможет. */
const tokenKey = token => "sess:" + crypto.createHash("sha256").update(token).digest("hex");

async function startSession(user) {
  const token = crypto.randomBytes(32).toString("base64url");
  const csrf = crypto.randomBytes(32).toString("base64url");
  await kv.setJson(tokenKey(token), {
    email: user.email,
    role: user.role,
    csrf,
    startedAt: Date.now()
  }, SESSION_TTL);
  return { token, csrf };
}

async function readSession(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const data = await kv.getJson(tokenKey(token));
  if (!data) return null;
  /* Срок жизни держит хранилище, но проверим и здесь: ключ мог быть
     записан без срока по ошибке, и тогда сессия жила бы вечно. */
  if (Date.now() - data.startedAt > SESSION_TTL * 1000) {
    await kv.del(tokenKey(token));
    return null;
  }
  return Object.assign({}, data, { token });
}

async function endSession(req) {
  const token = readCookie(req, COOKIE);
  if (token) await kv.del(tokenKey(token));
}

/* --------------------------------------------------------------- */
/* Cookie                                                           */
/* --------------------------------------------------------------- */

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function cookieHeaders({ token, csrf }, secure) {
  const base = `Path=/; SameSite=Strict; Max-Age=${SESSION_TTL}` + (secure ? "; Secure" : "");
  return [
    /* Токен сессии скрипту не виден: даже если на страницу попадёт
       чужой код, украсть сессию он не сможет. */
    `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; ${base}`,
    /* А этот виден нарочно: скрипт панели читает его и присылает
       обратно заголовком. Совпадение и есть доказательство, что
       запрос пришёл со страницы панели, а не с чужого сайта. */
    `${CSRF_COOKIE}=${encodeURIComponent(csrf)}; ${base}`
  ];
}

function clearCookies(secure) {
  const base = `Path=/; SameSite=Strict; Max-Age=0` + (secure ? "; Secure" : "");
  return [`${COOKIE}=; HttpOnly; ${base}`, `${CSRF_COOKIE}=; ${base}`];
}

/* --------------------------------------------------------------- */
/* Вход                                                             */
/* --------------------------------------------------------------- */

async function login({ email, plainPassword, ip }) {
  const clean = String(email || "").trim().toLowerCase();

  const lock = await lockState(clean, ip);
  if (lock.locked) {
    return { ok: false, locked: true,
             error: `Слишком много неудачных попыток. Вход закрыт ещё на ${Math.ceil(lock.seconds / 60)} мин.` };
  }

  const user = await getUser(clean);
  /* Хеш считается и тогда, когда пользователя нет: иначе по времени
     ответа можно было бы понять, какие адреса заведены. */
  const passwordOk = password.check(String(plainPassword || ""), user && user.passwordHash);

  if (!user || !passwordOk) {
    const fail = await noteFailure(clean, ip);
    return {
      ok: false,
      /* Одинаковый ответ на «нет такого пользователя» и «неверный
         пароль»: иначе по ответу собирается список заведённых адресов. */
      error: "Почта или пароль неверны." +
             (fail.count >= 3 && fail.count < MAX_FAILS
               ? ` Осталось попыток: ${MAX_FAILS - fail.count}.` : ""),
      justLocked: fail.justLocked,
      email: clean
    };
  }

  await clearFailures(clean, ip);
  const session = await startSession(user);
  return { ok: true, user: { email: user.email, role: user.role }, session };
}

module.exports = {
  ROLES, SESSION_HOURS, MAX_FAILS, LOCK_MINUTES, COOKIE, CSRF_COOKIE,
  getUser, putUser, createUser, login, readSession, endSession,
  readCookie, cookieHeaders, clearCookies, lockState
};
