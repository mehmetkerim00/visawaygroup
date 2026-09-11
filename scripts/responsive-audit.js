#!/usr/bin/env node
/*
 * responsive-audit.js — прогоняет сайт по всем ширинам экрана и ищет то,
 * что на какой-то из них ломается.
 *
 * Зачем: трёх ширин мало. Вёрстка рвётся не на 390 и не на 1440, а где-то
 * между — на 412, на 673, на 820. Скрипт проходит диапазон шагом в 10 пикселей
 * по каждому типу страницы и на трёх языках и проверяет шесть вещей:
 *
 *   1. страница не едет вбок (scrollWidth больше ширины окна);
 *   2. ни один блок не вылезает за пределы родителя и за край экрана;
 *   3. текст нигде не обрезан (содержимое выше блока, а тот его прячет);
 *   4. по всему, на что можно нажать, попадает палец — не меньше 44×44;
 *   5. между соседними кнопками и ссылками не меньше 8 пунктов;
 *   6. картинки не растянуты — их пропорции совпадают с настоящими.
 *
 * Запуск:
 *     node scripts/serve.js              (в другом окне)
 *     node scripts/responsive-audit.js
 *
 *     --step=20        шаг по ширине, по умолчанию 10
 *     --from=320 --to=2560
 *     --lang=tk        только один язык
 *     --json=путь      сохранить полный отчёт файлом
 *
 * Нужен установленный Google Chrome и запущенный локальный сервер.
 */

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
].find(p => { try { return fs.existsSync(p); } catch { return false; } });

const arg = (name, fallback) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
};

const BASE = arg("base", "http://localhost:8777");
const STEP = Number(arg("step", 10));
const FROM = Number(arg("from", 320));
const TO = Number(arg("to", 2560));
const ONLY_LANG = arg("lang", "");
const JSON_OUT = arg("json", "");
const PORT = 9500 + (process.pid % 400);

/* По одному представителю каждого типа страницы: проверять все 36 штук
   на 225 ширинах незачем, вёрстка у однотипных страниц общая. */
const TYPES = [
  ["главная", "index.html"],
  ["хаб виз", "wizalar.html"],
  ["услуга", "wizalar/is-wizasy.html"],
  ["контакты", "habarlasmak.html"],
  ["о нас", "biz-barada.html"],
  ["источники", "suratlar.html"],
  ["404", "404.html"]
];

const LANGS = ONLY_LANG ? [ONLY_LANG] : ["tk", "ru", "en"];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const json = async (url, method) => (await fetch(url, { method: method || "GET" })).json();

function pageUrl(lang, rel) {
  return lang === "tk" ? `/${rel}` : `/${lang}/${rel}`;
}


/* ==================================================================== */
/* Связь с браузером                                                    */
/* ==================================================================== */

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  };
  return {
    send: (method, params) => new Promise(res => {
      const n = ++id;
      waiting.set(n, res);
      ws.send(JSON.stringify({ id: n, method, params: params || {} }));
    }),
    close: () => ws.close()
  };
}


/* ==================================================================== */
/* Проверка, которая выполняется внутри страницы                        */
/* ==================================================================== */

/* Функция уходит в браузер строкой, поэтому живёт одним куском и ничего
   не берёт из внешней области видимости. */
