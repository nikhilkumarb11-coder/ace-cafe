/** App shell: navigation, routing, toasts, dialogs, sync indicator. */

const NAV = [
  { id: 'pos', label: 'POS', icon: 'bx-coffee' },
  { header: 'Counter' },
  { id: 'bills', label: 'Bills', icon: 'bx-receipt' },
  { id: 'menu', label: 'Menu', icon: 'bx-book-open' },
  { header: 'Books' },
  { id: 'today', label: 'Today', icon: 'bx-bar-chart-alt-2' },
  { id: 'expenses', label: 'Expenses', icon: 'bx-money-withdraw' },
  { id: 'dayclose', label: 'Day close', icon: 'bx-calendar-check' },
  { header: 'System' },
  { id: 'settings', label: 'Settings', icon: 'bx-cog' }
];

const NAV_GROUP = (() => {
  const out = {};
  let group = '';
  NAV.forEach(i => { if (i.header) group = i.header; else if (group) out[i.id] = group; });
  return out;
})();

const BOTTOM_NAV = [
  { id: 'pos', label: 'POS', icon: 'bx-coffee' },
  { id: 'bills', label: 'Bills', icon: 'bx-receipt' },
  { id: 'menu', label: 'Menu', icon: 'bx-book-open' },
  { id: 'today', label: 'Today', icon: 'bx-bar-chart-alt-2' },
  { id: 'more', label: 'More', icon: 'bx-grid-alt', action: 'more', rest: true }
];

const Views = {};

