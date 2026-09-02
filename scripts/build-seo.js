#!/usr/bin/env node
/*
 * build-seo.js — всё, что нужно поисковикам.
 *
 * Запускается сам собой из sync-layout.js, но можно и отдельно:
 *     node scripts/build-seo.js            — собрать
 *     node scripts/build-seo.js --check    — только проверить
 *
 * ЧТО ДЕЛАЕТ
 *
 * 1. sitemap.xml — список всех 30 страниц. У каждой указаны ссылки на две
 *    другие языковые версии и x-default на туркменскую.
 * 2. robots.txt — разрешает обход всего сайта и указывает на sitemap.
 * 3. Микроразметку JSON-LD между метками <!-- jsonld:start --> и
 *    <!-- jsonld:end --> в конце каждой страницы:
 *       • главные страницы  — TravelAgency: название, адрес, телефон,
 *                             часы работы, языки, карта, логотип;
 *       • страницы услуг    — Service;
 *       • страницы с FAQ    — FAQPage, только реально существующие вопросы;
 *       • вложенные страницы — BreadcrumbList из хлебных крошек на странице.
 * 4. Приводит og:url, og:image и twitter:image к каноническому адресу.
 *
 * ВАЖНО. Разметка описывает только то, что есть на странице. В ней намеренно
 * нет рейтингов, отзывов, цен и даты основания: выдуманные значения — это
 * ложь, которую поисковик покажет людям как факт.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const L = require("./lib-site.js");

const notes = [];
const problems = [];
function note(m) { if (!notes.includes(m)) notes.push(m); }
function problem(m) { if (!problems.includes(m)) problems.push(m); }

/* ------------------------------------------------------------------ */
/* Разбор страницы: берём только то, что на ней действительно есть      */
/* ------------------------------------------------------------------ */

function decode(s) {
  return String(s)
    .replace(/&mdash;/g, "—").replace(/&ndash;/g, "–")
    .replace(/&laquo;/g, "«").replace(/&raquo;/g, "»")
    .replace(/&middot;/g, "·").replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stripTags(s) {
  return decode(String(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function readPage(rel) {
  const html = fs.readFileSync(path.join(L.ROOT, rel), "utf8");
  const body = html.slice(html.indexOf("<body"));

  const titleM = html.match(/<title>([\s\S]*?)<\/title>/);
  const descM = html.match(/<meta name="description" content="([^"]*)"/);
  const h1M = body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);

  /* Хлебные крошки — ровно те, что нарисованы на странице */
  const crumbs = [];
  const crumbBlock = body.match(/<nav class="breadcrumbs"[\s\S]*?<\/nav>/);
  if (crumbBlock) {
    for (const m of crumbBlock[0].matchAll(/<(a|span)([^>]*)>([\s\S]*?)<\/\1>/g)) {
      const href = (m[2].match(/href="([^"]*)"/) || [])[1] || null;
      crumbs.push({ name: stripTags(m[3]), href });
    }
  }

  /* Вопросы и ответы — только раскрывающиеся блоки, которые есть на странице */
  const faq = [];
  for (const m of body.matchAll(/<details class="faq__item">([\s\S]*?)<\/details>/g)) {
    const q = m[1].match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
    const a = m[1].match(/<div class="faq__a">([\s\S]*?)<\/div>/);
    if (q && a) faq.push({ q: stripTags(q[1]), a: stripTags(a[1]) });
  }

  return {
    rel,
    html,
    lang: L.langOf(rel),
    bare: L.stripLang(rel),
    title: titleM ? decode(titleM[1].trim()) : "",
    description: descM ? decode(descM[1]) : "",
    h1: h1M ? stripTags(h1M[1]) : "",
    crumbs,
    faq
  };
}

/* ------------------------------------------------------------------ */
/* Адреса                                                              */
/* ------------------------------------------------------------------ */

/* Каноническая ссылка на страницу: полная, если домен вписан */
function makeUrl(site, rel) {
  const base = L.siteUrl(site);
  return base ? base + rel : rel;
}

/* ------------------------------------------------------------------ */
/* JSON-LD                                                             */
/* ------------------------------------------------------------------ */

const COUNTRY = { tk: "Türkmenistan", ru: "Туркменистан", en: "Turkmenistan" };

function organizationNode(site, page, values) {
  const addr = L.pick(site.address, page.lang) || {};
  const node = {
    "@type": "TravelAgency",
    "@id": makeUrl(site, L.joinLang("index.html", page.lang)) + "#organization",
    name: values.nameFull,
    url: makeUrl(site, L.joinLang("index.html", page.lang)),
    logo: makeUrl(site, "assets/logo-horizontal.svg"),
    image: makeUrl(site, "assets/og-image.png"),
    /* Языки указываем кодами: их понимают машины, а не только люди */
    availableLanguage: L.LANGS
  };

  if (!L.isTodo(values.phone)) node.telephone = values.phone;
  if (!L.isTodo(values.email)) node.email = values.email;
  /* Пустую ссылку на карту в разметку класть нельзя: поисковик увидит
     поле без значения. Нет ссылки — нет поля. */
  const map = (site.address.mapUrl || "").trim();
  if (map && !L.isTodo(map)) node.hasMap = map;

  const address = { "@type": "PostalAddress", addressCountry: "TM" };
  if (addr.city) address.addressLocality = addr.city;
  if (addr.street && !L.isTodo(addr.street)) address.streetAddress = addr.street;
  node.address = address;

  const spec = site.openingHoursSpec || [];
  if (spec.length) {
    node.openingHoursSpecification = spec.map(h => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: h.days.map(d => "https://schema.org/" + d),
      opens: h.opens,
      closes: h.closes
    }));
  }
  return node;
}

