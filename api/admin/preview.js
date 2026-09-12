/*
 * preview.js — как страница будет выглядеть на сайте, до публикации.
 *
 * Отрисовывает то, что сейчас в редакторе, а не то, что сохранено:
 * посмотреть правку до сохранения — это и есть смысл предпросмотра.
 *
 * Разметку делает та же самая api/_lib/core.js, что и сборка сайта, и
 * стили подключаются настоящие, из /css. Поэтому предпросмотр — это не
 * похожая картинка, а тот же самый код.
 *
 * Шапки и подвала здесь нет: они на всех страницах одинаковы и от правки
 * требований не зависят. Показывается ровно то, что меняется.
 */

"use strict";

const crypto = require("crypto");
const http = require("../_lib/http.js");
const kv = require("../_lib/kv.js");
const records = require("../_lib/records.js");
const core = require("../_lib/core.js");

/* Предпросмотр живёт двумя обращениями: панель присылает то, что сейчас
   в редакторе, и получает обратно короткий ключ; рамка открывает этот
   ключ обычным адресом.
 *
 * Почему не проще — не отдать разметку прямо в рамку через srcdoc:
 * такой документ не имеет своего адреса и наследует политику содержимого
 * у страницы панели. Настоящий адрес получает собственные заголовки,
 * а ещё его можно открыть в отдельной вкладке. */
const PREVIEW_TTL = 300;

/* Три значка, которые встречаются в содержимом страницы. Набор целиком
   лежит в partials/icons.html, но тащить его сюда незачем. */
const SPRITE = `<svg class="preview-sprite" width="0" height="0" aria-hidden="true"><defs>
<symbol id="i-doc" viewBox="0 0 24 24"><path d="M13.25 2.75H6.5A1.25 1.25 0 0 0 5.25 4v16a1.25 1.25 0 0 0 1.25 1.25h11A1.25 1.25 0 0 0 18.75 20V8.25l-5.5-5.5Z"/><path d="M13.25 2.75v5.5h5.5"/><path d="M8.5 12.75h7"/><path d="M8.5 16.25h7"/></symbol>
<symbol id="i-arrow-left" viewBox="0 0 24 24"><path d="M20 12H5"/><path d="m11 6.5-5.5 5.5 5.5 5.5"/></symbol>
<symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 2.75 4.75 5.75v6c0 4.3 3 8.3 7.25 9.5 4.25-1.2 7.25-5.2 7.25-9.5v-6L12 2.75Z"/><path d="m9 11.9 2.1 2.1 4-4.4"/></symbol>
</defs></svg>`;

const LANG_HTML = { tk: "tk", ru: "ru", en: "en" };

module.exports = http.handler(async (req, res) => {
  const session = await http.requireSession(req);

  /* Открыть готовый предпросмотр по ключу */
  if (req.method === "GET") {
    const id = new URL(req.url, "http://panel").searchParams.get("id") || "";
    if (!/^[A-Za-z0-9_-]{10,60}$/.test(id)) http.fail(400, "Ключ предпросмотра неверный.");
    const saved = await kv.getJson(`prev:${session.email}:${id}`);
    if (!saved) http.fail(404, "Предпросмотр устарел. Обновите страницу.");
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(saved.html);
    return;
  }

  http.requireCsrf(req, session);
  const body = await http.readBody(req);
  const entry = body.entry;
  const lang = LANG_HTML[body.lang] ? body.lang : "tk";

  if (!entry || !records.validPair(entry.visa, entry.country)) {
    http.fail(400, "Нечего показывать: не сказано, какая это пара.");
  }

  const labels = await records.getLabels();
  const country = records.BY_CODE.get(entry.country);
  const visaName = core.pick(records.VISA_NAMES[entry.visa], lang);
  const prefix = lang === "tk" ? "/" : `/${lang}/`;

  const main = core.mainContent(entry, lang, {
    /* Стили здесь приходят файлом, встроенных быть не должно */
    inlineStyles: false,
    labels,
    country,
    visaName,
    links: {
      home: prefix + "index.html",
      hub: prefix + "wizalar.html",
      visaPage: `${prefix}wizalar/${entry.visa}.html`,
      contacts: prefix + "habarlasmak.html"
    }
  });

  /* Ссылки на стили абсолютные: страница предпросмотра лежит по адресу
     /api/admin/preview, а стили — в корне сайта. */
  const html = `<!DOCTYPE html>
<html lang="${LANG_HTML[lang]}" class="js">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Предпросмотр</title>
<link rel="stylesheet" href="/css/tokens.css">
<link rel="stylesheet" href="/css/base.css">
<link rel="stylesheet" href="/css/layout.css">
<link rel="stylesheet" href="/css/home.css">
<link rel="stylesheet" href="/css/page.css">
<!-- Три правила предпросмотра лежат отдельным файлом, а не здесь:
     строгая политика содержимого не пропускает встроенные стили. -->
<link rel="stylesheet" href="/admin/preview.css">
</head>
<body>
${SPRITE}
<main class="site-main">
${main}
</main>
</body>
</html>`;

  /* Ключ привязан к тому, кто вошёл: чужой предпросмотр по чужому ключу
     не откроется, даже если ключ подсмотрят. */
  const id = crypto.randomBytes(16).toString("base64url");
  await kv.setJson(`prev:${session.email}:${id}`, { html }, PREVIEW_TTL);
  http.send(res, 200, { id });
}, { methods: ["POST", "GET"], frame: "SAMEORIGIN", frameAncestors: "'self'" });
