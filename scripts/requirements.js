#!/usr/bin/env node
/*
 * requirements.js — страницы требований по странам внутри типа визы.
 *
 * Из data/requirements.json собираются страницы
 * wizalar/{виза}/{страна}.html на трёх языках и блок выбора страны
 * на самой странице визы.
 *
 * СТАТУС НА ВИДИМОСТЬ НЕ ВЛИЯЕТ. Раньше страница собиралась только из
 * записи со статусом verified, а черновики физически отсутствовали.
 * Теперь собираются все: владелец решил выкладывать как есть.
 *
 * Взамен страницы защищены иначе, и это важнее прежнего разделения:
 *   — незаполненные поля и пункты с меткой УТОЧНИТЬ наружу не выходят
 *     (правила в api/_lib/core.js), так что недоделка не показывается;
 *   — вверху каждой страницы стоит предупреждение, что сведения общие;
 *   — страницы закрыты от поиска пометкой noindex и не стоят в карте
 *     сайта: они доступны по ссылке, но не приводят человека из поиска
 *     на непроверенный текст.
 *
 * Поле статуса и дата проверки в данных остаются — они понадобятся,
 * когда специалист пройдётся по записям.
 *
 * Сам по себе этот файл ничего не делает — его вызывает scripts/build.js.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { ROOT, LANGS, DEFAULT_LANG, joinLang, relLink } = require("./lib-site");
/* Правила и отрисовка — общие с панелью. Держать их в двух местах
   нельзя: однажды разойдутся, и разойдутся молча. */
const core = require("../api/_lib/core.js");

const REQ_FILE = path.join(ROOT, "data", "requirements.json");
const COUNTRIES_FILE = path.join(ROOT, "data", "countries.json");


/* ==================================================================== */
/* Чтение данных                                                        */
/* ==================================================================== */

let cache = null;

function load() {
  if (cache) return cache;
  if (!fs.existsSync(REQ_FILE)) {
    throw new Error("нет data/requirements.json — собирать нечего");
  }
  const req = JSON.parse(fs.readFileSync(REQ_FILE, "utf8"));
  const countries = JSON.parse(fs.readFileSync(COUNTRIES_FILE, "utf8"));
  const byCode = new Map(countries.countries.map(c => [c.flag, c]));

  for (const e of req.entries || []) {
    if (!byCode.has(e.country)) {
      throw new Error(`в data/requirements.json страна "${e.country}" — такой нет в data/countries.json`);
    }
    if (e.status !== "draft" && e.status !== "verified") {
      throw new Error(`у записи ${e.visa}/${e.country} статус "${e.status}", а бывает только draft или verified`);
    }
    if (!fs.existsSync(path.join(ROOT, "wizalar", e.visa + ".html"))) {
      throw new Error(`в data/requirements.json виза "${e.visa}" — такой страницы нет`);
    }
  }
  cache = { req, countries: countries.countries, byCode, labels: req.labels };
  return cache;
}

function pick(obj, lang) {
  if (!obj) return "";
  return obj[lang] || obj[DEFAULT_LANG] || "";
}

/* Всё это считает api/_lib/core.js — здесь только имена, под которыми
   оно уже знакомо остальным скриптам. */
const {
  TODO_MARK, todos, KIND_FIELDS, kindOf, mustFill, MONEY, amountNeedsDate,
  feeNeedsDate, monthsSince, STALE_MONTHS, isStale, emptyFields,
  esc, escAttr, formatDate, factRow
} = core;

/* Путь страницы требований от корня сайта */
function pagePath(entry, lang, data) {
  const slug = data.byCode.get(entry.country).slug;
  return joinLang(`wizalar/${entry.visa}/${slug}.html`, lang);
}

/* Все пути, которые этот раздел вообще может занять. Нужны сборщику,
   чтобы убрать со диска страницы, которых в этой сборке быть не должно. */
function allPaths(data) {
  const out = [];
  for (const e of (data.req.entries || [])) {
    for (const lang of LANGS) out.push(pagePath(e, lang, data));
  }
  return out;
}

function entriesFor(visa, data) {
  return (data.req.entries || []).filter(e => e.visa === visa);
}

/* Есть ли в записи незакрытые вопросы специалисту */
/* ==================================================================== */
/* Сборка страницы                                                      */
/* ==================================================================== */

/* Название визы берём из её же страницы — чтобы оно было ровно одно
   и не разъехалось с заголовком раздела. */
const visaTitles = new Map();
function visaTitle(visa, lang) {
  const key = visa + "|" + lang;
  if (visaTitles.has(key)) return visaTitles.get(key);
  const file = path.join(ROOT, joinLang(`wizalar/${visa}.html`, lang));
  const html = fs.readFileSync(file, "utf8");
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  if (!m) throw new Error(`на странице ${file} нет <h1> — не из чего взять название визы`);
  const title = m[1].replace(/<[^>]*>/g, "").trim();
  visaTitles.set(key, title);
  return title;
}

