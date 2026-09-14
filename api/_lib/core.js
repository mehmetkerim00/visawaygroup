/*
 * core.js — правила и отрисовка требований по странам.
 *
 * Здесь нет ни одного обращения к диску. Этим файлом пользуются двое:
 * сборка сайта (scripts/requirements.js) и панель (api/), и оба должны
 * считать одинаково. Если правило «что нельзя публиковать» будет
 * записано в двух местах, однажды они разойдутся — и разойдутся молча.
 *
 * Всё, что связано с файлами и путями, осталось в scripts/requirements.js.
 */

"use strict";

const LANGS = ["tk", "ru", "en"];
const DEFAULT_LANG = "tk";
const TODO_MARK = "УТОЧНИТЬ:";

function pick(obj, lang) {
  if (!obj) return "";
  return obj[lang] || obj[DEFAULT_LANG] || "";
}

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

/* У записи бывает два устройства. Обычная виза и образовательная
   консультация — это разные вещи, и поля у них разные.

   У консультации нет ни консульского сбора, ни подачи в консульство:
   документы идут в учебное заведение, а не в консульство. Зато есть то,
   чего нет у визы: сроки приёма в вузы, языковые требования, признание
   диплома в Туркменистане и стипендии. */
const KIND_FIELDS = {
  visa:      ["where", "prepDays", "reviewDays"],
  education: ["admissionDates", "language", "recognition", "scholarships"]
};

function kindOf(entry) {
  return entry.kind === "education" ? "education" : "visa";
}

/* Поля, которые специалист обязан заполнить перед тем, как ставить verified.

   Денежных полей здесь нет нарочно. Сборы и стоимость обучения меняются
   чаще всего и зависят от курса: устаревшая сумма на сайте хуже, чем её
   отсутствие. Поэтому пустая сумма — это нормально, на странице встанет
   честная строка. А вот если сумму вписали, к ней обязательна дата:
   см. amountNeedsDate. */
function mustFill(entry) {
  return KIND_FIELDS[kindOf(entry)];
}

/* Денежное поле у каждого устройства своё */
const MONEY = {
  visa:      { field: "fee",     date: "feeCheckedOn",     ru: "консульский сбор" },
  education: { field: "tuition", date: "tuitionCheckedOn", ru: "стоимость обучения" }
};

/* Сумма вписана, а когда её проверяли — не сказано.
   Текст с меткой УТОЧНИТЬ суммой не считается: это ещё вопрос
   специалисту, а не цифра, которую кто-то подтвердил. */
function amountNeedsDate(entry) {
  const m = MONEY[kindOf(entry)];
  const has = LANGS.some(l => {
    const v = String(pick(entry[m.field], l)).trim();
    return v && !v.includes(TODO_MARK);
  });
  return has && !String(entry[m.date] || "").trim() ? m : null;
}

/* Сохранено ради старых вызовов: где спрашивали про сбор, теперь
   спрашивают про любую сумму. */
function feeNeedsDate(entry) { return amountNeedsDate(entry) !== null; }

