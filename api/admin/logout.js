/* Выход по кнопке: сессия стирается в хранилище, cookie гасятся. */
"use strict";
const http = require("../_lib/http.js");
const auth = require("../_lib/auth.js");

module.exports = http.handler(async (req, res) => {
  await auth.endSession(req);
  res.setHeader("Set-Cookie", auth.clearCookies(http.SECURE));
  http.send(res, 200, { ok: true });
}, { methods: ["POST"] });
