/* ==========================================================================
   motion.js — появление блоков при прокрутке.

   На весь сайт один наблюдатель (IntersectionObserver). Отдельных скриптов
   для отдельных секций нет и быть не должно: если понадобилось оживить ещё
   один блок, ему дописывают атрибут в разметке, а не новый файл.

   Как размечать:

     <div data-reveal>            блок поднимается снизу и проявляется;
     <div data-reveal="fade">     только проявляется, без подъёма;
     <ul  data-reveal-group>      дети появляются по очереди, с нарастающей
                                  задержкой (--stagger в tokens.css);
     <section data-reveal="dash"> сам блок не двигается — «бежит» пунктирный
                                  разделитель над ним.

   Само оформление живёт в css/base.css, здесь только момент включения.

   Движения не будет вовсе, если:
     • в системе включено «уменьшить движение»;
     • браузер не умеет IntersectionObserver.
   В обоих случаях страница просто показана целиком — ничего не спрятано.
   Прячет блоки CSS, и только когда у <html> есть класс js, который ставит
   строка в <head>. Без JavaScript класса нет, значит, и прятать нечего.
   ========================================================================== */

(function () {
  "use strict";

  var GROUP = "[data-reveal-group]";
  var SINGLE = "[data-reveal]";

  if (!("IntersectionObserver" in window)) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  /* Что показываем, когда сработает наблюдатель. Ключ — элемент, за которым
     следим, значение — список элементов, которым ставим класс.
     У одиночного блока это он сам, у списка — его дети. */
  var targets = new WeakMap();
  var watched = [];

  /* --- Списки: дети появляются друг за другом ---------------------------- */
  Array.prototype.forEach.call(document.querySelectorAll(GROUP), function (group) {
    var items = Array.prototype.filter.call(group.children, function (node) {
      return node.nodeType === 1;
    });
    if (!items.length) return;

    /* Порядковый номер ребёнка. CSS умножает его на --stagger и получает
       задержку: первый появляется сразу, третий — на 140 мс позже. */
    items.forEach(function (item, index) {
      item.style.setProperty("--i", String(index));
    });

    targets.set(group, items);
    watched.push(group);
  });

  /* --- Одиночные блоки ---------------------------------------------------- */
  Array.prototype.forEach.call(document.querySelectorAll(SINGLE), function (el) {
    /* Если блок лежит внутри списка, им уже занимается список */
    if (el.parentElement && el.parentElement.closest(GROUP)) return;
    targets.set(el, [el]);
    watched.push(el);
  });

  if (!watched.length) return;

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;

      var list = targets.get(entry.target);
      if (list) {
        list.forEach(function (el) {
          el.classList.add("is-visible");
        });
      }
      /* Показали один раз — больше следить незачем */
      observer.unobserve(entry.target);
    });
  }, {
    /* Блок считается «в кадре», когда поднялся выше нижней кромки экрана
       примерно на десятую её часть: так появление успевает закончиться
       к моменту, когда читатель до блока доберётся. */
    rootMargin: "0px 0px -8% 0px",
    threshold: 0.05
  });

  watched.forEach(function (el) {
    observer.observe(el);
  });

})();

/* ==========================================================================
   Первый экран: самолётик вокруг кнопки и остановка вечного движения.

   Отдельный кусок, а не отдельный файл. Наблюдатель выше показывает блок
   один раз и перестаёт следить; здесь нужен другой — он следит постоянно,
   потому что первый экран уходит и возвращается.

   Что делает:
     1. считает путь самолётику по настоящему размеру кнопки и
        пересчитывает его, когда размер меняется;
     2. ставит первому экрану метку is-still, когда он ушёл с глаз или
        вкладку свернули. По метке css/home.css замораживает бесконечные
        анимации — они не тратят батарею, пока на них никто не смотрит.
   ========================================================================== */

