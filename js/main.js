/* ==========================================================================
   main.js — весь интерактив сайта.
   Обычный JavaScript, без библиотек. Подключается в конце index.html.
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------------------------------------------------
     1. МОБИЛЬНОЕ МЕНЮ (бургер)

     Что умеет:
       • открывается и закрывается по кнопке-бургеру;
       • закрывается по клавише Esc;
       • закрывается по клику вне меню (по затемнению или по любому месту
         страницы за пределами панели);
       • закрывается после нажатия на пункт меню;
       • закрывается сам, если экран стал широким (поворот телефона, планшет);
       • блокирует прокрутку страницы, пока открыто;
       • держит фокус клавиатуры внутри панели, пока она открыта.
     ---------------------------------------------------------------------- */

  var burger   = document.querySelector("[data-nav-toggle]");
  var nav      = document.querySelector("[data-nav]");
  var backdrop = document.querySelector("[data-nav-backdrop]");
  var header   = document.querySelector("[data-header]");

  // Та же граница, что и в layout.css (@media min-width: 64em).
  // Единицы em, а не пиксели: при увеличенном шрифте порог сдвигается вместе
  // с текстом. Если поменяете её в CSS — поменяйте и здесь.
  var desktopQuery = window.matchMedia("(min-width: 64em)");

  var isOpen = false;

  function openNav() {
    if (isOpen || !nav || !burger) return;
    isOpen = true;

    nav.classList.add("is-open");
    burger.setAttribute("aria-expanded", "true");
    updateHeader();
    document.body.classList.add("no-scroll");
    if (backdrop) backdrop.classList.add("is-visible");

    // Переводим фокус на первый пункт меню, чтобы с клавиатуры
    // сразу можно было идти по списку.
    var first = nav.querySelector("a, button");
    if (first) first.focus();
  }

  function closeNav(returnFocus) {
    if (!isOpen || !nav || !burger) return;
    isOpen = false;

    nav.classList.remove("is-open");
    burger.setAttribute("aria-expanded", "false");
    updateHeader();
    document.body.classList.remove("no-scroll");
    if (backdrop) backdrop.classList.remove("is-visible");

    // Возвращаем фокус на бургер — иначе он «потеряется» на скрытом элементе.
    if (returnFocus) burger.focus();
  }

  function toggleNav() {
    if (isOpen) {
      closeNav(true);
    } else {
      openNav();
    }
  }

  if (burger && nav) {

    burger.addEventListener("click", toggleNav);

    // Клик по затемнению
    if (backdrop) {
      backdrop.addEventListener("click", function () {
        closeNav(false);
      });
    }

    // Клик где угодно вне панели и вне кнопки
    document.addEventListener("click", function (event) {
      if (!isOpen) return;
      if (nav.contains(event.target) || burger.contains(event.target)) return;
      closeNav(false);
    });

    // Нажали на пункт меню — панель больше не нужна
    nav.addEventListener("click", function (event) {
      var link = event.target.closest("a");
      if (link) closeNav(false);
    });

    // Клавиатура: Esc закрывает, Tab не выпускает фокус из панели
    document.addEventListener("keydown", function (event) {
      if (!isOpen) return;

      if (event.key === "Escape" || event.key === "Esc") {
        event.preventDefault();
        closeNav(true);
        return;
      }

      if (event.key !== "Tab") return;

      // Удерживаем фокус внутри открытой панели
      var focusable = nav.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;

      var first = focusable[0];
      var last  = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    // Экран стал широким — меню и так видно строкой, панель закрываем
    function handleBreakpoint(event) {
      if (event.matches) closeNav(false);
    }

    if (typeof desktopQuery.addEventListener === "function") {
      desktopQuery.addEventListener("change", handleBreakpoint);
    } else if (typeof desktopQuery.addListener === "function") {
      // Запасной вариант для старых браузеров
      desktopQuery.addListener(handleBreakpoint);
    }
  }


  /* ------------------------------------------------------------------------
     2. ТЕНЬ У ШАПКИ ПРИ ПРОКРУТКЕ
     Пока страница вверху — шапка плоская. Прокрутили — появляется тень,
     чтобы шапка отделялась от содержимого.
     ---------------------------------------------------------------------- */

  /* Функция объявлена здесь, а не внутри блока ниже: её зовёт и меню,
     когда открывается поверх прозрачной шапки на главной. */
  function updateHeader() {
    if (!header) return;
    /* Шапка становится «плотной» либо от прокрутки, либо когда открыто
       меню: полупрозрачная шапка над белой панелью меню читалась бы плохо. */
    header.classList.toggle("is-scrolled", window.scrollY > 8 || isOpen);
  }

  if (header) {
    var ticking = false;

    function onScroll() {
      updateHeader();
      ticking = false;
    }

    window.addEventListener("scroll", function () {
      // requestAnimationFrame — чтобы не пересчитывать на каждый пиксель
      if (!ticking) {
        window.requestAnimationFrame(onScroll);
        ticking = true;
      }
    }, { passive: true });

    updateHeader();
  }


  /* ------------------------------------------------------------------------
     3. АККОРДЕОН «ЧАСТЫЕ ВОПРОСЫ»

     Сами вопросы работают на обычных <details> — они раскрываются даже
     при выключенном JavaScript. Скрипт лишь добавляет удобство:
     когда открывают один вопрос, остальные закрываются.
     ---------------------------------------------------------------------- */

  var faqGroups = document.querySelectorAll("[data-faq]");

  Array.prototype.forEach.call(faqGroups, function (group) {
    var items = group.querySelectorAll("details");

    Array.prototype.forEach.call(items, function (item) {
      item.addEventListener("toggle", function () {
        if (!item.open) return;
        Array.prototype.forEach.call(items, function (other) {
          if (other !== item) other.open = false;
        });
      });
    });
  });


  /* ------------------------------------------------------------------------
     4. ФИЛЬТР СТРАН ПО РЕГИОНАМ

     Карточки не перерисовываются и не пересобираются — лишние просто
     прячутся, а оставшиеся переезжают на новые места.

     Переезд сделан приёмом FLIP: сначала запоминаем, где карточка была,
     потом прячем ненужные и смотрим, куда карточка встала, потом мгновенно
     возвращаем её на старое место сдвигом (transform) и отпускаем. Браузер
     доигрывает сдвиг сам, на видеокарте: ни ширина, ни отступы при этом
     не пересчитываются, поэтому даже на слабом телефоне не дёргается.

     Без JavaScript кнопок фильтра не видно (правило в css/home.css),
     а карточки показаны все — раздел остаётся рабочим.
     ---------------------------------------------------------------------- */

  var countries = document.querySelector("[data-countries]");

  if (countries) {
    var grid  = countries.querySelector("[data-countries-grid]");
    var chips = countries.querySelectorAll(".chip");
    var cards = grid ? grid.querySelectorAll(".country") : [];
    var emptyNote = countries.querySelector("[data-countries-empty]");
    var lessMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    function filterCountries(region) {

      /* 1. Запоминаем, где карточки лежат сейчас */
      var before = [];
      Array.prototype.forEach.call(cards, function (card) {
        before.push(card.hidden ? null : card.getBoundingClientRect());
      });

      /* 2. Прячем лишние — сетка перестраивается */
      var shown = 0;
      Array.prototype.forEach.call(cards, function (card) {
        var match = region === "all" || card.getAttribute("data-region") === region;
        card.hidden = !match;
        if (match) shown++;
      });
      if (emptyNote) emptyNote.hidden = shown > 0;

      /* В системе просят меньше движения — на этом и заканчиваем:
         фильтр работает, просто без перестановки. */
      if (lessMotion.matches) return;

      /* 3. Возвращаем каждую карточку туда, где она была */
      Array.prototype.forEach.call(cards, function (card, i) {
        if (card.hidden) return;
        var now = card.getBoundingClientRect();
        var was = before[i];
        card.style.transition = "none";
        if (was) {
          var dx = was.left - now.left;
          var dy = was.top - now.top;
          if (!dx && !dy) { card.style.transition = ""; return; }
          card.style.transform = "translate(" + dx + "px, " + dy + "px)";
        } else {
          /* Карточка была спрятана и появляется заново */
          card.style.transform = "scale(0.94)";
          card.style.opacity = "0";
        }
      });

      /* 4. Заставляем браузер принять новое положение… */
      void grid.offsetWidth;

      /* …и отпускаем: дальше он доигрывает сам */
      Array.prototype.forEach.call(cards, function (card) {
        if (card.hidden) return;
        card.style.transition = "";
        card.style.transform = "";
        card.style.opacity = "";
      });
    }

    Array.prototype.forEach.call(chips, function (chip) {
      chip.addEventListener("click", function () {
        if (chip.getAttribute("aria-pressed") === "true") return;

        Array.prototype.forEach.call(chips, function (other) {
          other.setAttribute("aria-pressed", other === chip ? "true" : "false");
        });

        filterCountries(chip.getAttribute("data-region"));
      });
    });
  }


  /* ------------------------------------------------------------------------
     5. ПОЛОСА ЗВОНКА ВНИЗУ ЭКРАНА (только на телефоне, только на главной)

     Появляется, когда первый экран ушёл вверх: пока человек его читает,
     полоса не нужна и только закрывает содержимое. Пропадает, пока открыто
     меню, — иначе она наложилась бы на выехавшую панель.

     Ширину экрана проверяет CSS: полоса просто не показана на больших.
     Скрипт отвечает только за «когда», а не за «где».
     ---------------------------------------------------------------------- */

  var callbar = document.querySelector("[data-callbar]");

  if (callbar) {
    var hero = document.querySelector(".hero");
    var callbarTicking = false;

    function updateCallbar() {
      /* Порог — низ первого экрана. Нет первого экрана (другая страница) —
         показываем после первой же прокрутки. */
      var limit = hero ? hero.offsetHeight - 120 : 200;
      var show = window.scrollY > limit && !isOpen;
      callbar.hidden = !show;
      callbar.classList.toggle("is-shown", show);
      callbarTicking = false;
    }

    window.addEventListener("scroll", function () {
      if (!callbarTicking) {
        window.requestAnimationFrame(updateCallbar);
        callbarTicking = true;
      }
    }, { passive: true });

    /* Меню открылось или закрылось — пересчитываем сразу */
    document.addEventListener("click", function () {
      window.requestAnimationFrame(updateCallbar);
    });

    updateCallbar();
  }


  /* ------------------------------------------------------------------------
     6. СВЁРНУТЫЕ КОЛОНКИ ПОДВАЛА НА ТЕЛЕФОНЕ

     В разметке они открыты: без скриптов подвал должен работать как обычно,
     и на большом экране колонки тоже стоят раскрытыми. Здесь мы только
     закрываем их на узком экране, где они занимали пол-экрана повторением
     того же меню, что и в шапке.
     ---------------------------------------------------------------------- */

  var folds = document.querySelectorAll(".footer-fold");
  var narrowQuery = window.matchMedia("(max-width: 47.99em)");

  function syncFolds(matches) {
    Array.prototype.forEach.call(folds, function (fold) {
      /* Открыл человек сам — не трогаем */
      if (fold.dataset.touched) return;
      fold.open = !matches;
    });
  }

  if (folds.length) {
    Array.prototype.forEach.call(folds, function (fold) {
      fold.addEventListener("toggle", function () {
        /* На большом экране колонка не сворачивается: там это просто
           заголовок, и случайный клик по нему не должен прятать меню. */
        if (!narrowQuery.matches) {
          if (!fold.open) fold.open = true;
          return;
        }
        fold.dataset.touched = "1";
      });
    });
    syncFolds(narrowQuery.matches);
    if (typeof narrowQuery.addEventListener === "function") {
      narrowQuery.addEventListener("change", function (e) { syncFolds(e.matches); });
    } else if (typeof narrowQuery.addListener === "function") {
      narrowQuery.addListener(function (e) { syncFolds(e.matches); });
    }
  }


  /* ------------------------------------------------------------------------
     7. ГОД В СТРОКЕ КОПИРАЙТА
     Чтобы год в подвале не пришлось править руками каждый январь.
     ---------------------------------------------------------------------- */

  var yearEl = document.querySelector("[data-current-year]");
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }


  /* ------------------------------------------------------------------------
     8. ВЫБОР СТРАНЫ НА СТРАНИЦЕ ВИЗЫ

     Кнопки стран — настоящие ссылки на отдельные страницы этих стран.
     Без скриптов нажатие туда и уводит, и выбор работает. Здесь мы этот
     переход перехватываем и подменяем содержимое на месте: данные всех
     двенадцати уже лежат в разметке, поэтому на сервер идти не за чем.

     Адрес при этом меняется на #страна — чтобы ссылкой можно было
     поделиться и чтобы «назад» возвращала к прежней стране, а не уносила
     со страницы.
     ---------------------------------------------------------------------- */

  var picker = document.querySelector(".picker");
  if (picker) {
    var bar = picker.querySelector(".picker__bar");
    var chips = [].slice.call(picker.querySelectorAll(".picker__chip"));
    var panels = [].slice.call(picker.querySelectorAll(".picker__panel"));

    var показать = function (slug, сдвигать) {
      var есть = false;
      chips.forEach(function (chip) {
        var свой = chip.dataset.country === slug;
        if (свой) есть = true;
        chip.classList.toggle("is-on", свой);
        chip.setAttribute("aria-selected", свой ? "true" : "false");
        chip.tabIndex = свой ? 0 : -1;
      });
      if (!есть) return false;
      panels.forEach(function (panel) {
        var свой = panel.dataset.country === slug;
        if (свой && panel.hidden) {
          /* Перезапуск проявления: без этого панель, показанная второй
             раз, появлялась бы рывком — анимация уже отыграна. */
          panel.style.animation = "none";
          panel.hidden = false;
          void panel.offsetWidth;
          panel.style.animation = "";
        } else if (!свой) {
          panel.hidden = true;
        }
      });
      /* Выбранную кнопку подтягиваем в видимую часть ленты: на телефоне
         двенадцатая страна иначе осталась бы за краем экрана. */
      var выбранная = picker.querySelector('.picker__chip[aria-selected="true"]');
      if (выбранная && bar && bar.scrollWidth > bar.clientWidth) {
        var л = выбранная.offsetLeft, ш = выбранная.offsetWidth;
        if (л < bar.scrollLeft || л + ш > bar.scrollLeft + bar.clientWidth) {
          bar.scrollLeft = Math.max(0, л - (bar.clientWidth - ш) / 2);
        }
      }
      if (сдвигать) выбранная.focus();
      return true;
    };

    bar.addEventListener("click", function (event) {
      var chip = event.target.closest(".picker__chip");
      if (!chip) return;
      /* Открыть в новой вкладке — это переход на отдельную страницу
         страны, и мешать ему нельзя. */
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      var slug = chip.dataset.country;
      if (!показать(slug, false)) return;
      event.preventDefault();
      if (history.pushState) history.pushState({ country: slug }, "", "#" + slug);
      else location.hash = slug;
    });

    /* Стрелками по ленте — так же, как это принято у вкладок. */
    bar.addEventListener("keydown", function (event) {
      var шаг = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!шаг) return;
      var сейчас = chips.findIndex(function (c) { return c.getAttribute("aria-selected") === "true"; });
      var следующий = chips[(сейчас + шаг + chips.length) % chips.length];
      if (!следующий) return;
      event.preventDefault();
      показать(следующий.dataset.country, true);
      if (history.replaceState) history.replaceState(null, "", "#" + следующий.dataset.country);
    });

    var изАдреса = function () {
      var slug = decodeURIComponent(String(location.hash || "").replace(/^#/, ""));
      /* Пустой адрес — это начало пути: «назад» с последнего выбора
         должна вернуть первую страну, а не оставить показанной ту,
         от которой человек только что ушёл. */
      if (!slug && chips.length) slug = chips[0].dataset.country;
      if (slug) показать(slug, false);
    };
    window.addEventListener("popstate", изАдреса);
    изАдреса();
  }

})();
