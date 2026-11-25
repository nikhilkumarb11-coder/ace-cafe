/**
 * Count the drawer once for a date. Sales figures are taken from paid bills
 * at the moment you save, so the sheet keeps that snapshot.
 */
Views.dayclose = {
  title: 'Day close',
  refreshOn: ['Bills', 'BillPayments', 'Expenses', 'DayCloses'],

  render(el) { this.fill(el, U.today()); },

  fill(el, date) {
    const live = Cafe.dayFigures(date);
    const saved = Store.list('DayCloses').find(d => d.close_date === date) || null;
    const opening = saved ? saved.opening_cash : '';
    const counted = saved ? saved.counted_cash : '';
    const notes = saved ? saved.notes || '' : '';
    el.innerHTML = `
      <div class="row g-4">
        <div class="col-lg-5">
          <div class="card">
            <h5 class="card-header">${U.fmtDate(date)}</h5>
            <div class="card-body">
              <label class="form-label" for="dc-date">Date</label>
              <input type="date" class="form-control mb-3" id="dc-date" value="${U.esc(date)}">
              <dl class="row mb-0">
                <dt class="col-7 text-muted fw-normal">Paid bills</dt><dd class="col-5 text-end">${live.count}</dd>
                <dt class="col-7 text-muted fw-normal">Sales</dt><dd class="col-5 text-end">${U.inr(live.sales)}</dd>
                <dt class="col-7 text-muted fw-normal">Cash sales</dt><dd class="col-5 text-end">${U.inr(live.cash)}</dd>
                <dt class="col-7 text-muted fw-normal">UPI</dt><dd class="col-5 text-end">${U.inr(live.upi)}</dd>
                <dt class="col-7 text-muted fw-normal">Card</dt><dd class="col-5 text-end">${U.inr(live.card)}</dd>
                <dt class="col-7 text-muted fw-normal">Expenses</dt><dd class="col-5 text-end">${U.inr(live.expenses)}</dd>
              </dl>
            </div>
          </div>
        </div>
        <div class="col-lg-7">
          <form class="card" id="dc-form">
            <h5 class="card-header">Drawer</h5>
            <div class="card-body">
              <div class="row g-3">
                <div class="col-md-6"><label class="form-label" for="dc-open">Opening cash</label>
                  <input class="form-control" id="dc-open" inputmode="decimal" required value="${U.esc(opening)}"></div>
                <div class="col-md-6"><label class="form-label" for="dc-count">Counted cash</label>
                  <input class="form-control" id="dc-count" inputmode="decimal" required value="${U.esc(counted)}"></div>
                <div class="col-12"><label class="form-label" for="dc-notes">Notes</label>
                  <textarea class="form-control" id="dc-notes" rows="2" maxlength="240">${U.esc(notes)}</textarea></div>
              </div>
              <div class="mt-3" id="dc-math"></div>
            </div>
            <div class="card-footer">
              <button class="btn btn-primary" type="submit">${saved ? 'Update day close' : 'Save day close'}</button>
            </div>
          </form>
        </div>
      </div>`;
    const math = () => {
      const open = U.round2(el.querySelector('#dc-open').value);
      const count = U.round2(el.querySelector('#dc-count').value);
      const expected = U.round2(open + live.cash - live.expenses);
      const diff = U.round2(count - expected);
      el.querySelector('#dc-math').innerHTML = `
        <div class="d-flex justify-content-between"><span>Expected cash</span><strong>${U.inr(expected)}</strong></div>
        <div class="d-flex justify-content-between"><span>Difference</span><strong class="${diff < 0 ? 'text-danger' : ''}">${U.inr(diff)}</strong></div>
        <p class="text-muted small mb-0 mt-2">Opening cash + cash sales − expenses.</p>`;
    };
    math();
    el.querySelector('#dc-open').addEventListener('input', math);
    el.querySelector('#dc-count').addEventListener('input', math);
    el.querySelector('#dc-date').addEventListener('change', e => this.fill(el, e.target.value || U.today()));
    el.querySelector('#dc-form').addEventListener('submit', async e => {
      e.preventDefault();
      const open = U.round2(el.querySelector('#dc-open').value);
      const count = U.round2(el.querySelector('#dc-count').value);
      if (open < 0 || count < 0) { UI.toast("Cash counts can't be negative", 'danger'); return; }
      const now = Cafe.dayFigures(date);
      const expected = U.round2(open + now.cash - now.expenses);
      await Store.save('DayCloses', {
        id: 'day-' + date,
        close_date: date,
        opening_cash: open,
        counted_cash: count,
        sales_total: now.sales,
        bill_count: now.count,
        cash_sales: now.cash,
        upi_sales: now.upi,
        card_sales: now.card,
        expenses_total: now.expenses,
        expected_cash: expected,
        difference: U.round2(count - expected),
        notes: el.querySelector('#dc-notes').value.trim()
      });
      UI.toast('Day close saved');
      this.fill(el, date);
    });
  }
};
