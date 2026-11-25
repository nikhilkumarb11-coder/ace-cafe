/** Café profile, this counter's bill prefix, install and sync. */
Views.settings = {
  title: 'Settings',

  FIELDS: [
    { key: 'company_name', label: 'Café name', required: true },
    { key: 'address', label: 'Address', type: 'textarea' },
    { key: 'phone', label: 'Phone', inputmode: 'tel' },
    { key: 'gstin', label: 'GSTIN' },
    { key: 'upi_id', label: 'UPI ID', placeholder: 'ace@upi' },
    { key: 'tax_percent', label: 'GST % included in menu prices', inputmode: 'decimal', placeholder: '5' },
    { key: 'receipt_footer', label: 'Line at the bottom of the bill', type: 'textarea' }
  ],

  render(el) {
    const s = Store.settings();
    const field = f => {
      const value = U.esc(s[f.key] != null ? s[f.key] : '');
      const attrs = `class="form-control" id="set-${f.key}" name="${f.key}" ${f.required ? 'required' : ''} ${f.inputmode ? `inputmode="${f.inputmode}"` : ''} ${f.placeholder ? `placeholder="${U.esc(f.placeholder)}"` : ''}`;
      const input = f.type === 'textarea'
        ? `<textarea ${attrs} rows="2">${value}</textarea>`
        : `<input ${attrs} value="${value}">`;
      return `<div class="col-md-6"><label class="form-label" for="set-${f.key}">${f.label}</label>${input}</div>`;
    };
    el.innerHTML = `
      <div class="row g-4">
        <div class="col-xl-7">
          <form class="card" id="company-form">
            <h5 class="card-header">Café profile</h5>
            <div class="card-body">
              <p class="text-muted small">Printed on the bill. Menu prices already include GST — set the percent to 0 if you don't charge it.</p>
              <div class="row g-3">${this.FIELDS.map(field).join('')}</div>
            </div>
            <div class="card-footer">
              <button class="btn btn-primary" type="submit"><i class="bx bx-save me-1"></i>Save profile</button>
            </div>
          </form>
          ${this.receiptCard()}
        </div>
        <div class="col-xl-5">
          <div class="card mb-4"><h5 class="card-header">Sync & data</h5><div class="card-body" id="sync-card"></div></div>
          ${this.installCard()}
          <form class="card mb-4" id="device-form">
            <h5 class="card-header">This counter</h5>
            <div class="card-body">
              <label class="form-label" for="device-code">Bill prefix</label>
              <input class="form-control text-uppercase" id="device-code" maxlength="4" value="${U.esc(Cafe.deviceCode())}" required>
              <div class="form-text mb-3">Each device gets its own numbers, such as ${U.esc(Cafe.deviceCode())}-0042, so a bill can be printed while offline.</div>
              <label class="form-label" for="device-name">Device name</label>
              <input class="form-control" id="device-name" maxlength="40" value="${U.esc(Auth.deviceName())}" placeholder="Front counter">
              <div class="form-text">Recorded as who saved a row.</div>
              <button class="btn btn-outline-primary mt-3" type="submit">Save</button>
            </div>
          </form>
          <div class="card">
            <h5 class="card-header">Account</h5>
            <div class="card-body">
              <p class="small text-muted">To change the shared password, open the Google Sheet → <b>Ace Café</b> menu → <b>Set app password</b>.</p>
              <button class="btn btn-outline-danger w-100" id="logout-btn" type="button"><i class="bx bx-log-out me-1"></i>Log out</button>
              <p class="small text-muted text-center mt-3 mb-0">Version ${U.esc(APP_CONFIG.version)}</p>
            </div>
          </div>
        </div>
      </div>`;
    this.syncCard();
    if (this.unsub) this.unsub();
    this.unsub = Sync.onStatus(() => { if (document.getElementById('sync-card')) this.syncCard(); });
    el.querySelector('#company-form').addEventListener('submit', e => this.saveProfile(e));
    el.querySelectorAll('[data-print-flag]').forEach(input => {
      input.addEventListener('change', () => this.saveReceipt(input));
    });
    el.querySelector('#device-form').addEventListener('submit', e => {
      e.preventDefault();
      try {
        Cafe.setDeviceCode(el.querySelector('#device-code').value);
        Auth.setDeviceName(el.querySelector('#device-name').value);
        UI.toast('This counter was saved');
        this.render(el);
      } catch (err) {
        UI.toast(err.message, 'danger');
      }
    });
    el.querySelector('#logout-btn').addEventListener('click', () => this.logout());
    el.querySelector('#install-btn')?.addEventListener('click', async () => {
      if (await App.install.prompt()) return;
      this.render(el);
    });
  },

  syncCard() {
    const card = document.getElementById('sync-card');
    if (!card) return;
    const url = Api.url();
    const local = localStorage.getItem('ace_local') === '1' || !url;
    const field = `
      <label class="form-label" for="sheet-url">Apps Script URL</label>
      <input class="form-control form-control-sm mb-2" id="sheet-url" value="${U.esc(url)}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" spellcheck="false">
      <p class="form-text">Deploy the Sheet as a web app and paste the address that ends with /exec.</p>
      <button class="btn btn-primary btn-sm" id="sheet-save" type="button">Save</button>`;
    if (local) {
      card.innerHTML = `${field}
        <p class="small text-muted mt-3 mb-0">Bills stay on this device until a URL is saved. Log in once after that and the waiting changes are sent to the Sheet.</p>`;
    } else {
      const s = Sync.status();
      card.innerHTML = `${field}
        <dl class="row mt-3 mb-3 small">
          <dt class="col-6 text-muted fw-normal">Status</dt><dd class="col-6 text-end mb-1">${U.esc(s.state)}</dd>
          <dt class="col-6 text-muted fw-normal">Last synced</dt><dd class="col-6 text-end mb-1">${U.timeAgo(s.lastSync)}</dd>
          <dt class="col-6 text-muted fw-normal">Waiting to save</dt><dd class="col-6 text-end mb-1">${s.pending}</dd>
        </dl>
        ${s.message ? `<div class="alert alert-warning small py-2">${U.esc(s.message)}</div>` : ''}
        <div class="d-grid gap-2">
          <button class="btn btn-outline-primary" id="sync-now" type="button"><i class="bx bx-refresh me-1"></i>Sync now</button>
          <button class="btn btn-outline-secondary" id="reload-data" type="button"><i class="bx bx-data me-1"></i>Reload all data</button>
        </div>`;
      card.querySelector('#sync-now').addEventListener('click', () => Sync.now());
      card.querySelector('#reload-data').addEventListener('click', () => this.reloadAll());
    }
    card.querySelector('#sheet-save').addEventListener('click', () => this.saveSheet());
  },

  saveSheet() {
    const input = document.getElementById('sheet-url');
    if (!input) return;
    let next = input.value.trim();
    if (next && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec\/?$/.test(next)) {
      UI.toast('Paste the web app URL. It starts with https://script.google.com and ends with /exec.', 'danger');
      return;
    }
    next = next.replace(/\/$/, '');
    const prev = Api.url();
    if (next === prev) { UI.toast('That URL is already saved', 'info'); return; }
    Api.setUrl(next);
    Sync.stop();
    if (!next) {
      localStorage.setItem('ace_token', 'local');
      localStorage.setItem('ace_token_exp', String(Date.now() + 365 * 86400000));
      localStorage.setItem('ace_local', '1');
      UI.toast('Saved on this device');
      UI.renderSyncStatus({ state: 'local', message: 'Saved on this device until a Google Sheet is connected.', pending: Store.pendingCount() });
      this.syncCard();
      return;
    }
    localStorage.removeItem('ace_token');
    localStorage.removeItem('ace_token_exp');
    localStorage.removeItem('ace_local');
    UI.toast('URL saved. Log in to send this device’s bills to the Sheet.');
    App.showLogin();
  },

  installCard() {
    const ins = App.install;
    let body;
    if (ins.isInstalled()) {
      body = '<p class="small mb-0"><i class="bx bx-check-circle text-success me-1"></i>Running as an installed app on this device.</p>';
    } else if (ins.canPrompt()) {
      body = `<p class="small text-muted">Add Ace Café to this device's home screen. It opens full screen and keeps working on a weak connection.</p>
        <button class="btn btn-primary w-100" id="install-btn" type="button"><i class="bx bx-download me-1"></i>Install app</button>`;
    } else if (ins.isIos()) {
      body = `<p class="small text-muted mb-2">On iPhone, add it from Safari:</p>
        <ol class="small text-muted mb-0 ps-3">
          <li class="mb-1">Open this site in <b>Safari</b>.</li>
          <li class="mb-1">Tap <b>Share</b>.</li>
          <li>Tap <b>Add to Home Screen</b>.</li>
        </ol>`;
    } else {
      body = '<p class="small text-muted mb-0">Open the browser menu and choose <b>Install app</b> or <b>Add to Home screen</b>.</p>';
    }
    return `<div class="card mb-4"><h5 class="card-header">Install on this device</h5><div class="card-body">${body}</div></div>`;
  },

  receiptCard() {
    const prefs = Cafe.receiptPrefs();
    const row = (key, on, label, help) => `
      <div class="form-check mb-3">
        <input class="form-check-input" type="checkbox" id="print-${key}" data-print-flag="${key}" ${on ? 'checked' : ''}>
        <label class="form-check-label" for="print-${key}">${label}</label>
        <div class="form-text">${help}</div>
      </div>`;
    return `
      <form class="card mt-4" id="print-form">
        <h5 class="card-header">Receipts</h5>
        <div class="card-body pb-0">
          <p class="text-muted small">Sent to the counter's receipt printer. With both on, the customer bill prints first and the counter slip follows on the next page.</p>
          ${row('print_customer', prefs.customer, 'Customer bill', 'Café name, items with rates, GST, total and payment.')}
          ${row('print_counter', prefs.counter, 'Counter slip', 'Bill number, table and quantities only. No prices.')}
        </div>
      </form>`;
  },

  async saveReceipt(input) {
    const key = input.dataset.printFlag;
    const value = input.checked ? 'TRUE' : 'FALSE';
    try {
      await Store.save('Settings', { id: key, key, value });
      UI.toast(input.checked ? 'Receipt on' : 'Receipt off');
    } catch (err) {
      input.checked = !input.checked;
      UI.toast(err.message, 'danger');
    }
  },

  async saveProfile(e) {
    e.preventDefault();
    const form = e.target;
    const tax = Number(form.elements.tax_percent.value);
    if (form.elements.tax_percent.value && (!Number.isFinite(tax) || tax < 0 || tax > 100)) {
      UI.toast('GST percent should be between 0 and 100', 'danger');
      return;
    }
    const changed = this.FIELDS.filter(f => String(form.elements[f.key].value).trim() !== String(Store.settings()[f.key] || ''));
    if (!changed.length) { UI.toast('No changes to save', 'info'); return; }
    await Store.saveMany(changed.map(f => ['Settings', { id: f.key, key: f.key, value: form.elements[f.key].value.trim() }]));
    UI.toast('Profile saved');
  },

  async reloadAll() {
    if (localStorage.getItem('ace_local') === '1') {
      UI.toast('Connect a Google Sheet before reloading.', 'warning');
      return;
    }
    if (Store.hasPending()) {
      UI.toast('Some changes are still waiting to save. Sync first, then reload.', 'warning');
      return;
    }
    const ok = await UI.confirm({ title: 'Reload all data?', message: 'This re-downloads everything from the Google Sheet.', confirmText: 'Reload', danger: false });
    if (!ok) return;
    UI.showSkeleton();
    try {
      await Sync.initial();
      UI.toast('All data reloaded');
    } catch (err) {
      UI.toast(err.message, 'danger');
    }
    UI.route();
  },

  async logout() {
    const pending = Store.pendingCount();
    const ok = await UI.confirm({
      title: 'Log out?',
      message: pending
        ? `${pending} change(s) are still only on this device and will be cleared.`
        : 'This device\'s cached data will be cleared.',
      confirmText: 'Log out'
    });
    if (ok) Auth.logout();
  }
};
