/**
 * Café rules shared by the till and the other screens.
 * Prices on the menu already include GST. A bill keeps the tax rate it was
 * priced with, so changing Settings later does not rewrite old bills.
 *
 * Sample menu ids match the rows Apps Script seeds. Keep the two lists together.
 */
const Cafe = (() => {
  const SERVICES = ['Dine-in', 'Takeaway'];
  const PAY_MODES = ['Cash', 'UPI', 'Card'];
  const EXPENSE_CATEGORIES = ['Purchase', 'Rent', 'Salaries', 'Utilities', 'Maintenance', 'Miscellaneous'];

  const SEED_CATEGORIES = [
    ['cat-coffee', 'Coffee', 1],
    ['cat-tea', 'Tea', 2],
    ['cat-coolers', 'Coolers', 3],
    ['cat-snacks', 'Snacks', 4]
  ];
  const SEED_ITEMS = [
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
  ];

  function isOn(v) {
    return v !== false && v !== 'FALSE' && v !== 'false' && v !== 0 && v !== '0';
  }

  function taxPercent() {
    const n = Number(Store.settings().tax_percent);
    return Number.isFinite(n) && n >= 0 ? n : 5;
  }

  function deviceCode() {
    const raw = String(localStorage.getItem('ace_device_code') || 'C1').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    return raw || 'C1';
  }

  function setDeviceCode(code) {
    const clean = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (!clean) throw new Error('Counter code needs a letter or number');
    localStorage.setItem('ace_device_code', clean);
    return clean;
  }

  /** Per-counter sequence so a receipt can be printed before the Sheet answers. */
  function nextBillNo() {
    const code = deviceCode();
    const re = new RegExp('^' + code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(\\d+)$');
    let max = Number(localStorage.getItem('ace_seq_' + code) || 0);
    Store.list('Bills', { includeDeleted: true }).forEach(b => {
      const m = String(b.bill_no || '').match(re);
      if (m) max = Math.max(max, Number(m[1]));
    });
    const n = max + 1;
    localStorage.setItem('ace_seq_' + code, String(n));
    return code + '-' + String(n).padStart(4, '0');
  }

  function categories() {
    return Store.list('MenuCategories')
      .filter(c => isOn(c.active))
      .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0) || String(a.name).localeCompare(String(b.name)));
  }

  function menuItems() {
    const catOrder = new Map(categories().map((c, i) => [c.id, i]));
    return Store.list('MenuItems').sort((a, b) =>
      (catOrder.get(a.category_id) ?? 99) - (catOrder.get(b.category_id) ?? 99)
      || (Number(a.sort) || 0) - (Number(b.sort) || 0)
      || String(a.name).localeCompare(String(b.name)));
  }

  function itemsFor(billId) {
    return Store.list('BillItems')
      .filter(i => i.bill_id === billId)
      .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
  }

  function paymentsFor(billId, { includeVoid = false } = {}) {
    return Store.list('BillPayments')
      .filter(p => p.bill_id === billId && (includeVoid || p.status !== 'Void'))
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  }

  function paidSum(billId) {
    return U.round2(paymentsFor(billId).reduce((s, p) => s + (Number(p.amount) || 0), 0));
  }

  function priceOf(lines, discount) {
    const gross = U.round2(lines.reduce((s, l) => s + U.round2((Number(l.qty) || 0) * (Number(l.rate) || 0)), 0));
    let disc = U.round2(discount);
    if (disc < 0) disc = 0;
    if (disc > gross) disc = gross;
    const total = U.round2(gross - disc);
    const pct = taxPercent();
    const tax = pct > 0 ? U.round2(total * pct / (100 + pct)) : 0;
    return { gross, discount: disc, subtotal: U.round2(total - tax), tax, tax_percent: pct, total };
  }

  function totalsOp(bill, lines) {
    const t = priceOf(lines, bill.discount);
    return ['Bills', {
      id: bill.id,
      discount: t.discount,
      subtotal: t.subtotal,
      tax: t.tax,
      tax_percent: t.tax_percent,
      total: t.total
    }];
  }

  function current() {
    const id = sessionStorage.getItem('ace_bill');
    if (!id) return null;
    const bill = Store.get('Bills', id);
    if (!bill || bill.is_deleted || bill.status !== 'Open') {
      sessionStorage.removeItem('ace_bill');
      return null;
    }
    return bill;
  }

  function resume(id) {
    const bill = Store.get('Bills', id);
    if (!bill || bill.is_deleted || bill.status !== 'Open') throw new Error('That bill is not open');
    sessionStorage.setItem('ace_bill', id);
  }

  function due(bill) {
    if (!bill) return 0;
    return Math.max(0, U.round2((Number(bill.total) || 0) - paidSum(bill.id)));
  }

  async function addItem(menuItemId) {
    const item = Store.get('MenuItems', menuItemId);
    if (!item || item.is_deleted) throw new Error('That item is not on the menu');
    if (!isOn(item.available)) throw new Error(item.name + ' is marked unavailable');
    const rate = U.round2(item.price);
    let bill = current();
    if (!bill) {
      const id = U.uuid();
      const t = priceOf([{ qty: 1, rate }], 0);
      // Set before the save notifies the screen, or the first item paints an empty ticket.
      sessionStorage.setItem('ace_bill', id);
      sessionStorage.removeItem('ace_last_paid');
      try {
        await Store.saveMany([
          ['Bills', {
            id,
            bill_no: nextBillNo(),
            bill_date: U.today(),
            opened_at: U.nowIso(),
            closed_at: '',
            service: 'Dine-in',
            table_no: '',
            customer_name: '',
            customer_phone: '',
            status: 'Open',
            void_reason: '',
            notes: '',
            discount: t.discount,
            subtotal: t.subtotal,
            tax: t.tax,
            tax_percent: t.tax_percent,
            total: t.total
          }],
          ['BillItems', {
            id: U.uuid(),
            bill_id: id,
            menu_item_id: item.id,
            item_name: item.name,
            qty: 1,
            rate,
            amount: rate,
            note: '',
            sort: 1
          }]
        ]);
      } catch (err) {
        if (sessionStorage.getItem('ace_bill') === id) sessionStorage.removeItem('ace_bill');
        throw err;
      }
      return id;
    }
    const lines = itemsFor(bill.id);
    const existing = lines.find(l => l.menu_item_id === item.id && !String(l.note || '').trim());
    const ops = [];
    let nextLines;
    if (existing) {
      const qty = U.round2(Number(existing.qty) + 1);
      const amount = U.round2(qty * Number(existing.rate));
      nextLines = lines.map(l => l.id === existing.id ? { ...l, qty, amount } : l);
      ops.push(['BillItems', { id: existing.id, qty, amount }]);
    } else {
      const sort = lines.reduce((m, l) => Math.max(m, Number(l.sort) || 0), 0) + 1;
      nextLines = lines.concat([{ qty: 1, rate }]);
      ops.push(['BillItems', {
        id: U.uuid(),
        bill_id: bill.id,
        menu_item_id: item.id,
        item_name: item.name,
        qty: 1,
        rate,
        amount: rate,
        note: '',
        sort
      }]);
    }
    ops.push(totalsOp(bill, nextLines));
    await Store.saveMany(ops);
    return bill.id;
  }

  async function setQty(lineId, qty) {
    const line = Store.get('BillItems', lineId);
    if (!line) return;
    const bill = Store.get('Bills', line.bill_id);
    if (!bill || bill.status !== 'Open') throw new Error('This bill is closed');
    qty = Math.max(0, U.round2(qty));
    const lines = itemsFor(bill.id)
      .filter(l => l.id !== lineId || qty > 0)
      .map(l => l.id === lineId ? { ...l, qty, amount: U.round2(qty * Number(l.rate)) } : l);
    const ops = [qty > 0
      ? ['BillItems', { id: lineId, qty, amount: U.round2(qty * Number(line.rate)) }]
      : ['BillItems', { id: lineId, is_deleted: true }]];
    ops.push(totalsOp(bill, lines));
    await Store.saveMany(ops);
  }

  async function setNote(lineId, note) {
    const line = Store.get('BillItems', lineId);
    if (!line) return;
    const bill = Store.get('Bills', line.bill_id);
    if (!bill || bill.status !== 'Open') throw new Error('This bill is closed');
    await Store.save('BillItems', { id: lineId, note: String(note || '').trim() });
  }

  async function updateBill(bill, patch) {
    if (!bill || bill.status !== 'Open') return;
    const phone = patch.customer_phone != null ? String(patch.customer_phone).trim() : String(bill.customer_phone || '');
    if (phone && !U.isPhone(phone)) throw new Error('Phone must be 10 digits');
    const next = {
      service: patch.service || bill.service || 'Dine-in',
      table_no: patch.table_no != null ? String(patch.table_no).trim() : String(bill.table_no || ''),
      customer_name: patch.customer_name != null ? String(patch.customer_name).trim() : String(bill.customer_name || ''),
      customer_phone: phone,
      notes: patch.notes != null ? String(patch.notes).trim() : String(bill.notes || ''),
      discount: patch.discount != null ? patch.discount : bill.discount
    };
    const t = priceOf(itemsFor(bill.id), next.discount);
    await Store.save('Bills', { id: bill.id, ...next, discount: t.discount, subtotal: t.subtotal, tax: t.tax, tax_percent: t.tax_percent, total: t.total });
  }

  async function discard(bill) {
    if (!bill || bill.status !== 'Open') throw new Error('This bill is closed');
    if (paidSum(bill.id) > 0) throw new Error('This bill has a payment. Void that payment, or finish the bill.');
    const ops = itemsFor(bill.id).map(l => ['BillItems', { id: l.id, is_deleted: true }]);
    ops.push(['Bills', { id: bill.id, is_deleted: true }]);
    await Store.saveMany(ops);
    if (sessionStorage.getItem('ace_bill') === bill.id) sessionStorage.removeItem('ace_bill');
  }

  /**
   * Records a payment. Cash may be tendered above the balance; the stored
   * amount is only what was due, and `change` is the rest.
   * Closes the bill when the balance reaches zero.
   */
  async function takePayment(bill, mode, tendered) {
    if (!bill || bill.status !== 'Open') throw new Error('This bill is closed');
    if (!PAY_MODES.includes(mode)) throw new Error('Choose Cash, UPI or Card');
    const owing = due(bill);
    if (!(Number(bill.total) > 0) || !(owing > 0)) throw new Error('Nothing to pay yet');
    let entered = U.round2(tendered);
    if (!(entered > 0)) entered = owing;
    const amount = U.round2(Math.min(owing, entered));
    if (!(amount > 0)) throw new Error('Enter an amount');
    const ops = [['BillPayments', {
      bill_id: bill.id, mode, amount, ref: '', status: '', paid_at: U.nowIso()
    }]];
    const covered = U.round2(paidSum(bill.id) + amount) >= U.round2(Number(bill.total)) - 0.001;
    if (covered) {
      ops.push(['Bills', { id: bill.id, status: 'Paid', closed_at: U.nowIso() }]);
      // Set before the save notifies the screen, or the paid banner is painted too early.
      sessionStorage.removeItem('ace_bill');
      sessionStorage.setItem('ace_last_paid', bill.id);
    }
    await Store.saveMany(ops);
    return { covered, amount, change: mode === 'Cash' ? Math.max(0, U.round2(entered - amount)) : 0 };
  }

  async function voidPayment(payment) {
    const bill = Store.get('Bills', payment.bill_id);
    if (!bill || bill.status !== 'Open') throw new Error('This bill is already closed. Void the bill instead.');
    await Store.save('BillPayments', { id: payment.id, status: 'Void' });
  }

  async function voidBill(bill, reason) {
    const why = String(reason || '').trim();
    if (!why) throw new Error('Give a reason for voiding');
    if (!bill || bill.status === 'Void') throw new Error('This bill is already void');
    await Store.save('Bills', { id: bill.id, status: 'Void', void_reason: why });
    if (sessionStorage.getItem('ace_bill') === bill.id) sessionStorage.removeItem('ace_bill');
  }

  function dayBills(date, status = 'Paid') {
    return Store.list('Bills').filter(b => b.bill_date === date && b.status === status);
  }

  function dayFigures(date) {
    const bills = dayBills(date, 'Paid');
    const ids = new Set(bills.map(b => b.id));
    const pays = Store.list('BillPayments').filter(p => ids.has(p.bill_id) && p.status !== 'Void');
    const sumMode = mode => U.round2(pays.filter(p => p.mode === mode).reduce((s, p) => s + (Number(p.amount) || 0), 0));
    const expenses = U.round2(Store.list('Expenses').filter(e => e.date === date).reduce((s, e) => s + (Number(e.amount) || 0), 0));
    return {
      count: bills.length,
      sales: U.round2(bills.reduce((s, b) => s + (Number(b.total) || 0), 0)),
      cash: sumMode('Cash'),
      upi: sumMode('UPI'),
      card: sumMode('Card'),
      expenses
    };
  }

  async function ensureSetup() {
    if (!Store.list('MenuCategories', { includeDeleted: true }).length) {
      const ops = SEED_CATEGORIES.map(([id, name, sort]) => ['MenuCategories', { id, name, sort, active: true }]);
      SEED_ITEMS.forEach(([id, category_id, name, price, sort]) => {
        ops.push(['MenuItems', { id, category_id, name, price, sort, available: true }]);
      });
      await Store.saveMany(ops);
    }
    const have = Store.settings();
    const defaults = {
      company_name: 'Ace Café',
      tax_percent: '5',
      tax_inclusive: 'TRUE',
      receipt_footer: 'Thank you. Visit again.',
      print_customer: 'TRUE',
      print_counter: 'FALSE'
    };
    const missing = Object.entries(defaults).filter(([key]) => !(key in have));
    if (missing.length) {
      await Store.saveMany(missing.map(([key, value]) => ['Settings', { id: key, key, value }]));
    }
  }

  function qtyLabel(n) {
    const v = U.round2(n);
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }

  /** Missing keys keep the default: customer bill on, counter slip off. */
  function flagOn(key, fallback) {
    const v = Store.settings()[key];
    if (v == null || v === '') return fallback;
    const s = String(v).trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'no') return false;
    return fallback;
  }

  function receiptPrefs() {
    return {
      customer: flagOn('print_customer', true),
      counter: flagOn('print_counter', false)
    };
  }

  function billMeta(bill) {
    const bits = [];
    if (bill.service) bits.push(bill.service);
    if (bill.table_no) bits.push('Table ' + bill.table_no);
    if (bill.customer_name) bits.push(bill.customer_name);
    return bits.join(' · ');
  }

  const RECEIPT_CSS = `
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { font-family: "Segoe UI", sans-serif; color: #000; width: 72mm; margin: 0 auto; }
    .slip { padding: 3mm 0 5mm; }
    .slip.break { break-before: page; page-break-before: always; }
    h1 { font-size: 16px; letter-spacing: 0.08em; text-align: center; margin: 0 0 2px; }
    .kicker { text-align: center; font-size: 13px; font-weight: 700; letter-spacing: 0.18em; margin: 0 0 4px; }
    .center { text-align: center; } .muted { font-size: 11px; }
    .rule { border-top: 1px dashed #000; margin: 6px 0; }
    .row, .line { display: flex; justify-content: space-between; gap: 6px; font-size: 12px; }
    .line b { font-weight: 600; } .grow { flex: 1; }
    .ticket { display: flex; align-items: baseline; gap: 8px; font-size: 13px; }
    .qty { min-width: 2.6em; font-size: 16px; font-weight: 700; } .note { font-size: 11px; }
    .amt { min-width: 52px; text-align: right; }
    .total { font-size: 15px; font-weight: 700; }
    .foot { text-align: center; margin-top: 8px; font-size: 11px; }
  `;

  function customerSlip(bill, s, lines, pays) {
    const name = s.company_name || APP_CONFIG.companyName;
    const taxLine = Number(bill.tax) > 0
      ? `<div class="row"><span>Includes GST ${U.esc(bill.tax_percent)}%</span><span>${U.esc(U.money(bill.tax))}</span></div>`
      : '';
    const discount = Number(bill.discount) > 0
      ? `<div class="row"><span>Discount</span><span>- ${U.esc(U.money(bill.discount))}</span></div>`
      : '';
    const meta = billMeta(bill);
    return `
      <h1>${U.esc(String(name).toUpperCase())}</h1>
      <div class="center muted">${[s.address, s.phone].filter(Boolean).map(U.esc).join('<br>')}</div>
      ${s.gstin ? `<div class="center muted">GSTIN ${U.esc(s.gstin)}</div>` : ''}
      <div class="rule"></div>
      <div class="row"><span>Bill ${U.esc(bill.bill_no || '')}</span><span>${U.esc(U.fmtDateTime(bill.closed_at || bill.opened_at))}</span></div>
      ${meta ? `<div class="muted">${U.esc(meta)}</div>` : ''}
      <div class="rule"></div>
      ${lines.map(l => `<div class="line"><span class="grow"><b>${U.esc(l.item_name)}</b>${l.note ? `<div class="note">${U.esc(l.note)}</div>` : ''}</span><span>${qtyLabel(l.qty)} × ${U.esc(U.money(l.rate))}</span><span class="amt">${U.esc(U.money(l.amount))}</span></div>`).join('')}
      <div class="rule"></div>
      ${discount}
      ${taxLine}
      <div class="row total"><span>Total</span><span>₹ ${U.esc(U.money(bill.total))}</span></div>
      ${pays.map(p => `<div class="row"><span>${U.esc(p.mode)}</span><span>${U.esc(U.money(p.amount))}</span></div>`).join('')}
      ${bill.status === 'Void' ? `<div class="center"><b>VOID</b> — ${U.esc(bill.void_reason || '')}</div>` : ''}
      <div class="foot">${U.esc(s.receipt_footer || 'Thank you. Visit again.')}${s.upi_id ? `<div>UPI ${U.esc(s.upi_id)}</div>` : ''}</div>`;
  }

  function counterSlip(bill, lines) {
    const meta = billMeta(bill);
    return `
      <div class="kicker">COUNTER</div>
      <div class="row"><span>Bill ${U.esc(bill.bill_no || '')}</span><span>${U.esc(U.fmtDateTime(bill.closed_at || bill.opened_at))}</span></div>
      ${meta ? `<div class="muted">${U.esc(meta)}</div>` : ''}
      <div class="rule"></div>
      ${lines.map(l => `<div class="ticket"><span class="qty">${qtyLabel(l.qty)} ×</span><span class="grow"><b>${U.esc(l.item_name)}</b>${l.note ? `<div class="note">${U.esc(l.note)}</div>` : ''}</span></div>`).join('')}
      ${bill.status === 'Void' ? `<div class="rule"></div><div class="center"><b>VOID</b> — ${U.esc(bill.void_reason || '')}</div>` : ''}`;
  }

  /**
   * One job for the receipt printer. Customer bill first, then the counter
   * slip on the next page so the cutter can separate them. Returns false
   * when both copies are switched off.
   */
  function printBill(bill) {
    if (!bill) return false;
    const prefs = receiptPrefs();
    if (!prefs.customer && !prefs.counter) return false;
    const s = Store.settings();
    const lines = itemsFor(bill.id);
    const pays = paymentsFor(bill.id, { includeVoid: true }).filter(p => p.status !== 'Void');
    const slips = [];
    if (prefs.customer) slips.push(customerSlip(bill, s, lines, pays));
    if (prefs.counter) slips.push(counterSlip(bill, lines));
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${U.esc(bill.bill_no || 'Bill')}</title><style>${RECEIPT_CSS}</style></head><body>${
      slips.map((body, i) => `<section class="slip${i ? ' break' : ''}">${body}</section>`).join('')
    }</body></html>`;
    let frame = document.getElementById('ace-print-frame');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'ace-print-frame';
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
      document.body.appendChild(frame);
    }
    const doc = frame.contentDocument;
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    }, 80);
    return true;
  }

  return {
    SERVICES, PAY_MODES, EXPENSE_CATEGORIES,
    isOn, taxPercent, deviceCode, setDeviceCode, nextBillNo,
    categories, menuItems, itemsFor, paymentsFor, paidSum, priceOf, due,
    current, resume, addItem, setQty, setNote, updateBill, discard,
    takePayment, voidPayment, voidBill, dayBills, dayFigures, ensureSetup,
    qtyLabel, receiptPrefs, printBill
  };
})();