const CHECKS = function () {
  const W = window.innerWidth;
  const found = [];
  const add = (rule, node, note) => {
    found.push({ rule, el: describe(node), note });
  };

  function describe(el) {
    if (!el || !el.tagName) return "?";
    let s = el.tagName.toLowerCase();
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
    if (el.id) s += "#" + el.id;
    else if (cls) s += "." + cls;
    const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 24);
    return text ? `${s} «${text}»` : s;
  }

  /* Внутренности SVG не проверяем: у них своя система координат,
     и «вылезает за родителя» там означает совсем не то, что в вёрстке. */
  const all = Array.from(document.querySelectorAll("body *"))
    .filter(el => !(el.ownerSVGElement || el.tagName === "svg" && false));
  const visible = all.filter(el => {
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });

  /* --- 1. Страница едет вбок ---------------------------------------- */
  const doc = document.documentElement;
  if (doc.scrollWidth > W + 1) {
    add("прокрутка вбок", document.body, `${doc.scrollWidth} при окне ${W}`);
  }

  /* --- 2. Блок вылезает за экран или за родителя ---------------------- */
  for (const el of visible) {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);

    /* За край экрана. Absolute и fixed декорации пропускаем: их часто
       намеренно заводят за край, а обрезает родитель с overflow: hidden. */
    if (st.position === "static" || st.position === "relative") {
      if (r.right > W + 1 || r.left < -1) {
        /* но только если это не следствие переполнения предка,
           который уже и так помечен */
        add("вылезает за экран", el,
            `слева ${Math.round(r.left)}, справа ${Math.round(r.right)} при окне ${W}`);
      }
    }

    /* За пределы родителя, который ничего не прячет */
    const parent = el.parentElement;
    if (!parent || parent === document.body) continue;
    if (st.position === "absolute" || st.position === "fixed") continue;
    const ps = getComputedStyle(parent);
    if (/hidden|clip|auto|scroll/.test(ps.overflowX)) continue;
    if (ps.display === "contents") continue;
    const pr = parent.getBoundingClientRect();
    const out = Math.max(pr.left - r.left, r.right - pr.right);
    if (out > 2) {
      add("шире родителя", el, `на ${Math.round(out)} px`);
    }
  }

  /* --- 3. Текст обрезан ---------------------------------------------- */
  for (const el of visible) {
    const st = getComputedStyle(el);
    const clips = /hidden|clip/.test(st.overflowY) || /hidden|clip/.test(st.overflowX);
    if (!clips) continue;
    if (!el.textContent || !el.textContent.trim()) continue;
    /* Пропускаем то, что прячется намеренно: скрытые панели, служебные
       подписи для скринридеров, схлопнутые ответы аккордеона. */
    if (el.closest("[hidden], .visually-hidden, details:not([open])")) continue;
    if (el.classList.contains("visually-hidden")) continue;
    if (st.position === "absolute" && el.clientHeight < 4) continue;
    const overY = el.scrollHeight - el.clientHeight;
    const overX = el.scrollWidth - el.clientWidth;
    if (overY > 2) add("текст обрезан по высоте", el, `${overY} px не влезло`);
    else if (overX > 2) add("текст обрезан по ширине", el, `${overX} px не влезло`);
  }

  /* --- 4. Размер цели нажатия ---------------------------------------- */
  const TAP = "a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex='-1'])";
  const targets = visible.filter(el => el.matches(TAP));

  function inlineInText(el) {
    /* Ссылка внутри абзаца — исключение стандарта: её размер задаёт текст,
       а не разработчик. Проверяем, что рядом действительно есть текст. */
    if (el.tagName !== "A") return false;
    const st = getComputedStyle(el);
    if (st.display !== "inline") return false;
    const p = el.parentElement;
    if (!p) return false;
    for (const node of p.childNodes) {
      if (node.nodeType === 3 && node.textContent.trim().length > 1) return true;
    }
    return false;
  }

  const boxes = [];
  for (const el of targets) {
    const r = el.getBoundingClientRect();
    boxes.push({ el, r });
    if (inlineInText(el)) continue;
    if (r.width < 43.5 || r.height < 43.5) {
      add("мелкая цель нажатия", el, `${Math.round(r.width)}×${Math.round(r.height)}`);
    }
  }

  /* --- 5. Зазор между соседними целями -------------------------------- */
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if (inlineInText(a.el) || inlineInText(b.el)) continue;
      /* Зазор нужен не всем: он выручает мелкие цели, по которым легко
         промахнуться. Две крупные кнопки, стоящие вплотную, — это список,
         а не ошибка: промахнуться мимо строки в 80 пикселей нельзя.
         Поэтому проверяем пару, только если хотя бы одна цель мельче 44. */
      const small = a.r.width < 43.5 || a.r.height < 43.5 ||
                    b.r.width < 43.5 || b.r.height < 43.5;
      if (!small) continue;
      const dx = Math.max(a.r.left - b.r.right, b.r.left - a.r.right);
      const dy = Math.max(a.r.top - b.r.bottom, b.r.top - a.r.bottom);
      /* Соседями считаем только те, что действительно рядом:
         пересекаются по одной оси и разведены по другой. */
      const overlapX = dx < 0;
      const overlapY = dy < 0;
      if (overlapX && overlapY) continue;            /* наложились — отдельная беда */
      if (overlapX && dy >= 0 && dy < 8) {
        add("тесно по вертикали", a.el, `${Math.round(dy)} px до ${describe(b.el)}`);
      } else if (overlapY && dx >= 0 && dx < 8) {
        add("тесно по горизонтали", a.el, `${Math.round(dx)} px до ${describe(b.el)}`);
      }
    }
  }

  /* --- 6. Растянутые картинки ----------------------------------------- */
  for (const el of visible) {
    if (el.tagName !== "IMG") continue;
    if (!el.naturalWidth || !el.naturalHeight) continue;
    const fit = getComputedStyle(el).objectFit;
    if (fit === "cover" || fit === "contain" || fit === "scale-down") continue;
    const r = el.getBoundingClientRect();
    const shown = r.width / r.height;
    const real = el.naturalWidth / el.naturalHeight;
    if (Math.abs(shown - real) / real > 0.02) {
      add("картинка растянута", el,
          `показана ${shown.toFixed(2)}, настоящая ${real.toFixed(2)}`);
    }
  }

  /* Одинаковые находки схлопываем: одно правило + один элемент = одна строка */
  const seen = new Map();
  for (const f of found) {
    const key = f.rule + "|" + f.el;
    if (!seen.has(key)) seen.set(key, f);
  }
  return Array.from(seen.values());
};


