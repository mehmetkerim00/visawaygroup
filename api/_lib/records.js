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
    blockers: blockersFor(entry)
  };
}

/* Что мешает поставить «проверено». Один список на всю панель: и кнопка
   публикации, и preflight при сборке спрашивают одно и то же. */
function blockersFor(entry) {
  const out = [];
  const todo = core.todos(entry);
  if (todo.length) out.push(`Осталось меток УТОЧНИТЬ: ${todo.length}.`);
  const empty = core.emptyFields(entry);
  if (empty.length) out.push("Не заполнены поля: " + empty.join(", ") + ".");
  if (!String(entry.checkedOn || "").trim()) out.push("Не поставлена дата проверки.");
  const money = core.amountNeedsDate(entry);
  if (money) out.push(`Вписана ${money.ru}, но не сказано, когда проверяли сумму.`);
  return out;
}

module.exports = {
  VISAS, VISA_NAMES, BY_CODE, countriesData,
  validPair, getRecord, putRecord, listRecords, summarize, blockersFor,
  getLabels, setLabels, recKey
};
