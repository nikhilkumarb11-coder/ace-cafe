/**
 * The till. Categories and item tiles on the left, the open bill on the right.
 * On a phone the bill is a sheet above the bottom bar.
 */
Views.pos = {
  title: 'POS',
  refreshOn: ['Bills', 'BillItems', 'BillPayments', 'MenuItems', 'MenuCategories', 'Settings'],

  q: '',
  category: 'all',
  mode: 'Cash',
  mountedFor: undefined,
  root: null,

  render(el) {
    this.root = el;
    this.mountedFor = undefined;
    el.innerHTML = `
      <div class="pos-shell">
        <section class="pos-menu">
          <div class="pos-tools">
            <label class="visually-hidden" for="pos-search">Search the menu</label>
            <input id="pos-search" class="form-control" placeholder="Search the menu" autocomplete="off" enterkeyhint="search" value="${U.esc(this.q)}">
          </div>
          <div class="cat-row" id="pos-cats"></div>
          <div class="item-grid" id="pos-grid"></div>
        </section>
        <aside class="pos-ticket" id="pos-ticket"><div id="pos-ticket-body"></div></aside>
      </div>
      <div class="pos-backdrop" id="pos-backdrop"></div>
      <div class="pos-bar d-lg-none" id="pos-bar"></div>`;

    el.querySelector('#pos-search').addEventListener('input', e => {
      this.q = e.target.value;
      this.paintGrid();
    });
    // The page element is reused. A new listener on every visit was counting one tap twice.
    if (this._click) el.removeEventListener('click', this._click);
    this._click = e => this.onClick(e);
    el.addEventListener('click', this._click);
    el.querySelector('#pos-backdrop').addEventListener('click', () => this.closeTicket());
    if (this._key) document.removeEventListener('keydown', this._key);
    this._key = e => this.onKey(e);
    document.addEventListener('keydown', this._key);
    this.paint();
  },

  update() {
    if (!document.getElementById('pos-grid')) return;
    this.paint();
  },

  openTicket() {
    document.getElementById('pos-ticket')?.classList.add('open');
    document.getElementById('pos-backdrop')?.classList.add('open');
  },

  closeTicket() {
    document.getElementById('pos-ticket')?.classList.remove('open');
    document.getElementById('pos-backdrop')?.classList.remove('open');
  },

  /** Enter takes payment once the bill has items, unless a text field is being filled in. */
  onKey(e) {
    if (!document.getElementById('pos-grid')) return;
    if (e.key === 'Escape') { this.closeTicket(); return; }
    if (e.key !== 'Enter' || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    const t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (t && t.closest && t.closest('.modal')) return;
    if (t && t.id === 'pos-search' && String(t.value || '').trim()) return;
    if (t && t.closest && t.closest('#pos-ticket') && t.matches && t.matches('input, textarea') && t.id !== 'pos-amount') return;
    const bill = Cafe.current();
    if (!bill || bill.status !== 'Open' || !Cafe.itemsFor(bill.id).length || !(Cafe.due(bill) > 0)) return;
    e.preventDefault();
    this.pay();
  },

  async onClick(e) {
    const add = e.target.closest('[data-add]');
    const cat = e.target.closest('[data-cat]');
    const dec = e.target.closest('[data-dec]');
    const inc = e.target.closest('[data-inc]');
    const note = e.target.closest('[data-note]');
    const service = e.target.closest('[data-service]');
    const discard = e.target.closest('[data-discard]');
    const mode = e.target.closest('[data-mode]');
    const quick = e.target.closest('[data-quick]');
    const take = e.target.closest('[data-take]');
    const voidPay = e.target.closest('[data-void-pay]');
    const open = e.target.closest('[data-open-ticket]');
    const print = e.target.closest('[data-print]');
    const resume = e.target.closest('[data-new]');
    try {
      if (add) {
        if (this.adding) return;
        this.adding = true;
        try {
          await Cafe.addItem(add.dataset.add);
          this.openTicket();
        } finally {
          this.adding = false;
        }
        return;
      }
      if (cat) { this.category = cat.dataset.cat; this.paintCats(); this.paintGrid(); return; }
      if (dec) { const line = Store.get('BillItems', dec.dataset.dec); if (line) await Cafe.setQty(line.id, Number(line.qty) - 1); return; }
      if (inc) { const line = Store.get('BillItems', inc.dataset.inc); if (line) await Cafe.setQty(line.id, Number(line.qty) + 1); return; }
      if (note) { await this.editNote(note.dataset.note); return; }
      if (service) { await Cafe.updateBill(Cafe.current(), { service: service.dataset.service }); return; }
      if (discard) { await this.discard(); return; }
      if (mode) { this.mode = mode.dataset.mode; this.paintPay(); return; }
      if (quick) { const input = document.getElementById('pos-amount'); if (input) { input.value = quick.dataset.quick; input.dataset.touched = '1'; } this.paintPay(); return; }
      if (take) { await this.pay(); return; }
      if (voidPay) { await Cafe.voidPayment(Store.get('BillPayments', voidPay.dataset.voidPay)); return; }
      if (open) { this.openTicket(); return; }
      if (print) {
        if (!Cafe.printBill(Store.get('Bills', print.dataset.print))) UI.toast('Turn on a receipt in Settings', 'warning');
        return;
      }
      if (resume) { sessionStorage.removeItem('ace_last_paid'); this.mountedFor = undefined; this.paintTicket(); this.paintBar(); return; }
    } catch (err) {
      UI.toast(err.message, 'danger');
    }
  },

  async editNote(lineId) {
    const line = Store.get('BillItems', lineId);
    if (!line) return;
    const data = await UI.form({
      title: line.item_name,
      okText: 'Save note',
      fields: [{ name: 'note', label: 'Note for the kitchen', value: line.note || '', maxlength: 80 }]
    });
    if (!data) return;
    await Cafe.setNote(lineId, data.note);
  },

  async discard() {
    const bill = Cafe.current();
    if (!bill) return;
    const ok = await UI.confirm({ title: 'Discard this bill?', message: 'The open bill and its items will be removed.', confirmText: 'Discard' });
    if (!ok) return;
    await Cafe.discard(bill);
    this.closeTicket();
  },

  async pay() {
    if (this.paying) return;
    const bill = Cafe.current();
    if (!bill) return;
    this.paying = true;
    try {
      const entered = document.getElementById('pos-amount')?.value;
      const result = await Cafe.takePayment(bill, this.mode, entered);
      const fresh = Store.get('Bills', bill.id);
      if (result.change > 0) UI.toast(`Change ${U.inr(result.change)}`);
      if (result.covered) {
        this.closeTicket();
        Cafe.printBill(fresh);
        UI.toast(`Paid ${fresh.bill_no}`, 'success');
      }
    } finally {
      this.paying = false;
    }
  },

  paint() {
    this.paintCats();
    this.paintGrid();
    this.paintTicket();
    this.paintBar();
  },

  paintCats() {
    const box = document.getElementById('pos-cats');
    if (!box) return;
    const cats = Cafe.categories();
    const chip = (id, label) => `<button type="button" class="cat-chip ${this.category === id ? 'active' : ''}" data-cat="${U.esc(id)}">${U.esc(label)}</button>`;
    box.innerHTML = chip('all', 'All') + cats.map(c => chip(c.id, c.name)).join('');
  },

  paintGrid() {
    const box = document.getElementById('pos-grid');
    if (!box) return;
    const q = this.q.trim().toLowerCase();
    const activeCats = new Set(Cafe.categories().map(c => c.id));
    const items = Cafe.menuItems().filter(i => {
      if (!Cafe.isOn(i.available)) return false;
      if (!activeCats.has(i.category_id)) return false;
      if (this.category !== 'all' && i.category_id !== this.category) return false;
      if (q && !String(i.name).toLowerCase().includes(q)) return false;
      return true;
    });
    if (!items.length) {
      box.innerHTML = `<div class="pos-empty">
        <p>${q ? 'No items match that search.' : 'Nothing on the menu yet.'}</p>
        <a class="btn btn-outline-primary btn-sm" href="#/menu">Edit the menu</a>
      </div>`;
      return;
    }
    box.innerHTML = items.map(i => `
      <button type="button" class="item-tile" data-add="${U.esc(i.id)}">
        <span class="item-name">${U.esc(i.name)}</span>
        <span class="item-price">${U.inr(i.price)}</span>
      </button>`).join('');
  },

  paintTicket() {
    const body = document.getElementById('pos-ticket-body');
    if (!body) return;
    const bill = Cafe.current();
    const id = bill ? bill.id : '';
    if (this.mountedFor !== id) {
      this.mountedFor = id;
      body.innerHTML = bill ? this.ticketShell(bill) : this.emptyShell();
      this.wireTicket();
    }
    if (!bill) return;
    this.fillLines(bill);
    this.fillMeta(bill);
    this.paintPay();
  },

  emptyShell() {
    const paidId = sessionStorage.getItem('ace_last_paid');
    const paid = paidId && Store.get('Bills', paidId);
    const done = paid && paid.status === 'Paid' ? `
      <div class="ticket-done">
        <div class="ticket-no">${U.esc(paid.bill_no)}</div>
        <div class="ticket-total">${U.inr(paid.total)}</div>
        <div class="text-muted small mb-3">Paid</div>
        <button type="button" class="btn btn-outline-primary" data-print="${U.esc(paid.id)}"><i class="bx bx-printer me-1"></i>Print</button>
        <button type="button" class="btn btn-primary ms-2" data-new>New bill</button>
      </div>` : '';
    return `<div class="ticket-empty">
      ${done}
      <i class="bx bx-coffee"></i>
      <p>Tap an item to start a bill.</p>
    </div>`;
  },

  ticketShell(bill) {
    return `
      <div class="ticket-head">
        <div>
          <div class="ticket-no" id="pos-no"></div>
          <div class="text-muted small" id="pos-when"></div>
        </div>
        <button type="button" class="btn btn-sm btn-icon btn-outline-secondary d-lg-none" data-close-ticket aria-label="Close"><i class="bx bx-x"></i></button>
        <button type="button" class="btn btn-sm btn-outline-danger" data-discard>Discard</button>
      </div>
      <div class="service-row" id="pos-service">
        ${Cafe.SERVICES.map(s => `<button type="button" data-service="${s}">${s}</button>`).join('')}
      </div>
      <input class="form-control form-control-sm mb-2" id="pos-table" placeholder="Table" maxlength="20" autocomplete="off">
      <div id="pos-lines"></div>
      <div class="discount-row">
        <label for="pos-discount">Discount ₹</label>
        <input id="pos-discount" inputmode="decimal" autocomplete="off">
      </div>
      <div id="pos-totals"></div>
      <details class="ticket-customer">
        <summary>Customer</summary>
        <input class="form-control form-control-sm mb-2" id="pos-name" placeholder="Name" maxlength="60" autocomplete="off">
        <input class="form-control form-control-sm" id="pos-phone" placeholder="Phone" inputmode="numeric" maxlength="10" autocomplete="off">
      </details>
      <div id="pos-payments"></div>
      <div class="pay-box" id="pos-pay">
        <div class="mode-row">
          ${Cafe.PAY_MODES.map(m => `<button type="button" data-mode="${m}">${m}</button>`).join('')}
        </div>
        <label class="form-label small mb-1" for="pos-amount">Amount</label>
        <input class="form-control" id="pos-amount" inputmode="decimal" autocomplete="off">
        <div class="quick-cash" id="pos-quick"></div>
        <div class="small text-muted" id="pos-change"></div>
        <button type="button" class="btn btn-primary w-100" data-take>Take payment</button>
      </div>`;
  },

  wireTicket() {
    const save = async patch => {
      try { await Cafe.updateBill(Cafe.current(), patch); }
      catch (err) { UI.toast(err.message, 'danger'); }
    };
    const table = document.getElementById('pos-table');
    const name = document.getElementById('pos-name');
    const phone = document.getElementById('pos-phone');
    const discount = document.getElementById('pos-discount');
    table?.addEventListener('change', () => save({ table_no: table.value }));
    name?.addEventListener('change', () => save({ customer_name: name.value }));
    phone?.addEventListener('change', () => save({ customer_phone: phone.value }));
    discount?.addEventListener('change', () => save({ discount: discount.value }));
    document.querySelector('[data-close-ticket]')?.addEventListener('click', () => this.closeTicket());
  },

  fillMeta(bill) {
    const no = document.getElementById('pos-no');
    if (no) no.textContent = bill.bill_no || 'New bill';
    const when = document.getElementById('pos-when');
    if (when) when.textContent = U.fmtDateTime(bill.opened_at);
    document.querySelectorAll('[data-service]').forEach(btn => btn.classList.toggle('active', btn.dataset.service === (bill.service || 'Dine-in')));
    const table = document.getElementById('pos-table');
    if (table) {
      table.parentElement?.classList.toggle('d-none', false);
      table.classList.toggle('d-none', (bill.service || 'Dine-in') !== 'Dine-in');
      if (document.activeElement !== table && table.value !== (bill.table_no || '')) table.value = bill.table_no || '';
    }
    const name = document.getElementById('pos-name');
    const phone = document.getElementById('pos-phone');
    if (name && document.activeElement !== name) name.value = bill.customer_name || '';
    if (phone && document.activeElement !== phone) phone.value = bill.customer_phone || '';
    const discount = document.getElementById('pos-discount');
    if (discount && document.activeElement !== discount) discount.value = Number(bill.discount) ? String(bill.discount) : '';
  },

  fillLines(bill) {
    const box = document.getElementById('pos-lines');
    if (!box || box.querySelector('input:focus')) return;
    const lines = Cafe.itemsFor(bill.id);
    if (!lines.length) {
      box.innerHTML = '<div class="text-muted small py-3 text-center">No items yet.</div>';
      return;
    }
    box.innerHTML = lines.map(l => `
      <div class="tline">
        <div class="tline-name">
          <div>${U.esc(l.item_name)}</div>
          ${l.note ? `<div class="tline-note">${U.esc(l.note)}</div>` : ''}
          <button type="button" class="tline-note-btn" data-note="${U.esc(l.id)}">${l.note ? 'Edit note' : 'Note'}</button>
        </div>
        <div class="tline-qty">
          <button type="button" data-dec="${U.esc(l.id)}" aria-label="Less">−</button>
          <span>${Cafe.qtyLabel(l.qty)}</span>
          <button type="button" data-inc="${U.esc(l.id)}" aria-label="More">+</button>
        </div>
        <div class="tline-amt">${U.inr(l.amount)}</div>
      </div>`).join('');
  },

  paintPay() {
    const bill = Cafe.current();
    const box = document.getElementById('pos-pay');
    if (!bill || !box) return;
    document.querySelectorAll('[data-mode]').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === this.mode));
    const owing = Cafe.due(bill);
    const amount = document.getElementById('pos-amount');
    if (amount && document.activeElement !== amount) {
      if (amount.dataset.owing !== String(owing)) delete amount.dataset.touched;
      if (!amount.dataset.touched) amount.value = owing ? String(owing) : '';
      amount.dataset.owing = String(owing);
    }
    const entered = U.round2(amount ? amount.value : owing);
    const applied = Math.min(owing, entered > 0 ? entered : owing);
    const change = this.mode === 'Cash' ? Math.max(0, U.round2((entered || 0) - owing)) : 0;
    const quick = document.getElementById('pos-quick');
    if (quick) {
      const steps = [100, 200, 500, 1000, 2000].filter(n => n > owing);
      quick.innerHTML = this.mode === 'Cash'
        ? [`<button type="button" data-quick="${owing || 0}">Exact</button>`, ...steps.map(n => `<button type="button" data-quick="${n}">${n}</button>`)].join('')
        : '';
    }
    const changeEl = document.getElementById('pos-change');
    if (changeEl) changeEl.textContent = change > 0 ? `Change ${U.inr(change)}` : '';
    const take = box.querySelector('[data-take]');
    if (take) {
      take.disabled = !(owing > 0);
      const printing = Cafe.receiptPrefs().customer || Cafe.receiptPrefs().counter;
      take.textContent = owing > 0 ? `${printing ? 'Take & print' : 'Take'} ${U.inr(applied || owing)}` : 'Paid';
    }
    const totals = document.getElementById('pos-totals');
    if (totals) {
      const lines = Cafe.itemsFor(bill.id);
      const gross = U.round2(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0));
      totals.innerHTML = `
        <div class="tot-row"><span>Items</span><span>${U.inr(gross)}</span></div>
        ${Number(bill.discount) > 0 ? `<div class="tot-row"><span>Discount</span><span>− ${U.inr(bill.discount)}</span></div>` : ''}
        ${Number(bill.tax) > 0 ? `<div class="tot-row text-muted"><span>Includes GST ${U.esc(bill.tax_percent)}%</span><span>${U.inr(bill.tax)}</span></div>` : ''}
        <div class="tot-row tot-total"><span>Total</span><span>${U.inr(bill.total)}</span></div>
        ${Cafe.paidSum(bill.id) > 0 ? `<div class="tot-row"><span>Paid</span><span>${U.inr(Cafe.paidSum(bill.id))}</span></div>
          <div class="tot-row"><span>Balance</span><span>${U.inr(owing)}</span></div>` : ''}`;
    }
    const pays = document.getElementById('pos-payments');
    if (pays) {
      const list = Cafe.paymentsFor(bill.id, { includeVoid: true });
      pays.innerHTML = list.map(p => `
        <div class="tpay ${p.status === 'Void' ? 'is-void' : ''}">
          <span>${U.esc(p.mode)}</span><span>${U.inr(p.amount)}</span>
          ${p.status === 'Void' ? '<span class="text-muted">Void</span>' : `<button type="button" data-void-pay="${U.esc(p.id)}">Void</button>`}
        </div>`).join('');
    }
  },

  paintBar() {
    const bar = document.getElementById('pos-bar');
    if (!bar) return;
    const bill = Cafe.current();
    bar.classList.toggle('d-none', !bill);
    if (!bill) return;
    const n = Cafe.itemsFor(bill.id).reduce((s, l) => s + (Number(l.qty) || 0), 0);
    bar.innerHTML = `
      <button type="button" class="pos-bar-sum" data-open-ticket>
        <span>${Cafe.qtyLabel(n)} item${n === 1 ? '' : 's'}</span>
        <strong>${U.inr(bill.total)}</strong>
      </button>
      <button type="button" class="btn btn-primary" data-open-ticket>Bill</button>`;
  }
};
