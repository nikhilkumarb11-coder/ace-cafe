/**
 * Ace Café — Google Apps Script API
 *
 * This file is a copy kept with the app. The live code runs inside the
 * Google Sheet: Extensions → Apps Script. See README.md for setup.
 *
 * All requests are POST with Content-Type text/plain and a JSON body:
 *   { action: "login" | "sync" | "batch", token, ... }
 * Responses are JSON: { ok: true, ... } or { ok: false, code, message }.
 *
 * Bill numbers are chosen on the device (C1-0001) so a receipt can be printed
 * while the counter is offline. The server rejects a number that already exists.
 */

const API_VERSION = '0.1.0';
const TOKEN_DAYS = 30;
const SYNC_OVERLAP_MS = 15000;
const MAX_LOGIN_FAILS = 8;

const COMMON_FIELDS = ['id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'is_deleted'];

const SCHEMA = {
  MenuCategories: ['name', 'sort', 'active'],
  MenuItems:      ['category_id', 'name', 'price', 'available', 'sort'],
  Bills:          ['bill_no', 'bill_date', 'opened_at', 'closed_at', 'service', 'table_no', 'customer_name', 'customer_phone', 'status', 'void_reason', 'discount', 'subtotal', 'tax_percent', 'tax', 'total', 'notes'],
  BillItems:      ['bill_id', 'menu_item_id', 'item_name', 'qty', 'rate', 'amount', 'note', 'sort'],
  BillPayments:   ['bill_id', 'mode', 'amount', 'ref', 'status', 'paid_at'],
  Expenses:       ['date', 'category', 'vendor_name', 'amount', 'description'],
  DayCloses:      ['close_date', 'opening_cash', 'sales_total', 'bill_count', 'cash_sales', 'upi_sales', 'card_sales', 'expenses_total', 'expected_cash', 'counted_cash', 'difference', 'notes'],
  Settings:       ['key', 'value']
};

const NUMERIC_FIELDS = {
  qty: 1, rate: 1, amount: 1, price: 1, sort: 1, total: 1, discount: 1, subtotal: 1, tax: 1, tax_percent: 1,
  opening_cash: 1, sales_total: 1, bill_count: 1, cash_sales: 1, upi_sales: 1, card_sales: 1,
  expenses_total: 1, expected_cash: 1, counted_cash: 1, difference: 1
};
const BOOLEAN_FIELDS = { is_deleted: 1, active: 1, available: 1 };
const AUTO_NUMBERS = {};
const PRIVATE_FIELDS = {};

const PAY_MODES = ['Cash', 'UPI', 'Card'];
const EXPENSE_CATEGORIES = ['Purchase', 'Rent', 'Salaries', 'Utilities', 'Maintenance', 'Miscellaneous'];
const SERVICES = ['Dine-in', 'Takeaway'];

function paidForBill_(ctx, billId) {
  const sum = tableCtx_(ctx, 'BillPayments').rows.reduce(function (s, p) {
    if (p.bill_id !== billId || p.is_deleted || p.status === 'Void') return s;
    return s + (Number(p.amount) || 0);
  }, 0);
  return round2_(sum);
}

/** Lines already stored, with an in-flight item swapped in (it is not on the sheet yet). */
function linesForBill_(ctx, billId, pending) {
  const lines = tableCtx_(ctx, 'BillItems').rows.filter(function (i) {
    return i.bill_id === billId && !i.is_deleted && (!pending || i.id !== pending.id);
  });
  if (pending && !pending.is_deleted && pending.bill_id === billId) lines.push(pending);
  return lines;
}

/**
 * Menu prices include GST. An open bill that arrives before its items in the
 * same batch keeps the totals the till already calculated.
 */
function applyBillTotals_(row, ctx, pending) {
  const lines = linesForBill_(ctx, row.id, pending);
  if ((row.status || 'Open') === 'Open' && !lines.length && Number(row.total) > 0) return;
  const gross = round2_(lines.reduce(function (s, l) {
    return s + round2_((Number(l.qty) || 0) * (Number(l.rate) || 0));
  }, 0));
  let discount = round2_(row.discount);
  if (discount < 0) discount = 0;
  if (discount > gross) discount = gross;
  const total = round2_(gross - discount);
  let pct = round2_(row.tax_percent);
  if (pct < 0) pct = 0;
  const tax = pct > 0 ? round2_(total * pct / (100 + pct)) : 0;
  row.discount = discount;
  row.subtotal = round2_(total - tax);
  row.tax = tax;
  row.tax_percent = pct;
  row.total = total;
}

function touchBill_(ctx, billId, pending) {
  const t = tableCtx_(ctx, 'Bills');
  const bill = findRow_(ctx, 'Bills', billId);
  if (!bill || bill.is_deleted || bill.status !== 'Open') return;
  applyBillTotals_(bill, ctx, pending);
  const idx = t.index[billId];
  if (idx == null) return;
  if (bill.__row) t.updatedIdx[idx] = true;
  t.dirty = true;
}

const VALIDATORS = {
  Settings: function (row) {
    if (!row.key) throw invalid_('Setting key is required');
  },
  MenuCategories: function (row) {
    if (row.is_deleted) return;
    if (!row.name) throw invalid_('Category name is required');
    if (row.active === '' || row.active == null) row.active = true;
  },
  MenuItems: function (row) {
    if (row.is_deleted) return;
    if (!row.name) throw invalid_('Item name is required');
    if (!row.category_id) throw invalid_('Choose a category');
    if (row.price < 0) throw invalid_("Price can't be negative");
    if (row.available === '' || row.available == null) row.available = true;
  },
  Bills: function (row, prev, ctx) {
    if (row.is_deleted) {
      if (prev && prev.status === 'Paid') throw invalid_("A paid bill can't be deleted. Void it.");
      if (paidForBill_(ctx, row.id) > 0) throw invalid_('This bill has payments. Void those first.');
      return;
    }
    if (prev && prev.status === 'Void') throw invalid_('This bill is already void');
    if (prev && prev.bill_no && row.bill_no && row.bill_no !== prev.bill_no) throw invalid_("A bill number can't be changed");
    if (prev && prev.status === 'Paid') {
      if (row.status !== 'Void') throw invalid_("A paid bill can't be edited. Void it.");
      if (!row.void_reason) throw invalid_('Give a reason for voiding');
      row.total = prev.total;
      row.subtotal = prev.subtotal;
      row.tax = prev.tax;
      row.discount = prev.discount;
      row.tax_percent = prev.tax_percent;
      return;
    }
    if (!row.bill_no) {
      const seq = nextSeq_('BILL');
      row.bill_no = 'B-' + ('000' + seq).slice(-4);
    }
    if (!/^[A-Z0-9]{1,6}-\d{1,6}$/.test(String(row.bill_no))) throw invalid_('Bill number is not valid');
    const clash = tableCtx_(ctx, 'Bills').rows.some(function (b) {
      return b.id !== row.id && String(b.bill_no) === String(row.bill_no);
    });
    if (clash) throw invalid_('Bill number ' + row.bill_no + ' is already used');
    if (!row.service) row.service = 'Dine-in';
    if (SERVICES.indexOf(row.service) === -1) throw invalid_('Choose Dine-in or Takeaway');
    if (row.customer_phone && !/^\d{10}$/.test(String(row.customer_phone))) throw invalid_('Phone must be 10 digits');
    if (!row.status) row.status = 'Open';
    if (['Open', 'Paid', 'Void'].indexOf(row.status) === -1) throw invalid_('Unknown status');
    if (row.status === 'Void' && !row.void_reason) throw invalid_('Give a reason for voiding');
    applyBillTotals_(row, ctx);
    if (row.status === 'Paid') {
      if (!(row.total > 0)) throw invalid_('Nothing to charge');
      const paid = paidForBill_(ctx, row.id);
      if (Math.abs(paid - Number(row.total)) > 0.05) throw invalid_('Payments ₹' + paid + ' do not match the total ₹' + row.total);
      if (!row.closed_at) row.closed_at = nowIso_();
    }
  },
  BillItems: function (row, prev, ctx) {
    const bill = findRow_(ctx, 'Bills', row.bill_id);
    if (row.is_deleted) {
      if (bill && bill.status === 'Paid') throw invalid_("Items on a paid bill can't be removed");
      if (bill && bill.status === 'Open') touchBill_(ctx, row.bill_id, row);
      return;
    }
    if (!row.bill_id) throw invalid_('Item is missing its bill');
    if (!row.item_name) throw invalid_('Item name is required');
    if (!(row.qty > 0)) throw invalid_('Quantity must be more than 0');
    if (row.rate < 0) throw invalid_("Price can't be negative");
    if (!bill || bill.is_deleted) throw invalid_('Bill not found');
    if (bill.status !== 'Open') throw invalid_("This bill can't be changed");
    row.amount = round2_((Number(row.qty) || 0) * (Number(row.rate) || 0));
    touchBill_(ctx, row.bill_id, row);
  },
  BillPayments: function (row, prev, ctx) {
    if (prev) {
      if (Number(row.amount) !== Number(prev.amount) || row.bill_id !== prev.bill_id || row.mode !== prev.mode || row.is_deleted) {
        throw invalid_("A payment can't be changed. Void it and take another.");
      }
      if (prev.status === 'Void') throw invalid_('A voided payment stays void');
      if (row.status === 'Void') {
        const bill = findRow_(ctx, 'Bills', row.bill_id);
        if (bill && bill.status === 'Paid') throw invalid_('This bill is paid. Void the bill instead.');
      }
      return;
    }
    if (row.is_deleted) return;
    if (!row.bill_id) throw invalid_('Payment is missing its bill');
    if (PAY_MODES.indexOf(row.mode) === -1) throw invalid_('Choose Cash, UPI or Card');
    if (!(row.amount > 0)) throw invalid_('Payment amount must be more than 0');
    const bill = findRow_(ctx, 'Bills', row.bill_id);
    if (!bill || bill.is_deleted) throw invalid_('Bill not found');
    if (bill.status === 'Void') throw invalid_('This bill is void');
    if (bill.status === 'Paid') throw invalid_('This bill is already paid');
    const room = round2_(Number(bill.total) - paidForBill_(ctx, row.bill_id));
    if (row.amount > room + 0.05) throw invalid_('Payment is more than the balance of ₹' + room);
    row.status = '';
  },
  Expenses: function (row) {
    if (row.is_deleted) return;
    if (!row.date) throw invalid_('Date is required');
    if (EXPENSE_CATEGORIES.indexOf(row.category) === -1) throw invalid_('Choose a category');
    if (!(row.amount > 0)) throw invalid_('Amount must be more than 0');
    if (row.category === 'Purchase') {
      if (!row.vendor_name) throw invalid_('Vendor name is required for purchases');
    } else {
      row.vendor_name = '';
    }
  },
  DayCloses: function (row) {
    if (row.is_deleted) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.close_date || ''))) throw invalid_('Date is required');
    ['opening_cash', 'counted_cash', 'cash_sales', 'upi_sales', 'card_sales', 'expenses_total', 'expected_cash', 'sales_total'].forEach(function (f) {
      if (Number(row[f]) < 0) throw invalid_("Amounts can't be negative");
    });
  }
};

