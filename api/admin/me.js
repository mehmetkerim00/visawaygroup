/* Кто вошёл. По этому ответу панель понимает, показывать ли себя
   или перебрасывать на вход. */
"use strict";
const http = require("../_lib/http.js");
const auth = require("../_lib/auth.js");

module.exports = http.handler(async (req, res) => {
  const session = await http.requireSession(req);
  const user = await auth.getUser(session.email);
  http.send(res, 200, {
    email: session.email,
    role: session.role,
    roleName: auth.ROLES[session.role] || session.role,
    csrf: session.csrf,
    /* Сколько сессии осталось — панель показывает это человеку,
       чтобы выход посреди правки не был неожиданностью. */
    minutesLeft: Math.max(0, Math.round(
      (session.startedAt + auth.SESSION_HOURS * 3600 * 1000 - Date.now()) / 60000)),
    createdAt: user && user.createdAt
  });
}, { methods: ["GET"] });
