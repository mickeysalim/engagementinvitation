/**
 * Mickey & Edmund · The Engagement — RSVP backend (Google Apps Script)
 *
 * A standalone Apps Script project that reads ONE tab of the guest-list Google
 * Sheet. It is separate from the wedding script, so the wedding site is never
 * affected by changes here.
 *
 *   GET  ?action=guest&code=XXXX   -> that guest's names, seats, RSVP and the gift details
 *   POST {action:'rsvp', code, count}
 *                                   -> writes the RSVP into the sheet
 *
 * RSVP column:  blank = has not replied   0 = not attending   1, 2, ... = number attending
 *
 * Columns are found by their header text (not position), so you can reorder
 * them freely. Required headers (case-insensitive):
 *   Name 1, Name 2, Name 3, Name 4, Seats, Code, RSVP, Updated at
 * Other columns (Side, Group, notes, ...) are ignored and never sent to guests.
 *
 * Setup steps are in docs/SETUP.md.
 */

var CONFIG = {
  // The long ID in the sheet's address: docs.google.com/spreadsheets/d/<THIS PART>/edit
  SHEET_ID: 'PASTE_THE_SHEET_ID_HERE',
  SHEET_NAME: 'Engagement',
  TIMEZONE: 'Asia/Jakarta', // used for the "Updated at" timestamp
  SITE_URL: 'https://example.vercel.app', // used by createLinks()
  CODE_LENGTH: 8,
  CODE_ALPHABET: 'abcdefghjkmnpqrstuvwxyz23456789', // no 0/o, 1/l/i to avoid typos
  LINK_COLUMN_HEADER: 'Link'
};

// Only sent to guests who open a valid personal link. Fill these in inside the
// Apps Script editor (not in the public GitHub copy).
var GIFT = [
  { bank: 'BANK NAME', currency: 'IDR', number: 'ACCOUNT NUMBER', holder: 'ACCOUNT NAME' }
];

var COLS = {
  name1: 'name 1',
  name2: 'name 2',
  name3: 'name 3',
  name4: 'name 4',
  seats: 'seats',
  code: 'code',
  rsvp: 'rsvp',
  updatedAt: 'updated at'
};