/** Same ids as the app, so a till that already created them does not duplicate the menu. */
function seedMenu_() {
  const cats = readTable_('MenuCategories', true);
  if (cats.rows.length) return;
  const now = nowIso_();
  function stamp(row) {
    row.created_at = now;
    row.updated_at = now;
    row.created_by = 'setup';
    row.updated_by = 'setup';
    row.is_deleted = false;
    return row;
  }
  [
    ['cat-coffee', 'Coffee', 1],
    ['cat-tea', 'Tea', 2],
    ['cat-coolers', 'Coolers', 3],
    ['cat-snacks', 'Snacks', 4]
  ].forEach(function (c) {
    const row = blankRow_('MenuCategories');
    row.id = c[0]; row.name = c[1]; row.sort = c[2]; row.active = true;
    cats.appended.push(stamp(row));
  });
  writeTable_(cats);
  const items = readTable_('MenuItems', true);
  [
    ['item-espresso', 'cat-coffee', 'Espresso', 80, 1],
    ['item-americano', 'cat-coffee', 'Americano', 100, 2],
    ['item-cappuccino', 'cat-coffee', 'Cappuccino', 120, 3],
    ['item-latte', 'cat-coffee', 'Latte', 130, 4],
    ['item-filter', 'cat-coffee', 'Filter Coffee', 60, 5],
    ['item-masala', 'cat-tea', 'Masala Chai', 40, 1],
    ['item-ginger', 'cat-tea', 'Ginger Tea', 40, 2],
    ['item-greentea', 'cat-tea', 'Green Tea', 50, 3],
    ['item-coldcoffee', 'cat-coolers', 'Cold Coffee', 140, 1],
    ['item-lemon', 'cat-coolers', 'Lemon Soda', 70, 2],
    ['item-lime', 'cat-coolers', 'Fresh Lime', 60, 3],
    ['item-puff', 'cat-snacks', 'Veg Puff', 40, 1],
    ['item-bun', 'cat-snacks', 'Bun Butter Jam', 50, 2],
    ['item-fries', 'cat-snacks', 'French Fries', 90, 3],
    ['item-sandwich', 'cat-snacks', 'Veg Sandwich', 80, 4]
  ].forEach(function (it) {
    const row = blankRow_('MenuItems');
    row.id = it[0]; row.category_id = it[1]; row.name = it[2]; row.price = it[3]; row.sort = it[4]; row.available = true;
    items.appended.push(stamp(row));
  });
  writeTable_(items);
  PropertiesService.getScriptProperties().setProperties({ mod_MenuCategories: now, mod_MenuItems: now });
}

