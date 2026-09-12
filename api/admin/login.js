/* Вход в панель: почта, пароль и код из приложения. Все три обязательны. */
"use strict";
const http = require("../_lib/http.js");
const auth = require("../_lib/auth.js");
const notify = require("../_lib/notify.js");

module.exports = http.handler(async (req, res) => {
  const body = await http.readBody(req);
  const ip = http.clientIp(req);

  const result = await auth.login({
    email: body.email,
    plainPassword: body.password,
    code: body.code,
    ip
  });

  if (!result.ok) {
    if (result.justLocked) {
      /* Владельцу сообщаем о блокировке: пять неудач подряд — это либо
         человек забыл пароль, либо кто-то подбирает. Знать об этом
         нужно в обоих случаях. */
      await notify.lockedOut({ email: result.email, ip });
    }
    /* Одинаковый ответ на «нет такого пользователя» и «неверный пароль»:
       иначе по ответу можно собрать список заведённых адресов. */
    http.fail(result.locked ? 429 : 401, result.error);
  }

  res.setHeader("Set-Cookie", auth.cookieHeaders(result.session, http.SECURE));
  http.send(res, 200, {
    ok: true,
    user: result.user,
    csrf: result.session.csrf,
    hours: auth.SESSION_HOURS
  });
}, { methods: ["POST"] });