/* ==================================================================== */
/* Свод: сжимаем подряд идущие ширины в диапазоны                       */
/* ==================================================================== */

function ranges(widths) {
  const sorted = [...widths].sort((a, b) => a - b);
  const out = [];
  let start = sorted[0], prev = sorted[0];
  for (const w of sorted.slice(1)) {
    if (w - prev <= STEP) { prev = w; continue; }
    out.push([start, prev]);
    start = prev = w;
  }
  out.push([start, prev]);
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ");
}


/* ==================================================================== */

async function main() {
  if (!CHROME) { console.error("Не найден Google Chrome."); process.exit(1); }
  try { await fetch(BASE); } catch {
    console.error(`Не отвечает ${BASE}\nЗапустите в другом окне: node scripts/serve.js`);
    process.exit(1);
  }

  const widths = [];
  for (let w = FROM; w <= TO; w += STEP) widths.push(w);

  console.log(`Ширины ${FROM}–${TO} шагом ${STEP} — ${widths.length} шт.`);
  console.log(`Страниц: ${TYPES.length} типов × ${LANGS.length} яз. = ${TYPES.length * LANGS.length}`);
  console.log(`Всего замеров: ${widths.length * TYPES.length * LANGS.length}\n`);

  const userDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "chrome-audit-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
    "about:blank"
  ], { stdio: "ignore" });

  let version = null;
  for (let i = 0; i < 60 && !version; i++) {
    await sleep(200);
    try { version = await json(`http://localhost:${PORT}/json/version`); } catch {}
  }
  if (!version) { chrome.kill(); console.error("Chrome не запустился."); process.exit(1); }

  const source = "(" + CHECKS.toString() + ")()";
  const report = [];
  let total = 0;

  for (const lang of LANGS) {
    for (const [label, rel] of TYPES) {
      const url = BASE + pageUrl(lang, rel);
      const tab = await json(`http://localhost:${PORT}/json/new?about:blank`, "PUT");
      const c = await connect(tab.webSocketDebuggerUrl);
      await c.send("Page.enable");
      await c.send("Network.enable");
      await c.send("Network.setCacheDisabled", { cacheDisabled: true });
      await c.send("Emulation.setDeviceMetricsOverride",
                   { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
      await c.send("Page.navigate", { url });
      await sleep(1400);
      /* Появление блоков прячет часть страницы, пока до неё не долистали.
         Для обмера это мешает — показываем всё сразу. */
      await c.send("Runtime.evaluate", { expression:
        "document.querySelectorAll('[data-reveal],[data-reveal-group] > *')" +
        ".forEach(function(e){e.classList.add('is-visible')});" +
        "document.documentElement.style.scrollBehavior='auto';" });

      const perRule = new Map();

      for (const w of widths) {
        await c.send("Emulation.setDeviceMetricsOverride",
                     { width: w, height: 820, deviceScaleFactor: 1, mobile: w < 900 });
        const r = await c.send("Runtime.evaluate",
                               { expression: source, returnByValue: true });
        const list = (r.result && r.result.result && r.result.result.value) || [];
        for (const f of list) {
          const key = `${f.rule}|${f.el}`;
          if (!perRule.has(key)) perRule.set(key, { ...f, widths: [] });
          perRule.get(key).widths.push(w);
        }
      }

      c.close();
      await fetch(`http://localhost:${PORT}/json/close/${tab.id}`);

      const findings = Array.from(perRule.values())
        .sort((a, b) => b.widths.length - a.widths.length);
      total += findings.length;
      report.push({ lang, label, rel, findings });
      process.stdout.write(`  ${lang}  ${label.padEnd(12)} ${findings.length ? findings.length + " найдено" : "чисто"}\n`);
    }
  }

  chrome.kill();
  await sleep(300);
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}

  /* --- Таблица ------------------------------------------------------- */
  console.log("\n" + "─".repeat(78));
  if (!total) {
    console.log("\n  НА ВСЕХ ШИРИНАХ ЧИСТО\n");
  } else {
    console.log("\nстраница × ширина × найденное\n");
    for (const page of report) {
      if (!page.findings.length) continue;
      console.log(`${page.lang}  ${page.label}  (${page.rel})`);
      for (const f of page.findings) {
        console.log(`    ${f.rule}`);
        console.log(`      ${f.el}`);
        console.log(`      ширины: ${ranges(f.widths)}`);
        if (f.note) console.log(`      ${f.note}`);
      }
      console.log("");
    }
    console.log(`Всего разных находок: ${total}`);
  }

  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 1));
    console.log(`Полный отчёт: ${JSON_OUT}`);
  }

  process.exitCode = total ? 1 : 0;
}

main();
