/** Open, paid and void bills, plus a single bill with print and void. */
Views.bills = {
  title: 'Bills',
  refreshOn: ['Bills', 'BillItems', 'BillPayments'],
  filter: 'open',
  date: U.today(),

  render(el, params) {
    if (params[0]) this.detail(el, params[0]);
    else this.list(el);
  },

  list(el) {
    const bills = this.filtered();
    const openCount = Store.list('Bills').filter(b => b.status === 'Open').length;
    el.innerHTML = `
      <div class="card mb-3"><div class="card-body py-3 d-flex flex-wrap gap-2 align-items-end">
        <div class="btn-group">
          ${[['open', `Open (${openCount})`], ['paid', 'Paid'], ['void', 'Void']].map(([id, label]) =>
            `<button type="button" class="btn btn-sm ${this.filter === id ? 'btn-primary' : 'btn-outline-secondary'}" data-filter="${id}">${label}</button>`).join('')}
        </div>
        <input type="date" class="form-control form-control-sm" style="max-width:11rem" id="bill-date" value="${U.esc(this.date)}" ${this.filter === 'open' ? 'disabled' : ''}>
        <span class="text-muted small">${this.filter === 'open' ? 'Every bill still unpaid.' : U.fmtDate(this.date)}</span>
      </div></div>
      <div id="bill-list">${this.rows(bills)}</div>`;
    el.querySelectorAll('[data-filter]').forEach(btn => btn.addEventListener('click', () => {
      this.filter = btn.dataset.filter;
      this.list(el);
    }));
    el.querySelector('#bill-date').addEventListener('change', e => {
      this.date = e.target.value || U.today();
      this.list(el);
    });
  },

  filtered() {
    return Store.list('Bills').filter(b => {
      if (b.status !== (this.filter === 'open' ? 'Open' : this.filter === 'void' ? 'Void' : 'Paid')) return false;
      if (this.filter !== 'open' && b.bill_date !== this.date) return false;
      return true;
    }).sort((a, b) => String(b.opened_at || '').localeCompare(String(a.opened_at || '')));
  },

  rows(bills) {
    if (!bills.length) {
      return `<div class="card"><div class="card-body text-center text-muted py-5">No ${this.filter} bills${this.filter === 'open' ? '' : ' on this date'}.</div></div>`;
    }
    return `<div class="card"><div class="list-group list-group-flush">${bills.map(b => {
      const n = Cafe.itemsFor(b.id).reduce((s, l) => s + (Number(l.qty) || 0), 0);
      const who = [b.service, b.table_no ? 'Table ' + b.table_no : '', b.customer_name].filter(Boolean).join(' · ');
      return `<a class="list-group-item list-group-item-action d-flex justify-content-between align-items-center gap-3" href="#/bills/${encodeURIComponent(b.id)}">
        <span class="min-w-0">
          <span class="fw-semibold d-block">${U.esc(b.bill_no || 'Bill')}</span>
          <span class="text-muted small">${U.esc(who)} · ${Cafe.qtyLabel(n)} item${n === 1 ? '' : 's'}</span>
        </span>
        <span class="text-end flex-shrink-0">
          <span class="fw-semibold d-block">${U.inr(b.total)}</span>
          <span class="text-muted small">${U.esc(U.fmtDateTime(b.opened_at))}</span>
        </span>
      </a>`;
    }).join('')}</div></div>`;
  },

  detail(el, id) {
    const bill = Store.get('Bills', id);
    if (!bill || bill.is_deleted) {
      el.innerHTML = `<div class="card"><div class="card-body text-center py-5">That bill is not on this device. <a href="#/bills">Back to bills</a></div></div>`;
      return;
    }
    const title = document.getElementById('page-title');
    if (title) title.textContent = bill.bill_no || 'Bill';
    const lines = Cafe.itemsFor(bill.id);
    const pays = Cafe.paymentsFor(bill.id, { includeVoid: true });
    const tone = bill.status === 'Paid' ? 'success' : bill.status === 'Void' ? 'secondary' : 'warning';
    el.innerHTML = `
      <div class="mb-3"><a href="#/bills" class="text-muted small"><i class="bx bx-chevron-left"></i> All bills</a></div>
      <div class="row g-3">
        <div class="col-lg-7">
          <div class="card">
            <div class="card-header d-flex justify-content-between align-items-center">
              <div>
                <h5 class="mb-0">${U.esc(bill.bill_no || 'Bill')}</h5>
                <small class="text-muted">${U.esc(bill.service || '')}${bill.table_no ? ' · Table ' + U.esc(bill.table_no) : ''}${bill.customer_name ? ' · ' + U.esc(bill.customer_name) : ''}</small>
              </div>
              <span class="badge bg-label-${tone}">${U.esc(bill.status)}</span>
            </div>
            <div class="list-group list-group-flush">
              ${lines.map(l => `<div class="list-group-item d-flex justify-content-between gap-3">
                <span>${U.esc(l.item_name)} <span class="text-muted">× ${Cafe.qtyLabel(l.qty)}</span>${l.note ? `<div class="small text-muted">${U.esc(l.note)}</div>` : ''}</span>
                <span class="fw-semibold">${U.inr(l.amount)}</span>
              </div>`).join('') || '<div class="list-group-item text-muted">No items.</div>'}
            </div>
            <div class="card-body">
              ${Number(bill.discount) > 0 ? `<div class="d-flex justify-content-between"><span>Discount</span><span>− ${U.inr(bill.discount)}</span></div>` : ''}
              ${Number(bill.tax) > 0 ? `<div class="d-flex justify-content-between text-muted"><span>Includes GST ${U.esc(bill.tax_percent)}%</span><span>${U.inr(bill.tax)}</span></div>` : ''}
              <div class="d-flex justify-content-between fs-5 fw-bold mt-2"><span>Total</span><span>${U.inr(bill.total)}</span></div>
              ${bill.status === 'Void' ? `<div class="alert alert-secondary mt-3 mb-0">Void — ${U.esc(bill.void_reason || '')}</div>` : ''}
            </div>
          </div>
        </div>
        <div class="col-lg-5">
          <div class="card mb-3">
            <h6 class="card-header">Payments</h6>
            <div class="list-group list-group-flush">
              ${pays.map(p => `<div class="list-group-item d-flex justify-content-between ${p.status === 'Void' ? 'text-muted' : ''}">
                <span>${U.esc(p.mode)}${p.status === 'Void' ? ' · void' : ''}</span><span>${U.inr(p.amount)}</span>
              </div>`).join('') || '<div class="list-group-item text-muted">No payments yet.</div>'}
            </div>
          </div>
          <div class="d-grid gap-2">
            ${bill.status === 'Open' ? `<a class="btn btn-primary" href="#/pos" id="bill-resume">Resume on the till</a>` : ''}
            <button type="button" class="btn btn-outline-primary" id="bill-print"><i class="bx bx-printer me-1"></i>Print</button>
            ${bill.status !== 'Void' ? `<button type="button" class="btn btn-outline-danger" id="bill-void">Void bill</button>` : ''}
          </div>
        </div>
      </div>`;
    el.querySelector('#bill-resume')?.addEventListener('click', () => { try { Cafe.resume(bill.id); } catch (err) { UI.toast(err.message, 'danger'); } });
    el.querySelector('#bill-print').addEventListener('click', () => {
      if (!Cafe.printBill(Store.get('Bills', bill.id))) UI.toast('Turn on a receipt in Settings', 'warning');
    });
    el.querySelector('#bill-void')?.addEventListener('click', () => this.voidBill(bill));
  },

  async voidBill(bill) {
    const data = await UI.form({
      title: 'Void ' + (bill.bill_no || 'bill'),
      okText: 'Void bill',
      fields: [{ name: 'reason', label: 'Reason', type: 'textarea', required: true, maxlength: 160 }]
    });
    if (!data) return;
    try {
      await Cafe.voidBill(bill, data.reason);
      UI.toast('Bill voided');
    } catch (err) {
      UI.toast(err.message, 'danger');
    }
  }
};