function breadcrumbNode(site, page) {
  if (page.crumbs.length < 2) return null;
  return {
    "@type": "BreadcrumbList",
    itemListElement: page.crumbs.map((c, i) => {
      const item = { "@type": "ListItem", position: i + 1, name: c.name };
      if (c.href) {
        const target = path.posix.normalize(
          path.posix.join(path.posix.dirname(page.rel), c.href));
        item.item = makeUrl(site, target);
      }
      return item;
    })
  };
}

function faqNode(page) {
  if (!page.faq.length) return null;
  return {
    "@type": "FAQPage",
    mainEntity: page.faq.map(f => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a }
    }))
  };
}

function serviceNode(site, page, values) {
  return {
    "@type": "Service",
    name: page.h1,
    description: page.description,
    serviceType: page.h1,
    provider: { "@id": makeUrl(site, L.joinLang("index.html", page.lang)) + "#organization" },
    areaServed: { "@type": "Country", name: COUNTRY[page.lang] },
    availableChannel: {
      "@type": "ServiceChannel",
      serviceUrl: makeUrl(site, L.joinLang("habarlasmak.html", page.lang))
    }
  };
}

function buildJsonLd(site, page, values) {
  const graph = [];
  const isHome = page.bare === "index.html";
  const isService = page.bare.startsWith("wizalar/");

  if (isHome || page.bare === "habarlasmak.html" || page.bare === "biz-barada.html") {
    graph.push(organizationNode(site, page, values));
  }
  if (isService) graph.push(serviceNode(site, page, values));

  const crumbs = breadcrumbNode(site, page);
  if (crumbs) graph.push(crumbs);

  const faq = faqNode(page);
  if (faq) graph.push(faq);

  if (!graph.length) return null;
  return { "@context": "https://schema.org", "@graph": graph };
}

/* ------------------------------------------------------------------ */
/* sitemap.xml и robots.txt                                            */
/* ------------------------------------------------------------------ */