/* Мостик к общей отрисовке: собирает ctx из того, что есть только при
   сборке, — названия визы со страницы и относительных ссылок. */
function pageBody(entry, lang, data, relPosix) {
  return core.mainContent(entry, lang, {
    labels: data.labels,
    country: data.byCode.get(entry.country),
    visaName: visaTitle(entry.visa, lang),
    links: {
      home: relLink(relPosix, joinLang("index.html", lang)),
      hub: relLink(relPosix, joinLang("wizalar.html", lang)),
      visaPage: relLink(relPosix, joinLang(`wizalar/${entry.visa}.html`, lang)),
      contacts: relLink(relPosix, joinLang("habarlasmak.html", lang))
    }
  });
}


/* Готовая страница. За основу берётся страница самой визы: так шапка,
   подвал, набор иконок и все метки блоков остаются ровно такими же, как
   на остальном сайте, и их потом обновит sync-layout. */
/* Хвост описания, когда своего текста у записи ещё нет. Ничего не
   обещает и ничего не выдумывает — просто говорит, о чём страница. */
const DESCR_TAIL = {
  tk: "resminamalar we tabşyryş tertibi. VisaWay Group, Aşgabat.",
  ru: "документы и порядок подачи. VisaWay Group, Ашхабад.",
  en: "documents and how to apply. VisaWay Group, Ashgabat."
};

function renderPage(entry, lang, data) {
  const relPosix = pagePath(entry, lang, data);
  const template = fs.readFileSync(path.join(ROOT, joinLang(`wizalar/${entry.visa}.html`, lang)), "utf8");
  const country = data.byCode.get(entry.country);
  const countryName = pick(country.country, lang);
  const visaName = visaTitle(entry.visa, lang);

  const title = `${countryName} — ${visaName} — VisaWay Group`;
  /* Описание берём из краткого текста записи. Если он пуст или в нём
     осталась метка специалиста — на страницу такое не выносим, поэтому
     и в описание тоже: вместо него ровная строка из названий. */
  const summary = core.shown(entry.summary, lang);
  const descr = (summary || `${countryName} — ${visaName.toLocaleLowerCase(lang === "ru" ? "ru" : "en")}: ` +
                            DESCR_TAIL[lang])
    .replace(/\s+/g, " ").trim().slice(0, 155);

  let html = template;

  /* Заголовок и описание */
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*">/,
                      `<meta name="description" content="${escAttr(descr)}">`);

  /* Содержимое страницы */
  const body = pageBody(entry, lang, data, relPosix);
  html = html.replace(/(<main\b[^>]*>)[\s\S]*?(<\/main>)/, (m, open, close) =>
    `${open}\n${body}\n\n  ${close}`);

  /* Страница лежит на уровень глубже своей визы, поэтому ссылки на общие
     файлы надо увести на шаг выше. Их две группы: в <head> стили и значки,
     в конце <body> скрипты. Обе лежат вне блоков, и sync-layout их не
     трогает — пересчитывает он только то, что внутри меток.

     Правим именно общие файлы (assets, css, js, манифест), а не все
     ссылки подряд: ссылки на страницы внутри блоков сделает sync-layout
     сам, и лишняя правка тут только помешала бы. */
  const prefix = "../".repeat(relPosix.split("/").length - 1);
  html = html.replace(
    /(\s(?:href|src)=")(?:\.\.\/)+(assets\/|css\/|js\/|manifest\.webmanifest)/g,
    (m, head, file) => head + prefix + file);

  /* Пока специалист не прошёлся по записям, страницы не должны приводить
     человека из поиска. Открыть по ссылке можно, найти поиском — нет.
     Снимается это одной строкой отсюда и одной в build-seo.js. */
  html = html.replace(/<meta name="theme-color"/,
    `<meta name="robots" content="noindex, follow">\n  <meta name="theme-color"`);

  return html;
}

/* ==================================================================== */
/* Блок выбора страны на странице визы                                  */
/* ==================================================================== */

/* Те же карточки, что на главной, только проверенные страны и каждая —
   ссылка. Когда проверенных ещё нет, вместо сетки честная строка и
   кнопка на контакты: обещать несуществующие страницы нельзя. */
