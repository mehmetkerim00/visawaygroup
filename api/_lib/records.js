/*
 * records.js — требования по странам в хранилище панели.
 *
 * Ключи:
 *   rec:<виза>:<страна>   одна пара
 *   meta:labels           подписи, общие для всех страниц
 *
 * data/requirements.json остаётся в проекте как формат выгрузки: из него
 * данные заносятся в базу первый раз и в него же выгружаются обратно,
 * чтобы сборка сайта работала как прежде и чтобы у правок был читаемый
 * снимок в репозитории.
 */

"use strict";

const kv = require("./kv.js");
const core = require("./core.js");
const countriesData = require("../../data/countries.json");

const BY_CODE = new Map(countriesData.countries.map(c => [c.flag, c]));
const VISAS = ["is-wizasy", "okuw-wizasy", "syyahat-wizasy",
               "myhmancylyk-wizasy", "isewurlik-wizasy", "bilim-maslahaty"];

const VISA_NAMES = {
  "is-wizasy":          { tk: "Iş wizasy", ru: "Рабочая виза", en: "Work visa" },
  "okuw-wizasy":        { tk: "Okuw wizasy", ru: "Учебная виза", en: "Student visa" },
  "syyahat-wizasy":     { tk: "Syýahatçylyk wizasy", ru: "Туристическая виза", en: "Tourist visa" },
  "myhmancylyk-wizasy": { tk: "Myhmançylyk wizasy", ru: "Гостевая виза", en: "Visitor visa" },
  "isewurlik-wizasy":   { tk: "Işewürlik wizasy", ru: "Деловая виза", en: "Business visa" },
  "bilim-maslahaty":    { tk: "Bilim maslahaty", ru: "Помощь студентам с поступлением", en: "Help with applying" }
};

const recKey = (visa, country) => `rec:${visa}:${country}`;

function validPair(visa, country) {
  return VISAS.includes(visa) && BY_CODE.has(country);
}

async function getLabels() {
  return (await kv.getJson("meta:labels")) || {};
}

async function setLabels(labels) {
  return kv.setJson("meta:labels", labels);
}

async function getRecord(visa, country) {
  if (!validPair(visa, country)) return null;
  return kv.getJson(recKey(visa, country));
}

async function putRecord(entry, who) {
  if (!validPair(entry.visa, entry.country)) throw new Error("Нет такой пары «виза + страна».");
  const saved = Object.assign({}, entry, {
    updatedAt: new Date().toISOString(),
    updatedBy: who || "не указан"
  });
  await kv.setJson(recKey(entry.visa, entry.country), saved);
  return saved;
}

async function listRecords() {
  const wanted = [];
  for (const visa of VISAS) {
    for (const c of countriesData.countries) wanted.push(recKey(visa, c.flag));
  }
  const values = await kv.mgetJson(wanted);
  return values.filter(Boolean);
}

/* ==================================================================== */
/* Этап записи                                                          */
/* ==================================================================== */

/* Три состояния, которые видит человек:
 *
 *   draft      черновик — виден только в панели, на сайте его нет;
 *   verified   проверено специалистом — готово, но на сайте ещё нет;
 *   published  опубликовано — страница есть на сайте.
 *
 * И одно четвёртое, без которого было бы вранье: changed — страница на
 * сайте есть, но с тех пор текст правили, и на сайте лежит старое.
 *
 * «Опубликовано» ставится не по факту нажатия кнопки, а после того как
 * страницу удалось открыть на живом сайте. Нажатие кнопки — это ещё не
 * публикация: сборка может не дойти до конца. */
function stateOf(entry) {
  if (entry.status !== "verified") return "draft";
  const pub = String(entry.publishedAt || "");
  if (!pub) return "verified";
  if (entry.updatedAt && entry.updatedAt > pub) return "changed";
  return "published";
}

const STATE_ORDER = ["draft", "verified", "published", "changed"];