function buildSitemap(site, pages) {
  const base = L.siteUrl(site);
  const set = new Set(pages.map(p => p.rel));
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- Собирается автоматически: node scripts/build-seo.js. Руками не правьте. -->',
    '<urlset xmlns="http://www.w3.org/1999/xhtml/../../../schemas/sitemap/0.9"'
  ];
  /* правильные пространства имён */
  lines[2] = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';
  lines.push('        xmlns:xhtml="http://www.w3.org/1999/xhtml">');

  for (const page of pages) {
    if (page.bare === "404.html") continue;   /* страницу ошибки индексировать незачем */
    lines.push("  <url>");
    lines.push(`    <loc>${base + page.rel}</loc>`);
    for (const lang of L.LANGS) {
      const mirror = L.joinLang(page.bare, lang);
      const target = set.has(mirror) ? mirror : L.joinLang("index.html", lang);
      lines.push(`    <xhtml:link rel="alternate" hreflang="${lang}" href="${base + target}"/>`);
    }
    const def = set.has(L.joinLang(page.bare, L.DEFAULT_LANG))
      ? L.joinLang(page.bare, L.DEFAULT_LANG) : "index.html";
    lines.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${base + def}"/>`);
    lines.push(`    <changefreq>monthly</changefreq>`);
    lines.push("  </url>");
  }
  lines.push("</urlset>");
  return lines.join("\n") + "\n";
}

function buildManifest(site) {
  return JSON.stringify({
    name: site.name,
    short_name: "TDS",
    description: L.pick(site.tagline, L.DEFAULT_LANG) || "",
    lang: L.DEFAULT_LANG,
    dir: "ltr",
    start_url: "./index.html",
    scope: "./",
    display: "browser",
    background_color: "#FAFAF8",
    theme_color: "#AF5F39",
    icons: [
      { src: "assets/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "assets/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "assets/logo-mark.svg", sizes: "any", type: "image/svg+xml" }
    ]
  }, null, 2) + "\n";
}

