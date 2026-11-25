/** Money going out: milk, rent, wages and the rest. */
Views.expenses = {
  title: 'Expenses',
  refreshOn(params) { return params.length ? null : ['Expenses']; },
  month: U.today().slice(0, 7),

  render(el, params) {
    if (!params.length) this.list(el);
    else this.form(el, params[0] === 'new' ? null : params[0]);
  },

  list(el) {
    const all = Store.list('Expenses');
    const rows = all.filter(e => !this.month || String(e.date).startsWith(this.month))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
    const total = U.round2(rows.reduce((s, e) => s + (Number(e.amount) || 0), 0));
    el.innerHTML = `
      <div class="d-flex flex-wrap gap-2 justify-content-between align-items-end mb-3">
        <div>
          <label class="form-label small mb-1" for="exp-month">Month</label>
          <input type="month" class="form-control" id="exp-month" value="${U.esc(this.month)}">
        </div>
        <div class="text-end">
          <div class="text-muted small">Shown</div>
          <div class="fs-4 fw-bold">${U.inr(total)}</div>
        </div>
        <a class="btn btn-primary" href="#/expenses/new"><i class="bx bx-plus me-1"></i>Add expense</a>
      </div>
      ${rows.length ? `<div class="card"><div class="list-group list-group-flush">${rows.map(e => `
        <a class="list-group-item list-group-item-action d-flex justify-content-between gap-3" href="#/expenses/${encodeURIComponent(e.id)}">
          <span><span class="fw-semibold d-block">${U.esc(e.category)}</span>
            <span class="text-muted small">${U.fmtDate(e.date)}${e.vendor_name ? ' · ' + U.esc(e.vendor_name) : ''}${e.description ? ' · ' + U.esc(e.description) : ''}</span></span>
          <span class="fw-semibold">${U.inr(e.amount)}</span>
        </a>`).join('')}</div></div>`
        : `<div class="card"><div class="card-body text-center text-muted py-5">${all.length ? 'Nothing in this month.' : 'No expenses yet.'}</div></div>`}`;
    el.querySelector('#exp-month').addEventListener('change', e => {
      this.month = e.target.value;
      this.list(el);
    });
  },

  form(el, id) {
    const row = id ? Store.get('Expenses', id) : null;
    if (id && !row) {
      el.innerHTML = `<div class="card"><div class="card-body">That expense is not on this device. <a href="#/expenses">Back</a></div></div>`;
      return;
    }
    const title = document.getElementById('page-title');
    if (title) title.textContent = row ? 'Edit expense' : 'New expense';
    const v = row || { date: U.today(), category: 'Purchase', amount: '', vendor_name: '', description: '' };
    el.innerHTML = `
      <div class="mb-3"><a href="#/expenses" class="text-muted small"><i class="bx bx-chevron-left"></i> Expenses</a></div>
      <form class="card" id="exp-form" novalidate>
        <div class="card-body">
          <div class="row g-3">
            <div class="col-md-4"><label class="form-label" for="exp-date">Date</label>
              <input type="date" class="form-control" id="exp-date" required value="${U.esc(v.date || '')}"></div>
            <div class="col-md-4"><label class="form-label" for="exp-cat">Category</label>
              <select class="form-select" id="exp-cat">${Cafe.EXPENSE_CATEGORIES.map(c => `<option ${c === v.category ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
            <div class="col-md-4"><label class="form-label" for="exp-amt">Amount</label>
              <input class="form-control" id="exp-amt" inputmode="decimal" required value="${U.esc(v.amount || '')}"></div>
            <div class="col-md-6" id="exp-vendor-wrap"><label class="form-label" for="exp-vendor">Vendor</label>
              <input class="form-control" id="exp-vendor" maxlength="80" value="${U.esc(v.vendor_name || '')}"></div>
            <div class="col-12"><label class="form-label" for="exp-desc">Note</label>
              <input class="form-control" id="exp-desc" maxlength="160" value="${U.esc(v.description || '')}"></div>
          </div>
        </div>
        <div class="card-footer d-flex gap-2">
          <button class="btn btn-primary" type="submit">Save</button>
          ${row ? '<button class="btn btn-outline-danger ms-auto" type="button" id="exp-del">Delete</button>' : ''}
        </div>
      </form>`;
    const vendorWrap = el.querySelector('#exp-vendor-wrap');
    const cat = el.querySelector('#exp-cat');
    const syncVendor = () => vendorWrap.classList.toggle('d-none', cat.value !== 'Purchase');
    syncVendor();
    cat.addEventListener('change', syncVendor);
    el.querySelector('#exp-form').addEventListener('submit', async e => {
      e.preventDefault();
      const amount = U.round2(el.querySelector('#exp-amt').value);
      if (!(amount > 0)) { UI.toast('Amount must be more than 0', 'danger'); return; }
      const category = cat.value;
      const vendor = category === 'Purchase' ? el.querySelector('#exp-vendor').value.trim() : '';
      if (category === 'Purchase' && !vendor) { UI.toast('Vendor name is required for a purchase', 'danger'); return; }
      await Store.save('Expenses', {
        id: row ? row.id : undefined,
        date: el.querySelector('#exp-date').value,
        category,
        amount,
        vendor_name: vendor,
        description: el.querySelector('#exp-desc').value.trim()
      });
      UI.toast('Expense saved');
      location.hash = '#/expenses';
    });
    el.querySelector('#exp-del')?.addEventListener('click', async () => {
      const ok = await UI.confirm({ title: 'Delete this expense?', message: 'It will leave the books.', confirmText: 'Delete' });
      if (!ok) return;
      await Store.remove('Expenses', row.id);
      location.hash = '#/expenses';
    });
  }
};
