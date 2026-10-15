/* Mickey & Edmund · The Engagement — page behaviour. */
(function () {
  var CFG = window.ENGAGEMENT_CONFIG || {};
  var root = document.documentElement;
  var $ = function (id) { return document.getElementById(id); };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  /* ---------- storage that never throws (private mode, in-app browsers) ---------- */
  function store(kind) {
    try { var s = window[kind]; s.setItem('_t', '1'); s.removeItem('_t'); return s; } catch (e) { return null; }
  }
  var session = store('sessionStorage');
  var local = store('localStorage');
  function sget(k) { try { return session && session.getItem(k); } catch (e) { return null; } }
  function sset(k, v) { try { if (session) session.setItem(k, v); } catch (e) {} }

  /* ---------- guest code from ?u= ---------- */
  var code = (new URLSearchParams(location.search).get('u') || '').trim();

  function joinNames(names) {
    if (names.length <= 1) return names[0] || '';
    if (names.length === 2) return names[0] + ' & ' + names[1];
    return names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1];
  }

  /* ---------- API, or preview mode with sample guests ---------- */
  var isDemo = !CFG.apiUrl;
  var DEMO_GIFT = [{ bank: 'Blu', currency: 'IDR', number: '1234 5678 9000', holder: 'Sample Account Name' }];
  var DEMO = {
    demo: { names: ['Mr. Budi Hartono', 'Mrs. Lina Wijaya'], seats: 2 },
    'demo-solo': { names: ['Jennifer'], seats: 1 },
    'demo-long': { names: ['Mr. Hardjanto Salim', 'Mrs. Sylvi Lutantowidjojo'], seats: 2 },
    'demo-title': { title: 'Mr. & Mrs.', names: ['Victor Chang'], seats: 2 },
    'demo-four': { names: ['Mr. Michael Tanoesoedibjo', 'Mrs. Angelina Kusumawardhani', 'Kevin', 'Clarissa'], seats: 4 }
  };
  function demoGuest(c) {
    var base = DEMO[c];
    if (!base) return null;
    var g = JSON.parse(JSON.stringify(base));
    g.rsvp = null;
    g.gift = DEMO_GIFT;
    try { var v = local && local.getItem('demo-rsvp-' + c); if (v !== null && v !== undefined && v !== '') g.rsvp = Number(v); } catch (e) {}
    return g;
  }
  function apiGet(c) {
    if (isDemo) return Promise.resolve(demoGuest(c.toLowerCase()));
    var url = CFG.apiUrl + (CFG.apiUrl.indexOf('?') < 0 ? '?' : '&') + 'action=guest&code=' + encodeURIComponent(c);
    return fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (d) { return d && d.ok ? d.guest : null; })
      .catch(function () { return null; });
  }
  // Resolves with the updated guest; rejects with a message to show.
  function apiSave(c, count) {
    if (isDemo) {
      var g = demoGuest(c.toLowerCase());
      if (!g) return Promise.reject(new Error('We could not find your invitation.'));
      try { if (local) local.setItem('demo-rsvp-' + c.toLowerCase(), String(count)); } catch (e) {}
      g.rsvp = count;
      return new Promise(function (res) { setTimeout(function () { res(g); }, 500); });
    }
    return fetch(CFG.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // a "simple" request: no CORS preflight
      body: JSON.stringify({ action: 'rsvp', code: c, count: count })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok) return d.guest;
        throw new Error(d && d.error === 'invalid_count'
          ? 'That number does not match your invitation. Please check and try again.'
          : 'We could not save your reply. Please try again.');
      }, function () { throw new Error('We could not reach the server. Please check your connection and try again.'); });
  }

  /* ---------- browser bar colour (WhatsApp / Safari): butter on the cover, white below ---------- */
  function barColor(c) { var m = $('theme-color'); if (m) m.setAttribute('content', c); }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (e) { barColor(e[0].isIntersecting ? '#FBE3B4' : '#FFFFFF'); }, { threshold: 0.15 }).observe($('cover'));
  }

  /* ---------- music ---------- */
  var music = (function () {
    var btn = $('music'), audio = null;
    if (!CFG.musicSrc || !btn) return { start: function () {} };
    btn.hidden = false;
    function sync() {
      var on = !!(audio && !audio.paused);
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', on ? 'Music on. Tap to turn off' : 'Music off. Tap to turn on');
    }
    function ensure() {
      if (audio) return audio;
      audio = new Audio(CFG.musicSrc);
      audio.loop = true;
      audio.volume = 0.6;
      audio.addEventListener('error', function () { btn.hidden = true; });
      audio.addEventListener('play', sync);
      audio.addEventListener('pause', sync);
      return audio;
    }
    function play() { var p = ensure().play(); if (p && p.then) p.then(function () { sset('music', 'on'); }, sync); }
    function pause() { if (audio) audio.pause(); sset('music', 'off'); }
    btn.addEventListener('click', function () { if (audio && !audio.paused) pause(); else play(); });
    sync();
    // Phones only allow sound after a tap, so the music starts on the guest's first tap or click
    // anywhere (e.g. "View Invitation"), unless they turned it off.
    var started = false;
    function first(e) {
      if (started) return;
      started = true;
      if (!(e.target && e.target.closest && e.target.closest('#music')) && sget('music') !== 'off') play();
      ['click', 'touchend', 'keydown'].forEach(function (t) { document.removeEventListener(t, first, true); });
    }
    ['click', 'touchend', 'keydown'].forEach(function (t) { document.addEventListener(t, first, true); });
    return { start: function () {} };
  })();

  /* ---------- cover: "View Invitation" scrolls to the first section ---------- */
  $('open').addEventListener('click', function (e) {
    e.preventDefault();
    var target = Array.prototype.find.call($('main').children, function (el) { return el.offsetHeight > 0; }) || $('main');
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  });

  function setCoverName(names, title) {
    var el = $('cover-guest');
    var text = joinNames(names);
    // Same greeting for everyone; an optional "Title" column in the sheet overrides it.
    document.querySelector('.cover__dear').textContent = 'Dear ' + (title || 'Mr/Mrs/Miss');
    el.textContent = text;
    el.classList.toggle('is-md', text.length > 24 && text.length <= 40);
    el.classList.toggle('is-sm', text.length > 40);
  }

  /* ---------- links from config ---------- */
  if (CFG.mapsUrl) $('maps').href = CFG.mapsUrl;
  if (CFG.storyUrl) $('story').href = CFG.storyUrl;
  if (CFG.rsvpDeadline) $('rsvp-deadline').textContent = 'Let us know by ' + CFG.rsvpDeadline;

  /* ---------- Save the Date: one button, right calendar per device ---------- */
  (function () {
    var ev = CFG.event;
    if (!ev) return;
    var ua = navigator.userAgent || '';
    var isApple = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    var isAndroid = /Android/i.test(ua);
    var cal = $('cal');
    if (isAndroid) {
      cal.href = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
        '&text=' + encodeURIComponent(ev.title) +
        '&dates=' + ev.start + '/' + ev.end +
        '&location=' + encodeURIComponent(ev.location) +
        '&details=' + encodeURIComponent(ev.details);
    } else {
      // iPhone opens Apple Calendar's "Add" sheet; laptops open Outlook / Apple Calendar.
      cal.href = 'assets/save-the-date.ics';
      if (isApple) cal.removeAttribute('target');
    }
  })();

  /* ---------- photo slideshows (intro on phones, beside the cover on laptops): 3 seconds per photo ---------- */
  document.querySelectorAll('.slideshow').forEach(function (show) {
    var slides = Array.prototype.slice.call(show.querySelectorAll('.slide'));
    var dots = Array.prototype.slice.call(show.querySelectorAll('.dots span'));
    if (slides.length < 2 || reduceMotion) return;
    var i = 0;
    setInterval(function () {
      if (document.hidden || !show.offsetParent) return; // skip when hidden
      slides[i].classList.remove('is-active');
      if (dots[i]) dots[i].classList.remove('is-active');
      i = (i + 1) % slides.length;
      slides[i].classList.add('is-active');
      if (dots[i]) dots[i].classList.add('is-active');
    }, 3000);
  });

  /* ---------- sections float in as they scroll into view ---------- */
  (function () {
    var els = document.querySelectorAll('.rv, .rv-photo, .orn, .sprig, main h2');
    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(els, function (el) { el.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    var seen = new Map();
    Array.prototype.forEach.call(els, function (el) {
      if (el.tagName === 'H2') el.classList.add('rv');
      var n = seen.get(el.parentNode) || 0;
      seen.set(el.parentNode, n + 1);
      if (el.classList.contains('rv-photo')) el.style.setProperty('--d', (n % 2) * 120 + 'ms');
      else el.style.setProperty('--d', Math.min(n, 5) * 80 + 'ms');
      io.observe(el);
    });
  })();

  /* ---------- tap a gallery photo: full-screen viewer with swipe ---------- */
  (function () {
    var imgs = Array.prototype.slice.call(document.querySelectorAll('.gallery .photo img'));
    if (!imgs.length) return;
    var box, view, count, index = 0, opener = null;
    var svg = function (d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>'; };
    function build() {
      box = document.createElement('div');
      box.className = 'lightbox';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', 'Photo viewer');
      box.innerHTML = '<p class="lightbox__count" aria-live="polite"></p><img alt="">' +
        '<button type="button" class="lightbox__btn lightbox__close" aria-label="Close">' + svg('M6 6l12 12M18 6L6 18') + '</button>' +
        '<button type="button" class="lightbox__btn lightbox__prev" aria-label="Previous photo">' + svg('M15 6l-6 6 6 6') + '</button>' +
        '<button type="button" class="lightbox__btn lightbox__next" aria-label="Next photo">' + svg('M9 6l6 6-6 6') + '</button>';
      view = box.querySelector('img');
      count = box.querySelector('.lightbox__count');
      box.querySelector('.lightbox__close').addEventListener('click', close);
      box.querySelector('.lightbox__prev').addEventListener('click', function () { show(index - 1); });
      box.querySelector('.lightbox__next').addEventListener('click', function () { show(index + 1); });
      box.addEventListener('click', function (e) { if (e.target === box) close(); });
      var x0 = null;
      box.addEventListener('touchstart', function (e) { x0 = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
      box.addEventListener('touchend', function (e) {
        if (x0 === null) return;
        var dx = e.changedTouches[0].clientX - x0;
        if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
        x0 = null;
      });
      document.body.appendChild(box);
    }
    function show(i) {
      index = (i + imgs.length) % imgs.length;
      view.src = imgs[index].currentSrc || imgs[index].src;
      view.alt = imgs[index].alt;
      count.textContent = (index + 1) + ' / ' + imgs.length;
    }
    function open(i, el) {
      if (!box) build();
      opener = el;
      show(i);
      root.classList.add('lightbox-open');
      box.hidden = false;
      requestAnimationFrame(function () { box.classList.add('is-open'); });
      box.querySelector('.lightbox__close').focus();
    }
    function close() {
      box.classList.remove('is-open');
      root.classList.remove('lightbox-open');
      box.hidden = true;
      if (opener) opener.focus();
    }
    document.addEventListener('keydown', function (e) {
      if (!box || box.hidden) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') show(index - 1);
      else if (e.key === 'ArrowRight') show(index + 1);
    });
    imgs.forEach(function (img, i) {
      var t = img.parentNode;
      t.classList.add('zoomable');
      t.setAttribute('tabindex', '0');
      t.setAttribute('role', 'button');
      t.setAttribute('aria-label', 'Enlarge photo: ' + img.alt);
      t.addEventListener('click', function () { open(i, t); });
      t.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(i, t); } });
    });
  })();

  /* ---------- RSVP ---------- */
  var guest = null;
  var state = { answer: null, count: 1 };
  var saved = null;      // { answer, count } as stored in the sheet
  var flash = null;      // which thank-you to show after the last save
  var saving = false;

  var MESSAGES = {
    yes: ['Yesss, you’re coming!', 'Our hearts and tummies are ready.'],
    no: ['Aww, we’ll miss you!', 'Sending love your way.'],
    updated: ['Updated, all good!', 'Thanks for keeping us in the loop.']
  };

  function isDirty() {
    if (!saved) return true;
    if (saved.answer !== state.answer) return true;
    return state.answer === 'yes' && saved.count !== state.count;
  }

  function paint() {
    document.querySelectorAll('.choice').forEach(function (c) {
      c.setAttribute('aria-pressed', String(state.answer === c.dataset.answer));
    });
    $('counter').hidden = state.answer !== 'yes';
    $('count').textContent = state.count;
    $('fewer').disabled = state.count <= 1;
    $('more').disabled = state.count >= guest.seats;

    var dirty = isDirty();
    var btn = $('rsvp-submit');
    btn.disabled = saving || !state.answer || !dirty;
    if (saving) btn.textContent = 'Sending…';
    else if (saved && !dirty) btn.innerHTML = ICON_CHECK + '<span>Submitted</span>';
    else btn.textContent = saved ? 'Update' : 'Submit';

    var done = $('rsvp-done');
    var showDone = !!(saved && !dirty && !saving && flash);
    done.hidden = !showDone;
    if (showDone) {
      var m = MESSAGES[flash];
      done.querySelector('.rsvp__done-title').textContent = m[0];
      done.querySelector('.rsvp__done-text').textContent = m[1];
      done.classList.toggle('is-no', saved.answer === 'no');
    }
  }

  function burst() {
    if (reduceMotion) return;
    var wrap = $('petals');
    wrap.textContent = '';
    var colors = ['#E9789B', '#F7D774', '#2F8F7A', '#F28C6B', '#F4A0BA'];
    for (var i = 0; i < 18; i++) {
      var p = document.createElement('span');
      p.className = 'petal';
      var a = Math.random() * Math.PI * 2, d = 90 + Math.random() * 90;
      p.style.background = colors[i % colors.length];
      p.style.setProperty('--dx', Math.round(Math.cos(a) * d) + 'px');
      p.style.setProperty('--dy', Math.round(Math.sin(a) * d * 0.8 + 40) + 'px');
      p.style.setProperty('--r', Math.round(Math.random() * 600 - 300) + 'deg');
      p.style.animationDelay = (i * 0.03).toFixed(2) + 's';
      wrap.appendChild(p);
    }
    setTimeout(function () { wrap.textContent = ''; }, 2600);
  }

  function savedFrom(rsvp) {
    if (rsvp === null || rsvp === undefined || rsvp === '') return null;
    var n = Number(rsvp);
    if (!isFinite(n)) return null;
    return n > 0 ? { answer: 'yes', count: Math.min(n, guest.seats) } : { answer: 'no', count: 1 };
  }

  function setupRsvp() {
    if (!guest) {
      $('rsvp-message').textContent = code
        ? 'We couldn’t find your invitation. Please check the link we sent you, or get in touch with us.'
        : 'Please open the personal link we sent you to reply.';
      return;
    }
    $('rsvp-message').hidden = true;
    $('invitee-names').textContent = (guest.title ? guest.title + ' ' : '') + joinNames(guest.names);
    $('invitee-seats').textContent = 'Your invitation covers ' + guest.seats + (guest.seats === 1 ? ' guest.' : ' guests.');
    saved = savedFrom(guest.rsvp);
    if (saved) state = { answer: saved.answer, count: saved.count };
    else state = { answer: null, count: guest.seats };
    $('rsvp-form').hidden = false;

    document.querySelectorAll('.choice').forEach(function (c) {
      c.addEventListener('click', function () {
        state.answer = c.dataset.answer;
        $('rsvp-error').hidden = true;
        paint();
      });
    });
    $('fewer').addEventListener('click', function () { state.count = Math.max(1, state.count - 1); paint(); });
    $('more').addEventListener('click', function () { state.count = Math.min(guest.seats, state.count + 1); paint(); });
    $('rsvp-form').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!state.answer || !isDirty() || saving) return;
      var wasSaved = !!saved;
      var sent = { answer: state.answer, count: state.count };
      saving = true;
      $('rsvp-error').hidden = true;
      paint();
      apiSave(code, sent.answer === 'yes' ? sent.count : 0).then(function () {
        saving = false;
        saved = sent;
        flash = wasSaved ? 'updated' : sent.answer;
        paint();
        if (sent.answer === 'yes') burst();
      }, function (err) {
        saving = false;
        paint();
        $('rsvp-error').textContent = err.message;
        $('rsvp-error').hidden = false;
      });
    });
    paint();
  }

  /* ---------- engagement gift (only sent by the server for a valid link) ---------- */
  function setupGift() {
    if (!guest || !guest.gift || !guest.gift.length) return;
    var wrap = $('accounts');
    $('gift-summary').textContent = guest.gift.map(function (a) { return a.bank + ' · ' + a.currency; }).join('  ·  ');
    guest.gift.forEach(function (a) {
      var d = document.createElement('div');
      d.className = 'account';
      d.innerHTML = '<span class="account__bank"></span><p class="account__num"></p><p class="account__holder"></p>' +
        '<button type="button" class="copy">Copy Number</button>';
      d.querySelector('.account__bank').textContent = a.bank;
      d.querySelector('.account__num').textContent = a.number;
      d.querySelector('.account__holder').textContent = 'Account name: ' + a.holder;
      var cb = d.querySelector('.copy');
      cb.addEventListener('click', function () {
        var raw = String(a.number).replace(/\s/g, '');
        var done = function () {
          cb.textContent = '✓ Copied';
          setTimeout(function () { cb.textContent = 'Copy Number'; }, 1800);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(raw).then(done, fallback);
        else fallback();
        function fallback() {
          var t = document.createElement('textarea');
          t.value = raw; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
          document.body.appendChild(t); t.select();
          try { document.execCommand('copy'); } catch (e) {}
          t.remove(); done();
        }
      });
      wrap.appendChild(d);
    });
    $('gift').hidden = false;
    $('gift-toggle').addEventListener('click', function () {
      var open = this.getAttribute('aria-expanded') !== 'true';
      this.setAttribute('aria-expanded', String(open));
      wrap.hidden = !open;
    });
  }

  /* ---------- preview badge ---------- */
  if (isDemo) {
    var b = document.createElement('div');
    b.className = 'demo-badge';
    b.textContent = 'Preview mode';
    document.body.appendChild(b);
  }

  /* ---------- go ---------- */
  (code ? apiGet(code) : Promise.resolve(null)).then(function (g) {
    guest = g;
    if (g && g.names && g.names.length) setCoverName(g.names, g.title);
    $('cover-guest').classList.add('is-ready');
    setupRsvp();
    setupGift();
  });
})();
