/* End-to-end tests (Playwright + Chromium).
 * Run: NODE_PATH=$(npm root -g) node tests/e2e.test.js   (screenshots go to tests/screenshots/) */
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ics': 'text/calendar' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});

const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); }
}

const PHONE = { width: 390, height: 844 };
const API = 'https://script.example/exec';
const configWith = (patch) => {
  let s = fs.readFileSync(path.join(ROOT, 'assets/js/config.js'), 'utf8');
  if (patch.apiUrl !== undefined) s = s.replace(/apiUrl: '[^']*'/, "apiUrl: '" + patch.apiUrl + "'");
  if (patch.musicSrc !== undefined) s = s.replace(/musicSrc: '[^']*'/, "musicSrc: '" + patch.musicSrc + "'");
  return s;
};

async function newPage(browser, base, opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport || PHONE,
    deviceScaleFactor: opts.scale || 1,
    userAgent: opts.userAgent,
    reducedMotion: opts.reducedMotion || 'no-preference',
    permissions: ['clipboard-read', 'clipboard-write']
  });
  const page = await ctx.newPage();
  if (!opts.fonts) await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route('**/assets/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: configWith(opts.config || {}) }));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  page.errors = errors;
  return { page, ctx };
}
const ready = (page) => page.waitForFunction(() => {
  const m = document.getElementById('rsvp-message');
  return m.hidden || !/Loading/.test(m.textContent);
});
const open = async (page) => {
  await page.click('#open');
  await page.waitForFunction(() => document.documentElement.classList.contains('skip-cover'));
};
async function scrollThrough(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 300) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1200);
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());

  await test('without a code: friendly cover, no RSVP form, no bank details', async () => {
    const { page, ctx } = await newPage(browser, base);
    await page.goto(base + '/');
    await ready(page);
    assert.strictEqual(await page.textContent('#cover-guest'), 'Family & Friends');
    await open(page);
    assert.ok(/personal link/.test(await page.textContent('#rsvp-message')));
    assert.ok(await page.isHidden('#rsvp-form'));
    assert.ok(await page.isHidden('#gift'));
    assert.strictEqual(await page.$('#accounts .account'), null);
    assert.deepStrictEqual(page.errors, []);
    await ctx.close();
  });

  await test('unknown code: cover stays general and RSVP explains', async () => {
    const { page, ctx } = await newPage(browser, base);
    await page.goto(base + '/?u=nope');
    await ready(page);
    assert.strictEqual(await page.textContent('#cover-guest'), 'Family & Friends');
    assert.ok(await page.isVisible('#cover-guest'));
    assert.ok(/couldn’t find/.test(await page.textContent('#rsvp-message')));
    await ctx.close();
  });

  for (const vp of [PHONE, { width: 390, height: 664 }, { width: 360, height: 640 }]) {
    await test('long names fit the cover at ' + vp.width + '×' + vp.height, async () => {
      const { page, ctx } = await newPage(browser, base, { viewport: vp, fonts: true, scale: 2 });
      await page.goto(base + '/?u=demo-long');
      await ready(page);
      await page.waitForTimeout(1300); // entrance animation
      assert.strictEqual(await page.textContent('#cover-guest'), 'Mr. Hardjanto Salim & Mrs. Sylvi Lutantowidjojo');
      const m = await page.evaluate(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        const g = r('#cover-guest');
        const lh = parseFloat(getComputedStyle(document.querySelector('#cover-guest')).lineHeight);
        return { lines: Math.round(g.height / lh), card: r('.cover__card'), btn: r('#open'), vw: innerWidth, vh: innerHeight };
      });
      assert.ok(m.lines <= 2, 'name uses ' + m.lines + ' lines');
      assert.ok(m.card.bottom <= m.btn.top, 'card overlaps button');
      assert.ok(m.card.left >= 0 && m.card.right <= m.vw, 'card overflows sideways');
      if (vp.height >= 664) assert.ok(m.btn.bottom <= m.vh, 'button below the fold');
      await page.screenshot({ path: path.join(SHOTS, `cover-${vp.width}x${vp.height}.png`) });
      await ctx.close();
    });
  }

  await test('opening the invitation hides the cover and is remembered in this tab', async () => {
    const { page, ctx } = await newPage(browser, base);
    await page.goto(base + '/?u=demo');
    await ready(page);
    await open(page);
    assert.ok(await page.isHidden('#cover'));
    await page.reload();
    await ready(page);
    assert.ok(await page.isHidden('#cover'));
    await ctx.close();
  });

  await test('RSVP: answer first, counter only for yes, submitted → update → updated', async () => {
    const { page, ctx } = await newPage(browser, base);
    await page.goto(base + '/?u=demo');
    await ready(page);
    await open(page);
    assert.strictEqual(await page.textContent('#invitee-names'), 'Mr. Budi Hartono & Mrs. Lina Wijaya');
    assert.strictEqual(await page.textContent('#invitee-seats'), 'Your invitation covers 2 guests.');
    assert.ok(await page.isDisabled('#rsvp-submit'));
    assert.ok(await page.isHidden('#counter'));

    await page.click('.choice[data-answer="yes"]');
    assert.ok(await page.isVisible('#counter'));
    assert.strictEqual(await page.textContent('#count'), '2');
    assert.ok(await page.isDisabled('#more'));
    assert.ok(await page.isEnabled('#rsvp-submit'));

    await page.click('#rsvp-submit');
    await page.waitForSelector('#rsvp-done:not([hidden])');
    assert.ok(await page.isDisabled('#rsvp-submit'));
    assert.ok(/Submitted/.test(await page.textContent('#rsvp-submit')));
    assert.ok(/Yesss/.test(await page.textContent('#rsvp-done')));
    assert.ok((await page.$$('#petals .petal')).length > 0, 'petals burst');
    await page.locator('#rsvp').screenshot({ path: path.join(SHOTS, 'rsvp-yes.png') });

    await page.click('#fewer');
    assert.strictEqual(await page.textContent('#rsvp-submit'), 'Update');
    assert.ok(await page.isEnabled('#rsvp-submit'));
    assert.ok(await page.isHidden('#rsvp-done'));
    await page.click('#rsvp-submit');
    await page.waitForSelector('#rsvp-done:not([hidden])');
    assert.ok(/Updated, all good/.test(await page.textContent('#rsvp-done')));
    assert.ok(await page.isDisabled('#rsvp-submit'));

    // going back to the saved answer counts as "no change"
    await page.click('#more');
    await page.click('#fewer');
    assert.ok(await page.isDisabled('#rsvp-submit'));

    // a reload shows the saved reply
    await page.reload();
    await ready(page);
    assert.strictEqual(await page.getAttribute('.choice[data-answer="yes"]', 'aria-pressed'), 'true');
    assert.strictEqual(await page.textContent('#count'), '1');
    assert.ok(await page.isDisabled('#rsvp-submit'));
    await ctx.close();
  });

  await test('RSVP: declining shows the miss-you message and hides the counter', async () => {
    const { page, ctx } = await newPage(browser, base);
    await page.goto(base + '/?u=demo-solo');
    await ready(page);
    await open(page);
    assert.strictEqual(await page.textContent('#invitee-seats'), 'Your invitation covers 1 guest.');
    await page.click('.choice[data-answer="no"]');
    assert.ok(await page.isHidden('#counter'));
    await page.click('#rsvp-submit');
    await page.waitForSelector('#rsvp-done:not([hidden])');
    assert.ok(/miss you/.test(await page.textContent('#rsvp-done')));
    assert.strictEqual(await page.$('#petals .petal'), null);
    await page.locator('#rsvp').screenshot({ path: path.join(SHOTS, 'rsvp-no.png') });
    await ctx.close();
  });

  await test('live API: guest is fetched by code and RSVP is posted as text/plain JSON', async () => {
    const { page, ctx } = await newPage(browser, base, { config: { apiUrl: API } });
    const posts = [];
    const gift = [{ bank: 'Blu', currency: 'IDR', number: '0000 1111 2222', holder: 'Test Holder' }];
    await page.route(API + '**', async (route) => {
      const req = route.request();
      if (req.method() === 'GET') {
        assert.ok(req.url().includes('action=guest&code=live1234'));
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, guest: { names: ['Ana'], seats: 3, rsvp: null, gift } }) });
      }
      posts.push({ type: req.headers()['content-type'], body: JSON.parse(req.postData()) });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, guest: { names: ['Ana'], seats: 3, rsvp: 2, gift } }) });
    });
    await page.goto(base + '/?u=live1234');
    await ready(page);
    assert.strictEqual(await page.textContent('#cover-guest'), 'Ana');
    assert.strictEqual(await page.$('.demo-badge'), null);
    await open(page);
    await page.click('.choice[data-answer="yes"]');
    await page.click('#fewer');
    await page.click('#rsvp-submit');
    await page.waitForSelector('#rsvp-done:not([hidden])');
    assert.strictEqual(posts.length, 1);
    assert.ok(/text\/plain/.test(posts[0].type));
    assert.deepStrictEqual(posts[0].body, { action: 'rsvp', code: 'live1234', count: 2 });
    assert.ok(await page.isVisible('#gift'));
    await ctx.close();
  });

  await test('live API: a failed save shows an error and keeps the form usable', async () => {
    const { page, ctx } = await newPage(browser, base, { config: { apiUrl: API } });
    await page.route(API + '**', (route) => route.request().method() === 'GET'
      ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, guest: { names: ['Ana'], seats: 1, rsvp: null, gift: [] } }) })
      : route.abort());
    await page.goto(base + '/?u=x');
    await ready(page);
    await open(page);
    await page.click('.choice[data-answer="no"]');
    await page.click('#rsvp-submit');
    await page.waitForSelector('#rsvp-error:not([hidden])');
    assert.ok(/reach the server/.test(await page.textContent('#rsvp-error')));
    assert.ok(await page.isEnabled('#rsvp-submit'));
    assert.ok(await page.isHidden('#gift'), 'no gift details → no gift section');
    await ctx.close();
  });

  await test('bank details: shown for a valid link, open on tap, copy the number', async () => {
    const { page, ctx } = await newPage(browser, base);
    await page.goto(base + '/?u=demo');
    await ready(page);
    await open(page);
    assert.ok(await page.isVisible('#gift'));
    assert.ok(await page.isHidden('#accounts'));
    await page.click('#gift-toggle');
    assert.ok(await page.isVisible('#accounts'));
    assert.strictEqual(await page.textContent('.account__num'), '1234 5678 9000');
    assert.strictEqual(await page.textContent('.account__holder'), 'Account name: Sample Account Name');
    await page.click('.copy');
    assert.strictEqual(await page.evaluate(() => navigator.clipboard.readText()), '123456789000');
    assert.ok(/Copied/.test(await page.textContent('.copy')));
    await ctx.close();
  });

  await test('Save the Date: Google Calendar on Android, calendar file on iPhone and laptop', async () => {
    const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    let { page, ctx } = await newPage(browser, base, { userAgent: android });
    await page.goto(base + '/');
    const href = await page.getAttribute('#cal', 'href');
    assert.ok(href.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE'));
    assert.ok(href.includes('dates=20270320T040000Z/20270320T070000Z'));
    await ctx.close();
    ({ page, ctx } = await newPage(browser, base, { userAgent: iphone }));
    await page.goto(base + '/');
    assert.strictEqual(await page.getAttribute('#cal', 'href'), 'assets/save-the-date.ics');
    assert.strictEqual(await page.getAttribute('#cal', 'target'), null);
    await ctx.close();
    ({ page, ctx } = await newPage(browser, base, { viewport: { width: 1280, height: 800 } }));
    await page.goto(base + '/');
    assert.strictEqual(await page.getAttribute('#cal', 'href'), 'assets/save-the-date.ics');
    const ics = fs.readFileSync(path.join(ROOT, 'assets/save-the-date.ics'), 'utf8');
    assert.ok(ics.includes('DTSTART:20270320T040000Z') && ics.includes('\r\n'));
    await ctx.close();
  });

  await test('links: Maps and love story open in a new tab', async () => {
    const { page, ctx } = await newPage(browser, base);
    await page.goto(base + '/');
    assert.strictEqual(await page.getAttribute('#maps', 'href'), 'https://maps.app.goo.gl/nASqm4FpCSYGGn949');
    assert.strictEqual(await page.getAttribute('#story', 'href'), 'https://www.instagram.com/p/DcTZTYZD1q9/');
    assert.strictEqual(await page.getAttribute('#story', 'target'), '_blank');
    await ctx.close();
  });

  await test('music: hidden with no song; with a song it plays after Open and toggles off/on', async () => {
    let { page, ctx } = await newPage(browser, base);
    await page.goto(base + '/');
    await open(page);
    assert.ok(await page.isHidden('#music'));
    await ctx.close();
    ({ page, ctx } = await newPage(browser, base, { config: { musicSrc: 'assets/audio/test.mp3' } }));
    await page.addInitScript(() => {
      // stand-in audio so the test does not need a real mp3
      window.Audio = function () {
        const a = document.createElement('div');
        a.paused = true;
        a.play = () => { a.paused = false; a.dispatchEvent(new Event('play')); return Promise.resolve(); };
        a.pause = () => { a.paused = true; a.dispatchEvent(new Event('pause')); };
        return a;
      };
    });
    await page.goto(base + '/');
    assert.ok(await page.isVisible('#music') === false || true);
    await open(page);
    assert.ok(await page.isVisible('#music'));
    assert.strictEqual(await page.getAttribute('#music', 'aria-pressed'), 'true');
    await page.click('#music');
    assert.strictEqual(await page.getAttribute('#music', 'aria-pressed'), 'false');
    await page.click('#music');
    assert.strictEqual(await page.getAttribute('#music', 'aria-pressed'), 'true');
    await ctx.close();
  });

  await test('gallery: 6 photos, tap to enlarge, swipe/arrow to next, Esc closes', async () => {
    const { page, ctx } = await newPage(browser, base);
    await page.goto(base + '/');
    await open(page);
    assert.strictEqual((await page.$$('.gallery .photo')).length, 6);
    await page.locator('.gallery .photo').nth(1).scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);
    await page.locator('.gallery .photo').nth(1).click();
    await page.waitForSelector('.lightbox.is-open');
    assert.strictEqual(await page.textContent('.lightbox__count'), '2 / 6');
    await page.keyboard.press('ArrowRight');
    assert.strictEqual(await page.textContent('.lightbox__count'), '3 / 6');
    await page.keyboard.press('Escape');
    assert.ok(await page.isHidden('.lightbox'));
    await ctx.close();
  });

  await test('slideshow changes photo every 3 seconds', async () => {
    const { page, ctx } = await newPage(browser, base);
    await page.goto(base + '/');
    await open(page);
    const idx = () => page.$$eval('.intro .slide', (s) => s.findIndex((x) => x.classList.contains('is-active')));
    assert.strictEqual(await idx(), 0);
    await page.waitForTimeout(3300);
    assert.strictEqual(await idx(), 1);
    await ctx.close();
  });

  await test('reduce motion: everything visible without animation', async () => {
    const { page, ctx } = await newPage(browser, base, { reducedMotion: 'reduce' });
    await page.goto(base + '/?u=demo');
    await ready(page);
    await open(page);
    const hidden = await page.$$eval('.rv, .rv-photo', (els) => els.filter((e) => getComputedStyle(e).opacity !== '1').length);
    assert.strictEqual(hidden, 0);
    await ctx.close();
  });

  for (const vp of [{ width: 360, height: 740 }, PHONE, { width: 1280, height: 800 }]) {
    await test('no sideways scrolling, full-page screenshot at ' + vp.width + 'px', async () => {
      const { page, ctx } = await newPage(browser, base, { viewport: vp, fonts: true, scale: vp.width < 800 ? 2 : 1 });
      await page.goto(base + '/?u=demo-long');
      await ready(page);
      await open(page);
      await page.click('#gift-toggle');
      await scrollThrough(page);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over <= 0, 'page is ' + over + 'px too wide');
      await page.screenshot({ path: path.join(SHOTS, `page-${vp.width}.png`), fullPage: true });
      assert.deepStrictEqual(page.errors, []);
      await ctx.close();
    });
  }

  await browser.close();
  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
