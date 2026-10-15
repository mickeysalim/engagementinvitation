/* Tests the Google Apps Script backend (apps-script/Code.gs) against a fake sheet.
 * Run: node tests/apps-script.test.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const HEADER = ['Name 1', 'Name 2', 'Name 3', 'Name 4', 'Seats', 'Side', 'Code', 'RSVP', 'Updated at'];

function makeEnv(rows, opts = {}) {
  const data = [(opts.header || HEADER).slice()].concat(rows.map((r) => r.slice()));
  const sheet = {
    getDataRange: () => ({ getValues: () => data.map((r) => r.slice()) }),
    getRange: (row, col) => ({
      setValue: (v) => { while (data[row - 1].length < col) data[row - 1].push(''); data[row - 1][col - 1] = v; },
      setFormula: (v) => { while (data[row - 1].length < col) data[row - 1].push(''); data[row - 1][col - 1] = v; }
    })
  };
  let uuid = 0;
  const ctx = {
    console,
    SpreadsheetApp: {
      openById: () => ({ getSheetByName: (n) => (n === 'Engagement' ? sheet : null) }),
      flush: () => {}
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ text: s, setMimeType() { return this; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      sleep() {},
      formatDate: () => '2027-01-05 10:30',
      getUuid: () => (++uuid).toString(16).padStart(32, 'a')
    },
    Logger: { log() {} }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), ctx);
  if (opts.gift) vm.runInContext('GIFT = ' + JSON.stringify(opts.gift), ctx);
  return { ctx, data };
}
const get = (env, params) => JSON.parse(env.ctx.doGet({ parameter: params }).text);
const post = (env, body) => JSON.parse(env.ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

const ROWS = [
  ['Mr. Hardjanto Salim', 'Mrs. Sylvi Lutantowidjojo', '', '', 2, 'Bride', 'abc12345', '', ''],
  ['Jennifer', '', '', '', '', 'Groom', 'solo2345', 0, '2027-01-01 09:00'],
  ['Kevin', 'Clarissa', 'Ana', '', 3, 'Bride', 'fam23456', 2, '']
];

test('ping', () => assert.deepStrictEqual(get(makeEnv(ROWS), { action: 'ping' }), { ok: true }));

test('returns only the guest for that code, with names, seats and RSVP', () => {
  const r = get(makeEnv(ROWS), { action: 'guest', code: 'ABC12345 ' });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.guest.names, ['Mr. Hardjanto Salim', 'Mrs. Sylvi Lutantowidjojo']);
  assert.strictEqual(r.guest.seats, 2);
  assert.strictEqual(r.guest.rsvp, null);
  assert.ok(!('side' in r.guest));
});

test('seats default to the number of names; 0 means declined', () => {
  const r = get(makeEnv(ROWS), { action: 'guest', code: 'solo2345' });
  assert.strictEqual(r.guest.seats, 1);
  assert.strictEqual(r.guest.rsvp, 0);
});

test('unknown or empty code is rejected', () => {
  assert.strictEqual(get(makeEnv(ROWS), { action: 'guest', code: 'nope' }).error, 'not_found');
  assert.strictEqual(get(makeEnv(ROWS), { action: 'guest', code: '' }).error, 'not_found');
});

test('gift placeholders are never sent; real details only with a valid code', () => {
  assert.deepStrictEqual(get(makeEnv(ROWS), { action: 'guest', code: 'abc12345' }).guest.gift, []);
  const gift = [{ bank: 'Blu', currency: 'IDR', number: '0000 1111 2222', holder: 'Test' }];
  const env = makeEnv(ROWS, { gift });
  assert.deepStrictEqual(get(env, { action: 'guest', code: 'abc12345' }).guest.gift, gift);
  assert.strictEqual(get(env, { action: 'guest', code: 'wrong' }).guest, undefined);
});

test('RSVP yes writes the number and timestamp', () => {
  const env = makeEnv(ROWS);
  const r = post(env, { action: 'rsvp', code: 'abc12345', count: 2 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.guest.rsvp, 2);
  assert.strictEqual(env.data[1][7], 2);
  assert.strictEqual(env.data[1][8], '2027-01-05 10:30');
});

test('RSVP no writes 0, and an update overwrites it', () => {
  const env = makeEnv(ROWS);
  post(env, { action: 'rsvp', code: 'fam23456', count: 0 });
  assert.strictEqual(env.data[3][7], 0);
  post(env, { action: 'rsvp', code: 'fam23456', count: 3 });
  assert.strictEqual(env.data[3][7], 3);
});

test('RSVP counts outside 0..seats, fractions and blanks are rejected', () => {
  const env = makeEnv(ROWS);
  [3, -1, 1.5, '', null, 'two'].forEach((c) => {
    assert.strictEqual(post(env, { action: 'rsvp', code: 'abc12345', count: c }).error, 'invalid_count', 'count ' + c);
  });
  assert.strictEqual(env.data[1][7], '');
});

test('RSVP with a wrong code or action does nothing', () => {
  const env = makeEnv(ROWS);
  assert.strictEqual(post(env, { action: 'rsvp', code: 'zzz', count: 1 }).error, 'not_found');
  assert.strictEqual(post(env, { action: 'other' }).error, 'bad_request');
  assert.strictEqual(JSON.parse(env.ctx.doPost({ postData: { contents: 'not json' } }).text).error, 'bad_request');
});

test('a missing column is reported clearly', () => {
  const env = makeEnv([], { header: ['Name 1', 'Seats', 'Code'] });
  const r = get(env, { action: 'guest', code: 'x' });
  assert.strictEqual(r.error, 'server_error');
  assert.ok(/Missing column header/.test(r.message));
});

test('generateCodes fills only rows with a name and no code, without duplicates', () => {
  const env = makeEnv([['A', '', '', '', 1, '', '', '', ''], ['', '', '', '', '', '', '', '', ''], ['B', '', '', '', 1, '', 'keep1234', '', '']]);
  assert.strictEqual(env.ctx.generateCodes(), 1);
  assert.match(String(env.data[1][6]), /^[a-z2-9]{8}$/);
  assert.strictEqual(env.data[2][6], '');
  assert.strictEqual(env.data[3][6], 'keep1234');
});

test('createLinks writes a link formula per row', () => {
  const env = makeEnv(ROWS);
  vm.runInContext("CONFIG.SITE_URL = 'https://ex.app/'", env.ctx);
  env.ctx.createLinks();
  assert.strictEqual(env.data[0][9], 'Link');
  assert.strictEqual(env.data[1][9], '=IF(G2="","","https://ex.app/?u="&G2)');
});

console.log(passed + ' passed');