(function () {
  "use strict";

  /* --- Путь вокруг кнопки ------------------------------------------------- */

  /* Скруглённый прямоугольник по контуру кнопки. Координаты считаются от
     угла обёртки: самолёт лежит в ней абсолютно, и offset-path отсчитывает
     путь именно оттуда. Надписи на трёх языках разной длины, поэтому путь
     нельзя записать в стилях числом — только посчитать по месту. */
  function roundedRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    var n = function (v) { return Math.round(v * 10) / 10; };
    var x0 = n(x), y0 = n(y), x1 = n(x + w), y1 = n(y + h), k = n(r);
    var a = k + " " + k + " 0 0 1 ";
    return 'path("M' + n(x0 + k) + " " + y0 +
           " H" + n(x1 - k) + " A" + a + x1 + " " + n(y0 + k) +
           " V" + n(y1 - k) + " A" + a + n(x1 - k) + " " + y1 +
           " H" + n(x0 + k) + " A" + a + x0 + " " + n(y1 - k) +
           " V" + n(y0 + k) + " A" + a + n(x0 + k) + " " + y0 + ' Z")';
  }

  var orbits = Array.prototype.slice.call(document.querySelectorAll(".orbit"));

  function sync(orbit) {
    var btn = orbit.querySelector(".btn");
    if (!btn) return;
    var ob = orbit.getBoundingClientRect();
    var bb = btn.getBoundingClientRect();
    if (!bb.width || !bb.height) return;
    var radius = parseFloat(getComputedStyle(btn).borderTopLeftRadius) || 0;
    orbit.style.setProperty("--orbit-path",
      roundedRect(bb.left - ob.left, bb.top - ob.top, bb.width, bb.height, radius));
    orbit.classList.add("is-ready");
  }

  function syncAll() {
    orbits.forEach(sync);
  }

  if (orbits.length) {
    syncAll();

    /* Размер кнопки меняется не только от ширины окна: сначала надпись
       набрана запасным шрифтом, потом приезжает фирменный и кнопка
       становится другой. ResizeObserver ловит и то и другое. */
    if ("ResizeObserver" in window) {
      var ro = new ResizeObserver(function (entries) {
        entries.forEach(function (e) {
          var orbit = e.target.closest ? e.target.closest(".orbit") : null;
          if (orbit) sync(orbit);
        });
      });
      orbits.forEach(function (orbit) {
        var btn = orbit.querySelector(".btn");
        if (btn) ro.observe(btn);
      });
    } else {
      window.addEventListener("resize", syncAll);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncAll);
    }
  }

  /* --- Вечное движение спит, пока на него не смотрят -----------------------

     Бесконечных анимаций на странице несколько: маршруты в первом экране
     и самолётик на каждом разделителе между секциями. Разделителей пять,
     и если каждый будет крутить своё движение всё время, пока открыта
     вкладка, это заметно на слабом телефоне — при том что видно из них
     от силы один.

     Поэтому каждый такой блок следит за собой сам: ушёл с экрана —
     движение замирает, вернулся — продолжается с того же места. И всё
     разом останавливается, когда вкладку свернули. */

  var живые = [].slice.call(document.querySelectorAll('.hero, .section[data-reveal="dash"]'));
  if (!живые.length) return;

  var вкладкаАктивна = !document.hidden;
  var наГлазах = new WeakMap();
  живые.forEach(function (el) { наГлазах.set(el, true); });

  function пересчитать(el) {
    var идёт = вкладкаАктивна && наГлазах.get(el) !== false;
    el.classList.toggle("is-still", !идёт);
  }
  function пересчитатьВсе() { живые.forEach(пересчитать); }

  if ("IntersectionObserver" in window) {
    /* Свой наблюдатель: этот следит постоянно, а не один раз */
    var сторож = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        наГлазах.set(entry.target, entry.isIntersecting);
        пересчитать(entry.target);
      });
    }, { threshold: 0 });
    живые.forEach(function (el) { сторож.observe(el); });
  }

  document.addEventListener("visibilitychange", function () {
    вкладкаАктивна = !document.hidden;
    пересчитатьВсе();
  });

  пересчитатьВсе();
})();
