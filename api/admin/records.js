/* Список всех 72 пар: то, по чему панель строит таблицу, фильтры и поиск. */
"use strict";
const http = require("../_lib/http.js");
const records = require("../_lib/records.js");

module.exports = http.handler(async (req, res) => {
  await http.requireSession(req);
  const all = await records.listRecords();
  const list = all.map(records.summarize);

  const by = st => list.filter(r => r.state === st).length;
  const counts = {
    всего: list.length,
    draft: by("draft"),
    verified: by("verified"),
    published: by("published"),
    changed: by("changed"),
    stale: list.filter(r => r.stale).length,
    /* Сколько записей ждёт публикации: проверенные и те, что правили
       после публикации. Это же число стоит на кнопке «Опубликовать». */
    ждут: by("verified") + by("changed")
  };
  /* Адрес сайта — чтобы в списке у опубликованных записей была живая
     ссылка. Сам путь приходит в каждой строке из summarize. */
  http.send(res, 200, { list, counts, visas: records.VISA_NAMES, siteBase: http.siteBase(req) });
}, { methods: ["GET"] });