function round2_(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Tables read inside a batch (under the lock), so missing columns can be added. */
function tableCtx_(ctx, table) {
  return ctx[table] || (ctx[table] = readTable_(table, true));
}

function findRow_(ctx, table, id) {
  const t = tableCtx_(ctx, table);
  const idx = t.index[id];
  return idx == null ? null : t.rows[idx];
}

function paidForOrder_(ctx, orderId) {
  const sum = tableCtx_(ctx, 'Payments').rows.reduce(function (s, p) {
    if (p.order_id !== orderId || p.is_deleted || p.status === 'Void') return s;
    return s + (Number(p.amount) || 0);
  }, 0);
  return Math.round(sum * 100) / 100;
}

// ───────────────────────────── HTTP entry points ─────────────────────────────

function doGet() {
  return json_({
    ok: true,
    app: 'Ace Café',
    version: API_VERSION,
    features: { pos: true }
  });
}


function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, code: 'BAD_REQUEST', message: 'Request body is not valid JSON' });
  }
  try {
    if (req.action === 'login') {
      const res = login_(req.password);
      if (res.ok && req.withData) res.sync = sync_('');
      return json_(res);
    }
    verifyToken_(req.token);
    const user = String(req.device || 'app').slice(0, 40);
    switch (req.action) {
      case 'ping':       return json_({ ok: true, serverTime: nowIso_() });
      case 'setPassword': return json_(setPassword_(req.current, req.next));
      case 'sync':       return json_(sync_(req.since));
      case 'batch': {
        const ctx = {};
        const res = batch_(req.ops || [], user, ctx);
        if (req.since) res.sync = sync_(req.since, ctx);
        return json_(res);
      }
      case 'getPrivate': return json_(getPrivate_(req.table, req.id));
      default:           return json_({ ok: false, code: 'BAD_REQUEST', message: 'Unknown action: ' + req.action });
    }
  } catch (err) {
    return json_({ ok: false, code: err.code || 'ERROR', message: String(err && err.message ? err.message : err) });
  }
}