/* ------------------------------------------------------------------ */
/* Web app entry points                                                */
/* ------------------------------------------------------------------ */

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (p.action === 'ping') return json_({ ok: true });
    if (p.action === 'guest') {
      var found = findGuest_(readTable_(getSheet_()), p.code);
      if (!found) {
        Utilities.sleep(250); // slows down anyone guessing codes
        return json_({ ok: false, error: 'not_found' });
      }
      return json_({ ok: true, guest: withGift_(found.guest) });
    }
    return json_({ ok: false, error: 'bad_request' });
  } catch (err) {
    return json_({ ok: false, error: 'server_error', message: String(err && err.message ? err.message : err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var payload = parseBody_(e);
    if (payload.action !== 'rsvp') return json_({ ok: false, error: 'bad_request' });

    lock.waitLock(15000);
    var sheet = getSheet_();
    var table = readTable_(sheet);
    var found = findGuest_(table, payload.code);
    if (!found) {
      Utilities.sleep(250);
      return json_({ ok: false, error: 'not_found' });
    }

    var count = validateCount_(found.guest, payload.count);
    if (count === null) return json_({ ok: false, error: 'invalid_count' });

    var row = found.rowNumber;
    sheet.getRange(row, table.idx.rsvp + 1).setValue(count);
    sheet.getRange(row, table.idx.updatedAt + 1).setValue(Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm'));
    SpreadsheetApp.flush();

    found.guest.rsvp = count;
    return json_({ ok: true, guest: withGift_(found.guest) });
  } catch (err) {
    return json_({ ok: false, error: 'server_error', message: String(err && err.message ? err.message : err) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

/* ------------------------------------------------------------------ */
/* Sheet helpers                                                       */
/* ------------------------------------------------------------------ */

function normalize_(s) {
  return String(s === null || s === undefined ? '' : s)
    .toLowerCase()
    .replace(/[‐-―−]/g, '-') // en/em dashes -> hyphen
    .replace(/\s+/g, ' ')
    .trim();
}

function getSheet_() {
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error('No tab called "' + CONFIG.SHEET_NAME + '" in the sheet.');
  return sheet;
}

function readTable_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values.length) throw new Error('The tab is empty.');
  var header = values[0].map(normalize_);
  var idx = {};
  Object.keys(COLS).forEach(function (key) {
    var i = header.indexOf(COLS[key]);
    if (i < 0) throw new Error('Missing column header: "' + COLS[key] + '"');
    idx[key] = i;
  });
  return { values: values, idx: idx, header: header };
}

function cellText_(v) {
  return String(v === null || v === undefined ? '' : v).trim();
}

function count_(v) {
  if (v === '' || v === null || v === undefined) return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}

function guestFromRow_(t, row) {
  var names = [t.idx.name1, t.idx.name2, t.idx.name3, t.idx.name4]
    .map(function (i) { return cellText_(row[i]); })
    .filter(function (n) { return n.length > 0; });
  var seats = parseInt(row[t.idx.seats], 10);
  if (!(seats >= 1)) seats = names.length || 1;
  return { names: names, seats: seats, rsvp: count_(row[t.idx.rsvp]) };
}

function findGuest_(t, code) {
  var wanted = normalize_(code);
  if (!wanted) return null;
  for (var r = 1; r < t.values.length; r++) {
    var rowCode = normalize_(t.values[r][t.idx.code]);
    if (rowCode && rowCode === wanted) {
      return { rowNumber: r + 1, guest: guestFromRow_(t, t.values[r]) };
    }
  }
  return null;
}

function withGift_(guest) {
  guest.gift = GIFT.filter(function (a) { return a && a.number && a.number !== 'ACCOUNT NUMBER'; });
  return guest;
}

/** Returns the number to store (0 = not attending), or null when it is not valid for this guest. */
function validateCount_(guest, value) {
  if (value === null || value === undefined || value === '') return null;
  var n = Number(value);
  if (!isFinite(n) || n % 1 !== 0 || n < 0 || n > guest.seats) return null;
  return n;
}

function parseBody_(e) {
  var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
  try {
    var obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch (err) {
    return {};
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ */
/* Tools you run from the Apps Script editor (choose the function, Run) */
/* ------------------------------------------------------------------ */

function makeCode_() {
  var uuid = Utilities.getUuid().replace(/-/g, ''); // 32 random hex characters
  var alphabet = CONFIG.CODE_ALPHABET;
  var out = '';
  for (var i = 0; i < CONFIG.CODE_LENGTH; i++) {
    var chunk = parseInt(uuid.substr(i * 4, 4), 16); // 0..65535
    out += alphabet.charAt(chunk % alphabet.length);
  }
  return out;
}

/** Fills the Code column for every invitation that has a name but no code yet. */
function generateCodes() {
  var sheet = getSheet_();
  var t = readTable_(sheet);
  var used = {};
  for (var r = 1; r < t.values.length; r++) {
    var existing = normalize_(t.values[r][t.idx.code]);
    if (existing) used[existing] = true;
  }
  var made = 0;
  for (var row = 1; row < t.values.length; row++) {
    var hasName = cellText_(t.values[row][t.idx.name1]) !== '';
    var hasCode = cellText_(t.values[row][t.idx.code]) !== '';
    if (!hasName || hasCode) continue;
    var code = makeCode_();
    while (used[code]) code = makeCode_();
    used[code] = true;
    sheet.getRange(row + 1, t.idx.code + 1).setValue(code);
    made++;
  }
  Logger.log(made + ' new code(s) created.');
  return made;
}

function columnLetter_(index) {
  var n = index + 1;
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Adds a "Link" column with each guest's personal link (uses CONFIG.SITE_URL). */
function createLinks() {
  var base = String(CONFIG.SITE_URL || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) throw new Error('Set CONFIG.SITE_URL to an address that starts with https://');
  var sheet = getSheet_();
  var t = readTable_(sheet);
  var linkIndex = t.header.indexOf(normalize_(CONFIG.LINK_COLUMN_HEADER));
  if (linkIndex < 0) {
    linkIndex = t.header.length;
    sheet.getRange(1, linkIndex + 1).setValue(CONFIG.LINK_COLUMN_HEADER);
  }
  var codeCol = columnLetter_(t.idx.code);
  for (var r = 2; r <= t.values.length; r++) {
    sheet
      .getRange(r, linkIndex + 1)
      .setFormula('=IF(' + codeCol + r + '="","","' + base + '/?u="&' + codeCol + r + ')');
  }
  Logger.log('Links created in column "' + CONFIG.LINK_COLUMN_HEADER + '".');
}
