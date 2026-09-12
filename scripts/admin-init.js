#!/usr/bin/env node
/*
 * admin-init.js — то, что владелец делает один раз с командной строки.
 *
 *   node scripts/admin-init.js import                данные из json в базу
 *   node scripts/admin-init.js export                из базы обратно в json
 *   node scripts/admin-init.js user <почта> <роль>   завести пользователя
 *   node scripts/admin-init.js check                 что сейчас в базе
 *
 * Роли две: owner (владелец) и editor (редактор).
 *
 * Пароль спрашивается здесь и нигде не показывается: ни на экране при
 * наборе, ни в истории команд, ни в записях журнала. В базу уходит
 * только его bcrypt-хеш.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const ROOT = path.resolve(__dirname, "..");
const REQ_FILE = path.join(ROOT, "data", "requirements.json");

const kv = require(path.join(ROOT, "api", "_lib", "kv.js"));
const auth = require(path.join(ROOT, "api", "_lib", "auth.js"));
const records = require(path.join(ROOT, "api", "_lib", "records.js"));

function say(m) { console.log(m); }
const RULE = "-".repeat(70);

/* Ввод пароля без показа на экране */
function askHidden(question) {
  return new Promise(resolve => {
    const stdin = process.stdin;
    process.stdout.write(question);
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    let value = "";
    const ETX = String.fromCharCode(3);
    const DEL = String.fromCharCode(127);
    const BS = String.fromCharCode(8);
    const onData = chunk => {
      const str = chunk.toString("utf8");
      for (const ch of str) {
        if (ch === "\r" || ch === "\n") {
          stdin.removeListener("data", onData);
          if (stdin.isTTY) stdin.setRawMode(!!wasRaw);
          stdin.pause();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === ETX) { process.stdout.write("\n"); process.exit(1); }
        if (ch === DEL || ch === BS) { value = value.slice(0, -1); continue; }
        value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, a => { rl.close(); resolve(a.trim()); }));
}

/* --------------------------------------------------------------- */

async function cmdImport() {
  if (!fs.existsSync(REQ_FILE)) { say("Нет data/requirements.json — нечего переносить."); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(REQ_FILE, "utf8"));
  const existing = await records.listRecords();
  if (existing.length && !process.argv.includes("--force")) {
    const answer = await ask(`В базе уже ${existing.length} записей. Перезаписать их из файла? (да/нет) `);
    if (answer.toLowerCase() !== "да") { say("Отменено, ничего не тронуто."); return; }
  }
  await records.setLabels(data.labels || {});
  let n = 0;
  for (const entry of data.entries || []) {
    if (!records.validPair(entry.visa, entry.country)) {
      say(`  пропущена неизвестная пара ${entry.visa}/${entry.country}`);
      continue;
    }
    await records.putRecord(entry, "перенос из файла");
    n++;
  }
  say(`Перенесено записей: ${n}. Подписей: ${Object.keys(data.labels || {}).length}.`);
}

async function cmdExport() {
  const list = await records.listRecords();
  if (!list.length) { say("В базе пусто — выгружать нечего."); process.exit(1); }
  const labels = await records.getLabels();
  const file = JSON.parse(fs.readFileSync(REQ_FILE, "utf8"));

  /* Порядок записей тот же, что был: иначе каждая выгрузка давала бы
     огромную разницу в git, и в ней нельзя было бы ничего разглядеть. */
  const order = new Map();
  (file.entries || []).forEach((e, i) => order.set(e.visa + "|" + e.country, i));
  list.sort((a, b) => {
    const ka = order.has(a.visa + "|" + a.country) ? order.get(a.visa + "|" + a.country) : 1e6;
    const kb = order.has(b.visa + "|" + b.country) ? order.get(b.visa + "|" + b.country) : 1e6;
    return ka - kb;
  });

  file.labels = Object.keys(labels).length ? labels : file.labels;
  file.entries = list.map(e => {
    const copy = Object.assign({}, e);
    /* Служебное в файл не выгружаем: смысл у него только внутри базы */
    delete copy.updatedAt;
    delete copy.updatedBy;
    return copy;
  });
  fs.writeFileSync(REQ_FILE, JSON.stringify(file, null, 2) + "\n", "utf8");
  say(`Выгружено записей: ${file.entries.length} в data/requirements.json`);
  say("Дальше: node scripts/build.js && node scripts/preflight.js");
}

async function cmdUser(email, role) {
  if (!email) { say("Укажите почту: node scripts/admin-init.js user pochta@primer.ru owner"); process.exit(1); }
  role = role || "editor";
  say("");
  say(`Заводим пользователя: ${email}, роль «${auth.ROLES[role] || role}».`);
  say("Пароль: не короче 12 знаков, проверяется по базе утёкших паролей.");
  say("");
  const p1 = await askHidden("Пароль: ");
  const p2 = await askHidden("Ещё раз: ");
  if (p1 !== p2) { say("\nПароли не совпали. Ничего не сделано."); process.exit(1); }

  let created;
  try {
    created = await auth.createUser({ email, plainPassword: p1, role });
  } catch (e) {
    say("\nНе получилось: " + e.message);
    process.exit(1);
  }

  const pretty = created.secret.replace(/(.{4})/g, "$1 ").trim();
  say("");
  say("Готово. Теперь настройте приложение-аутентификатор.");
  say(RULE);
  say("");
  say("  Откройте Google Authenticator, Authy, 1Password или Aegis,");
  say("  выберите «Добавить вручную» и введите этот ключ:");
  say("");
  say("      " + pretty);
  say("");
  say("  Название: VisaWay Group");
  say("  Тип: по времени (TOTP), 6 цифр, 30 секунд.");
  say("");
  say("  Либо вставьте в приложение целиком эту строку:");
  say("");
  say("      " + created.otpauth);
  say("");
  say(RULE);
  say("");
  say("  Ключ показан один раз. Сохраните его, пока окно открыто:");
  say("  без приложения вход не работает, и это не отключается.");
  say("");
}

async function cmdCheck() {
  const list = await records.listRecords();
  const users = await kv.keys("user:*");
  const labels = await records.getLabels();
  say("");
  say("ЧТО В БАЗЕ ПАНЕЛИ");
  say(RULE);
  say(`  хранилище:     ${kv.isDev ? "файл на этом компьютере (режим разработки)" : "Vercel KV"}`);
  say(`  записей:       ${list.length} из 72`);
  say(`  проверено:     ${list.filter(e => e.status === "verified").length}`);
  say(`  подписей:      ${Object.keys(labels).length}`);
  say(`  пользователей: ${users.length}`);
  for (const key of users) {
    const u = await kv.getJson(key);
    say(`     ${u.email} — ${auth.ROLES[u.role] || u.role}` +
        `, второй фактор ${u.totpConfirmed ? "подтверждён" : "ещё не подтверждён"}`);
  }
  say("");
}

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === "import") return cmdImport();
  if (cmd === "export") return cmdExport();
  if (cmd === "user") return cmdUser(a, b);
  if (cmd === "check") return cmdCheck();
  say("Команды: import | export | user <почта> <owner|editor> | check");
  process.exit(1);
}

main().catch(e => { console.error("Сбой:", e.message); process.exit(1); });