// ───────────────────────────── Auth ─────────────────────────────

let PROPS_ = null;

/** Script properties, read once per request (each read is a slow service call). */
function props_() {
  return PROPS_ || (PROPS_ = PropertiesService.getScriptProperties().getProperties());
}

function login_(password) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('login_fails') || 0);
  if (fails >= MAX_LOGIN_FAILS) {
    return { ok: false, code: 'LOCKED', message: 'Too many wrong attempts. Try again in 15 minutes.' };
  }
  const salt = props_().PASSWORD_SALT;
  const hash = props_().PASSWORD_HASH;
  if (!salt || !hash) {
    return { ok: false, code: 'NOT_SET_UP', message: 'App password not set. Open the Sheet → Ace Café menu → Set app password.' };
  }
  if (sha256Hex_(salt + String(password || '')) !== hash) {
    cache.put('login_fails', String(fails + 1), 15 * 60);
    return { ok: false, code: 'WRONG_PASSWORD', message: 'Wrong password' };
  }
  cache.remove('login_fails');
  const exp = Date.now() + TOKEN_DAYS * 24 * 3600 * 1000;
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify({ exp: exp }));
  return { ok: true, token: payload + '.' + sign_(payload), expiresAt: exp, serverTime: nowIso_() };
}

function verifyToken_(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || sign_(parts[0]) !== parts[1]) throw error_('AUTH', 'Please log in again');
  let payload;
  try {
    payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
  } catch (err) {
    throw error_('AUTH', 'Please log in again');
  }
  if (!payload.exp || payload.exp < Date.now()) throw error_('AUTH', 'Session expired, please log in again');
}

function sign_(text) {
  const secret = getTokenSecret_();
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(text, secret));
}

function getTokenSecret_() {
  let secret = props_().TOKEN_SECRET;
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    PropertiesService.getScriptProperties().setProperty('TOKEN_SECRET', secret);
    props_().TOKEN_SECRET = secret;
  }
  return secret;
}

function setPassword_(current, next) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('login_fails') || 0);
  if (fails >= MAX_LOGIN_FAILS) throw error_('LOCKED', 'Too many wrong attempts. Try again in 15 minutes.');
  const salt = props_().PASSWORD_SALT;
  const hash = props_().PASSWORD_HASH;
  if (!salt || !hash) throw error_('NOT_SET_UP', 'App password not set. Open the Sheet → Ace Café menu → Set app password.');
  if (sha256Hex_(salt + String(current || '')) !== hash) {
    cache.put('login_fails', String(fails + 1), 15 * 60);
    throw error_('WRONG_PASSWORD', 'Current password is wrong');
  }
  next = String(next || '');
  if (next.length < 6) throw invalid_('Password must be at least 6 characters.');
  cache.remove('login_fails');
  const newSalt = Utilities.getUuid();
  const secret = Utilities.getUuid() + Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperties({
    PASSWORD_SALT: newSalt,
    PASSWORD_HASH: sha256Hex_(newSalt + next),
    TOKEN_SECRET: secret
  });
  props_().PASSWORD_SALT = newSalt;
  props_().PASSWORD_HASH = sha256Hex_(newSalt + next);
  props_().TOKEN_SECRET = secret;
  const exp = Date.now() + TOKEN_DAYS * 24 * 3600 * 1000;
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify({ exp: exp }));
  return { ok: true, token: payload + '.' + sign_(payload), expiresAt: exp };
}

function sha256Hex_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); })
    .join('');
}

// ───────────────────────────── Sync (read) ─────────────────────────────

/**
 * Rows changed since `since` (everything when empty). Tables the API hasn't
 * written since the cutoff are skipped without opening the sheet. `ctx` reuses
 * tables a batch already has in memory.
 */
function sync_(since, ctx) {
  if (!since) {
    const cached = fullCacheGet_();
    if (cached) return cached;
  }
  const serverTime = nowIso_();
  const cutoff = since ? new Date(new Date(since).getTime() - SYNC_OVERLAP_MS).toISOString() : '';
  const props = props_();
  const tables = {};
  Object.keys(SCHEMA).forEach(function (table) {
    const lastWrite = props['mod_' + table];
    if (cutoff && (!lastWrite || lastWrite < cutoff)) return;
    const t = (ctx && ctx[table]) || readTable_(table);
    const rows = t.rows
      .filter(function (r) { return !cutoff || String(r.updated_at) > cutoff; })
      .map(function (r) { return publicRow_(table, r); });
    if (rows.length) tables[table] = rows;
  });
  const res = { ok: true, serverTime: serverTime, full: !since, tables: tables };
  if (!since) fullCachePut_(res);
  return res;
}

