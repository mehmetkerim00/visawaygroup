/*
 * kv.js — хранилище панели.
 *
 * ПОЧЕМУ KV, А НЕ POSTGRES
 *
 * Данных здесь мало и они несвязные: 72 документа с требованиями,
 * два-три пользователя, несколько сессий. Ни одного запроса, ради
 * которого нужен SQL: список из 72 записей читается целиком и
 * фильтруется в памяти быстрее, чем формулируется запрос.
 *
 * Зато есть две вещи, где KV заметно удобнее:
 *   — сессии и блокировка входа живут по таймеру. В Redis срок жизни
 *     ключа встроен, в SQL пришлось бы держать поле expires_at и
 *     вручную подчищать протухшее;
 *   — обращение идёт по HTTPS, без драйвера и без пула соединений.
 *     Пул соединений к Postgres из бессерверных функций — известная
 *     морока: функций много, соединений мало, и они кончаются.
 *
 * Поэтому: Vercel KV (Upstash Redis) через его REST-интерфейс.
 * Ни одной зависимости ради самого хранилища.
 *
 * РЕЖИМ РАЗРАБОТКИ. Без ключей KV модуль работает с файлом на диске —
 * чтобы панель можно было запустить и проверить у себя на компьютере.
 * На сервере такой режим запрещён: там файловая система временная,
 * и запись в неё молча потерялась бы.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const REST_URL = process.env.KV_REST_API_URL || "";
const REST_TOKEN = process.env.KV_REST_API_TOKEN || "";
const ON_SERVER = !!process.env.VERCEL;

if (ON_SERVER && !REST_URL) {
  throw new Error("нет KV_REST_API_URL — панели негде хранить данные");
}

/* ---------------------------------------------------------------- */
/* Боевой режим: Upstash по HTTPS                                    */
/* ---------------------------------------------------------------- */

async function callRest(command) {
  const res = await fetch(REST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });
  if (!res.ok) {
    throw new Error(`хранилище ответило ${res.status}`);
  }
  const data = await res.json();
  if (data.error) throw new Error("хранилище: " + data.error);
  return data.result;
}

/* ---------------------------------------------------------------- */
/* Режим разработки: один файл на диске                              */
/* ---------------------------------------------------------------- */

const DEV_FILE = process.env.ADMIN_DEV_STORE ||
  path.join(require("os").tmpdir(), "visaway-admin-dev.json");

function devRead() {
  try {
    return JSON.parse(fs.readFileSync(DEV_FILE, "utf8"));
  } catch (e) {
    return {};
  }
}

function devWrite(store) {
  fs.writeFileSync(DEV_FILE, JSON.stringify(store, null, 1), "utf8");
}

/* Протухшее не отдаём — так же, как это делает Redis */
function devAlive(store, key) {
  const rec = store[key];
  if (!rec) return null;
  if (rec.exp && Date.now() > rec.exp) {
    delete store[key];
    devWrite(store);
    return null;
  }
  return rec;
}

async function callDev(command) {
  const [cmd, ...args] = command;
  const store = devRead();
  const name = String(cmd).toUpperCase();

  if (name === "GET") {
    const rec = devAlive(store, args[0]);
    return rec ? rec.v : null;
  }
  if (name === "SET") {
    const rec = { v: args[0 + 1] !== undefined ? args[1] : null, exp: 0 };
    /* SET key value EX seconds */
    const exIndex = args.findIndex(a => String(a).toUpperCase() === "EX");
    if (exIndex !== -1) rec.exp = Date.now() + Number(args[exIndex + 1]) * 1000;
    store[args[0]] = rec;
    devWrite(store);
    return "OK";
  }
  if (name === "DEL") {
    let n = 0;
    for (const k of args) if (store[k]) { delete store[k]; n++; }
    devWrite(store);
    return n;
  }
  if (name === "INCR") {
    const rec = devAlive(store, args[0]) || { v: "0", exp: 0 };
    rec.v = String(Number(rec.v || 0) + 1);
    store[args[0]] = rec;
    devWrite(store);
    return Number(rec.v);
  }
  if (name === "EXPIRE") {
    const rec = devAlive(store, args[0]);
    if (!rec) return 0;
    rec.exp = Date.now() + Number(args[1]) * 1000;
    devWrite(store);
    return 1;
  }
  if (name === "TTL") {
    const rec = devAlive(store, args[0]);
    if (!rec) return -2;
    if (!rec.exp) return -1;
    return Math.max(0, Math.round((rec.exp - Date.now()) / 1000));
  }
  if (name === "KEYS") {
    const rx = new RegExp("^" + String(args[0]).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
    return Object.keys(store).filter(k => rx.test(k) && devAlive(store, k));
  }
  if (name === "MGET") {
    return args.map(k => { const r = devAlive(store, k); return r ? r.v : null; });
  }
  throw new Error("режим разработки не умеет команду " + name);
}

const call = REST_URL ? callRest : callDev;

/* ---------------------------------------------------------------- */
/* Что от хранилища нужно панели                                     */
/* ---------------------------------------------------------------- */

async function getJson(key) {
  const raw = await call(["GET", key]);
  if (raw === null || raw === undefined) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    return null;
  }
}

async function setJson(key, value, ttlSeconds) {
  const cmd = ["SET", key, JSON.stringify(value)];
  if (ttlSeconds) cmd.push("EX", String(ttlSeconds));
  return call(cmd);
}

async function del(...keys) {
  if (!keys.length) return 0;
  return call(["DEL", ...keys]);
}

async function incrWithTtl(key, ttlSeconds) {
  const n = await call(["INCR", key]);
  if (Number(n) === 1 && ttlSeconds) await call(["EXPIRE", key, String(ttlSeconds)]);
  return Number(n);
}

async function ttl(key) {
  return Number(await call(["TTL", key]));
}

async function keys(pattern) {
  const list = await call(["KEYS", pattern]);
  return Array.isArray(list) ? list : [];
}

async function mgetJson(list) {
  if (!list.length) return [];
  const raw = await call(["MGET", ...list]);
  return (raw || []).map(v => {
    if (v === null || v === undefined) return null;
    try { return typeof v === "string" ? JSON.parse(v) : v; } catch (e) { return null; }
  });
}

module.exports = { getJson, setJson, del, incrWithTtl, ttl, keys, mgetJson, isDev: !REST_URL };
