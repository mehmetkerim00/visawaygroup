/*
 * notify.js — письма владельцу.
 *
 * На первом заходе нужно ровно одно письмо: о блокировке входа после
 * пяти неудачных попыток. Письма о публикации появятся вторым заходом.
 *
 * Отправка — через Resend по HTTPS, без библиотеки. Если ключа нет,
 * письмо не отправляется, а запись остаётся в журнале сервера: панель
 * из-за этого не ломается, но и молча делать вид, что письмо ушло,
 * она не будет.
 */

"use strict";

const API = "https://api.resend.com/emails";

function configured() {
  return !!(process.env.RESEND_API_KEY && process.env.ADMIN_OWNER_EMAIL);
}

async function send({ subject, text }) {
  if (!configured()) {
    console.warn("письмо не отправлено (нет RESEND_API_KEY или ADMIN_OWNER_EMAIL):", subject);
    return { sent: false, reason: "не настроено" };
  }
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: process.env.ADMIN_MAIL_FROM || "VisaWay panel <onboarding@resend.dev>",
        to: [process.env.ADMIN_OWNER_EMAIL],
        subject,
        text
      }),
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) {
      console.error("почта ответила", res.status);
      return { sent: false, reason: "почта ответила " + res.status };
    }
    return { sent: true };
  } catch (e) {
    console.error("письмо не ушло:", e.message);
    return { sent: false, reason: e.message };
  }
}

async function lockedOut({ email, ip }) {
  return send({
    subject: "Панель VisaWay: вход заблокирован после пяти неудачных попыток",
    text: [
      "В панель пять раз подряд не смогли войти.",
      "",
      `Учётная запись: ${email}`,
      `Адрес, откуда пробовали: ${ip}`,
      `Время: ${new Date().toLocaleString("ru-RU", { timeZone: "Asia/Ashgabat" })} (Ашхабад)`,
      "",
      "Вход по этой учётной записи закрыт на 15 минут.",
      "",
      "Если это были вы — просто подождите и войдите снова.",
      "Если нет — смените пароль, как только войдёте."
    ].join("\n")
  });
}

module.exports = { send, lockedOut, configured };