/* Сколько месяцев прошло с даты вида 2026-09-12. null, если даты нет. */
function monthsSince(date) {
  const d = String(date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const then = new Date(d + "T00:00:00Z");
  if (isNaN(then)) return null;
  return (Date.now() - then.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
}

/* Данные старше полугода считаем требующими перепроверки */
const STALE_MONTHS = 6;

function isStale(date) {
  const m = monthsSince(date);
  return m !== null && m > STALE_MONTHS;
}

function emptyFields(entry) {
  return mustFill(entry).filter(k => LANGS.every(l => !String(pick(entry[k], l)).trim()));
}


function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escAttr(s) { return esc(s).replace(/"/g, "&quot;"); }

/* Предупреждение вверху каждой страницы требований.
 *
 * Текст живёт в коде, а не в подписях, которые правит специалист: это
 * условие, на котором страницы вообще выложены. Случайно стереть его
 * из панели быть не должно возможности.
 */
const TOP_NOTICE = {
  tk: "Bu sahypadaky maglumat umumy häsiýetlidir we üýtgäp biler. " +
      "Size degişli takyk talaplary maslahatda tassyklaýarys.",
  ru: "Информация на этой странице носит общий характер и может меняться. " +
      "Точные требования подтверждаем на консультации.",
  en: "The information on this page is general and may change. " +
      "We confirm the exact requirements during the consultation."
};

function noticeBlock(lang) {
  return [
    `        <aside class="notice" role="note">`,
    `          <svg class="icon icon--sm" aria-hidden="true"><use href="#i-shield"/></svg>`,
    `          <p>${esc(TOP_NOTICE[lang] || TOP_NOTICE.ru)}</p>`,
    `        </aside>`
  ].join("\n");
}

/* Текст, который можно показать посетителю.
 *
 * Пустое поле и метка УТОЧНИТЬ — это заметки для специалиста, а не
 * сведения. На странице они выглядели бы недоделкой, поэтому наружу не
 * выходят: пустой ответ означает «этого раздела на странице не будет».
 * В панели те же места по-прежнему подсвечиваются — см. mainContent. */
function shown(value, lang) {
  const t = String(pick(value, lang) || "").trim();
  if (!t || t.includes(TODO_MARK)) return "";
  return t;
}

/* То же для списка: пункты с метками просто выпадают. */
function shownList(list, lang) {
  return (list || []).map(x => shown(x, lang)).filter(Boolean);
}

/* Дату показываем словами: «в январе 2026», а не «2026-09-12». Цифровая
   дата на странице читается как код, а не как срок годности сведений. */
function formatDate(date, lang, data, template) {
  const d = String(date || "").trim();
  const m = d.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) return "";
  const months = (data.labels.months && data.labels.months[lang]) || [];
  const name = months[Number(m[2]) - 1] || m[2];
  return String(template).replace("{month}", name).replace("{year}", m[1]);
}

/* Строка в табличке «сроки и сборы».
 *
 * На сайте незаполненной строки не бывает вовсе: вместо «НЕ ЗАПОЛНЕНО»
 * строка просто не выводится. В панели наоборот — специалист должен
 * видеть, что осталось дозаполнить, поэтому там пропуск подсвечивается. */
function factRow(label, value, forPanel, lang) {
  const filled = String(pick(value, lang) || "").trim();
  const годно = filled && !filled.includes(TODO_MARK);
  if (!годно && !forPanel) return "";

  const shownValue = годно
    ? esc(filled)
    : `<span class="is-missing">${esc(filled || "НЕ ЗАПОЛНЕНО")}</span>`;
  return [
    `            <li class="pricing__row">`,
    `              <span class="pricing__label">${esc(label)}</span>`,
    `              <span class="pricing__value">${shownValue}</span>`,
    `            </li>`
  ].join("\n");
}

/* Содержимое страницы требований.
 *
 * Всё, что снаружи, приходит в ctx: подписи, страна, название визы и
 * четыре ссылки. Так одна и та же отрисовка работает и при сборке сайта,
 * где ссылки относительные, и в предпросмотре панели, где они абсолютные.
 *
 * ctx = { labels, country, visaName, links: { home, hub, visaPage, contacts } }
 */
function mainContent(entry, lang, ctx) {
  const data = { labels: ctx.labels };
  const L = k => pick(ctx.labels[k], lang);
  const country = ctx.country;
  const countryName = pick(country.country, lang);
  const visaName = ctx.visaName;
  /* Две отрисовки одного и того же. На сайте незаполненное просто не
     выводится: посетителю нечего делать с заметками специалиста. В панели
     пропуски подсвечиваются — иначе специалист не увидит, что дозаполнить. */
  const forPanel = ctx.forPanel === true;
  const out = [];
  const { home, hub, visaPage, contacts } = ctx.links;

  out.push(`    <article class="page page--service">`);

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
            ${(() => { const t = shown(entry.summary, lang);
                       return t ? `<p class="lead">${esc(t)}</p>`
                                : (forPanel ? `<p class="lead is-missing">НЕ ЗАПОЛНЕНО</p>` : ""); })()}
          </div>
        </div>
      </section>

      <div class="container container--narrow">`);

  /* Первое, что человек читает под заголовком. Не сноска внизу: сведения
     здесь общие, и знать об этом надо до того, как их применят к себе. */
  out.push(noticeBlock(lang));

  const audience = forPanel ? (entry.audience || []).map(a => pick(a, lang))
                            : shownList(entry.audience, lang);
  if (audience.length) {
    out.push(`
        <section class="page-section" data-reveal>
          <h2>${esc(L("audience"))}</h2>
          <ul class="checklist">`);
    for (const a of audience) out.push(`            <li>${esc(a)}</li>`);
    out.push(`          </ul>
        </section>`);
  }

  const documents = (entry.documents || [])
    .filter(d => forPanel || shown(d.text, lang));
  if (documents.length) {
    out.push(`
        <section class="page-section" data-reveal>
          <h2>${esc(L("documents"))}</h2>
          <ul class="doclist" data-reveal-group>`);
    for (const d of documents) {
      const note = d.note ? (forPanel ? pick(d.note, lang) : shown(d.note, lang)) : "";
      const extra = d.required === false ? L("optional") : "";
      const sub = [note, extra].filter(Boolean).join(" &middot; ");
      const текст = forPanel ? String(pick(d.text, lang) || "") : shown(d.text, lang);
      out.push(`            <li><svg class="icon doclist__icon" aria-hidden="true"><use href="#i-doc"/></svg>` +
               `<span>${esc(текст)}` + (sub ? `<span>${sub}</span>` : "") + `</span></li>`);
    }
    out.push(`          </ul>
        </section>`);
  }

  /* Признание диплома в Туркменистане вынесено отдельным блоком и стоит
     до всего остального про сроки и деньги. Для родителей это главный
     вопрос — «а что этот диплом будет значить дома», — и ответа на него
     почти нигде нет. Прятать его строкой в таблице было бы нечестно. */
  const kind = kindOf(entry);
  const recognition = shown(entry.recognition, lang);
  if (kind === "education" && (recognition || forPanel)) {
    const текст = recognition || (forPanel ? "НЕ ЗАПОЛНЕНО" : "");
    out.push(`
        <section class="page-section" data-reveal>
          <h2>${esc(L("recognition"))}</h2>
          <div class="callout">
            <p${recognition ? "" : ' class="is-missing"'}>${esc(текст)}</p>
          </div>
        </section>`);
  }

  const factTitle = kind === "education" ? L("studyTerms") : L("termsAndFee");
  out.push(`
        <section class="page-section" data-reveal>
          <h2>${esc(factTitle)}</h2>
          <div class="pricing">
            <ul class="pricing__list">`);
  if (kind === "education") {
    out.push(factRow(L("admissionDates"), entry.admissionDates, forPanel, lang));
    out.push(factRow(L("language"), entry.language, forPanel, lang));
  } else {
    out.push(factRow(L("where"), entry.where, forPanel, lang));
    out.push(factRow(L("prepDays"), entry.prepDays, forPanel, lang));
    out.push(factRow(L("reviewDays"), entry.reviewDays, forPanel, lang));
  }
  /* Деньги — особый случай. Пустое поле это не недоделка, а осознанный
     выбор: ставим честную строку. Вписанная сумма живёт вместе с датой,
     когда её проверяли, иначе через полгода она врёт с уверенным видом.
     У визы это консульский сбор, у консультации — стоимость обучения. */
  const money = MONEY[kind];
  const moneyLabel = kind === "education" ? L("tuition") : L("fee");
  const moneyDefault = kind === "education" ? L("tuitionDefault") : L("feeDefault");
  /* Метка УТОЧНИТЬ — это вопрос специалисту, а не сумма. На сайте вместо
     неё встаёт честная строка «уточняем на консультации»: она верна в
     любом случае и не выглядит недоделкой. */
  const сырое = String(pick(entry[money.field], lang) || "").trim();
  const feeText = forPanel ? сырое : shown(entry[money.field], lang);
  const isAmount = feeText && !feeText.includes(TODO_MARK);
  if (feeText) {
    const asOf = formatDate(entry[money.date], lang, data, L("feeAsOf"));
    const tail = asOf
      ? ` <span class="fact-note">&middot; ${esc(asOf)}</span>`
      : (forPanel && isAmount ? ` <span class="is-missing">· БЕЗ ДАТЫ ПРОВЕРКИ</span>` : "");
    out.push([
      `            <li class="pricing__row">`,
      `              <span class="pricing__label">${esc(moneyLabel)}</span>`,
      `              <span class="pricing__value">${esc(feeText)}${tail}</span>`,
      `            </li>`
    ].join("\n"));
  } else {
    out.push([
      `            <li class="pricing__row">`,
      `              <span class="pricing__label">${esc(moneyLabel)}</span>`,
      `              <span class="pricing__value">${esc(moneyDefault)}</span>`,
      `            </li>`
    ].join("\n"));
  }
  if (kind === "education") {
    out.push(factRow(L("scholarships"), entry.scholarships, forPanel, lang));
  }
  out.push(`            </ul>
            <a class="btn btn--primary pricing__cta" href="${contacts}">${esc(L("askUs"))}</a>
          </div>
        </section>`);

  for (const [key, raw] of [["notes", entry.notes], ["refusals", entry.refusals]]) {
    const list = forPanel ? (raw || []).map(x => pick(x, lang)) : shownList(raw, lang);
    if (!list.length) continue;
    out.push(`
        <section class="page-section" data-reveal>
          <h2>${esc(L(key))}</h2>
          <ul class="checklist">`);
    for (const n of list) out.push(`            <li>${esc(n)}</li>`);
    out.push(`          </ul>
        </section>`);
  }

  /* Дата актуальности и оговорка — последнее, что человек читает перед
     призывом. Оговорка набрана так же, как предупреждение о документах
     на странице контактов: это не мелкий шрифт внизу, а часть сведений. */
  const checkedOn = String(entry.checkedOn || "").trim();
  const checkedBy = String(entry.checkedBy || "").trim() || L("notChecked");
  const dateLine = formatDate(checkedOn, lang, data, L("verifiedOn"))
    || (forPanel ? "НЕ ЗАПОЛНЕНО" : L("notVerifiedYet"));
  out.push(`
        <section class="page-section" data-reveal>
          <div class="warn">
            <svg class="icon icon--sm" aria-hidden="true"><use href="#i-shield"/></svg>
            <div>
              <p><strong>${esc(dateLine)}</strong></p>
              <p>${esc(L("disclaimer"))}</p>
            </div>
          </div>
          <p class="note-line">${esc(L("checked"))}: ${esc(checkedBy)}</p>
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
  /* Пропущенные строки таблички возвращают пустую строку — выбрасываем,
     чтобы в разметке не оставалось дыр на месте того, чего не выводим. */
  return out.filter(x => x !== "").join("\n");
}


/* Готовая страница. За основу берётся страница самой визы: так шапка,
   подвал, набор иконок и все метки блоков остаются ровно такими же, как
   на остальном сайте, и их потом обновит sync-layout. Меняются только
   заголовок, описание и содержимое <main>. */

module.exports = {
  LANGS, DEFAULT_LANG, TODO_MARK, pick,
  todos, KIND_FIELDS, kindOf, mustFill, MONEY, amountNeedsDate, feeNeedsDate,
  monthsSince, STALE_MONTHS, isStale, emptyFields,
  esc, escAttr, formatDate, factRow, mainContent, noticeBlock, shown, shownList, TOP_NOTICE
};
