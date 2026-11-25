/** Startup and switching between the login screen and the app. */
const App = (() => {
  const $ = sel => document.querySelector(sel);
  let started = false;

  function applyBranding() {
    document.querySelectorAll('[data-brand-name]').forEach(el => { el.textContent = APP_CONFIG.companyName; });
    document.querySelectorAll('[data-brand-tagline]').forEach(el => { el.textContent = APP_CONFIG.tagline; });
    document.querySelectorAll('[data-brand-logo]').forEach(el => { el.src = APP_CONFIG.logo; });
  }

  function showLogin() {
    $('#app-shell').classList.add('d-none');
    $('#login-screen').classList.remove('d-none');
    $('#login-password').value = '';
    $('#login-error').classList.add('d-none');
    const offline = !Api.url();
    $('#login-setup-hint').classList.toggle('d-none', !offline);
    $('#login-local-wrap').classList.toggle('d-none', !offline);
    $('#login-form').classList.toggle('d-none', offline);
    if (!offline) Api.warm();
    if (!offline) setTimeout(() => $('#login-password').focus(), 50);
  }

  function showApp() {
    $('#login-screen').classList.add('d-none');
    $('#app-shell').classList.remove('d-none');
    if (!started) {
      started = true;
      window.addEventListener('hashchange', UI.route);
      Store.onChange(UI.onDataChange);
      Sync.onStatus(UI.renderSyncStatus);
    }
  }

  async function openTill() {
    await Cafe.ensureSetup();
    const hash = location.hash;
    if (!hash || hash === '#/' || hash === '#/home') history.replaceState(null, '', '#/pos');
    UI.route();
    UI.updateBadges();
  }

  async function enterLocal() {
    localStorage.setItem('ace_token', 'local');
    localStorage.setItem('ace_token_exp', String(Date.now() + 365 * 86400000));
    localStorage.setItem('ace_local', '1');
    showApp();
    UI.showSkeleton();
    await Store.load();
    await openTill();
    UI.renderSyncStatus(Sync.status());
  }

  async function onLoginSubmit(e) {
    e.preventDefault();
    const btn = $('#login-btn');
    const err = $('#login-error');
    err.classList.add('d-none');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Checking…';
    const slow = setTimeout(() => {
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Waking up the server…';
    }, 4000);
    try {
      const data = await Auth.login($('#login-password').value);
      clearTimeout(slow);
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Loading your data…';
      showApp();
      UI.showSkeleton();
      await Store.load();
      await Sync.initial(data);
      await openTill();
      Sync.start();
    } catch (ex) {
      showLogin();
      err.textContent = ex.message;
      err.classList.remove('d-none');
    } finally {
      clearTimeout(slow);
      btn.disabled = false;
      btn.innerHTML = 'Log in';
    }
  }

  /** Off on localhost unless localStorage.ace_sw is set, so local edits show without a version bump. */
  function registerWorker() {
    if (!('serviceWorker' in navigator)) return;
    const local = ['localhost', '127.0.0.1'].includes(location.hostname);
    if (local && !localStorage.getItem('ace_sw')) return;
    let told = false;
    navigator.serviceWorker.addEventListener('message', e => {
      if (told || !e.data || e.data.type !== 'app-updated') return;
      told = true;
      UI.toast('A new version of the app is ready.', 'info', { label: 'Reload', onClick: () => location.reload() });
    });
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker not registered', err));
  }

  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installPrompt = e;
    if (UI.current && UI.current() === 'settings') UI.render();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    UI.toast('App installed. Open it from your home screen.');
  });

  const install = {
    isInstalled: () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
    canPrompt: () => !!installPrompt,
    isIos: () => /iPhone|iPad|iPod/i.test(navigator.userAgent),
    async prompt() {
      if (!installPrompt) return false;
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      installPrompt = null;
      return outcome === 'accepted';
    }
  };

  async function boot() {
    registerWorker();
    applyBranding();
    UI.buildNav();
    $('#login-form').addEventListener('submit', onLoginSubmit);
    $('#login-local').addEventListener('click', () => enterLocal().catch(err => {
      console.error(err);
      UI.toast(err.message, 'danger');
    }));
    $('#login-password').addEventListener('input', () => Api.warm());

    // A Sheet URL was added after this device had been used on its own.
    if (Api.url() && localStorage.getItem('ace_local') === '1') {
      localStorage.removeItem('ace_token');
      localStorage.removeItem('ace_token_exp');
      localStorage.removeItem('ace_local');
    }

    if (!Auth.isLoggedIn()) {
      showLogin();
      return;
    }
    showApp();
    await Store.load();
    const local = localStorage.getItem('ace_local') === '1';
    const empty = Store.TABLES.every(t => !Store.list(t).length);
    if (!local && empty) {
      UI.showSkeleton();
      await Sync.initial();
    }
    await openTill();
    if (local) {
      UI.renderSyncStatus({ state: 'local', message: 'Saved on this device until a Google Sheet is connected.', pending: Store.pendingCount() });
    } else {
      Sync.start();
    }
  }

  return { boot, showLogin, showApp, install };
})();

document.addEventListener('DOMContentLoaded', () => {
  App.boot().catch(err => {
    console.error(err);
    document.body.insertAdjacentHTML('afterbegin',
      `<div class="alert alert-danger m-3">The app could not start: ${U.esc(err.message)}. Try reloading the page.</div>`);
  });
});