// The full download (login, "Reload all data") is cached until the next write
// changes a mod_ stamp. Cache values are capped at 100 KB, so it is stored in chunks.
const FULL_CACHE_CHUNK = 90000;
const FULL_CACHE_MAX_CHUNKS = 60;

function fullCacheKey_() {
  const props = props_();
  const sig = Object.keys(SCHEMA).map(function (t) { return props['mod_' + t] || ''; }).join('|');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, sig);
  return 'full_' + Utilities.base64EncodeWebSafe(digest).replace(/=+$/, '');
}

function fullCacheGet_() {
  try {
    const cache = CacheService.getScriptCache();
    const key = fullCacheKey_();
    const n = Number(cache.get(key) || 0);
    if (!n) return null;
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(key + '_' + i);
    const parts = cache.getAll(keys);
    let json = '';
    for (let i = 0; i < n; i++) {
      if (parts[keys[i]] == null) return null;
      json += parts[keys[i]];
    }
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function fullCachePut_(res) {
  try {
    const json = JSON.stringify(res);
    const n = Math.ceil(json.length / FULL_CACHE_CHUNK);
    if (n > FULL_CACHE_MAX_CHUNKS) return;
    const key = fullCacheKey_();
    const values = {};
    for (let i = 0; i < n; i++) values[key + '_' + i] = json.slice(i * FULL_CACHE_CHUNK, (i + 1) * FULL_CACHE_CHUNK);
    const cache = CacheService.getScriptCache();
    cache.putAll(values, 21600);
    cache.put(key, String(n), 21600);
  } catch (e) {
    // Too large or cache unavailable: logins just read the Sheet.
  }
}

function getPrivate_(table, id) {
  if (!PRIVATE_FIELDS[table]) throw error_('BAD_REQUEST', 'No private fields on ' + table);
  const t = readTable_(table);
  const row = t.rows.filter(function (r) { return r.id === id; })[0];
  if (!row) throw error_('NOT_FOUND', 'Record not found');
  const out = { id: id };
  PRIVATE_FIELDS[table].forEach(function (f) { out[f] = row[f]; });
  return { ok: true, row: out };
}

// ───────────────────────────── Batch (write) ─────────────────────────────

/**
 * ops: [{ opId, table, id, type: "create"|"update", data: {...}, base: updated_at|null }]
 * Each op succeeds or fails on its own; results come back in the same order.
 */
function batch_(ops, user, ctx) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw error_('BUSY', 'Server busy, will retry');
  try {
    const results = ops.map(function (op) {
      try {
        return applyOp_(op, ctx, user);
      } catch (err) {
        const res = { opId: op.opId, ok: false, code: err.code || 'INVALID', message: String(err.message || err) };
        const t = ctx[op.table];
        if (t && t.index[op.id] != null) res.row = publicRow_(op.table, t.rows[t.index[op.id]]);
        return res;
      }
    });
    const touched = Object.keys(ctx).filter(function (name) { return ctx[name].dirty; });
    touched.forEach(function (name) { writeTable_(ctx[name]); });
    if (touched.length) {
      SpreadsheetApp.flush();
      const now = nowIso_();
      const mods = {};
      touched.forEach(function (name) { mods['mod_' + name] = now; });
      PropertiesService.getScriptProperties().setProperties(mods);
      Object.assign(props_(), mods);
    }
    return { ok: true, serverTime: nowIso_(), results: results };
  } finally {
    lock.releaseLock();
  }
}

function applyOp_(op, ctx, user) {
  const table = op.table;
  if (!SCHEMA[table]) throw error_('BAD_REQUEST', 'Unknown table: ' + table);
  if (!op.id) throw error_('BAD_REQUEST', 'Missing id');
  const t = tableCtx_(ctx, table);
  const idx = t.index[op.id];
  const now = nowIso_();
  const data = sanitize_(table, op.data || {});

  if (op.type === 'create') {
    // A retried create (lost response) must not duplicate the row or burn a number.
    if (idx != null) return { opId: op.opId, ok: true, row: publicRow_(table, t.rows[idx]) };
    const row = blankRow_(table);
    Object.keys(data).forEach(function (k) { row[k] = data[k]; });
    row.id = String(op.id);
    row.created_at = now;
    row.created_by = user;
    row.updated_at = now;
    row.updated_by = user;
    row.is_deleted = data.is_deleted === true;
    if (VALIDATORS[table]) VALIDATORS[table](row, null, ctx);
    assignNumber_(table, row);
    t.index[row.id] = t.rows.length;
    t.rows.push(row);
    t.appended.push(row);
    t.dirty = true;
    return { opId: op.opId, ok: true, row: publicRow_(table, row) };
  }

  if (op.type === 'update') {
    if (idx == null) throw error_('NOT_FOUND', 'Record not found (it may have been removed)');
    const prev = t.rows[idx];
    if (op.base && String(prev.updated_at) !== String(op.base)) {
      return { opId: op.opId, ok: false, code: 'CONFLICT', message: 'Changed on another device', row: publicRow_(table, prev) };
    }
    const next = {};
    Object.keys(prev).forEach(function (k) { next[k] = prev[k]; });
    Object.keys(data).forEach(function (k) { next[k] = data[k]; });
    next.updated_at = now;
    next.updated_by = user;
    if (VALIDATORS[table]) VALIDATORS[table](next, prev, ctx);
    t.rows[idx] = next;
    if (prev.__row) {
      t.updatedIdx[idx] = true;
    } else {
      t.appended[t.appended.indexOf(prev)] = next;
    }
    t.dirty = true;
    return { opId: op.opId, ok: true, row: publicRow_(table, next) };
  }

  throw error_('BAD_REQUEST', 'Unknown op type: ' + op.type);
}

/** Keeps only known, client-writable fields and coerces their types. */
function sanitize_(table, data) {
  const out = {};
  const auto = AUTO_NUMBERS[table];
  SCHEMA[table].concat(['is_deleted']).forEach(function (f) {
    if (!(f in data)) return;
    if (auto && f === auto.field) return;
    let v = data[f];
    if (NUMERIC_FIELDS[f]) {
      v = Math.round((Number(v) || 0) * 100) / 100;
    } else if (BOOLEAN_FIELDS[f]) {
      v = v === true || v === 'TRUE' || v === 'true';
    } else {
      v = v == null ? '' : String(v).trim();
    }
    out[f] = v;
  });
  // Masked values come back from clients that only ever saw the mask; never store them.
  (PRIVATE_FIELDS[table] || []).forEach(function (f) {
    if (f in out && /x/i.test(out[f])) delete out[f];
  });
  return out;
}

/** Bill numbers are chosen on the till so a receipt can be printed offline. */
function assignNumber_() {}

/** Must be called while holding the script lock. */
function nextSeq_(key) {
  const sh = getSheet_('Counters');
  const last = sh.getLastRow();
  const values = last > 1 ? sh.getRange(2, 1, last - 1, 2).getValues() : [];
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]) === key) {
      const seq = Number(values[i][1] || 0) + 1;
      sh.getRange(i + 2, 2).setValue(seq);
      return seq;
    }
  }
  sh.getRange(last + 1, 1, 1, 2).setNumberFormats([['@', '0']]).setValues([[key, 1]]);
  return 1;
}

