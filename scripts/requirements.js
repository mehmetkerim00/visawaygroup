#!/usr/bin/env node
/*
 * requirements.js — страницы требований по странам внутри типа визы.
 *
 * Из data/requirements.json собираются страницы
 * wizalar/{виза}/{страна}.html на трёх языках и блок выбора страны
 * на самой странице визы.
 *
 * ГЛАВНОЕ ПРАВИЛО. Запись со статусом draft на опубликованный сайт не
 * попадает вообще: ни файлом, ни ссылкой, ни строкой в карте сайта.
 * Это сделано не стилями, а тем, что файла попросту нет на диске.
 * Спрятанное стилями всё равно уезжает на хостинг и всё равно
 * находится поиском — а недопроверенные требования по визам это
 * не просто некрасиво, это вводит человека в заблуждение.
 *
 * Черновики можно посмотреть локально:
 *     node scripts/build.js --drafts
 * Каждая такая страница помечена красной полосой и пометкой noindex.
 *
 * Сам по себе этот файл ничего не делает — его вызывает scripts/build.js.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { ROOT, LANGS, DEFAULT_LANG, joinLang, relLink } = require("./lib-site");

const REQ_FILE = path.join(ROOT, "data", "requirements.json");
const COUNTRIES_FILE = path.join(ROOT, "data", "countries.json");

const TODO_MARK = "УТОЧНИТЬ:";

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

function entriesFor(visa, data, withDrafts) {
  return (data.req.entries || [])
    .filter(e => e.visa === visa)
    .filter(e => withDrafts || e.status === "verified");
}

/* Есть ли в записи незакрытые вопросы специалисту */
function todos(entry) {
  const found = [];
  const walk = (v, where) => {
    if (typeof v === "string") {
      if (v.includes(TODO_MARK)) found.push({ where, text: v.trim() });
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${where}[${i}]`));
    } else if (v && typeof v === "object") {
      for (const k of Object.keys(v)) walk(v[k], where ? `${where}.${k}` : k);
    }
  };
  walk(entry, "");
  /* Один и тот же вопрос продублирован на три языка — считаем за один */
  const seen = new Set();
  return found.filter(f => (seen.has(f.text) ? false : seen.add(f.text)));
}

/* Поля, которые специалист обязан заполнить перед тем, как ставить verified */
const MUST_FILL = ["where", "prepDays", "reviewDays", "fee"];

function emptyFields(entry) {
  return MUST_FILL.filter(k => LANGS.every(l => !String(pick(entry[k], l)).trim()));
}


/* ==================================================================== */
/* Сборка страницы                                                      */
/* ==================================================================== */

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escAttr(s) { return esc(s).replace(/"/g, "&quot;"); }

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

/* Красная полоса черновика. Стили прямо в ней: в общие файлы стилей
   им нельзя — те уезжают на хостинг, а всё про черновики должно
   оставаться только на рабочем компьютере. */
function draftBar(lang) {
  const text = {
    tk: "ÇYNLAMA — HÜNÄRMEN TARAPYNDAN BARLANMADY",
    ru: "ЧЕРНОВИК — НЕ ПРОВЕРЕНО СПЕЦИАЛИСТОМ",
    en: "DRAFT — NOT CHECKED BY A SPECIALIST"
  };
  const css = ".draftbar{position:sticky;top:0;z-index:300;display:block;padding:14px 16px;" +
    "background:#B3261E;color:#fff;font:700 clamp(.9rem,3.4vw,1.15rem)/1.25 system-ui,sans-serif;" +
    "letter-spacing:.04em;text-align:center;text-transform:uppercase}" +
    ".draftbar small{display:block;margin-top:5px;color:#FFE9E6;font-weight:600;font-size:.82em;text-transform:none;letter-spacing:.01em}";
  const sub = {
    tk: "Bu sahypa diňe içerki gözden geçirmek üçin. Saýtda ýok.",
    ru: "Эта страница только для внутренней проверки. На сайте её нет.",
    en: "This page is for internal review only. It is not on the site."
  };
  return `      <div class="draftbar" role="alert"><style>${css}</style>` +
         `${esc(text[lang] || text.ru)}<small>${esc(sub[lang] || sub.ru)}</small></div>`;
}

function factRow(label, value, isDraft, emptyText) {
  const filled = String(value || "").trim();
  const shown = filled
    ? esc(filled)
    : (isDraft
        ? `<span style="color:#B3261E;font-weight:700">НЕ ЗАПОЛНЕНО</span>`
        : esc(emptyText));
  return [
    `            <li class="pricing__row">`,
    `              <span class="pricing__label">${esc(label)}</span>`,
    `              <span class="pricing__value">${shown}</span>`,
    `            </li>`
  ].join("\n");
}

function mainContent(entry, lang, data, relPosix) {
  const L = k => pick(data.labels[k], lang);
  const country = data.byCode.get(entry.country);
  const countryName = pick(country.country, lang);
  const visaName = visaTitle(entry.visa, lang);
  const isDraft = entry.status !== "verified";
  const out = [];
  const home = relLink(relPosix, joinLang("index.html", lang));
  const hub = relLink(relPosix, joinLang("wizalar.html", lang));
  const visaPage = relLink(relPosix, joinLang(`wizalar/${entry.visa}.html`, lang));
  const contacts = relLink(relPosix, joinLang("habarlasmak.html", lang));

  out.push(`    <article class="page page--service">`);
  if (isDraft) out.push(draftBar(lang));

  out.push(`
      <section class="page-hero">
        <div class="page-hero__art" aria-hidden="true">
          <svg viewBox="0 0 420 260" xmlns="http://www.w3.org/2000/svg" focusable="false">
            <path class="page-hero__line" d="M-10 232 C 90 214, 150 120, 250 88 C 320 66, 360 44, 412 22"
                  fill="none" stroke-width="2" stroke-linecap="round" stroke-dasharray="5 13"/>
            <circle class="page-hero__ring" cx="352" cy="46" r="17" fill="none" stroke-width="1.5"/>
            <circle class="page-hero__dot" cx="352" cy="46" r="5.5"/>
          </svg>
        </div>
        <div class="container container--narrow page-hero__inner">
          <nav class="breadcrumbs" aria-label="${escAttr(lang === "ru" ? "Навигация" : lang === "en" ? "Navigation" : "Nawigasiýa")}">
            <ol>
              <li><a href="${home}">${esc(lang === "ru" ? "Главная" : lang === "en" ? "Home" : "Baş sahypa")}</a></li>
              <li><a href="${hub}">${esc(lang === "ru" ? "Визы" : lang === "en" ? "Visas" : "Wizalar")}</a></li>
              <li><a href="${visaPage}">${esc(visaName)}</a></li>
              <li><span aria-current="page">${esc(countryName)}</span></li>
            </ol>
          </nav>

          <div class="page-hero__head" data-reveal>
            <p class="eyebrow">${esc(L("eyebrow"))}</p>
            <h1>${esc(countryName)} &mdash; ${esc(visaName.toLocaleLowerCase(lang === "ru" ? "ru" : "en"))}</h1>
            <p class="lead">${esc(pick(entry.summary, lang))}</p>
          </div>
        </div>
      </section>

      <div class="container container--narrow">`);

  if ((entry.audience || []).length) {
    out.push(`
        <section class="page-section" data-reveal>
          <h2>${esc(L("audience"))}</h2>
          <ul class="checklist">`);
    for (const a of entry.audience) out.push(`            <li>${esc(pick(a, lang))}</li>`);
    out.push(`          </ul>
        </section>`);
  }

  if ((entry.documents || []).length) {
    out.push(`
        <section class="page-section" data-reveal>
          <h2>${esc(L("documents"))}</h2>
          <ul class="doclist" data-reveal-group>`);
    for (const d of entry.documents) {
      const note = d.note ? pick(d.note, lang) : "";
      const extra = d.required === false ? L("optional") : "";
      const sub = [note, extra].filter(Boolean).join(" &middot; ");
      out.push(`            <li><svg class="icon doclist__icon" aria-hidden="true"><use href="#i-doc"/></svg>` +
               `<span>${esc(pick(d.text, lang))}` + (sub ? `<span>${sub}</span>` : "") + `</span></li>`);
    }
    out.push(`          </ul>
        </section>`);
  }

  out.push(`
        <section class="page-section" data-reveal>
          <h2>${esc(L("termsAndFee"))}</h2>
          <div class="pricing">
            <ul class="pricing__list">`);
  out.push(factRow(L("where"), pick(entry.where, lang), isDraft, L("empty")));
  out.push(factRow(L("prepDays"), pick(entry.prepDays, lang), isDraft, L("empty")));
  out.push(factRow(L("reviewDays"), pick(entry.reviewDays, lang), isDraft, L("empty")));
  out.push(factRow(L("fee"), pick(entry.fee, lang), isDraft, L("empty")));
  out.push(`            </ul>
            <a class="btn btn--primary pricing__cta" href="${contacts}">${esc(L("askUs"))}</a>
          </div>
        </section>`);

  for (const [key, list] of [["notes", entry.notes], ["refusals", entry.refusals]]) {
    if (!(list || []).length) continue;
    out.push(`
        <section class="page-section" data-reveal>
          <h2>${esc(L(key))}</h2>
          <ul class="checklist">`);
    for (const n of list) out.push(`            <li>${esc(pick(n, lang))}</li>`);
    out.push(`          </ul>
        </section>`);
  }

  const checkedOn = String(entry.checkedOn || "").trim();
  const checkedBy = String(entry.checkedBy || "").trim() || L("notChecked");
  out.push(`
        <section class="page-section" data-reveal>
          <p class="note-line">${esc(L("checked"))}: ${esc(checkedBy)}${checkedOn ? " &middot; " + esc(checkedOn) : ""}</p>
          <a class="backlink" href="${visaPage}">
            <svg class="icon icon--sm" aria-hidden="true"><use href="#i-arrow-left"/></svg>
            ${esc(L("backToVisa"))}
          </a>
        </section>

      </div>`);

  /* Блок призыва такой же, как на остальных страницах: его собирает
     sync-layout из партиала, здесь только метка и подписи. */
  out.push(`
      <!-- cta:start title="${escAttr(L("ctaTitle"))}" text="${escAttr(L("ctaText"))}" -->
      <!-- cta:end -->`);
  out.push(`    </article>`);
  return out.join("\n");
}


/* Готовая страница. За основу берётся страница самой визы: так шапка,
   подвал, набор иконок и все метки блоков остаются ровно такими же, как
   на остальном сайте, и их потом обновит sync-layout. Меняются только
   заголовок, описание и содержимое <main>. */
function renderPage(entry, lang, data) {
  const relPosix = pagePath(entry, lang, data);
  const template = fs.readFileSync(path.join(ROOT, joinLang(`wizalar/${entry.visa}.html`, lang)), "utf8");
  const country = data.byCode.get(entry.country);
  const countryName = pick(country.country, lang);
  const visaName = visaTitle(entry.visa, lang);
  const isDraft = entry.status !== "verified";

  const title = `${countryName} — ${visaName} — VisaWay Group`;
  const descr = String(pick(entry.summary, lang)).replace(/\s+/g, " ").trim().slice(0, 155);

  let html = template;

  /* Заголовок и описание */
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*">/,
                      `<meta name="description" content="${escAttr(descr)}">`);

  /* Содержимое страницы */
  const body = mainContent(entry, lang, data, relPosix);
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

  /* Черновик не должен попадать в поиск даже случайно — например, если
     кто-то откроет предпросмотр наружу. */
  if (isDraft) {
    html = html.replace(/<meta name="theme-color"/,
      `<meta name="robots" content="noindex, nofollow">\n  <meta name="theme-color"`);
  }

  return html;
}

/* ==================================================================== */
/* Блок выбора страны на странице визы                                  */
/* ==================================================================== */

/* Те же карточки, что на главной, только проверенные страны и каждая —
   ссылка. Когда проверенных ещё нет, вместо сетки честная строка и
   кнопка на контакты: обещать несуществующие страницы нельзя. */
function pickerBlock(lang, visa, indent, relPosix, prefix, withDrafts) {
  const data = load();
  const L = k => pick(data.labels[k], lang);
  const i = indent;
  const list = entriesFor(visa, data, withDrafts);
  const verified = entriesFor(visa, data, false).length;
  const out = [];
  const contacts = relLink(relPosix, joinLang("habarlasmak.html", lang));

  out.push(`${i}<section class="page-section" data-reveal>`);
  out.push(`${i}  <h2>${esc(L("pickCountry"))}</h2>`);

  if (!list.length) {
    out.push(`${i}  <p class="lead">${esc(L("noneYet"))}</p>`);
    out.push(`${i}  <p><a class="btn btn--primary" href="${contacts}">${esc(L("askUs"))}</a></p>`);
    out.push(`${i}</section>`);
    return out.join("\n");
  }

  out.push(`${i}  <p class="countries__count">${esc(L("checkedCount").replace("{{n}}", String(verified)))}</p>`);
  out.push(`${i}  <div class="countries countries--plain">`);
  /* На телефоне сетка превращается в ленту с прокруткой пальцем, поэтому
     ей нужен и способ прокрутки с клавиатуры: tabindex делает её точкой
     фокуса, и стрелки начинают листать карточки. */
  out.push(`${i}    <ul class="countries__grid" tabindex="0" role="group"` +
           ` aria-label="${escAttr(L("pickCountry"))}">`);
  for (const e of list) {
    const c = data.byCode.get(e.country);
    const name = pick(c.country, lang);
    const city = pick(c.city, lang);
    const alt = pick((data.req.labels.photoOf || {}), lang) || "";
    const href = relLink(relPosix, pagePath(e, lang, data));
    const draft = e.status !== "verified";
    const photo = c.photo ? path.join(ROOT, "assets", "photos", c.photo + ".webp") : null;
    const big = c.photo ? path.join(ROOT, "assets", "photos", c.photo + "@2x.webp") : null;

    out.push(`${i}      <li class="country">`);
    out.push(`${i}        <a class="country__link" href="${href}">`);
    out.push(`${i}          <div class="country__photo">`);
    if (photo && fs.existsSync(photo)) {
      out.push(`${i}            <picture>`);
      if (fs.existsSync(big)) {
        out.push(`${i}              <source media="(min-width: 64em)"` +
                 ` srcset="${prefix}assets/photos/${c.photo}.webp 480w, ${prefix}assets/photos/${c.photo}@2x.webp 960w"` +
                 ` sizes="300px">`);
      }
      out.push(`${i}              <img src="${prefix}assets/photos/${c.photo}.webp" alt=""` +
               ` width="480" height="320" loading="lazy" decoding="async">`);
      out.push(`${i}            </picture>`);
    }
    out.push(`${i}          </div>`);
    out.push(`${i}          <div class="country__label">`);
    out.push(`${i}            <img class="country__flag" src="${prefix}assets/flags/${c.flag}.svg"` +
             ` alt="" width="24" height="18" loading="lazy" decoding="async">`);
    out.push(`${i}            <span class="country__name">${esc(name)}</span>`);
    out.push(`${i}            <span class="country__city">${esc(city)}${draft ? " · ЧЕРНОВИК" : ""}</span>`);
    out.push(`${i}          </div>`);
    out.push(`${i}        </a>`);
    out.push(`${i}      </li>`);
  }
  out.push(`${i}    </ul>`);
  out.push(`${i}  </div>`);
  out.push(`${i}  <p class="countries__more"><span>${esc(L("notListed"))}</span>` +
           ` <a href="${contacts}">${esc(L("askUs"))}</a></p>`);
  out.push(`${i}</section>`);
  return out.join("\n");
}

/* ==================================================================== */
/* Запись и уборка                                                      */
/* ==================================================================== */

function build({ drafts = false } = {}) {
  const data = load();
  const written = [];
  const removed = [];
  const wanted = new Set();

  for (const e of data.req.entries || []) {
    if (!drafts && e.status !== "verified") continue;
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

  /* Всё, чего в этой сборке быть не должно, с диска убирается. Иначе
     черновик, однажды собранный для предпросмотра, так и остался бы
     лежать и уехал бы на хостинг вместе со всем остальным. */
  for (const rel of allPaths(data)) {
    if (wanted.has(rel)) continue;
    const file = path.join(ROOT, rel);
    if (fs.existsSync(file)) { fs.unlinkSync(file); removed.push(rel); }
    const dir = path.dirname(file);
    if (fs.existsSync(dir) && !fs.readdirSync(dir).length) fs.rmdirSync(dir);
  }

  return { written, removed, drafts };
}

module.exports = {
  load, pick, pagePath, allPaths, entriesFor, todos, emptyFields,
  visaTitle, pickerBlock, build, TODO_MARK, MUST_FILL
};
