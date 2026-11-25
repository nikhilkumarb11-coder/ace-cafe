/** Categories and items. Hidden items stay on the sheet but leave the till. */
Views.menu = {
  title: 'Menu',
  refreshOn: ['MenuCategories', 'MenuItems'],

  render(el) { this.fill(el); },

  fill(el) {
    const cats = Store.list('MenuCategories').sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0) || String(a.name).localeCompare(String(b.name)));
    const items = Store.list('MenuItems');
    el.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-3">
        <p class="text-muted small mb-0">Prices are what the customer pays. GST is included.</p>
        <button type="button" class="btn btn-primary" id="cat-add"><i class="bx bx-plus me-1"></i>Category</button>
      </div>
      ${cats.map(c => this.section(c, items.filter(i => i.category_id === c.id))).join('') || '<div class="card"><div class="card-body text-center text-muted py-5">Add a category to start the menu.</div></div>'}
      ${items.some(i => !cats.find(c => c.id === i.category_id)) ? '<p class="text-muted small mt-3">Some items have no category. Edit them and choose one.</p>' : ''}`;
    el.querySelector('#cat-add')?.addEventListener('click', () => this.editCategory(null));
    el.querySelectorAll('[data-cat-edit]').forEach(btn => btn.addEventListener('click', () => this.editCategory(Store.get('MenuCategories', btn.dataset.catEdit))));
    el.querySelectorAll('[data-cat-hide]').forEach(btn => btn.addEventListener('click', () => this.toggleCategory(btn.dataset.catHide)));
    el.querySelectorAll('[data-cat-del]').forEach(btn => btn.addEventListener('click', () => this.deleteCategory(btn.dataset.catDel)));
    el.querySelectorAll('[data-item-add]').forEach(btn => btn.addEventListener('click', () => this.editItem(null, btn.dataset.itemAdd)));
    el.querySelectorAll('[data-item-edit]').forEach(btn => btn.addEventListener('click', () => this.editItem(Store.get('MenuItems', btn.dataset.itemEdit))));
    el.querySelectorAll('[data-item-hide]').forEach(btn => btn.addEventListener('click', () => this.toggleItem(btn.dataset.itemHide)));
  },

  section(cat, items) {
    const hidden = !Cafe.isOn(cat.active);
    const sorted = items.slice().sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0) || String(a.name).localeCompare(String(b.name)));
    return `<div class="card mb-3 ${hidden ? 'opacity-50' : ''}">
      <div class="card-header d-flex flex-wrap gap-2 justify-content-between align-items-center">
        <h5 class="mb-0">${U.esc(cat.name)}${hidden ? ' <span class="badge bg-label-secondary">Hidden</span>' : ''}</h5>
        <div class="d-flex gap-2">
          <button type="button" class="btn btn-sm btn-outline-secondary" data-cat-hide="${U.esc(cat.id)}">${hidden ? 'Show' : 'Hide'}</button>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-cat-edit="${U.esc(cat.id)}">Rename</button>
          <button type="button" class="btn btn-sm btn-outline-danger" data-cat-del="${U.esc(cat.id)}">Delete</button>
          <button type="button" class="btn btn-sm btn-primary" data-item-add="${U.esc(cat.id)}">Add item</button>
        </div>
      </div>
      <div class="list-group list-group-flush">
        ${sorted.map(i => `<div class="list-group-item d-flex justify-content-between align-items-center gap-3 ${Cafe.isOn(i.available) ? '' : 'text-muted'}">
          <span class="fw-semibold">${U.esc(i.name)}${Cafe.isOn(i.available) ? '' : ' · unavailable'}</span>
          <span class="d-flex align-items-center gap-2">
            <span class="fw-semibold">${U.inr(i.price)}</span>
            <button type="button" class="btn btn-sm btn-outline-secondary" data-item-hide="${U.esc(i.id)}">${Cafe.isOn(i.available) ? 'Hide' : 'Show'}</button>
            <button type="button" class="btn btn-sm btn-outline-primary" data-item-edit="${U.esc(i.id)}">Edit</button>
          </span>
        </div>`).join('') || '<div class="list-group-item text-muted">No items in this category.</div>'}
      </div>
    </div>`;
  },

  async editCategory(cat) {
    const data = await UI.form({
      title: cat ? 'Rename category' : 'New category',
      fields: [{ name: 'name', label: 'Name', required: true, maxlength: 40, value: cat ? cat.name : '' }]
    });
    if (!data) return;
    const sort = cat ? cat.sort : Store.list('MenuCategories').reduce((m, c) => Math.max(m, Number(c.sort) || 0), 0) + 1;
    await Store.save('MenuCategories', { id: cat ? cat.id : undefined, name: data.name.trim(), sort, active: cat ? cat.active : true });
  },

  async toggleCategory(id) {
    const cat = Store.get('MenuCategories', id);
    if (!cat) return;
    await Store.save('MenuCategories', { id, active: !Cafe.isOn(cat.active) });
  },

  async deleteCategory(id) {
    const cat = Store.get('MenuCategories', id);
    if (!cat) return;
    const items = Store.list('MenuItems').filter(i => i.category_id === id);
    const ok = await UI.confirm({
      title: 'Delete ' + cat.name + '?',
      message: items.length ? `This also removes ${items.length} item${items.length === 1 ? '' : 's'} from the till.` : 'The category will leave the menu.',
      confirmText: 'Delete'
    });
    if (!ok) return;
    const ops = items.map(i => ['MenuItems', { id: i.id, is_deleted: true }]);
    ops.push(['MenuCategories', { id, is_deleted: true }]);
    await Store.saveMany(ops);
  },

  async editItem(item, categoryId) {
    const cats = Store.list('MenuCategories');
    if (!cats.length) { UI.toast('Add a category first', 'warning'); return; }
    const data = await UI.form({
      title: item ? 'Edit item' : 'New item',
      fields: [
        { name: 'name', label: 'Name', required: true, maxlength: 60, value: item ? item.name : '' },
        { name: 'price', label: 'Price (₹, including GST)', type: 'number', inputmode: 'decimal', step: '0.01', required: true, value: item ? item.price : '' },
        { name: 'category_id', label: 'Category', type: 'select', required: true, value: item ? item.category_id : categoryId, options: cats.map(c => ({ value: c.id, label: c.name })) }
      ]
    });
    if (!data) return;
    const price = U.round2(data.price);
    if (price < 0) { UI.toast("Price can't be negative", 'danger'); return; }
    const sort = item ? item.sort : Store.list('MenuItems').filter(i => i.category_id === data.category_id).reduce((m, i) => Math.max(m, Number(i.sort) || 0), 0) + 1;
    await Store.save('MenuItems', {
      id: item ? item.id : undefined,
      name: data.name.trim(),
      price,
      category_id: data.category_id,
      sort,
      available: item ? item.available : true
    });
  },

  async toggleItem(id) {
    const item = Store.get('MenuItems', id);
    if (!item) return;
    await Store.save('MenuItems', { id, available: !Cafe.isOn(item.available) });
  }
};