const UI = (() => {
  let current = null;
  const $ = sel => document.querySelector(sel);

  function buildNav() {
    $('#menu-items').innerHTML = NAV.map(item => item.header
      ? `<li class="menu-header small text-uppercase"><span class="menu-header-text">${item.header}</span></li>`
      : `<li class="menu-item" data-nav="${item.id}">
           <a href="#/${item.id}" class="menu-link">
             <i class="menu-icon tf-icons bx ${item.icon}"></i>
             <div>${item.label}</div>
             <span class="badge rounded-pill bg-danger ms-auto d-none" data-badge="${item.id}"></span>
           </a>
         </li>`).join('');

    $('#bottom-nav').innerHTML = BOTTOM_NAV.map(item => `
      <a href="${item.action ? 'javascript:void(0)' : '#/' + item.id}" class="bottom-nav-item" data-bottom="${item.id}" ${item.action ? `data-action="${item.action}"` : ''}>
        <span class="bottom-nav-icon"><i class="bx ${item.icon}"></i>
          <span class="badge rounded-pill bg-danger bottom-nav-badge d-none" data-badge="${item.id}"></span></span>
        <span>${item.label}</span>
      </a>`).join('');

    $('#more-items').innerHTML = NAV.filter(i => !i.header).map(item => `
      <a href="#/${item.id}" class="more-tile"><i class="bx ${item.icon}"></i><span>${item.label}</span></a>`).join('');

    document.querySelector('[data-action="more"]').addEventListener('click', () => {
      bootstrap.Offcanvas.getOrCreateInstance($('#more-sheet')).show();
    });
    $('#more-sheet').addEventListener('click', e => {
      if (e.target.closest('a[href^="#/"]')) bootstrap.Offcanvas.getOrCreateInstance($('#more-sheet')).hide();
    });
    document.querySelectorAll('.layout-menu-toggle').forEach(btn => btn.addEventListener('click', e => {
      e.preventDefault();
      document.documentElement.classList.toggle('layout-menu-expanded');
    }));
    $('#sync-status').addEventListener('click', () => {
      if (localStorage.getItem('ace_local') === '1') {
        toast('This device is not connected to a Google Sheet yet. Paste the Apps Script URL in Settings.', 'info');
        return;
      }
      Sync.now();
    });
    document.addEventListener('click', e => {
      const row = e.target.closest('[data-href]');
      if (!row || e.target.closest('a, button, input, select, textarea')) return;
      location.hash = row.dataset.href;
    });
    Search.init();
  }

  function parseHash() {
    const parts = (location.hash || '#/pos').replace(/^#\/?/, '').split('/').filter(Boolean);
    return { name: parts[0] || 'pos', params: parts.slice(1).map(decodeURIComponent) };
  }

  function route() {
    const { name, params } = parseHash();
    const view = Views[name] || Views.notfound;
    current = { name, params, view };
    document.documentElement.classList.remove('layout-menu-expanded');
    document.querySelectorAll('[data-nav]').forEach(li => li.classList.toggle('active', li.dataset.nav === name));
    const named = BOTTOM_NAV.filter(b => !b.action).map(b => b.id);
    document.querySelectorAll('[data-bottom]').forEach(a => {
      const def = BOTTOM_NAV.find(b => b.id === a.dataset.bottom);
      a.classList.toggle('active', def.rest ? !named.includes(name) : def.id === name);
    });
    $('#page-title').textContent = view.title || '';
    $('#page-sub').textContent = name === 'pos' ? U.fmtDate(U.today()) : (NAV_GROUP[name] || '');
    document.body.dataset.page = name;
    document.title = `${view.title ? view.title + ' · ' : ''}${APP_CONFIG.companyName}`;
    render();
    const el = $('#page-content');
    el.classList.remove('page-enter');
    void el.offsetWidth;
    el.classList.add('page-enter');
    window.scrollTo(0, 0);
  }

  function render() {
    if (!current) return;
    const el = $('#page-content');
    try {
      current.view.render(el, current.params);
    } catch (e) {
      console.error(e);
      el.innerHTML = `<div class="alert alert-danger">Something went wrong showing this screen: ${U.esc(e.message)}</div>`;
    }
  }

  function onDataChange(tables) {
    updateBadges();
    renderSyncStatus(Sync.status());
    if (!current) return;
    const { view, params } = current;
    const watch = typeof view.refreshOn === 'function' ? view.refreshOn(params) : view.refreshOn;
    if (!watch || !watch.some(t => tables.has(t))) return;
    if (view.update) {
      try { view.update($('#page-content'), params); } catch (e) { console.error(e); }
    } else {
      render();
    }
  }

  function updateBadges() {
    const open = Store.list('Bills').filter(b => b.status === 'Open').length;
    document.querySelectorAll('[data-badge="bills"]').forEach(b => {
      b.textContent = open;
      b.classList.toggle('d-none', !open);
    });
  }

  function renderSyncStatus(s) {
    const btn = $('#sync-status');
    if (!btn) return;
    const pending = s.pending || 0;
    const states = {
      idle:    ['bx-cloud', 'text-muted', 'Ready'],
      syncing: ['bx-refresh bx-spin', 'text-muted', 'Syncing…'],
      saving:  ['bx-loader-alt bx-spin', 'text-primary', `Saving… (${pending})`],
      synced:  [pending ? 'bx-loader-alt bx-spin' : 'bx-check-circle', pending ? 'text-primary' : 'text-success', pending ? `Saving… (${pending})` : 'Saved'],
      offline: ['bx-wifi-off', 'text-warning', pending ? `Offline · ${pending} pending` : 'Offline'],
      local:   ['bx-mobile', 'text-muted', 'On this device'],
      error:   ['bx-error-circle', 'text-danger', pending ? `Sync error · ${pending} pending` : 'Sync error']
    };
    const [icon, color, label] = states[s.state] || states.idle;
    btn.className = `btn btn-sm sync-pill ${color}`;
    btn.title = s.message || (s.lastSync ? `Last synced ${U.timeAgo(s.lastSync)} — tap to sync now` : 'Tap to sync now');
    btn.innerHTML = `<i class="bx ${icon}"></i><span class="sync-label">${label}</span>`;
  }

  function toast(message, type = 'success', action = null) {
    const icons = { success: 'bx-check-circle', danger: 'bx-error-circle', warning: 'bx-error', info: 'bx-info-circle' };
    const el = U.el(`
      <div class="toast align-items-center text-white bg-${type} border-0" role="alert">
        <div class="d-flex">
          <div class="toast-body d-flex gap-2 align-items-start"><i class="bx ${icons[type] || icons.info} fs-5"></i><span>${U.esc(message)}</span></div>
          ${action ? `<button type="button" class="btn btn-sm btn-light my-auto" data-action>${U.esc(action.label)}</button>` : ''}
          <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
      </div>`);
    if (action) el.querySelector('[data-action]').addEventListener('click', action.onClick);
    $('#toast-area').appendChild(el);
    const t = new bootstrap.Toast(el, { autohide: !action, delay: type === 'danger' || type === 'warning' ? 7000 : 3500 });
    el.addEventListener('hidden.bs.toast', () => el.remove());
    t.show();
  }

  function confirm({ title = 'Are you sure?', message = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = true } = {}) {
    return new Promise(resolve => {
      const el = U.el(`
        <div class="modal fade" tabindex="-1">
          <div class="modal-dialog modal-dialog-centered modal-sm">
            <div class="modal-content">
              <div class="modal-header"><h5 class="modal-title">${U.esc(title)}</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
              <div class="modal-body">${U.esc(message)}</div>
              <div class="modal-footer">
                <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">${U.esc(cancelText)}</button>
                <button type="button" class="btn btn-${danger ? 'danger' : 'primary'}" data-ok>${U.esc(confirmText)}</button>
              </div>
            </div>
          </div>
        </div>`);
      document.body.appendChild(el);
      const modal = new bootstrap.Modal(el);
      let ok = false;
      el.querySelector('[data-ok]').addEventListener('click', () => { ok = true; modal.hide(); });
      el.addEventListener('hidden.bs.modal', () => { el.remove(); resolve(ok); });
      modal.show();
    });
  }

  /**
   * Small centred form. Resolves to { name: value } or null if dismissed.
   * fields: { name, label, type, value, required, inputmode, maxlength, options: [{value, label}] }
   */
  function form({ title = 'Edit', fields = [], okText = 'Save' } = {}) {
    return new Promise(resolve => {
      const inputs = fields.map(f => {
        if (f.type === 'select') {
          return `<label class="form-label" for="f-${f.name}">${U.esc(f.label)}</label>
            <select class="form-select mb-3" name="${f.name}" id="f-${f.name}" ${f.required ? 'required' : ''}>
              ${(f.options || []).map(o => `<option value="${U.esc(o.value)}" ${String(o.value) === String(f.value == null ? '' : f.value) ? 'selected' : ''}>${U.esc(o.label)}</option>`).join('')}
            </select>`;
        }
        if (f.type === 'textarea') {
          return `<label class="form-label" for="f-${f.name}">${U.esc(f.label)}</label>
            <textarea class="form-control mb-3" name="${f.name}" id="f-${f.name}" rows="${f.rows || 3}" ${f.required ? 'required' : ''} ${f.maxlength ? `maxlength="${f.maxlength}"` : ''}>${U.esc(f.value || '')}</textarea>`;
        }
        return `<label class="form-label" for="f-${f.name}">${U.esc(f.label)}</label>
          <input class="form-control mb-3" name="${f.name}" id="f-${f.name}" type="${f.type || 'text'}"
            ${f.inputmode ? `inputmode="${f.inputmode}"` : ''} ${f.required ? 'required' : ''}
            ${f.maxlength ? `maxlength="${f.maxlength}"` : ''} ${f.step ? `step="${f.step}"` : ''}
            value="${U.esc(f.value == null ? '' : f.value)}">`;
      }).join('');
      const el = U.el(`
        <div class="modal fade" tabindex="-1">
          <div class="modal-dialog modal-dialog-centered">
            <form class="modal-content" novalidate>
              <div class="modal-header"><h5 class="modal-title">${U.esc(title)}</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
              <div class="modal-body">${inputs}</div>
              <div class="modal-footer">
                <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
                <button type="submit" class="btn btn-primary">${U.esc(okText)}</button>
              </div>
            </form>
          </div>
        </div>`);
      document.body.appendChild(el);
      const modal = new bootstrap.Modal(el);
      let done = false;
      const finish = value => { if (done) return; done = true; resolve(value); };
      el.querySelector('form').addEventListener('submit', e => {
        e.preventDefault();
        const formEl = e.target;
        if (!formEl.checkValidity()) { formEl.classList.add('was-validated'); return; }
        const data = {};
        fields.forEach(f => { data[f.name] = formEl.elements[f.name].value; });
        finish(data);
        modal.hide();
      });
      el.addEventListener('hidden.bs.modal', () => { el.remove(); finish(null); });
      el.addEventListener('shown.bs.modal', () => {
        const first = el.querySelector('input, textarea, select');
        if (first) first.focus();
      });
      modal.show();
    });
  }

  function skeleton(cards = 4) {
    return `<div class="row g-3">${Array.from({ length: cards }, () => `
      <div class="col-6 col-lg-3"><div class="card"><div class="card-body">
        <div class="skeleton skeleton-line w-50"></div>
        <div class="skeleton skeleton-line skeleton-lg w-75 mt-2"></div>
      </div></div></div>`).join('')}</div>`;
  }

  return {
    buildNav, route, render, onDataChange, renderSyncStatus, updateBadges, toast, confirm, form, skeleton,
    current: () => current && current.name,
    showSkeleton: () => { $('#page-content').innerHTML = skeleton(); }
  };
})();

const Search = (() => {
  function rows(q) {
    q = q.trim().toLowerCase();
    if (!q) return '';
    const bills = Store.list('Bills').filter(b =>
      String(b.bill_no || '').toLowerCase().includes(q)
      || String(b.customer_name || '').toLowerCase().includes(q)
      || String(b.table_no || '').toLowerCase().includes(q))
      .sort((a, b) => String(b.opened_at || '').localeCompare(String(a.opened_at || '')))
      .slice(0, 8)
      .map(b => ({
        href: `#/bills/${encodeURIComponent(b.id)}`,
        title: `${b.bill_no || 'Bill'} · ${b.customer_name || b.service || ''}`,
        sub: `${U.fmtDate(b.bill_date)} · ${U.inr(b.total)} · ${b.status || ''}`
      }));
    const items = Store.list('MenuItems').filter(i => String(i.name || '').toLowerCase().includes(q)).slice(0, 8)
      .map(i => ({ href: '#/menu', title: i.name, sub: U.inr(i.price) }));
    const all = [...bills, ...items];
    if (!all.length) return '<div class="p-4 text-muted text-center">Nothing matches.</div>';
    return all.map(r => `
      <a class="search-hit" href="${r.href}">
        <span class="fw-semibold">${U.esc(r.title)}</span>
        <span class="text-muted small">${U.esc(r.sub)}</span>
      </a>`).join('');
  }

  function init() {
    const modalEl = document.getElementById('search-modal');
    if (!modalEl) return;
    const modal = new bootstrap.Modal(modalEl);
    const input = document.getElementById('search-input');
    const box = document.getElementById('search-results');
    document.querySelectorAll('[data-search-open]').forEach(b => b.addEventListener('click', () => {
      modal.show();
      setTimeout(() => input.focus(), 180);
    }));
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        modal.show();
        setTimeout(() => input.focus(), 180);
      }
    });
    input.addEventListener('input', () => { box.innerHTML = rows(input.value); });
    modalEl.addEventListener('click', e => { if (e.target.closest('a')) modal.hide(); });
    modalEl.addEventListener('shown.bs.modal', () => { box.innerHTML = rows(input.value); input.focus(); });
  }

  return { init };
})();

Views.notfound = {
  title: 'Not found',
  render(el) {
    el.innerHTML = `<div class="card"><div class="card-body text-center py-5">
      <p class="mb-3">That screen is not in the app.</p>
      <a class="btn btn-primary" href="#/pos">Back to the till</a>
    </div></div>`;
  }
};
