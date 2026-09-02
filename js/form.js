/* ==========================================================================
   form.js — форма заявки на странице habarlasmak.html

   У сайта нет сервера, поэтому форма ничего никуда не отправляет сама.
   Она собирает из полей аккуратное сообщение и даёт три кнопки:
   отправить в мессенджер, отправить почтой, скопировать текст.

   Без JavaScript форма остаётся видимой, а телефон, мессенджеры и почта
   над ней работают как обычные ссылки.
   ========================================================================== */

(function () {
  "use strict";

  var form = document.querySelector("[data-request-form]");
  if (!form) return;

  var statusBox = form.querySelector("[data-form-status]");
  var previewBox = form.querySelector("[data-form-preview]");

  /* ------------------------------------------------------------------
     Тексты формы на трёх языках. Нужный набор выбирается по атрибуту
     lang у страницы: русскому посетителю ошибки и письмо приходят
     по-русски, а не по-туркменски.
     ------------------------------------------------------------------ */
  var LANG = (document.documentElement.getAttribute("lang") || "tk").slice(0, 2);
  if (["tk", "ru", "en"].indexOf(LANG) === -1) LANG = "tk";

  var TEXTS = {
    tk: {
      nameEmpty:  "Adyňyzy ýazyň.",
      phoneEmpty: "Telefon belgiňizi ýazyň.",
      phoneShort: "Telefon belgisi doly däl. Meselem: +993 6X XX XX XX",
      copied:      "Tekst göçürildi.",
      copiedPaste: "Tekst göçürildi. Ony {app} arkaly {value} belgä iberiň.",
      copyFailed:  "Göçürip bolmady. Teksti aşakdan saýlap, el bilen göçüriň.",
      mailOpened:  "Poçta programmasy açylýar. Açylmasa — teksti göçürip iberiň.",
      appOpened:   "Habarçy açylýar. Açylmasa — teksti göçürip iberiň.",
      subject: "Wiza boýunça haýyş",
      title:   "Wiza boýunça haýyş",
      sentVia: "{name} saýtyndaky forma arkaly",
      labels: {
        name: "Ady", phone: "Telefon", visa: "Wiza görnüşi",
        country: "Ýurt", dates: "Meýilleşdirilen möhlet", comment: "Bellik"
      }
    },
    ru: {
      nameEmpty:  "Напишите ваше имя.",
      phoneEmpty: "Напишите номер телефона.",
      phoneShort: "Номер неполный. Например: +993 6X XX XX XX",
      copied:      "Текст скопирован.",
      copiedPaste: "Текст скопирован. Отправьте его через {app} на номер {value}.",
      copyFailed:  "Скопировать не удалось. Выделите текст ниже и скопируйте вручную.",
      mailOpened:  "Открывается почтовая программа. Если не открылась — скопируйте текст и отправьте сами.",
      appOpened:   "Открывается мессенджер. Если не открылся — скопируйте текст и отправьте сами.",
      subject: "Заявка на визу",
      title:   "Заявка на визу",
      sentVia: "отправлено через форму на сайте {name}",
      labels: {
        name: "Имя", phone: "Телефон", visa: "Тип визы",
        country: "Страна", dates: "Планируемые сроки", comment: "Комментарий"
      }
    },
    en: {
      nameEmpty:  "Please enter your name.",
      phoneEmpty: "Please enter your phone number.",
      phoneShort: "The number looks incomplete. For example: +993 6X XX XX XX",
      copied:      "Text copied.",
      copiedPaste: "Text copied. Send it via {app} to {value}.",
      copyFailed:  "Could not copy. Select the text below and copy it manually.",
      mailOpened:  "Opening your email app. If it does not open, copy the text and send it yourself.",
      appOpened:   "Opening the messenger. If it does not open, copy the text and send it yourself.",
      subject: "Visa enquiry",
      title:   "Visa enquiry",
      sentVia: "sent through the form on {name}",
      labels: {
        name: "Name", phone: "Phone", visa: "Visa type",
        country: "Country", dates: "Planned dates", comment: "Comment"
      }
    }
  };

  var T = TEXTS[LANG];
  var MESSAGES = T;

  /* ------------------------------------------------------------------
     1. Проверка полей
     ------------------------------------------------------------------ */

  function setError(field, message) {
    var wrap = field.closest(".field");
    var error = wrap.querySelector(".field__error");

    if (message) {
      wrap.setAttribute("data-invalid", "");
      field.setAttribute("aria-invalid", "true");
      error.textContent = message;
    } else {
      wrap.removeAttribute("data-invalid");
      field.removeAttribute("aria-invalid");
      error.textContent = "";
    }
  }

  function countDigits(value) {
    return (value.match(/\d/g) || []).length;
  }

  function validate() {
    var firstBad = null;

    var name = form.elements.name;
    if (!name.value.trim()) {
      setError(name, MESSAGES.nameEmpty);
      firstBad = firstBad || name;
    } else {
      setError(name, "");
    }

    var phone = form.elements.phone;
    var phoneValue = phone.value.trim();
    if (!phoneValue) {
      setError(phone, MESSAGES.phoneEmpty);
      firstBad = firstBad || phone;
    } else if (countDigits(phoneValue) < 6) {
      setError(phone, MESSAGES.phoneShort);
      firstBad = firstBad || phone;
    } else {
      setError(phone, "");
    }

    if (firstBad) firstBad.focus();
    return !firstBad;
  }

  /* ------------------------------------------------------------------
     2. Сборка сообщения
     ------------------------------------------------------------------ */

  var LABELS = T.labels;

  var ORDER = ["name", "phone", "visa", "country", "dates", "comment"];

  function buildMessage() {
    var lines = [T.title];
    lines.push("");

    ORDER.forEach(function (key) {
      var field = form.elements[key];
      if (!field) return;
      var value = field.value.trim();
      if (!value) return;                       // пустые поля не пишем
      lines.push(LABELS[key] + ": " + value);
    });

    lines.push("");
    /* Название компании — последняя часть заголовка вкладки:
       «Habarlaşmak — Täsin Dünýä Syýahat» */
    var parts = document.title.split("\u2014");
    var company = parts[parts.length - 1].trim();
    lines.push("(" + T.sentVia.replace("{name}", company) + ")");

    return lines.join("\n");
  }

  function updatePreview() {
    if (previewBox) previewBox.textContent = buildMessage();
  }

  /* ------------------------------------------------------------------
     3. Строка состояния
     ------------------------------------------------------------------ */

  function showStatus(text) {
    if (!statusBox) return;
    statusBox.textContent = text;
    statusBox.hidden = false;
  }

  /* ------------------------------------------------------------------
     4. Копирование в буфер обмена
     ------------------------------------------------------------------ */

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    /* Запасной путь для старых браузеров */
    return new Promise(function (resolve, reject) {
      var area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(area);
      ok ? resolve() : reject();
    });
  }

  /* ------------------------------------------------------------------
     5. Кнопки
     ------------------------------------------------------------------ */

  /* Первый мессенджер, у которого есть ссылка с {text} */
  function findShareTarget() {
    var cards = document.querySelectorAll("[data-form-url]");
    for (var i = 0; i < cards.length; i++) {
      var url = cards[i].getAttribute("data-form-url");
      if (url) return { url: url, card: cards[i] };
    }
    return null;
  }

  /* Первый мессенджер вообще — чтобы подсказать, куда вставить текст */
  function firstMessenger() {
    var card = document.querySelector("[data-messenger]");
    if (!card) return null;
    var value = card.querySelector(".contact-card__value");
    return {
      app: card.getAttribute("data-messenger"),
      value: value ? value.textContent.trim() : ""
    };
  }

  function sendToMessenger() {
    if (!validate()) return;
    var text = buildMessage();
    var target = findShareTarget();

    if (target) {
      window.open(target.url.replace("{text}", encodeURIComponent(text)), "_blank", "noopener");
      showStatus(MESSAGES.appOpened);
      return;
    }

    /* У IMO нет ссылки для готового текста — копируем и подсказываем,
       куда его вставить. */
    var m = firstMessenger();
    copyText(text).then(function () {
      showStatus(m
        ? MESSAGES.copiedPaste.replace("{app}", m.app).replace("{value}", m.value)
        : MESSAGES.copied);
    }, function () {
      showStatus(MESSAGES.copyFailed);
    });
  }

  function sendByMail(event) {
    if (!validate()) {
      event.preventDefault();
      return;
    }
    var link = event.currentTarget;
    /* Адрес почты берём из блока контактов выше — он приходит из site.json */
    var mailCard = document.querySelector('a.contact-card[href^="mailto:"]');
    var address = mailCard ? mailCard.getAttribute("href").replace("mailto:", "") : "";
    link.setAttribute("href",
      "mailto:" + address +
      "?subject=" + encodeURIComponent(T.subject) +
      "&body=" + encodeURIComponent(buildMessage()));
    showStatus(MESSAGES.mailOpened);
  }

  function copyOnly() {
    if (!validate()) return;
    copyText(buildMessage()).then(function () {
      showStatus(MESSAGES.copied);
    }, function () {
      showStatus(MESSAGES.copyFailed);
    });
  }

  /* ------------------------------------------------------------------
     6. Подключение
     ------------------------------------------------------------------ */

  var messengerBtn = form.querySelector("[data-action=messenger]");
  var mailBtn = form.querySelector("[data-action=mail]");
  var copyBtn = form.querySelector("[data-action=copy]");

  /* Если в data/site.json не указан ни один мессенджер, блоков с ними
     на странице нет — и кнопка «отправить в мессенджер» вести никуда.
     Прячем её, а отправку почтой делаем главным действием.
     Появится мессенджер — кнопка вернётся сама. */
  var hasMessenger = !!document.querySelector("[data-messenger]");

  if (messengerBtn && !hasMessenger) {
    messengerBtn.hidden = true;
    if (mailBtn) {
      mailBtn.classList.remove("btn--secondary");
      mailBtn.classList.add("btn--primary");
    }
  }

  if (messengerBtn) messengerBtn.addEventListener("click", sendToMessenger);
  if (mailBtn) mailBtn.addEventListener("click", sendByMail);
  if (copyBtn) copyBtn.addEventListener("click", copyOnly);

  /* Отправку страницы не делаем — сервера нет */
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (hasMessenger) sendToMessenger();
    else copyOnly();
  });

  /* Ошибка убирается, как только человек начал исправлять поле */
  ["name", "phone"].forEach(function (key) {
    var field = form.elements[key];
    if (field) field.addEventListener("input", function () { setError(field, ""); });
  });

  form.addEventListener("input", updatePreview);
  updatePreview();

})();
