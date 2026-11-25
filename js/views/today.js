/** One day's sales, payment split and best sellers. */
Views.today = {
  title: 'Today',
  refreshOn: ['Bills', 'BillItems', 'BillPayments', 'Expenses'],
  date: U.today(),

  render(el) { this.fill(el); },
  update(el) { this.fill(el); },

  fill(el) {
    const date = this.date || U.today();
    const fig = Cafe.dayFigures(date);
    const open = Store.list('Bills').filter(b => b.status === 'Open');
    const bills = Cafe.dayBills(date).sort((a, b) => String(b.closed_at || '').localeCompare(String(a.closed_at || '')));
    const ids = new Set(bills.map(b => b.id));
    const rank = new Map();
    Store.list('BillItems').forEach(l => {
      if (!ids.has(l.bill_id)) return;
      const row = rank.get(l.item_name) || { name: l.item_name, qty: 0, amount: 0 };
      row.qty += Number(l.qty) || 0;
      row.amount += Number(l.amount) || 0;
      rank.set(l.item_name, row);
    });
    const top = [...rank.values()].sort((a, b) => b.qty - a.qty || b.amount - a.amount).slice(0, 8);
    const avg = fig.count ? U.inr(fig.sales / fig.count) : '—';
    const card = (label, value, sub) => `
      <div class="col-6 col-md-4 col-xl-2"><div class="card h-100"><div class="card-body py-3">
        <div class="text-muted small">${label}</div><div class="fs-5 fw-bold">${value}</div>
        ${sub ? `<div class="text-muted small">${sub}</div>` : ''}
      </div></div></div>`;
    el.innerHTML = `
      <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
        <input type="date" class="form-control" style="max-width:12rem" id="today-date" value="${U.esc(date)}">
        <a class="btn btn-outline-primary btn-sm" href="#/bills">${open.length} open bill${open.length === 1 ? '' : 's'}</a>
      </div>
      <div class="row g-3 mb-3">
        ${card('Sales', U.inr(fig.sales), fig.count + ' paid')}
        ${card('Average', avg, '')}
        ${card('Cash', U.inr(fig.cash), '')}
        ${card('UPI', U.inr(fig.upi), '')}
        ${card('Card', U.inr(fig.card), '')}
        ${card('After expenses', U.inr(fig.sales - fig.expenses), U.inr(fig.expenses) + ' out')}
      </div>
      <div class="row g-3">
        <div class="col-lg-5">
          <div class="card h-100">
            <h6 class="card-header">Best sellers</h6>
            <div class="list-group list-group-flush">
              ${top.map(t => `<div class="list-group-item d-flex justify-content-between"><span>${U.esc(t.name)} <span class="text-muted">× ${Cafe.qtyLabel(t.qty)}</span></span><span class="fw-semibold">${U.inr(t.amount)}</span></div>`).join('')
                || '<div class="list-group-item text-muted">No paid bills on this date.</div>'}
            </div>
          </div>
        </div>
        <div class="col-lg-7">
          <div class="card h-100">
            <h6 class="card-header">Paid bills</h6>
            <div class="list-group list-group-flush">
              ${bills.map(b => `<a class="list-group-item list-group-item-action d-flex justify-content-between" href="#/bills/${encodeURIComponent(b.id)}">
                <span>${U.esc(b.bill_no || '')} <span class="text-muted">${U.esc(b.service || '')}${b.table_no ? ' · ' + U.esc(b.table_no) : ''}</span></span>
                <span class="fw-semibold">${U.inr(b.total)}</span>
              </a>`).join('') || '<div class="list-group-item text-muted">Nothing paid yet.</div>'}
            </div>
          </div>
        </div>
      </div>`;
    el.querySelector('#today-date').addEventListener('change', e => {
      this.date = e.target.value || U.today();
      this.fill(el);
    });
  }
};