// ───────────────────────────── Sheet I/O ─────────────────────────────

function headersFor_(table) {
  return COMMON_FIELDS.concat(SCHEMA[table]);
}

function getSheet_(name) {
  const sh = activeSpreadsheetOrThrow_().getSheetByName(name);
  if (!sh) throw error_('NOT_SET_UP', 'Sheet tab "' + name + '" missing. Run Ace Café → Repair missing columns.');
  return sh;
}

/**
 * Appends any SCHEMA columns missing from row 1. Returns the names that were added.
 * Uses the last non-empty header so blank trailing columns don't push new fields out of view.
 */
function ensureColumns_(sh, needed) {
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const raw = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h == null ? '' : h).trim();
  });
  let n = raw.length;
  while (n > 0 && !raw[n - 1]) n--;
  const existing = raw.slice(0, n);
  const missing = needed.filter(function (h) { return existing.indexOf(h) === -1; });
  if (!missing.length) return { headers: existing.length ? existing : needed.slice(), added: [] };

  const startCol = existing.length + 1;
  const startA1 = columnLetter_(startCol) + '1';
  const endA1 = columnLetter_(startCol + missing.length - 1) + '1';
  sh.getRange(startA1 + ':' + endA1).setValues([missing]).setFontWeight('bold').setBackground('#f3e6c8');
  missing.forEach(function (h, i) {
    const col = columnLetter_(startCol + i);
    sh.getRange(col + '2:' + col).setNumberFormat(formatFor_(h));
  });
  // Do not flush here — batch_ flushes once after all writes (flush mid-save is very slow).
  return { headers: existing.concat(missing), added: missing };
}

/** addMissing: append columns added to SCHEMA since setup ran (only while holding the lock). */
function readTable_(table, addMissing) {
  const sh = getSheet_(table);
  // One getDataRange in the common case. Re-read only if we just appended headers.
  let values = sh.getDataRange().getValues();
  let headers = (values[0] || []).map(function (h) { return String(h || '').trim(); });
  let headerCount = headers.length;
  while (headerCount > 0 && !headers[headerCount - 1]) headerCount--;
  if (addMissing) {
    const existing = headers.slice(0, headerCount);
    const missing = headersFor_(table).filter(function (h) { return existing.indexOf(h) === -1; });
    if (missing.length) {
      ensureColumns_(sh, headersFor_(table));
      values = sh.getDataRange().getValues();
      headers = (values[0] || []).map(function (h) { return String(h || '').trim(); });
      headerCount = headers.length;
      while (headerCount > 0 && !headers[headerCount - 1]) headerCount--;
    }
  }
  const useHeaders = headers.slice(0, headerCount);

  const tz = Session.getScriptTimeZone();
  const rows = [];
  const index = {};
  for (let r = 1; r < values.length; r++) {
    const obj = {};
    useHeaders.forEach(function (h, c) {
      if (!h) return;
      let v = values[r][c];
      if (Object.prototype.toString.call(v) === '[object Date]') {
        v = isNaN(v.getTime()) ? '' : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
      }
      obj[h] = v;
    });
    if (!obj.id) continue;
    obj.id = String(obj.id);
    obj.is_deleted = obj.is_deleted === true || obj.is_deleted === 'TRUE';
    index[obj.id] = rows.length;
    rows.push(obj);
    obj.__row = r + 1;
  }
  return { name: table, sheet: sh, headers: useHeaders, rows: rows, index: index, appended: [], updatedIdx: {}, dirty: false };
}

