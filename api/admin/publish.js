/*
 * publish.js — кнопка «Опубликовать».
 *
 * Что происходит при нажатии:
 *   1. собираем записи, которых на сайте ещё нет в нынешнем виде;
 *   2. дёргаем у Vercel ссылку пересборки. Он собирает сайт заново,
 *      уже беря требования из базы (см. scripts/build-vercel.js);
 *   3. владельцу уходит письмо.
 *
 * Если сборка упадёт — Vercel не заменит сайт, и посетители продолжат
 * видеть прежнюю версию. Это его обычное поведение, специально ничего
 * делать не нужно.
 *
 * GET на этот же адрес говорит, доехало ли: он просто открывает
 * страницы на живом сайте и смотрит, отвечают ли они. Пометка
 * «опубликовано» ставится по этому ответу, а не по факту нажатия
 * кнопки: нажатие — ещё не публикация.
 */

"use strict";

const http = require("../_lib/http.js");
const kv = require("../_lib/kv.js");
const records = require("../_lib/records.js");
const notify = require("../_lib/notify.js");

const RUN_KEY = "publish:run";

function siteUrl(req) {
  if (process.env.PUBLIC_SITE_URL) return String(process.env.PUBLIC_SITE_URL).replace(/\/+$/, "");
  var host = req.headers["x-forwarded-host"] || req.headers.host || "";
  var proto = req.headers["x-forwarded-proto"] || (http.SECURE ? "https" : "http");
  return host ? proto + "://" + host : "";
}

async function waiting() {
  const all = await records.listRecords();
  return all.filter(e => records.stateOf(e) === "changed");
}

module.exports = http.handler(async (req, res) => {
  const session = await http.requireSession(req);

  /* ---------------- Что сейчас происходит ---------------- */
  if (req.method === "GET") {
    const run = await kv.getJson(RUN_KEY);
    const base = siteUrl(req);
    const pending = await waiting();

    /* Проверяем по живому сайту, а не по своим записям */
    let live = [];
    if (run && run.records && run.records.length) {
      live = await Promise.all(run.records.map(async pair => {
        const [visa, country] = pair.split("|");
        const entry = await records.getRecord(visa, country);
        if (!entry) return null;
        const url = base + records.livePath(entry, "tk");
        let ok = false;
        try {
          const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(6000) });
          ok = r.status === 200;
        } catch (e) { ok = false; }
        if (ok && records.stateOf(entry) !== "published") {
          entry.publishedAt = new Date().toISOString();
          await records.putRecord(entry, entry.updatedBy || session.email);
        }
        return { visa, country, url, live: ok,
                 title: (records.BY_CODE.get(country).country || {}).ru + " — " +
                        ((records.VISA_NAMES[visa] || {}).ru || visa).toLowerCase() };
      }));
      live = live.filter(Boolean);
    }

    http.send(res, 200, {
      running: !!(run && live.length && live.some(x => !x.live)),
      startedAt: run ? run.startedAt : null,
      startedBy: run ? run.startedBy : null,
      pages: live,
      waiting: pending.length,
      site: base
    });
    return;
  }

  /* ---------------- Запуск публикации ---------------- */
  http.requireCsrf(req, session);

  const pending = await waiting();
  if (!pending.length) {
    http.fail(422, "Публиковать нечего: на сайте уже лежит то же, что в панели.");
  }

  /* Незакрытые замечания публикацию больше не останавливают. Пустые поля
     и пункты с меткой УТОЧНИТЬ на страницу не выходят вовсе (правила в
     api/_lib/core.js), так что недоделку они показать не могут. В панели
     эти места по-прежнему подсвечены — там они и нужны. */

  const hook = process.env.VERCEL_DEPLOY_HOOK;
  if (!hook) {
    http.fail(501, "Публикация не настроена: владельцу нужно добавить ссылку пересборки (VERCEL_DEPLOY_HOOK). Как — в ADMIN.md.");
  }

  let hookOk = false, hookNote = "";
  try {
    const r = await fetch(hook, { method: "POST", signal: AbortSignal.timeout(10000) });
    hookOk = r.ok;
    if (!r.ok) hookNote = "хостинг ответил " + r.status;
  } catch (e) {
    hookNote = e.message;
  }
  if (!hookOk) {
    http.fail(502, "Не удалось запустить сборку: " + (hookNote || "нет ответа от хостинга") +
                   ". Сайт не тронут, попробуйте ещё раз.");
  }

  const run = {
    startedAt: new Date().toISOString(),
    startedBy: session.email,
    records: pending.map(e => e.visa + "|" + e.country)
  };
  /* Запись о запуске живёт полчаса: дольше сборка не идёт, а вечная
     запись потом путала бы «сейчас собирается» с «собиралось вчера». */
  await kv.setJson(RUN_KEY, run, 1800);

  await notify.published({
    who: session.email,
    count: pending.length,
    list: pending.map(e => (records.BY_CODE.get(e.country).country || {}).ru + " — " +
                           ((records.VISA_NAMES[e.visa] || {}).ru || e.visa).toLowerCase())
  });

  http.send(res, 200, { ok: true, started: run.startedAt, count: pending.length });
}, { methods: ["GET", "POST"] });