function pickerBlock(lang, visa, indent, relPosix, prefix) {
  const data = load();
  const L = k => pick(data.labels[k], lang);
  const i = indent;
  const list = entriesFor(visa, data);
  const out = [];
  const contacts = relLink(relPosix, joinLang("habarlasmak.html", lang));

  out.push(`${i}<section class="page-section picker" data-reveal>`);
  out.push(`${i}  <h2>${esc(L("pickCountry"))}</h2>`);

  if (!list.length) {
    out.push(`${i}  <p class="lead">${esc(L("noneYet"))}</p>`);
    out.push(`${i}  <p><a class="btn btn--primary" href="${contacts}">${esc(L("askUs"))}</a></p>`);
    out.push(`${i}</section>`);
    return out.join("\n");
  }

  /* Кнопки стран. Каждая — настоящая ссылка на отдельную страницу этой
     страны: без JavaScript нажатие просто уведёт туда, и выбор работает.
     С JavaScript переход перехватывается, и содержимое подменяется на
     месте. Так один и тот же набор кнопок годится в обоих случаях. */
  out.push(`${i}  <div class="picker__bar" role="tablist" aria-label="${escAttr(L("pickCountry"))}">`);
  list.forEach((e, n) => {
    const c = data.byCode.get(e.country);
    const slug = c.slug;
    const href = relLink(relPosix, pagePath(e, lang, data));
    const first = n === 0;
    out.push(`${i}    <a class="picker__chip${first ? " is-on" : ""}" role="tab" href="${href}"` +
             ` id="tab-${slug}" data-country="${slug}" aria-controls="panel-${slug}"` +
             ` aria-selected="${first ? "true" : "false"}" tabindex="${first ? "0" : "-1"}">` +
             `<img class="picker__flag" src="${prefix}assets/flags/${c.flag}.svg" alt=""` +
             ` width="20" height="15" loading="lazy" decoding="async">` +
             `<span>${esc(pick(c.country, lang))}</span></a>`);
  });
  out.push(`${i}  </div>`);

  /* Оговорка стоит один раз над панелями, а не в каждой из двенадцати:
     она про весь раздел, и при переключении страны меняться ей незачем. */
  out.push(reindent(core.noticeBlock(lang), i + "  "));

  out.push(`${i}  <div class="picker__panels">`);
  list.forEach((e, n) => {
    const c = data.byCode.get(e.country);
    const ctx = {
      labels: data.labels,
      country: c,
      visaName: visaTitle(visa, lang),
      links: { contacts }
    };
    /* Первая страна открыта сразу: пустой блок не объясняет, что кнопки
       вообще можно нажимать. Остальные лежат рядом скрытыми — данные всех
       двенадцати уже в разметке, и переключение не ходит на сервер. */
    out.push(`${i}    <div class="picker__panel" id="panel-${c.slug}" role="tabpanel"` +
             ` aria-labelledby="tab-${c.slug}" data-country="${c.slug}"${n === 0 ? "" : " hidden"}>`);
    const секции = core.countrySections(e, lang, ctx, { level: "h3", reveal: false });
    for (const строка of секции) {
      if (строка !== "") out.push(reindent(строка, i + "      "));
    }
    out.push(`${i}    </div>`);
  });
  out.push(`${i}  </div>`);

  out.push(`${i}  <p class="countries__more"><span>${esc(L("notListed"))}</span>` +
           ` <a href="${contacts}">${esc(L("askUs"))}</a></p>`);
  out.push(`${i}</section>`);
  return out.join("\n");
}

/* Отступ у общей отрисовки свой, а в блоке выбора глубина другая.
   Сдвигаем целиком, сохраняя внутреннюю лесенку. */
function reindent(text, indent) {
  return String(text).split("\n")
    .map(строка => строка.trim() ? indent + строка.replace(/^ {0,10}/, "") : строка)
    .join("\n");
}

/* ==================================================================== */
/* Запись и уборка                                                      */
/* ==================================================================== */

function build() {
  const data = load();
  const written = [];
  const removed = [];
  const wanted = new Set();

  for (const e of data.req.entries || []) {
    for (const lang of LANGS) {
      const rel = pagePath(e, lang, data);
      wanted.add(rel);
      const file = path.join(ROOT, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const html = renderPage(e, lang, data);
      const old = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
      if (old !== html) { fs.writeFileSync(file, html, "utf8"); written.push(rel); }
    }
  }

  /* Всё, чего в этой сборке быть не должно, с диска убирается: страница
     удалённой или переименованной пары не должна остаться лежать. */
  for (const rel of allPaths(data)) {
    if (wanted.has(rel)) continue;
    const file = path.join(ROOT, rel);
    if (fs.existsSync(file)) { fs.unlinkSync(file); removed.push(rel); }
    const dir = path.dirname(file);
    if (fs.existsSync(dir) && !fs.readdirSync(dir).length) fs.rmdirSync(dir);
  }

  return { written, removed };
}

module.exports = {
  load, pick, pagePath, allPaths, entriesFor, todos, emptyFields,
  visaTitle, pickerBlock, build, feeNeedsDate, amountNeedsDate, monthsSince,
  isStale, formatDate, kindOf, mustFill, TODO_MARK, MONEY, STALE_MONTHS
};