function writeTable_(t) {
  const toArray = function (row) {
    return t.headers.map(function (h) { return h && row[h] != null ? row[h] : ''; });
  };
  Object.keys(t.updatedIdx).forEach(function (i) {
    const row = t.rows[i];
    t.sheet.getRange(row.__row, 1, 1, t.headers.length).setValues([toArray(row)]);
  });
  if (t.appended.length) {
    const start = t.sheet.getLastRow() + 1;
    const formats = t.appended.map(function () { return t.headers.map(formatFor_); });
    t.sheet.getRange(start, 1, t.appended.length, t.headers.length)
      .setNumberFormats(formats)
      .setValues(t.appended.map(toArray));
  }
}

/** Text columns stay text so Sheets never turns 12-digit Aadhar into 1.2E+11 or "10/2026/001" into a date. */
function formatFor_(header) {
  if (NUMERIC_FIELDS[header]) return '0.##';
  if (BOOLEAN_FIELDS[header]) return 'General';
  return '@';
}

function blankRow_(table) {
  const row = {};
  headersFor_(table).forEach(function (h) { row[h] = ''; });
  return row;
}

function publicRow_(table, row) {
  const out = {};
  Object.keys(row).forEach(function (k) { if (k.indexOf('__') !== 0) out[k] = row[k]; });
  (PRIVATE_FIELDS[table] || []).forEach(function (f) {
    const v = String(out[f] || '');
    out[f] = v ? 'XXXX XXXX ' + v.slice(-4) : '';
  });
  return out;
}

// ───────────────────────────── Helpers ─────────────────────────────

function nowIso_() {
  return new Date().toISOString();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function error_(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function invalid_(message) {
  return error_('INVALID', message);
}

// ───────────────────────────── Sheet menu & setup ─────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Ace Café')
    .addItem('Run setup (safe to re-run)', 'setup')
    .addItem('Repair missing columns', 'repairColumns')
    .addItem('Set app password', 'promptSetPassword')
    .addItem('Log out all devices', 'logoutAllDevices')
    .addSeparator()
    .addItem('Back up now', 'backupNow')
    .addItem('Turn on daily backup', 'enableDailyBackup')
    .addItem('Turn off daily backup', 'disableDailyBackup')
    .addToUi();
}

function activeSpreadsheetOrThrow_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  throw new Error(
    'No spreadsheet linked to this script.\n\n' +
    'You must open Apps Script FROM the sheet:\n' +
    'Ace Café - Test → Extensions → Apps Script\n\n' +
    'Do not paste Code.gs into an "Untitled project".'
  );
}

/**
 * Forces SCHEMA columns onto every tab and shows what was added.
 * Deploying alone does NOT add columns — run this (menu or editor ▶ Run).
 */
function repairColumns() {
  const ss = activeSpreadsheetOrThrow_();
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
  const lines = [];
  let total = 0;
  Object.keys(SCHEMA).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const res = ensureColumns_(sh, headersFor_(name));
    if (res.added.length) {
      total += res.added.length;
      lines.push(name + ': +' + res.added.join(', '));
    } else {
      lines.push(name + ': OK');
    }
  });
  let sh = ss.getSheetByName('Counters');
  if (!sh) sh = ss.insertSheet('Counters');
  const counters = ensureColumns_(sh, ['key', 'last_seq']);
  if (counters.added.length) {
    total += counters.added.length;
    lines.push('Counters: +' + counters.added.join(', '));
  }
  SpreadsheetApp.flush();
  const msg = 'Sheet: ' + ss.getName() + '\nAPI ' + API_VERSION + '\nAdded this run: ' + total + '\n\n' + lines.join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert('Repair columns', msg, SpreadsheetApp.getUi().ButtonSet.OK); }
  catch (e) { /* run from editor */ }
  ss.toast(total ? ('Added ' + total + ' columns') : 'Columns are up to date', 'Ace Café', 8);
}


/** If header name is missing, append it. Returns 1 if added, else 0. */
function forceHeader_(sh, name) {
  if (!sh) return 0;
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const raw = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h == null ? '' : h).trim();
  });
  if (raw.indexOf(name) !== -1) return 0;
  let n = raw.length;
  while (n > 0 && !raw[n - 1]) n--;
  const col = n + 1;
  sh.getRange(columnLetter_(col) + '1').setValue(name).setFontWeight('bold').setBackground('#f3e6c8');
  sh.getRange(columnLetter_(col) + '2:' + columnLetter_(col)).setNumberFormat('@');
  return 1;
}

// ───────────────────────────── Backups ─────────────────────────────

const BACKUP_FOLDER = 'Ace Café Backups';
const BACKUP_KEEP = 30;

