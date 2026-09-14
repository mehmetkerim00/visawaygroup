/*
 * record.js — одна пара «виза + страна»: прочитать и сохранить.
 *
 * Сохранение проверяет всё, что приходит: и что пара существует, и что
 * поля те, какие бывают у записи такого устройства. Текст не разбирается
 * и не исполняется — он кладётся как есть, а экранируется при выводе
 * (api/_lib/core.js, функции esc и escAttr). Так текст остаётся текстом
 * на всём пути: в базе лежит то, что напечатал человек, а на странице
 * появляется безопасная разметка.
 */

"use strict";

const http = require("../_lib/http.js");
const records = require("../_lib/records.js");
const core = require("../_lib/core.js");

const LANGS = core.LANGS;

/* Поля, которые панель вправе менять. Всё, чего нет в этом списке,
   в запись не попадёт, даже если придёт в запросе. */
const TEXT_FIELDS_COMMON = ["summary"];
const TEXT_FIELDS = {
  visa: ["where", "prepDays", "reviewDays", "fee"],
  education: ["recognition", "admissionDates", "language", "tuition", "scholarships"]
};
const LIST_FIELDS = ["audience", "notes", "refusals"];
const PLAIN_FIELDS = { visa: ["feeCheckedOn"], education: ["tuitionCheckedOn"] };

function trioOf(value) {
  const out = {};
  for (const l of LANGS) out[l] = typeof (value || {})[l] === "string" ? (value[l] || "").trim() : "";
  return out;
}

function cleanDate(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) http.fail(400, "Дата пишется как 2026-09-12.");
  const d = new Date(s + "T00:00:00Z");
  if (isNaN(d)) http.fail(400, "Такой даты не бывает.");
  if (d.getTime() > Date.now() + 86400000) http.fail(400, "Дата проверки не может быть в будущем.");
  return s;
}

function cleanDocuments(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 40).map(d => {
    const out = { required: d && d.required !== false, text: trioOf(d && d.text) };
    const note = trioOf(d && d.note);
    if (LANGS.some(l => note[l])) out.note = note;
    return out;
  }).filter(d => LANGS.some(l => d.text[l]));
}

function cleanList(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 30).map(trioOf).filter(x => LANGS.some(l => x[l]));
}

module.exports = http.handler(async (req, res) => {
  const session = await http.requireSession(req);
  const url = new URL(req.url, "http://panel");
  const visa = url.searchParams.get("visa") || "";
  const country = url.searchParams.get("country") || "";

  if (!records.validPair(visa, country)) http.fail(404, "Такой пары «виза + страна» нет.");

  if (req.method === "GET") {
    const entry = await records.getRecord(visa, country);
    if (!entry) http.fail(404, "Запись не найдена.");
    /* Адрес живой страницы — чтобы из карточки можно было сразу
       открыть то, что видит посетитель. */
    const host = req.headers["x-forwarded-host"] || req.headers.host || "";
    const proto = req.headers["x-forwarded-proto"] || (http.SECURE ? "https" : "http");
    const base = process.env.PUBLIC_SITE_URL
      ? String(process.env.PUBLIC_SITE_URL).replace(/\/+$/, "")
      : (host ? proto + "://" + host : "");

    http.send(res, 200, {
      entry,
      state: records.stateOf(entry),
      liveUrl: base + records.livePath(entry, "tk"),
      blockers: records.blockersFor(entry),
      kind: core.kindOf(entry),
      fields: {
        text: TEXT_FIELDS_COMMON.concat(TEXT_FIELDS[core.kindOf(entry)]),
        required: core.mustFill(entry),
        money: core.MONEY[core.kindOf(entry)]
      },
      country: records.BY_CODE.get(country),
      visaName: records.VISA_NAMES[visa]
    });
    return;
  }

  /* Дальше — изменение. Значит, проверяем подделку запроса. */
  http.requireCsrf(req, session);
  const body = await http.readBody(req);
  const current = await records.getRecord(visa, country);
  if (!current) http.fail(404, "Запись не найдена.");

  const kind = core.kindOf(current);
  const next = Object.assign({}, current);

  for (const f of TEXT_FIELDS_COMMON.concat(TEXT_FIELDS[kind])) {
    if (body[f] !== undefined) next[f] = trioOf(body[f]);
  }
  for (const f of PLAIN_FIELDS[kind]) {
    if (body[f] !== undefined) next[f] = cleanDate(body[f]);
  }
  for (const f of LIST_FIELDS) {
    if (body[f] !== undefined) next[f] = cleanList(body[f]);
  }
  if (body.documents !== undefined) next.documents = cleanDocuments(body.documents);
  if (body.checkedOn !== undefined) next.checkedOn = cleanDate(body.checkedOn);
  if (body.checkedBy !== undefined) next.checkedBy = String(body.checkedBy || "").trim().slice(0, 80);

  if (body.status !== undefined) {
    if (body.status !== "draft" && body.status !== "verified") {
      http.fail(400, "Состояние бывает только «черновик» или «проверено».");
    }
    /* Поставить «проверено» можно только тому, что пройдёт публикацию.
       Та же проверка стоит и в preflight при сборке: если её обойти
       здесь, сборка всё равно не даст выложить — но человек узнает об
       этом позже и не поймёт почему. */
    if (body.status === "verified") {
      const problems = records.blockersFor(next);
      if (problems.length) {
        http.fail(422, "Пока нельзя пометить проверенным.", { blockers: problems });
      }
    }
    next.status = body.status;
  }

  const saved = await records.putRecord(next, session.email);
  http.send(res, 200, { ok: true, entry: saved, blockers: records.blockersFor(saved) });
}, { methods: ["GET", "PUT"] });