/* Адрес страницы на сайте — тот же, что строит сборка */
function livePath(entry, lang) {
  const slug = (BY_CODE.get(entry.country) || {}).slug;
  const prefix = lang === "tk" ? "" : lang + "/";
  return `/${prefix}wizalar/${entry.visa}/${slug}.html`;
}

/* Короткая выжимка для списка в панели: всё, по чему там фильтруют
   и ищут, и ничего лишнего — список из 72 строк должен приходить одним
   лёгким ответом. */
function summarize(entry) {
  const c = BY_CODE.get(entry.country) || {};
  const todo = core.todos(entry).length;
  const empty = core.emptyFields(entry);
  const money = core.amountNeedsDate(entry);
  const stale = core.isStale(entry.checkedOn);
  return {
    visa: entry.visa,
    country: entry.country,
    state: stateOf(entry),
    publishedAt: entry.publishedAt || "",
    liveUrl: livePath(entry, "tk"),
    visaName: (VISA_NAMES[entry.visa] || {}).ru || entry.visa,
    countryName: (c.country || {}).ru || entry.country,
    kind: core.kindOf(entry),
    status: entry.status,
    stale,
    todo,
    empty,
    moneyNeedsDate: !!money,
    checkedOn: entry.checkedOn || "",
    checkedBy: entry.checkedBy || "",
    updatedAt: entry.updatedAt || "",
    updatedBy: entry.updatedBy || "",
    /* Готово ли к публикации — считается теми же правилами, что у preflight */
    blockers: blockersFor(entry).length
  };
}

/* Что мешает поставить «Проверено специалистом». Один список на всю
   панель: и кнопка публикации, и preflight при сборке спрашивают одно
   и то же.

   У каждого замечания сказано, к какому полю оно относится, — чтобы в
   панели по нему можно было прыгнуть прямо к этому полю, а не искать
   его глазами по длинной форме. */
function blockersFor(entry) {
  const out = [];
  const kind = core.kindOf(entry);

  for (const t of core.todos(entry)) {
    /* where[0].ru -> where ; documents[2].text.ru -> documents */
    const field = String(t.where || "").split(/[.[]/)[0] || "";
    out.push({ field, text: "Остался вопрос от разработчика: " + shorten(t.text) });
  }
  for (const f of core.emptyFields(entry)) {
    out.push({ field: f, text: "Не заполнено поле «" + (FIELD_TITLES[f] || f) + "»" });
  }
  if (!String(entry.checkedOn || "").trim()) {
    out.push({ field: "checkedOn", text: "Не поставлена дата проверки" });
  }
  const money = core.amountNeedsDate(entry);
  if (money) {
    out.push({ field: money.date,
               text: "Вписана " + money.ru + ", но не сказано, когда сумму проверяли" });
  }
  return out;
}

function shorten(text) {
  const clean = String(text).replace(/^УТОЧНИТЬ:\s*/, "").replace(/\s+/g, " ").trim();
  return clean.length > 70 ? clean.slice(0, 70) + "…" : clean;
}

/* Названия полей по-русски — те же, что человек видит в форме */
const FIELD_TITLES = {
  summary: "Краткое описание",
  where: "Куда подаётся",
  prepDays: "Сколько мы готовим документы",
  reviewDays: "Сколько рассматривает консульство",
  fee: "Консульский сбор",
  recognition: "Признание диплома в Туркменистане",
  admissionDates: "Сроки поступления",
  language: "Языковые требования",
  tuition: "Примерная стоимость обучения",
  scholarships: "Стипендии и квоты",
  audience: "Кому подходит",
  documents: "Документы",
  notes: "Особенности",
  refusals: "Частые причины отказа",
  checkedOn: "Дата проверки",
  checkedBy: "Кто проверил"
};

module.exports = {
  VISAS, VISA_NAMES, BY_CODE, countriesData,
  validPair, getRecord, putRecord, listRecords, summarize, blockersFor, FIELD_TITLES,
  stateOf, livePath, STATE_ORDER,
  getLabels, setLabels, recKey
};