/** Copies the whole workbook into a private Drive folder and trims old copies. */
function dailyBackup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
  const folders = DriveApp.getFoldersByName(BACKUP_FOLDER);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(BACKUP_FOLDER);
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HHmm');
  const copy = DriveApp.getFileById(ss.getId()).makeCopy(ss.getName() + ' backup ' + stamp, folder);

  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(BACKUP_KEEP).forEach(function (f) { f.setTrashed(true); });

  PropertiesService.getScriptProperties().setProperty('LAST_BACKUP', new Date().toISOString());
  return copy;
}

function backupNow() {
  const copy = dailyBackup();
  notify_('Backup saved to Drive → ' + BACKUP_FOLDER + ' as "' + copy.getName() + '". The last ' + BACKUP_KEEP + ' copies are kept.');
}

function enableDailyBackup() {
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', SpreadsheetApp.getActiveSpreadsheet().getId());
  removeBackupTriggers_();
  ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(2).create();
  dailyBackup();
  notify_('Daily backup is on. A copy of this Sheet is saved to Drive → ' + BACKUP_FOLDER + ' every night around 2 am; the last ' + BACKUP_KEEP + ' are kept. A first backup was made just now.');
}

function disableDailyBackup() {
  const n = removeBackupTriggers_();
  notify_(n ? 'Daily backup is off. Existing backups stay in Drive.' : 'Daily backup was not on.');
}

function removeBackupTriggers_() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyBackup') { ScriptApp.deleteTrigger(t); n++; }
  });
  return n;
}

function notify_(msg) {
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* run from the editor or a trigger */ }
}

/** Creates every tab with headers and text formatting. Re-running only adds what is missing. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabs = Object.keys(SCHEMA).map(function (t) { return { name: t, headers: headersFor_(t) }; });
  tabs.push({ name: 'Counters', headers: ['key', 'last_seq'] });
  const addedLines = [];
  tabs.forEach(function (tab) {
    let sh = ss.getSheetByName(tab.name);
    if (!sh) sh = ss.insertSheet(tab.name);
    const res = ensureColumns_(sh, tab.headers);
    if (res.added.length) addedLines.push(tab.name + ': +' + res.added.join(', '));
    const headers = res.headers.length ? res.headers : tab.headers;
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f3e6c8');
    sh.setFrozenRows(1);
    const byFormat = {};
    headers.forEach(function (h, i) {
      const fmt = tab.name === 'Counters' ? (h === 'last_seq' ? '0' : '@') : formatFor_(h);
      const col = columnLetter_(i + 1);
      (byFormat[fmt] = byFormat[fmt] || []).push(col + '2:' + col);
    });
    Object.keys(byFormat).forEach(function (fmt) { sh.getRangeList(byFormat[fmt]).setNumberFormat(fmt); });
  });
  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
  seedSettings_({
    company_name: 'Ace Café',
    tax_percent: '5',
    tax_inclusive: 'TRUE',
    receipt_footer: 'Thank you. Visit again.',
    print_customer: 'TRUE',
    print_counter: 'FALSE'
  });
  seedMenu_();
  getTokenSecret_();
  SpreadsheetApp.flush();
  const tz = Session.getScriptTimeZone();
  const msg = 'Setup complete (API ' + API_VERSION + ').' +
    (addedLines.length ? ' Added: ' + addedLines.join(' · ') + '.' : ' Columns already up to date.') +
    (tz !== 'Asia/Kolkata' ? ' Warning: script time zone is ' + tz + ' — set it to Asia/Kolkata in Project Settings.' : '') +
    (PropertiesService.getScriptProperties().getProperty('PASSWORD_HASH') ? '' : ' Next: Ace Café → Set app password.');
  ss.toast(msg, 'Ace Café', 15);
  Logger.log(msg);
}


function columnLetter_(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function seedSettings_(defaults) {
  const t = readTable_('Settings');
  const now = nowIso_();
  Object.keys(defaults).forEach(function (key) {
    if (t.index[key] != null) return;
    const row = blankRow_('Settings');
    row.id = key; row.key = key; row.value = defaults[key];
    row.created_at = now; row.updated_at = now; row.created_by = 'setup'; row.updated_by = 'setup'; row.is_deleted = false;
    t.appended.push(row);
  });
  if (t.appended.length) {
    writeTable_(t);
    PropertiesService.getScriptProperties().setProperty('mod_Settings', now);
  }
}

function promptSetPassword() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Set app password', 'Enter the new password everyone will use to log in (min 6 characters):', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const pw = res.getResponseText();
  if (!pw || pw.length < 6) { ui.alert('Password must be at least 6 characters.'); return; }
  const salt = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperties({
    PASSWORD_SALT: salt,
    PASSWORD_HASH: sha256Hex_(salt + pw),
    TOKEN_SECRET: Utilities.getUuid() + Utilities.getUuid()
  });
  ui.alert('Password set. All devices must log in again with the new password.');
}

function logoutAllDevices() {
  PropertiesService.getScriptProperties().setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
  try { SpreadsheetApp.getUi().alert('Done. Every device will need to log in again.'); } catch (e) { /* run from editor */ }
}
