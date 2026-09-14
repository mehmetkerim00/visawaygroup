/*
 * http.js — общая обвязка всех обработчиков панели.
 *
 * Здесь собрано то, что иначе пришлось бы помнить в каждом файле:
 * заголовки безопасности, разбор тела запроса, проверка сессии,
 * проверка подделки запроса и единый вид ответа об ошибке.
 *
 * Правило простое: обработчик не пишет в ответ ничего сам, он либо
 * возвращает данные, либо бросает fail(). Тогда невозможно случайно
 * отдать ответ без заголовков.
 */

"use strict";

const auth = require("./auth.js");

const SECURE = !!process.env.VERCEL;

/* Ошибка, которую видно человеку. Всё остальное наружу не выходит:
   текст настоящего сбоя уходит в журнал, а посетитель получает
   «что-то пошло не так» — иначе сообщения об ошибках становятся
   подсказкой для того, кто ищет вход. */
class Fail extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra || null;
  }
}
const fail = (status, message, extra) => { throw new Fail(status, message, extra); };

/* --------------------------------------------------------------- */
/* Заголовки                                                        */
/* --------------------------------------------------------------- */

/* Строгая политика содержимого. Панель не грузит ничего со стороны:
   ни шрифтов, ни картинок, ни скриптов — поэтому 'self' и всё.
   'unsafe-inline' нет нарочно: встроенных обработчиков в разметке
   панели тоже нет. */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  /* Панель показывает предпросмотр в рамке, и это её собственный адрес */
  "frame-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'"
].join("; ");

function secureHeaders(res, { frame = "DENY", frameAncestors = "'none'" } = {}) {
  res.setHeader("Content-Security-Policy",
    CSP.replace("frame-ancestors 'none'", "frame-ancestors " + frameAncestors));
  res.setHeader("X-Frame-Options", frame);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
  /* Панель нигде не должна оказаться в поиске */
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  /* Ответы панели не кладутся в кэш ни браузером, ни посредником */
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (SECURE) {
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
}

/* --------------------------------------------------------------- */
/* Запрос                                                           */
/* --------------------------------------------------------------- */

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    /* Ограничение на размер: без него любой может прислать гигабайт
       и занять память функции. Требования с документами — это единицы
       килобайт, 256 КБ хватает с большим запасом. */
    if (size > 256 * 1024) fail(413, "Слишком много данных за один раз.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (e) {
    fail(400, "Не удалось разобрать запрос.");
  }
}

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "неизвестно";
}

/* --------------------------------------------------------------- */
/* Сессия и роли                                                    */
/* --------------------------------------------------------------- */

async function requireSession(req) {
  const session = await auth.readSession(req);
  if (!session) fail(401, "Нужно войти заново.");
  return session;
}

function requireRole(session, role) {
  if (session.role !== role) fail(403, "Это может только владелец.");
}

/* Подделка запроса с чужого сайта. SameSite=Strict у cookie уже не даёт
   браузеру их отправить, но полагаться на одну защиту нельзя: старые
   браузеры и редкие случаи SameSite не покрывает. Поэтому второе:
   скрипт панели читает свой csrf-cookie и присылает его заголовком.
   Чужой сайт cookie прочитать не может, значит и заголовок не составит. */
function requireCsrf(req, session) {
  const sent = req.headers["x-csrf-token"];
  if (!sent || typeof sent !== "string" || sent !== session.csrf) {
    fail(403, "Запрос не прошёл проверку. Обновите страницу и повторите.");
  }
}

/* --------------------------------------------------------------- */
/* Ответ                                                            */
/* --------------------------------------------------------------- */

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

/* Обёртка вокруг обработчика: ставит заголовки, ловит ошибки и не даёт
   подробностям сбоя уехать к тому, кто его вызвал. */
function handler(fn, { methods = ["GET"], frame, frameAncestors } = {}) {
  return async (req, res) => {
    secureHeaders(res, { frame, frameAncestors });
    try {
      if (!methods.includes(req.method)) {
        res.setHeader("Allow", methods.join(", "));
        fail(405, "Так к этому адресу обращаться нельзя.");
      }
      await fn(req, res);
    } catch (e) {
      if (e instanceof Fail) {
        send(res, e.status, Object.assign({ error: e.message }, e.extra || {}));
        return;
      }
      /* Настоящая причина остаётся в журнале сервера */
      console.error("сбой обработчика:", e && e.stack ? e.stack : e);
      send(res, 500, { error: "Что-то пошло не так. Попробуйте ещё раз." });
    }
  };
}

/* Адрес сайта, каким его видит посетитель.
 *
 * Нужен, чтобы панель могла показать специалисту, где именно окажется
 * его текст. Берём PUBLIC_SITE_URL, если он задан; иначе — тот хост, по
 * которому открыта сама панель: она живёт на том же домене, что и сайт. */
function siteBase(req) {
  if (process.env.PUBLIC_SITE_URL) {
    return String(process.env.PUBLIC_SITE_URL).replace(/\/+$/, "");
  }
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const proto = req.headers["x-forwarded-proto"] || (SECURE ? "https" : "http");
  return host ? proto + "://" + host : "";
}

module.exports = {
  Fail, fail, handler, send, readBody, clientIp, siteBase,
  requireSession, requireRole, requireCsrf, secureHeaders, SECURE, CSP
};