function buildRobots(site) {
  const base = L.siteUrl(site);
  return [
    "# Обход разрешён полностью: закрывать на этом сайте нечего.",
    "User-agent: *",
    "Allow: /",
    "",
    base ? `Sitemap: ${base}sitemap.xml`
         : "# Sitemap: впишите домен в data/site.json и запустите node scripts/build-seo.js",
    ""
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Проверки заголовков и описаний                                      */
/* ------------------------------------------------------------------ */

const DESC_MAX = 160;

function checkTitlesAndDescriptions(pages) {
  const titles = new Map();
  const descs = new Map();

  for (const p of pages) {
    if (!p.title) { problem(`${p.rel}: нет <title>`); continue; }
    if (!p.description) { problem(`${p.rel}: нет meta description`); continue; }

    (titles.get(p.title) || titles.set(p.title, []).get(p.title)).push(p.rel);
    (descs.get(p.description) || descs.set(p.description, []).get(p.description)).push(p.rel);

    if (p.description.length > DESC_MAX) {
      problem(`${p.rel}: description ${p.description.length} символов, максимум ${DESC_MAX}`);
    }
  }
  for (const [t, list] of titles) {
    if (list.length > 1) problem(`одинаковый <title> на страницах: ${list.join(", ")} — «${t}»`);
  }
  for (const [d, list] of descs) {
    if (list.length > 1) problem(`одинаковый description на страницах: ${list.join(", ")}`);
  }
}

/* Часы работы в разметке должны совпадать с теми, что видит человек */
function checkHours(site) {
  const spec = site.openingHoursSpec || [];
  if (!spec.length) return;
  for (const lang of L.LANGS) {
    const shown = (L.pick(site.hours, lang) || []).map(h => h.time).join(" ");
    for (const s of spec) {
      for (const t of [s.opens, s.closes]) {
        if (t && shown.indexOf(t) === -1) {
          problem(`часы работы разошлись: в openingHoursSpec есть ${t}, а в hours.${lang} его нет`);
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Правка страниц                                                      */
/* ------------------------------------------------------------------ */

const MARKER = /([ \t]*)<!--\s*jsonld:start\s*-->[\s\S]*?<!--\s*jsonld:end\s*-->/;

function updatePage(site, page, values) {
  let html = page.html;
  const base = L.siteUrl(site);

  /* Страница ошибки закрыта от индексации — размечать её незачем */
  if (page.bare === "404.html") return html;

  /* og:url и картинки — на канонический адрес */
  const canonical = makeUrl(site, page.rel);
  const ogImage = makeUrl(site, "assets/og-image.png");

  html = html.replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${canonical}$2`);
  html = html.replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${ogImage}$2`);
  html = html.replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${ogImage}$2`);
  if (!/og:image:type/.test(html)) {
    html = html.replace(/(<meta property="og:image" content="[^"]*">\n)/,
      `$1  <meta property="og:image:type" content="image/png">\n`);
  }

  /* JSON-LD */
  const data = buildJsonLd(site, page, values);
  if (MARKER.test(html)) {
    html = html.replace(MARKER, (whole, indent) => {
      if (!data) return `${indent}<!-- jsonld:start -->\n${indent}<!-- jsonld:end -->`;
      const json = JSON.stringify(data, null, 2)
        .split("\n").map(l => indent + "  " + l).join("\n");
      return `${indent}<!-- jsonld:start -->\n` +
             `${indent}<script type="application/ld+json">\n${json}\n${indent}</script>\n` +
             `${indent}<!-- jsonld:end -->`;
    });
  } else {
    problem(`${page.rel}: нет меток <!-- jsonld:start --> / <!-- jsonld:end -->`);
  }

  if (!base) {
    note("домен не вписан в data/site.json — адреса в sitemap, og-тегах и разметке остались относительными");
  }
  return html;
}

/* ------------------------------------------------------------------ */

function run(options = {}) {
  const check = !!options.check;
  const site = L.loadSite();
  const pages = L.pageList().map(readPage);
  const values = {};

  /* значения из site.json по языкам (то же, что в sync-layout.js) */
  for (const lang of L.LANGS) {
    const phones = site.phones || [];
    values[lang] = {
      nameFull: site.name + (L.pick(site.nameSuffix, lang) || ""),
      phone: phones[0] ? phones[0].display : "",
      email: site.email || ""
    };
  }

  checkTitlesAndDescriptions(pages);
  checkHours(site);

  let changed = 0;
  for (const page of pages) {
    const updated = updatePage(site, page, values[page.lang]);
    if (updated !== page.html) {
      changed++;
      if (!check) fs.writeFileSync(path.join(L.ROOT, page.rel), updated, "utf8");
    }
  }

  const sitemap = buildSitemap(site, pages);
  const robots = buildRobots(site);
  const manifest = buildManifest(site);
  const manifestPath = path.join(L.ROOT, "manifest.webmanifest");
  const manifestStale = !fs.existsSync(manifestPath) ||
        fs.readFileSync(manifestPath, "utf8") !== manifest;
  if (!check && manifestStale) fs.writeFileSync(manifestPath, manifest, "utf8");
  const sitemapPath = path.join(L.ROOT, "sitemap.xml");
  const robotsPath = path.join(L.ROOT, "robots.txt");
  const sitemapStale = !fs.existsSync(sitemapPath) || fs.readFileSync(sitemapPath, "utf8") !== sitemap;
  const robotsStale = !fs.existsSync(robotsPath) || fs.readFileSync(robotsPath, "utf8") !== robots;

  if (!check) {
    if (sitemapStale) fs.writeFileSync(sitemapPath, sitemap, "utf8");
    if (robotsStale) fs.writeFileSync(robotsPath, robots, "utf8");
  }

  return {
    pages: pages.length,
    changed,
    sitemapStale,
    robotsStale,
    manifestStale,
    notes,
    problems
  };
}

function main() {
  const check = process.argv.includes("--check");
  const r = run({ check });
  console.log(`Страниц обработано: ${r.pages}`);
  console.log(check
    ? `Разметка отличается на страницах: ${r.changed}`
    : `Разметка обновлена на страницах: ${r.changed}`);
  console.log(`sitemap.xml: ${r.sitemapStale ? (check ? "устарел" : "обновлён") : "актуален"}`);
  console.log(`robots.txt:  ${r.robotsStale ? (check ? "устарел" : "обновлён") : "актуален"}`);
  if (r.notes.length) { console.log("\nЗамечания:"); for (const n of r.notes) console.log("  • " + n); }
  if (r.problems.length) {
    console.log(`\n✖  ПРОБЛЕМЫ SEO — ${r.problems.length} шт.`);
    for (const p of r.problems) console.log("   • " + p);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { run };
