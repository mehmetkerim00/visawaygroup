/* Список всех 72 пар: то, по чему панель строит таблицу, фильтры и поиск. */
"use strict";
const http = require("../_lib/http.js");
const records = require("../_lib/records.js");

module.exports = http.handler(async (req, res) => {
  await http.requireSession(req);
  const all = await records.listRecords();
  const list = all.map(records.summarize);

  const counts = {
    всего: list.length,
    черновики: list.filter(r => r.status !== "verified").length,
    проверено: list.filter(r => r.status === "verified").length,
    устарело: list.filter(r => r.stale).length
  };
  http.send(res, 200, { list, counts, visas: records.VISA_NAMES });
}, { methods: ["GET"] });
