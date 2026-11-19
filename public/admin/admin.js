'use strict';
// Panel de administración: prendas, categorías, pedidos y configuración de la tienda.
// Depende de dom.js (h, $, api, fmtMoney, applyAccent, norm).

const A = { settings: {}, categories: [], seasons: [], products: [], orders: [], accounts: [], tab: 'resumen', q: '', orderFilter: '', accQ: '' };
const root = $('#root');
// Menú lateral, agrupado como en un CRM. Cada sección es una vista (función) más abajo o en crm.js / reports.js.
const NAV = [
  ['Ventas', [['resumen', 'Resumen'], ['clientes', 'Clientes'], ['pedidos', 'Pedidos'], ['campanas', 'Campañas']]],
  ['Catálogo', [['prendas', 'Prendas'], ['categorias', 'Categorías'], ['temporadas', 'Temporadas']]],
  ['Compras', [['inventario', 'Inventario y ventas'], ['cuentas', 'Compras Shein']]],
  ['Ajustes', [['tienda', 'Mi tienda']]],
];
const TABS = NAV.flatMap(([, items]) => items);
const STATUS = { nuevo: 'Nuevo', confirmado: 'Confirmado', enviado: 'Enviado', entregado: 'Entregado', cancelado: 'Cancelado' };
const money = (n) => fmtMoney(n, A.settings.currency || 'S/');

// ------------------------------------------------------------------ utilidades

let toastTimer;
function toast(text) {
  let t = $('#toast');
  if (!t) { t = h('div', { id: 'toast', class: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// Igual que api(), pero si la sesión venció vuelve a la pantalla de entrada.
async function call(path, opts) {
  try { return await api(path, opts); }
  catch (e) { if (e.status === 401) showLogin('Tu sesión terminó. Entra otra vez para continuar.'); throw e; }
}

// Botón de dos pasos: el primer clic pide confirmar, el segundo ejecuta.
function confirmButton({ label, confirmLabel, onConfirm, cls = 'btn btn-danger btn-small' }) {
  let timer;
  const b = h('button', {
    class: cls, type: 'button',
    onclick: () => {
      if (b.dataset.armed) { clearTimeout(timer); onConfirm(); return; }
      b.dataset.armed = '1'; b.textContent = confirmLabel;
      timer = setTimeout(() => { delete b.dataset.armed; b.textContent = label; }, 4000);
    },
  }, label);
  return b;
}

// Reduce la foto antes de subirla: una foto de celular pesa 5 MB o más, y en la tienda no hace falta.
async function prepareImage(file, { max = 1600, logo = false } = {}) {
  if (logo && file.size < 2 * 1024 * 1024 && /^image\/(png|jpeg|webp)$/.test(file.type)) return file;
  if (!logo && file.size < 350 * 1024 && /^image\/(png|jpeg|webp)$/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const type = logo && file.type !== 'image/jpeg' ? 'image/png' : 'image/jpeg';
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), type, 0.86));
  } catch { return file; }
}

async function uploadImage(file, opts) {
  const blob = await prepareImage(file, opts);
  const r = await call('/api/admin/upload', { method: 'POST', raw: blob, headers: { 'Content-Type': blob.type || file.type } });
  return r.url;
}

const when = (s) => new Date(`${s.replace(' ', 'T')}Z`).toLocaleString('es-PE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// ------------------------------------------------------------------ entrar y arrancar

function showLogin(message) {
  document.title = 'Entrar · Panel';
  const err = h('p', { class: 'form-msg', role: 'alert' }, message || '');
  const form = h('form', {
    class: 'login',
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      const field = e.target.elements.password;
      try {
        await api('/api/admin/login', { method: 'POST', body: { password: field.value } });
        await start();
      } catch (ex) { err.textContent = ex.message; field.select(); }
    },
  },
  h('h1', { class: 'display' }, 'Panel de la tienda'),
  h('p', { class: 'muted' }, 'Ingresa tu contraseña para administrar las prendas.'),
  h('label', { class: 'field' }, h('span', { class: 'label' }, 'Contraseña'),
    h('input', { class: 'input', type: 'password', name: 'password', autocomplete: 'current-password', required: true })),
  err,
  h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Entrar'));
  root.replaceChildren(h('main', { class: 'login-wrap' }, form));
  form.elements.password.focus();
}

async function start() {
  const [settings, categories, seasons, products, orders, accounts] = await Promise.all([
    call('/api/admin/settings'), call('/api/admin/categories'), call('/api/admin/seasons'), call('/api/admin/products'),
    call('/api/admin/orders'), call('/api/admin/accounts'),
  ]);
  Object.assign(A, { settings, categories, seasons, products, orders, accounts });
  applyAccent(settings.accent);
  shell();
  route();
}

function shell() {
  const logout = async () => { await api('/api/admin/logout', { method: 'POST' }).catch(() => {}); showLogin(); };
  root.replaceChildren(
    h('header', { class: 'admin-bar' }, h('div', { class: 'wrap' },
      h('span', { class: 'name' }, A.settings.store_name),
      h('span', { class: 'tag-panel' }, 'Panel'),
      h('span', { class: 'grow' }),
      h('a', { href: '/', target: '_blank', rel: 'noopener' }, 'Ver mi tienda'),
      h('button', { class: 'plain', type: 'button', onclick: logout }, 'Salir'))),
    h('div', { class: 'layout' },
      h('nav', { class: 'side', 'aria-label': 'Secciones del panel', id: 'tabs' }),
      h('main', { class: 'panel', id: 'panel', tabindex: '-1' })));
}

function drawTabs() {
  const nuevos = A.orders.filter((o) => o.status === 'nuevo').length;
  $('#tabs').replaceChildren(...NAV.map(([group, items]) => h('div', { class: 'side-group' },
    h('p', { class: 'side-label' }, group),
    items.map(([id, label]) =>
      h('a', { class: 'tab', href: `#${id}`, 'aria-current': A.tab === id ? 'page' : null }, label,
        id === 'pedidos' && nuevos ? h('span', { class: 'badge', 'aria-label': `${nuevos} nuevos` }, nuevos) : null)))));
}

// La dirección es #seccion o #seccion/id (ej. #clientes/12 abre la ficha de ese cliente).
function route() {
  if (!$('#panel')) return;
  const [id, param] = location.hash.slice(1).split('/');
  A.tab = TABS.some((t) => t[0] === id) ? id : 'resumen';
  drawTabs();
  document.title = `${TABS.find((t) => t[0] === A.tab)[1]} · Panel`;
  const views = {
    resumen: reportsView, clientes: customersView, pedidos: ordersView, campanas: campaignsView,
    prendas: productsView, categorias: categoriesView, temporadas: seasonsView, inventario: inventoryView, cuentas: accountsView, tienda: settingsView,
  };
  $('#panel').replaceChildren(views[A.tab](param));
}

// Vista que primero carga datos del servidor: muestra "Cargando…" y luego el contenido.
function asyncView(load, render) {
  const box = h('div', {}, h('p', { class: 'loading' }, 'Cargando…'));
  load().then((data) => box.replaceChildren(render(data)))
    .catch((e) => box.replaceChildren(h('div', { class: 'empty-note' }, h('strong', {}, 'No se pudo cargar'), e.message)));
  return box;
}

// ------------------------------------------------------------------ prendas

const productPayload = (p) => ({
  name: p.name, description: p.description, price: p.price, compare_price: p.compare_price, category_id: p.category_id,
  season_id: p.season_id, stock: p.stock, images: p.images, sizes: p.sizes, colors: p.colors, active: p.active, featured: p.featured,
});

function productsView() {
  const list = h('div', { class: 'plist' });

  const empty = () => A.products.length
    ? h('p', { class: 'empty-note' }, 'Ninguna prenda coincide con la búsqueda.')
    : h('div', { class: 'empty-note' }, h('strong', {}, 'Todavía no hay prendas'), 'Sube la primera con fotos, precio y tallas. Aparecerá en tu tienda al guardarla.',
      h('div', {}, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openProductEditor(null) }, 'Subir la primera prenda')));

  const draw = () => {
    const q = norm(A.q);
    const items = A.products.filter((p) => !q || norm(p.name).includes(q));
    list.replaceChildren(...(items.length ? items.map(productRow) : [empty()]));
  };

  const search = h('input', {
    class: 'input', type: 'search', placeholder: 'Buscar por nombre', 'aria-label': 'Buscar prenda', value: A.q,
    oninput: (e) => { A.q = e.target.value; draw(); },
  });

  draw();
  return h('div', {},
    h('div', { class: 'panel-head' },
      h('h2', { class: 'title' }, 'Prendas'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openProductEditor(null) }, 'Nueva prenda')),
    A.products.length > 6 ? h('div', { style: 'margin-bottom:1rem' }, search) : null,
    list);
}

function productRow(p) {
  const stock = p.stock === null ? 'Sin límite' : p.stock <= 0 ? 'Agotada' : `${p.stock} en stock`;
  const stockEl = (cls) => h('span', { class: p.stock !== null && p.stock <= 0 ? 'out' : cls }, stock);
  const row = h('div', { class: `prow${p.active ? '' : ' is-hidden'}` });

  const toggle = h('input', {
    type: 'checkbox', role: 'switch', checked: p.active, 'aria-label': `Mostrar ${p.name} en la tienda`,
    onchange: async (e) => {
      const on = e.target.checked;
      try {
        const saved = await call(`/api/admin/products/${p.id}`, { method: 'PUT', body: { ...productPayload(p), active: on } });
        Object.assign(p, saved);
        row.classList.toggle('is-hidden', !on);
        toast(on ? 'Ahora se ve en la tienda' : 'Oculta en la tienda');
      } catch (ex) { e.target.checked = !on; toast(ex.message); }
    },
  });

  row.append(
    h('div', { class: 'pthumb' }, p.images[0] ? h('img', { src: p.images[0], alt: '' }) : null),
    h('div', { class: 'pmain' },
      h('p', { class: 'pname' }, p.name),
      h('p', { class: 'pcat' }, p.category_name || 'Sin categoría', p.season_name ? ` · ${p.season_name}` : ''),
      h('p', { class: 'pmeta' }, h('span', {}, money(p.price)), stockEl('')),
    ),
    h('div', { class: 'pcol' }, money(p.price), p.compare_price ? h('small', {}, `Antes ${money(p.compare_price)}`) : null),
    h('div', { class: 'pcol' }, stockEl('')),
    h('div', { class: 'pact' },
      h('label', { class: 'switch', title: 'Visible en la tienda' }, toggle, h('span', { class: 'track' })),
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => openProductEditor(p) }, 'Editar'),
      confirmButton({
        label: 'Eliminar', confirmLabel: '¿Seguro? Toca otra vez', cls: 'btn btn-danger btn-small',
        onConfirm: async () => {
          try {
            await call(`/api/admin/products/${p.id}`, { method: 'DELETE' });
            A.products = A.products.filter((x) => x.id !== p.id);
            A.categories = await call('/api/admin/categories');
            toast('Prenda eliminada'); route();
          } catch (ex) { toast(ex.message); }
        },
      })));
  return row;
}

// Campo de etiquetas: se escribe una talla o color y se agrega con Enter o coma.
function chipInput({ values, placeholder, label, presets = [] }) {
  let list = [...values];
  const box = h('div', { class: 'chipbox' });
  const input = h('input', { type: 'text', placeholder, maxlength: '20', 'aria-label': label });

  const addPending = () => {
    const raw = input.value;
    input.value = '';
    raw.split(',').map((s) => s.trim()).filter(Boolean).forEach((v) => { if (!list.includes(v) && list.length < 20) list.push(v); });
  };
  const draw = () => box.replaceChildren(
    ...list.map((v, i) => h('span', { class: 'chip-s' }, v,
      h('button', { type: 'button', 'aria-label': `Quitar ${v}`, onclick: () => { list.splice(i, 1); draw(); input.focus(); } }, '×'))),
    input);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addPending(); draw(); input.focus(); }
    else if (e.key === 'Backspace' && !input.value && list.length) { list.pop(); draw(); input.focus(); }
  });
  input.addEventListener('blur', () => { if (input.value.trim()) { addPending(); draw(); } });
  draw();

  const el = h('div', {}, box,
    presets.length ? h('div', { class: 'presets' }, h('span', { class: 'hint' }, 'Atajos:'),
      presets.map((pr) => h('button', { class: 'btn btn-small', type: 'button', onclick: () => { list = [...pr.values]; draw(); } }, pr.label))) : null);
  return { el, get: () => { addPending(); return [...list]; } };
}

function openProductEditor(existing) {
  const p = existing || { name: '', description: '', price: '', compare_price: '', category_id: '', season_id: A.seasons[0]?.id ?? '', stock: '', images: [], sizes: [], colors: [], active: true, featured: false };
  let images = [...p.images];
  let uploading = 0;

  const msg = h('p', { class: 'form-msg', role: 'alert' });
  const photosBox = h('div', { class: 'photos' });

  const fileInput = h('input', {
    type: 'file', accept: 'image/*', multiple: true, class: 'sr-only', tabindex: '-1',
    onchange: async (e) => {
      const files = [...e.target.files].slice(0, 8 - images.length);
      e.target.value = '';
      for (const f of files) {
        uploading++; drawPhotos(); msg.textContent = '';
        try { images.push(await uploadImage(f)); } catch (ex) { msg.textContent = ex.message; }
        uploading--; drawPhotos();
      }
    },
  });

  const move = (i, d) => { [images[i], images[i + d]] = [images[i + d], images[i]]; drawPhotos(); };
  function drawPhotos() {
    const small = (text, label, disabled, fn) => h('button', { type: 'button', 'aria-label': label, disabled, onclick: fn }, text);
    photosBox.replaceChildren(
      ...images.map((url, i) => h('div', { class: 'photo' },
        h('div', { class: 'photo-img' }, h('img', { src: url, alt: `Foto ${i + 1}` }), i === 0 ? h('span', { class: 'cover-badge' }, 'Portada') : null),
        h('div', { class: 'photo-actions' },
          small('‹', 'Mover a la izquierda', i === 0, () => move(i, -1)),
          small('›', 'Mover a la derecha', i === images.length - 1, () => move(i, 1)),
          small('✕', 'Quitar foto', false, () => { images.splice(i, 1); drawPhotos(); })))),
      uploading ? h('div', { class: 'photo' }, h('div', { class: 'photo-img wait' }, 'Subiendo…')) : null,
      images.length + uploading < 8 ? h('button', { class: 'add-photo', type: 'button', onclick: () => fileInput.click() }, 'Agregar foto') : null);
  }
  drawPhotos();

  const sizes = chipInput({
    values: p.sizes, placeholder: 'Escribe una talla y presiona Enter', label: 'Tallas',
    presets: [
      { label: 'S a XL', values: ['S', 'M', 'L', 'XL'] },
      { label: 'XS a XL', values: ['XS', 'S', 'M', 'L', 'XL'] },
      { label: '28 a 36', values: ['28', '30', '32', '34', '36'] },
      { label: 'Talla única', values: ['Única'] },
    ],
  });
  const colors = chipInput({ values: p.colors, placeholder: 'Escribe un color y presiona Enter', label: 'Colores' });

  const field = (label, control, hint) => h('label', { class: 'field' }, h('span', { class: 'label' }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);
  const dlg = h('dialog', { class: 'modal', 'aria-labelledby': 'ed-title' });

  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Guardar prenda');
  const form = h('form', {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      if (uploading) { msg.textContent = 'Espera a que terminen de subirse las fotos.'; return; }
      const el = e.target.elements;
      const body = {
        name: el.pname.value, description: el.description.value, price: el.price.value, compare_price: el.compare.value,
        category_id: el.category.value, season_id: el.season.value, stock: el.stock.value, images, sizes: sizes.get(), colors: colors.get(),
        active: el.active.checked, featured: el.featured.checked,
      };
      msg.textContent = ''; save.disabled = true; save.textContent = 'Guardando…';
      try {
        await call(existing ? `/api/admin/products/${existing.id}` : '/api/admin/products', { method: existing ? 'PUT' : 'POST', body });
        A.products = await call('/api/admin/products');
        [A.categories, A.seasons] = await Promise.all([call('/api/admin/categories'), call('/api/admin/seasons')]);
        dlg.close(); route(); toast('Prenda guardada');
      } catch (ex) { msg.textContent = ex.message; save.disabled = false; save.textContent = 'Guardar prenda'; }
    },
  },
  h('div', { class: 'modal-head' },
    h('h2', { class: 'title', id: 'ed-title', style: 'font-size:1.4rem' }, existing ? 'Editar prenda' : 'Nueva prenda'),
    h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: () => dlg.close() }, 'Cerrar')),
  h('div', { class: 'modal-body' },
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Fotos'), photosBox, fileInput,
      h('span', { class: 'hint' }, 'La primera es la portada. Hasta 8 fotos; se reducen solas para que la tienda cargue rápido.')),
    field('Nombre', h('input', { class: 'input', name: 'pname', maxlength: '120', value: p.name, placeholder: 'Ej. Vestido midi de lino', required: true })),
    field('Descripción', h('textarea', { class: 'textarea', name: 'description', maxlength: '2000', placeholder: 'Tela, corte, cuidados…' }, p.description)),
    h('div', { class: 'grid2' },
      field('Precio', h('input', { class: 'input', name: 'price', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: p.price, placeholder: '0.00' }), `En ${A.settings.currency}`),
      field('Precio anterior (opcional)', h('input', { class: 'input', name: 'compare', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: p.compare_price ?? '', placeholder: '0.00' }), 'Si lo llenas, se muestra tachado como oferta')),
    h('div', { class: 'grid2' },
      field('Categoría', h('select', { class: 'select', name: 'category', value: p.category_id ?? '' },
        h('option', { value: '' }, 'Sin categoría'), A.categories.map((c) => h('option', { value: c.id }, c.name)))),
      field('Temporada', h('select', { class: 'select', name: 'season', value: p.season_id ?? '' },
        h('option', { value: '' }, 'Sin temporada'), A.seasons.map((x) => h('option', { value: x.id }, x.name))),
      A.seasons.length ? 'Los outfits nuevos van a la temporada actual' : h('a', { href: '#temporadas', onclick: () => dlg.close() }, 'Crea tu primera temporada'))),
    h('div', { class: 'grid2' },
      field('Unidades disponibles', h('input', { class: 'input', name: 'stock', type: 'number', min: '0', step: '1', inputmode: 'numeric', value: p.stock ?? '', placeholder: 'Sin límite' }), 'Déjalo vacío si no quieres controlar el stock')),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Tallas'), sizes.el),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Colores'), colors.el),
    h('div', { class: 'checks' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'active', checked: p.active }), 'Mostrar en la tienda'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'featured', checked: p.featured }), 'Destacar en "Nuevos ingresos"')),
    msg),
  h('div', { class: 'modal-foot' },
    save,
    h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancelar'),
    h('span', { class: 'spacer' }),
    existing ? confirmButton({
      label: 'Eliminar', confirmLabel: 'Toca otra vez para eliminar',
      onConfirm: async () => {
        try {
          await call(`/api/admin/products/${existing.id}`, { method: 'DELETE' });
          A.products = await call('/api/admin/products');
          A.categories = await call('/api/admin/categories');
          dlg.close(); route(); toast('Prenda eliminada');
        } catch (ex) { msg.textContent = ex.message; }
      },
    }) : null));

  dlg.append(form);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  if (!existing) form.elements.pname.focus();
}

// ------------------------------------------------------------------ categorías

function categoriesView() {
  const list = h('div', { class: 'clist' });

  const reload = async () => { A.products = await call('/api/admin/products'); };
  const reorder = async (i, d) => {
    const ids = A.categories.map((c) => c.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    try { A.categories = await call('/api/admin/categories/order', { method: 'PUT', body: { ids } }); draw(); } catch (ex) { toast(ex.message); }
  };

  const catRow = (c, i) => h('div', { class: 'crow' },
    thumbPicker({
      value: c.image, label: `Foto de ${c.name}`,
      onChange: async (url) => {
        try { A.categories = await call(`/api/admin/categories/${c.id}/image`, { method: 'PUT', body: { image: url } }); toast(url ? 'Foto guardada' : 'Foto quitada'); draw(); }
        catch (ex) { toast(ex.message); }
      },
    }),
    h('input', {
      class: 'input', value: c.name, maxlength: '40', 'aria-label': `Nombre de la categoría ${c.name}`,
      onchange: async (e) => {
        try { A.categories = await call(`/api/admin/categories/${c.id}`, { method: 'PUT', body: { name: e.target.value } }); await reload(); toast('Nombre actualizado'); draw(); }
        catch (ex) { toast(ex.message); e.target.value = c.name; }
      },
    }),
    h('span', { class: 'count' }, `${c.count} ${c.count === 1 ? 'prenda' : 'prendas'}`),
    h('button', { class: 'btn icon-btn', type: 'button', 'aria-label': `Subir ${c.name}`, disabled: i === 0, onclick: () => reorder(i, -1) }, '↑'),
    h('button', { class: 'btn icon-btn', type: 'button', 'aria-label': `Bajar ${c.name}`, disabled: i === A.categories.length - 1, onclick: () => reorder(i, 1) }, '↓'),
    confirmButton({
      label: 'Eliminar', confirmLabel: c.count ? `Sí, dejar ${c.count} sin categoría` : 'Sí, eliminar',
      onConfirm: async () => {
        try { A.categories = await call(`/api/admin/categories/${c.id}`, { method: 'DELETE' }); await reload(); draw(); toast('Categoría eliminada'); }
        catch (ex) { toast(ex.message); }
      },
    }));

  function draw() {
    list.replaceChildren(...(A.categories.length
      ? A.categories.map(catRow)
      : [h('div', { class: 'empty-note' }, h('strong', {}, 'Aún no hay categorías'), 'Crea la primera, por ejemplo "Polos" o "Vestidos". Los clientes las usan para filtrar.')]));
  }
  draw();

  const addForm = h('form', {
    class: 'inline-form',
    onsubmit: async (e) => {
      e.preventDefault();
      const input = e.target.elements.cname;
      if (!input.value.trim()) { input.focus(); return; }
      try { A.categories = await call('/api/admin/categories', { method: 'POST', body: { name: input.value } }); input.value = ''; draw(); toast('Categoría agregada'); }
      catch (ex) { toast(ex.message); }
    },
  },
  h('input', { class: 'input', name: 'cname', maxlength: '40', placeholder: 'Nueva categoría, ej. Faldas', 'aria-label': 'Nombre de la nueva categoría' }),
  h('button', { class: 'btn btn-primary', type: 'submit' }, 'Agregar'));

  return h('div', {},
    h('div', { class: 'panel-head' }, h('h2', { class: 'title' }, 'Categorías')),
    h('div', { class: 'box' }, h('p', { class: 'muted' }, 'La tienda muestra solo las categorías que tienen prendas visibles, en este orden, en "Explora por categoría". Toca el cuadrito para subir su foto; si no tiene, se usa la foto de una de sus prendas.'), addForm),
    h('div', { class: 'box' }, list));
}

// Cuadrito de foto: al tocarlo se sube una imagen. Se usa en categorías y temporadas.
function thumbPicker({ value, label, onChange }) {
  const file = h('input', {
    type: 'file', accept: 'image/*', class: 'sr-only', tabindex: '-1',
    onchange: async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      btn.classList.add('wait');
      try { await onChange(await uploadImage(f, { max: 1200 })); } catch (ex) { toast(ex.message); }
      btn.classList.remove('wait');
    },
  });
  const btn = h('button', { class: 'thumb-pick', type: 'button', 'aria-label': value ? `Cambiar ${label.toLowerCase()}` : `Subir ${label.toLowerCase()}`, title: label, onclick: () => file.click() },
    value ? h('img', { src: value, alt: '' }) : h('span', {}, '+ Foto'));
  return h('span', { class: 'thumb-pick-wrap' }, btn, file,
    value ? h('button', { class: 'link-x', type: 'button', 'aria-label': `Quitar ${label.toLowerCase()}`, onclick: () => onChange('') }, '×') : null);
}

// ------------------------------------------------------------------ temporadas

function seasonsView() {
  const list = h('div', { class: 'slist' });
  const body = (x) => ({ name: x.name, description: x.description, image: x.image, active: x.active });
  const save = async (x, patch, ok) => {
    try { A.seasons = await call(`/api/admin/seasons/${x.id}`, { method: 'PUT', body: { ...body(x), ...patch } }); A.products = await call('/api/admin/products'); if (ok) toast(ok); draw(); }
    catch (ex) { toast(ex.message); draw(); }
  };
  const reorder = async (i, d) => {
    const ids = A.seasons.map((x) => x.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    try { A.seasons = await call('/api/admin/seasons/order', { method: 'PUT', body: { ids } }); draw(); } catch (ex) { toast(ex.message); }
  };

  const row = (x, i) => h('div', { class: `srow${x.active ? '' : ' is-hidden'}` },
    thumbPicker({ value: x.image, label: `Foto de ${x.name}`, onChange: (url) => save(x, { image: url }, url ? 'Foto guardada' : 'Foto quitada') }),
    h('div', { class: 'srow-main' },
      h('input', { class: 'input', value: x.name, maxlength: '60', 'aria-label': `Nombre de la temporada ${x.name}`, onchange: (e) => save(x, { name: e.target.value }, 'Nombre actualizado') }),
      h('textarea', { class: 'textarea', rows: '2', maxlength: '300', placeholder: 'Frase de la temporada (opcional), ej. Looks frescos para el sol', 'aria-label': `Descripción de ${x.name}`, onchange: (e) => save(x, { description: e.target.value }, 'Descripción guardada') }, x.description),
      h('p', { class: 'muted' }, i === 0 ? h('strong', {}, 'Temporada actual · ') : null, `${x.count} ${x.count === 1 ? 'prenda' : 'prendas'}`,
        x.count ? [' · ', h('a', { href: `/#/temporada/${x.slug}`, target: '_blank', rel: 'noopener' }, 'Ver en la tienda')] : null)),
    h('div', { class: 'srow-act' },
      h('label', { class: 'switch', title: 'Visible en la tienda' },
        h('input', { type: 'checkbox', role: 'switch', checked: x.active, 'aria-label': `Mostrar ${x.name} en la tienda`, onchange: (e) => save(x, { active: e.target.checked }, e.target.checked ? 'Temporada visible' : 'Temporada oculta') }),
        h('span', { class: 'track' })),
      h('button', { class: 'btn icon-btn', type: 'button', 'aria-label': `Subir ${x.name}`, disabled: i === 0, onclick: () => reorder(i, -1) }, '↑'),
      h('button', { class: 'btn icon-btn', type: 'button', 'aria-label': `Bajar ${x.name}`, disabled: i === A.seasons.length - 1, onclick: () => reorder(i, 1) }, '↓'),
      confirmButton({
        label: 'Eliminar', confirmLabel: x.count ? `Sí, dejar ${x.count} sin temporada` : 'Sí, eliminar',
        onConfirm: async () => {
          try { A.seasons = await call(`/api/admin/seasons/${x.id}`, { method: 'DELETE' }); A.products = await call('/api/admin/products'); draw(); toast('Temporada eliminada'); }
          catch (ex) { toast(ex.message); }
        },
      })));

  function draw() {
    list.replaceChildren(...(A.seasons.length ? A.seasons.map(row)
      : [h('div', { class: 'empty-note' }, h('strong', {}, 'Aún no hay temporadas'), 'Crea la primera, por ejemplo "Verano 2026". Luego, al subir cada outfit, elige a qué temporada pertenece.')]));
  }
  draw();

  const addForm = h('form', {
    class: 'inline-form',
    onsubmit: async (e) => {
      e.preventDefault();
      const input = e.target.elements.sname;
      if (!input.value.trim()) { input.focus(); return; }
      try { A.seasons = await call('/api/admin/seasons', { method: 'POST', body: { name: input.value } }); input.value = ''; draw(); toast('Temporada creada'); }
      catch (ex) { toast(ex.message); }
    },
  },
  h('input', { class: 'input', name: 'sname', maxlength: '60', placeholder: 'Nueva temporada, ej. Verano 2026', 'aria-label': 'Nombre de la nueva temporada' }),
  h('button', { class: 'btn btn-primary', type: 'submit' }, 'Crear temporada'));

  return h('div', {},
    h('div', { class: 'panel-head' }, h('h2', { class: 'title' }, 'Temporadas')),
    h('div', { class: 'box' },
      h('p', { class: 'muted' }, 'Cada temporada trae sus propios outfits. La primera de la lista es la temporada actual: sale destacada en la portada y las prendas nuevas se asignan a ella. Solo se muestran las temporadas visibles que tienen prendas.'),
      addForm),
    h('div', { class: 'box' }, list));
}

// ------------------------------------------------------------------ pedidos

function ordersView() {
  const list = h('div', {});

  const orderCard = (o) => {
    const digits = (o.customer_phone || '').replace(/\D/g, '');
    const wa = digits.length === 9 ? `51${digits}` : digits.length >= 10 ? digits : '';
    const select = h('select', {
      class: `select status st-${o.status}`, value: o.status, disabled: o.status === 'cancelado', 'aria-label': `Estado del pedido ${o.code}`,
      onchange: async (e) => {
        const next = e.target.value;
        if (next === 'cancelado' && !confirm('¿Cancelar este pedido? Las prendas vuelven al stock y no se puede reactivar.')) { e.target.value = o.status; return; }
        try {
          Object.assign(o, await call(`/api/admin/orders/${o.id}`, { method: 'PUT', body: { status: next } }));
          A.products = await call('/api/admin/products');
          toast('Estado actualizado'); route();
        } catch (ex) { e.target.value = o.status; toast(ex.message); }
      },
    }, Object.entries(STATUS).map(([k, v]) => h('option', { value: k }, v)));

    return h('article', { class: 'order' },
      h('div', { class: 'order-head' },
        h('div', {}, h('span', { class: 'order-code' }, o.code), ' ', h('span', { class: 'order-when' }, when(o.created_at))),
        select),
      h('div', { class: 'who' },
        o.customer_id ? h('a', { class: 'who-link', href: `#clientes/${o.customer_id}` }, h('strong', {}, o.customer_name)) : h('strong', {}, o.customer_name),
        o.customer_phone ? [' ', h('a', { href: `tel:${digits}` }, o.customer_phone)] : null,
        o.customer_email ? [' · ', h('span', { class: 'muted' }, o.customer_email)] : null,
        o.payment_method ? h('span', { class: `pay-chip${o.payment_method === 'tarjeta' ? ' is-card' : ''}` },
          o.payment_method === 'tarjeta' ? 'Pidió pagar con tarjeta (pedido antiguo)' : 'Yape, Plin o transferencia') : null,
        o.notes ? h('p', { class: 'note' }, o.notes) : null),
      h('ul', { class: 'oitems' }, o.items.map((it) => h('li', {},
        h('span', {}, `${it.qty} × ${it.name}`, [it.size, it.color].filter(Boolean).length ? h('span', { class: 'variant' }, ` ${[it.size, it.color].filter(Boolean).join(', ')}`) : null),
        h('span', {}, money(it.price * it.qty))))),
      h('div', { class: 'order-foot' },
        h('div', { class: 'head-actions' },
          wa ? h('a', { class: 'btn btn-small', href: `https://wa.me/${wa}`, target: '_blank', rel: 'noopener' }, 'Escribir por WhatsApp') : null,
          confirmButton({
            label: 'Eliminar', cls: 'btn btn-danger btn-small',
            confirmLabel: o.status === 'cancelado' ? 'Toca otra vez para eliminar' : 'Eliminar (vuelve al stock)',
            onConfirm: async () => {
              try {
                await call(`/api/admin/orders/${o.id}`, { method: 'DELETE' });
                A.orders = A.orders.filter((x) => x.id !== o.id);
                A.products = await call('/api/admin/products');
                toast('Pedido eliminado'); route();
              } catch (ex) { toast(ex.message); }
            },
          })),
        h('span', { class: 'order-total' }, `Total ${money(o.total)}`)));
  };

  const draw = () => {
    const items = A.orders.filter((o) => !A.orderFilter || o.status === A.orderFilter);
    list.replaceChildren(...(items.length ? items.map(orderCard)
      : [h('div', { class: 'empty-note' },
        h('strong', {}, A.orders.length ? 'No hay pedidos con ese estado' : 'Todavía no hay pedidos'),
        A.orders.length ? 'Cambia el filtro para ver los demás.' : 'Cuando un cliente envíe su pedido desde la tienda, aparecerá aquí.')]));
  };

  const filter = h('select', {
    class: 'select', value: A.orderFilter, 'aria-label': 'Filtrar por estado',
    onchange: (e) => { A.orderFilter = e.target.value; draw(); },
  }, h('option', { value: '' }, 'Todos los estados'), Object.entries(STATUS).map(([k, v]) => h('option', { value: k }, v)));

  draw();
  return h('div', {},
    h('div', { class: 'panel-head' }, h('h2', { class: 'title' }, 'Pedidos'), h('div', { class: 'filters' }, filter)),
    list);
}

// ------------------------------------------------------------------ cuentas shein

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dayLabel = (s) => new Date(`${s}T12:00:00`).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', year: 'numeric' });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

async function copyText(text, what) {
  try { await navigator.clipboard.writeText(text); toast(`${what} copiado`); }
  catch { toast('No se pudo copiar. Selecciónalo y cópialo a mano.'); }
}

// Ventana genérica con formulario: cabecera, cuerpo, pie con Guardar / Cancelar / Eliminar.
function formModal({ title, body, saveLabel, onSave, onDelete, deleteLabel, wide = false }) {
  const dlg = h('dialog', { class: `modal${wide ? ' modal-wide' : ' modal-sm'}`, 'aria-labelledby': 'fm-title' });
  const msg = h('p', { class: 'form-msg', role: 'alert' });
  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, saveLabel);
  const form = h('form', {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      msg.textContent = ''; save.disabled = true;
      try { await onSave(e.target.elements); dlg.close(); }
      catch (ex) { msg.textContent = ex.message; save.disabled = false; }
    },
  },
  h('div', { class: 'modal-head' },
    h('h2', { class: 'title', id: 'fm-title', style: 'font-size:1.4rem' }, title),
    h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: () => dlg.close() }, 'Cerrar')),
  h('div', { class: 'modal-body' }, body, msg),
  h('div', { class: 'modal-foot' },
    save,
    h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancelar'),
    h('span', { class: 'spacer' }),
    onDelete ? confirmButton({
      label: 'Eliminar', confirmLabel: deleteLabel || 'Toca otra vez para eliminar',
      onConfirm: async () => { try { await onDelete(); dlg.close(); } catch (ex) { msg.textContent = ex.message; } },
    }) : null));
  dlg.append(form);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  form.querySelector('input')?.focus();
}

const ffield = (label, control, hint) => h('label', { class: 'field' }, h('span', { class: 'label' }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);

function openAccountEditor(acc) {
  const pw = h('input', {
    class: 'input', name: 'password', type: 'password', maxlength: '200', autocomplete: 'off',
    placeholder: acc ? 'Déjala vacía para no cambiarla' : '',
  });
  const showPw = h('label', { class: 'check' },
    h('input', { type: 'checkbox', onchange: (e) => { pw.type = e.target.checked ? 'text' : 'password'; } }), 'Mostrar mientras escribo');
  formModal({
    title: acc ? 'Editar cuenta' : 'Nueva cuenta',
    saveLabel: acc ? 'Guardar cuenta' : 'Registrar cuenta',
    body: [
      ffield('Correo de la cuenta', h('input', { class: 'input', name: 'email', type: 'email', maxlength: '120', autocomplete: 'off', value: acc?.email || '', placeholder: 'nombre@gmail.com' })),
      ffield('Contraseña', pw, 'Se guarda cifrada. Solo tú la puedes ver desde este panel.'),
      showPw,
      ffield('Notas (opcional)', h('textarea', { class: 'textarea', name: 'notes', rows: '2', maxlength: '500', placeholder: 'Ej. cupón de bienvenida 30 %, número de celular usado…' }, acc?.notes || '')),
    ],
    onSave: async (el) => {
      const body = { email: el.email.value, notes: el.notes.value };
      if (el.password.value) body.password = el.password.value;
      A.accounts = await call(acc ? `/api/admin/accounts/${acc.id}` : '/api/admin/accounts', { method: acc ? 'PUT' : 'POST', body });
      route(); toast(acc ? 'Cuenta actualizada' : 'Cuenta registrada');
    },
    onDelete: acc ? async () => {
      A.accounts = await call(`/api/admin/accounts/${acc.id}`, { method: 'DELETE' });
      route(); toast('Cuenta eliminada');
    } : null,
    deleteLabel: acc?.purchases.length ? `Sí, borrar con sus ${plural(acc.purchases.length, 'compra', 'compras')}` : null,
  });
}

// Compra con detalle, como el reporte de compras: al elegir la cantidad de productos aparece una fila
// por cada uno (nombre, talla/color, tipo, precio en el pedido, unidades, precio de venta y de dónde salió el precio).
// El "costo real" reparte el envío, impuestos y descuentos del pedido entre sus prendas.
const MAX_LINES = 30;
const DEFAULT_TYPES = ['Vestido fiesta', 'Vestido largo', 'Playa', 'Conjunto', 'Top', 'Falda', 'Pantalón', 'Accesorio'];
const PRICE_SOURCE = { pedido: 'Del pedido', pagina: 'De la página', aprox: 'Aproximado' };
const allTypes = () => [...new Set([...DEFAULT_TYPES, ...A.accounts.flatMap((a) => a.purchases.flatMap((p) => p.lines.map((l) => l.type)))])].filter(Boolean);
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const pctFmt = (x) => `${Math.round(x * 100)} %`;

function openPurchaseEditor(acc, pur) {
  const legacy = pur && !pur.lines.length; // compra registrada antes, sin detalle
  const blank = () => ({ id: null, name: '', variant: '', type: '', price: '', qty: 1, sale_price: '', price_source: 'pedido', sold: 0 });
  const rows = (pur?.lines.length ? pur.lines : legacy ? [] : [blank()]).map((l) => ({ ...blank(), ...l, sale_price: l.sale_price ?? '' }));

  const count = h('input', {
    class: 'input', type: 'number', min: legacy ? '0' : '1', max: String(MAX_LINES), step: '1', inputmode: 'numeric',
    value: String(rows.length), 'aria-describedby': 'lines-hint',
    oninput: () => {
      const n = Math.max(0, Math.min(MAX_LINES, Number.parseInt(count.value, 10) || 0));
      while (rows.length < n) rows.push(blank());
      rows.length = n; // si bajas el número, se quitan las últimas filas
      drawLines();
    },
  });
  const linesBox = h('div', { class: 'plines' });
  const hasTotal = pur && pur.lines.length;
  const totalPaid = h('input', { class: 'input', name: 'total', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: hasTotal ? pur.cost : '', oninput: () => drawLines(false) });
  const totalBox = h('div', { class: 'ptotal', 'aria-live': 'polite' });
  const legacyBox = legacy ? h('div', { class: 'grid2' },
    ffield('Cantidad de prendas', h('input', { class: 'input', name: 'items', type: 'number', min: '1', step: '1', value: pur.items })),
    ffield('Cuánto te costó (total)', h('input', { class: 'input', name: 'cost', type: 'number', min: '0', step: '0.01', value: pur.cost }))) : null;
  const subs = [];

  const sumLines = () => rows.reduce((s, r) => s + num(r.price) * num(r.qty), 0);
  const paid = () => (totalPaid.value !== '' ? num(totalPaid.value) : sumLines());
  const factor = () => (sumLines() ? paid() / sumLines() : 1);

  function drawTotal() {
    const units = rows.reduce((s, r) => s + num(r.qty), 0);
    const f = factor();
    const sale = rows.reduce((s, r) => s + num(r.sale_price) * num(r.qty), 0);
    const priced = rows.filter((r) => num(r.sale_price)).reduce((s, r) => s + num(r.price) * f * num(r.qty), 0);
    const diff = paid() - sumLines();
    totalPaid.placeholder = `${sumLines().toFixed(2)} (suma de los productos)`;
    subs.forEach((fn) => fn(f));
    totalBox.replaceChildren(
      h('div', {}, h('span', {}, plural(units, 'unidad', 'unidades')),
        h('span', {}, `Productos ${money(sumLines())}`),
        Math.abs(diff) >= 0.005 ? h('span', {}, `${diff > 0 ? 'Envío e impuestos +' : 'Descuentos −'}${money(Math.abs(diff))}`) : null),
      h('div', {}, h('strong', {}, `Pagado ${money(paid())}`),
        sale ? h('span', {}, `Venta proyectada ${money(sale)} · Ganancia ${money(sale - priced)} (${pctFmt((sale - priced) / sale)})`) : null));
  }

  function drawLines(rebuild = true) {
    if (legacyBox) legacyBox.hidden = rows.length > 0;
    paidField.hidden = !rows.length;
    totalBox.hidden = !rows.length;
    headRow.hidden = !rows.length;
    if (rebuild) {
      subs.length = 0;
      linesBox.replaceChildren(...rows.map((r, i) => {
        const real = h('span', { class: 'pl-sub', title: 'Costo real por unidad (con envío, impuestos y descuentos)' });
        subs.push((f) => { real.textContent = num(r.price) ? money(num(r.price) * f) : '—'; });
        const set = (k) => (e) => { r[k] = e.target.value; drawTotal(); };
        const lbl = (t) => `${t} del producto ${i + 1}`;
        return h('div', { class: 'pline pline-full' },
          h('span', { class: 'pl-n', 'aria-hidden': 'true' }, i + 1),
          h('input', { class: 'input pl-name', placeholder: `Producto ${i + 1}, ej. Vestido mini encaje`, maxlength: '120', value: r.name, 'aria-label': lbl('Nombre'), oninput: set('name') }),
          h('input', { class: 'input', placeholder: 'Talla / color', maxlength: '40', value: r.variant, 'aria-label': lbl('Talla y color'), oninput: set('variant') }),
          h('input', { class: 'input', placeholder: 'Tipo', maxlength: '30', list: 'type-list', value: r.type, 'aria-label': lbl('Tipo de prenda'), oninput: set('type') }),
          h('input', { class: 'input', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', placeholder: 'Precio', value: r.price, 'aria-label': lbl('Precio en el pedido'), oninput: set('price') }),
          h('input', { class: 'input', type: 'number', min: String(Math.max(1, r.sold)), step: '1', inputmode: 'numeric', placeholder: 'Unid.', value: r.qty, 'aria-label': lbl('Unidades'), oninput: set('qty') }),
          h('input', { class: 'input', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', placeholder: 'Venta', value: r.sale_price, 'aria-label': lbl('Precio de venta proyectado'), oninput: set('sale_price') }),
          h('select', { class: 'select', value: r.price_source, 'aria-label': lbl('Origen del precio'), onchange: set('price_source') },
            Object.entries(PRICE_SOURCE).map(([k, v]) => h('option', { value: k }, v))),
          real);
      }));
    }
    drawTotal();
  }

  const paidField = ffield('Total pagado (opcional)', totalPaid, 'Lo que te cobró Shein, con envío, impuestos y descuentos. Si lo dejas vacío, se usa la suma de los productos.');
  const headRow = h('div', { class: 'pline pline-full pline-head', 'aria-hidden': 'true' },
    h('span', {}, '#'), h('span', {}, 'Prenda'), h('span', {}, 'Talla / color'), h('span', {}, 'Tipo'), h('span', {}, 'Precio pedido'),
    h('span', {}, 'Unid.'), h('span', {}, 'Precio venta'), h('span', {}, 'Origen del precio'), h('span', {}, 'Costo real'));
  drawLines();

  const accountSel = pur && A.accounts.length > 1
    ? ffield('Cuenta', h('select', { class: 'select', name: 'account', value: String(pur.account_id) }, A.accounts.map((a) => h('option', { value: String(a.id) }, a.email))))
    : null;

  formModal({
    title: pur ? 'Editar compra' : `Nueva compra · ${acc.email}`,
    saveLabel: 'Guardar compra',
    wide: true,
    body: [
      h('datalist', { id: 'type-list' }, allTypes().map((t) => h('option', { value: t }))),
      h('div', { class: 'grid4' },
        ffield('Fecha de compra', h('input', { class: 'input', name: 'date', type: 'date', value: pur?.date || today(), max: today() })),
        ffield('N° de pedido Shein', h('input', { class: 'input', name: 'order_number', maxlength: '40', value: pur?.order_number || '', placeholder: 'GSH19P59C00NH95' })),
        ffield('Llegada aprox. (opcional)', h('input', { class: 'input', name: 'arrival', maxlength: '40', value: pur?.arrival || '', placeholder: '16-29 nov' })),
        h('label', { class: 'field' }, h('span', { class: 'label' }, 'Cantidad de productos'), count)),
      h('p', { class: 'hint-block', id: 'lines-hint' }, 'Aparece una fila por producto. Si compraste 2 iguales, pon 2 en "Unid.". El precio de venta es opcional y sirve para las proyecciones.'),
      accountSel,
      legacy ? h('p', { class: 'muted', style: 'margin-bottom:.75rem' }, 'Esta compra se registró sin detalle. Escribe una cantidad de productos para detallarla.') : null,
      legacyBox,
      h('div', { class: 'plines-scroll' }, headRow, linesBox),
      paidField,
      totalBox,
      ffield('Nota (opcional)', h('textarea', { class: 'textarea', name: 'description', rows: '2', maxlength: '500', placeholder: 'Ej. cupón usado, "los 2 pañuelos son aproximados"…' }, pur?.description || '')),
    ],
    onSave: async (el) => {
      const body = {
        date: el.date.value, description: el.description.value, order_number: el.order_number.value, arrival: el.arrival.value,
        account_id: el.account ? el.account.value : undefined,
      };
      if (rows.length) {
        body.total = totalPaid.value;
        body.lines = rows.map((r) => ({ id: r.id, name: r.name, variant: r.variant, type: r.type, price: r.price, qty: r.qty, sale_price: r.sale_price, price_source: r.price_source }));
      } else if (legacy) Object.assign(body, { items: el.items.value, cost: el.cost.value });
      else throw new Error('Escribe cuántos productos compraste');
      A.accounts = await call(pur ? `/api/admin/purchases/${pur.id}` : `/api/admin/accounts/${acc.id}/purchases`, { method: pur ? 'PUT' : 'POST', body });
      route(); toast('Compra guardada');
    },
    onDelete: pur ? async () => {
      A.accounts = await call(`/api/admin/purchases/${pur.id}`, { method: 'DELETE' });
      route(); toast('Compra eliminada');
    } : null,
  });
}

function accountCard(acc) {
  // Contraseña: se pide al servidor solo cuando la quieres ver o copiar.
  let revealed = null;
  const pwText = h('code', { class: 'pw' }, acc.has_password ? '••••••••' : 'Sin contraseña');
  const fetchPw = async () => (revealed ??= (await call(`/api/admin/accounts/${acc.id}/password`)).password);
  const toggle = h('button', {
    class: 'btn btn-small', type: 'button', hidden: !acc.has_password,
    onclick: async () => {
      if (toggle.dataset.open) { pwText.textContent = '••••••••'; delete toggle.dataset.open; toggle.textContent = 'Ver'; return; }
      try { pwText.textContent = await fetchPw(); toggle.dataset.open = '1'; toggle.textContent = 'Ocultar'; } catch (ex) { toast(ex.message); }
    },
  }, 'Ver');
  const copyPw = h('button', {
    class: 'btn btn-small', type: 'button', hidden: !acc.has_password,
    onclick: async () => { try { await copyText(await fetchPw(), 'Contraseña'); } catch (ex) { toast(ex.message); } },
  }, 'Copiar');

  const avg = acc.total_items ? acc.total_cost / acc.total_items : 0;

  return h('article', { class: 'acc' },
    h('div', { class: 'acc-head' },
      h('div', { class: 'acc-id' },
        h('p', { class: 'acc-email' }, acc.email,
          h('button', { class: 'link-btn', type: 'button', onclick: () => copyText(acc.email, 'Correo') }, 'Copiar')),
        h('div', { class: 'acc-pw' }, h('span', { class: 'muted' }, 'Contraseña:'), pwText, toggle, copyPw)),
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => openAccountEditor(acc) }, 'Editar')),
    acc.notes ? h('p', { class: 'note' }, acc.notes) : null,
    h('div', { class: 'acc-stats' },
      h('span', {}, h('strong', {}, plural(acc.total_items, 'unidad', 'unidades'))),
      h('span', {}, plural(acc.purchases.length, 'compra', 'compras')),
      h('span', {}, 'Gastado ', h('strong', {}, money(acc.total_cost))),
      acc.total_items ? h('span', { class: 'muted' }, `${money(avg)} por unidad`) : null),
    acc.purchases.length
      ? h('ul', { class: 'purchases' }, acc.purchases.map((p) => h('li', {},
        h('div', {},
          h('span', { class: 'pdate' }, dayLabel(p.date)), ' · ', plural(p.items, 'unidad', 'unidades'),
          p.order_number ? h('span', { class: 'muted' }, ` · ${p.order_number}`) : null,
          p.arrival ? h('span', { class: 'muted' }, ` · llega ${p.arrival}`) : null,
          p.lines.length ? h('ul', { class: 'plines-mini' }, p.lines.map((l) => h('li', {},
            `${l.qty} × ${l.name}`, l.variant ? h('span', { class: 'muted' }, ` (${l.variant})`) : null,
            h('span', { class: `kind kind-${l.kind}` }, l.type || (l.kind === 'accesorio' ? 'Accesorio' : 'Prenda')),
            h('span', { class: 'muted' }, ` ${money(l.price)} c/u`)))) : null,
          p.shipping ? h('span', { class: 'pdesc' }, `${p.shipping > 0 ? 'Envío e impuestos' : 'Descuentos'}: ${money(Math.abs(p.shipping))}`) : null,
          p.description ? h('span', { class: 'pdesc' }, p.description) : null),
        h('div', { class: 'pside' },
          h('strong', {}, money(p.cost)),
          h('button', { class: 'link-btn', type: 'button', onclick: () => openPurchaseEditor(acc, p) }, 'Editar')))))
      : h('p', { class: 'muted acc-empty' }, 'Aún no registraste compras con esta cuenta.'),
    h('button', { class: 'btn btn-small btn-dark', type: 'button', onclick: () => openPurchaseEditor(acc, null) }, 'Agregar compra'));
}

function accountsView() {
  const all = A.accounts;
  const totalItems = all.reduce((n, a) => n + a.total_items, 0);
  const totalCost = all.reduce((n, a) => n + a.total_cost, 0);
  const totalBuys = all.reduce((n, a) => n + a.purchases.length, 0);

  const list = h('div', {});
  const draw = () => {
    const q = norm(A.accQ);
    const items = all.filter((a) => !q || norm(`${a.email} ${a.notes}`).includes(q));
    list.replaceChildren(...(items.length ? items.map(accountCard)
      : [h('div', { class: 'empty-note box' },
        h('strong', {}, all.length ? 'Ninguna cuenta coincide' : 'Todavía no registraste cuentas'),
        all.length ? 'Prueba con otra parte del correo.' : 'Cada vez que crees una cuenta nueva, regístrala aquí con su correo y contraseña. Luego anota cada compra que hagas con ella.')]));
  };
  draw();

  const stat = (label, value) => h('div', { class: 'stat' }, h('span', { class: 'stat-v' }, value), h('span', { class: 'stat-l' }, label));

  return h('div', {},
    h('div', { class: 'panel-head' },
      h('h2', { class: 'title' }, 'Compras Shein'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openAccountEditor(null) }, 'Nueva cuenta')),
    h('p', { class: 'muted', style: 'margin-bottom:1rem' }, 'Registro privado de tus cuentas de proveedor y lo que compraste con cada una. Tus clientes no ven nada de esto.'),
    all.length ? h('div', { class: 'stats' },
      stat('Cuentas', all.length),
      stat('Compras', totalBuys),
      stat('Unidades compradas', totalItems),
      stat('Total gastado', money(totalCost)),
      totalItems ? stat('Costo por unidad', money(totalCost / totalItems)) : null) : null,
    all.length > 4 ? h('div', { style: 'margin-bottom:1rem' }, h('input', {
      class: 'input', type: 'search', placeholder: 'Buscar por correo o nota', 'aria-label': 'Buscar cuenta', value: A.accQ,
      oninput: (e) => { A.accQ = e.target.value; draw(); },
    })) : null,
    list);
}

// ------------------------------------------------------------------ mi tienda

function imageField({ value, onChange, wide, logo }) {
  let url = value || '';
  const prev = h('div', { class: `imgfield-prev${wide ? ' wide' : ''}` });
  const msg = h('p', { class: 'form-msg', role: 'alert' });
  const pick = h('button', { class: 'btn btn-small', type: 'button', onclick: () => file.click() });
  const remove = h('button', { class: 'btn btn-small btn-quiet', type: 'button', onclick: () => { url = ''; onChange(''); draw(); } }, 'Quitar');
  const file = h('input', {
    type: 'file', accept: 'image/*', class: 'sr-only', tabindex: '-1',
    onchange: async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      msg.textContent = 'Subiendo…';
      try { url = await uploadImage(f, logo ? { max: 800, logo: true } : { max: 1800 }); onChange(url); msg.textContent = ''; draw(); }
      catch (ex) { msg.textContent = ex.message; }
    },
  });
  function draw() {
    prev.replaceChildren(url ? h('img', { src: url, alt: '' }) : h('span', {}, 'Sin imagen'));
    pick.textContent = url ? 'Cambiar' : 'Subir imagen';
    remove.hidden = !url;
  }
  draw();
  return h('div', {}, h('div', { class: 'imgfield' }, prev, h('div', {}, pick, ' ', remove, file)), msg);
}

const SWATCHES = [['#892E54', 'Rosa Lumiere'], ['#B35C8A', 'Rosa empolvado'], ['#5C1336', 'Vino oscuro'], ['#2B0E1C', 'Casi negro'], ['#0F766E', 'Verde azulado'], ['#2B3FD6', 'Azul']];

function settingsView() {
  const s = A.settings;
  const draft = { logo: s.logo, hero_image: s.hero_image, accent: s.accent };

  const colorInput = h('input', { type: 'color', value: draft.accent.toLowerCase(), 'aria-label': 'Elegir otro color', oninput: (e) => setAccent(e.target.value.toUpperCase()) });
  const swatchEls = SWATCHES.map(([hex, name]) => h('button', {
    class: 'swatch', type: 'button', style: `background:${hex}`, 'aria-label': name, 'aria-pressed': 'false', onclick: () => setAccent(hex),
  }));
  function setAccent(hex) {
    draft.accent = hex;
    colorInput.value = hex.toLowerCase();
    swatchEls.forEach((b, i) => b.setAttribute('aria-pressed', String(SWATCHES[i][0] === hex)));
    applyAccent(hex);
  }
  setAccent(draft.accent);

  const msg = h('p', { class: 'form-msg', role: 'alert' });
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Guardar cambios');
  const field = (label, control, hint) => h('label', { class: 'field' }, h('span', { class: 'label' }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);

  const storeForm = h('form', {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const el = e.target.elements;
      msg.textContent = ''; msg.classList.remove('is-ok'); saveBtn.disabled = true; saveBtn.textContent = 'Guardando…';
      try {
        A.settings = await call('/api/admin/settings', {
          method: 'PUT',
          body: {
            store_name: el.store_name.value, tagline: el.tagline.value, currency: el.currency.value, whatsapp: el.whatsapp.value,
            instagram: el.instagram.value, shipping_note: el.shipping_note.value, hero_title: el.hero_title.value,
            hero_subtitle: el.hero_subtitle.value, accent: draft.accent, logo: draft.logo, hero_image: draft.hero_image,
          },
        });
        applyAccent(A.settings.accent);
        $('.admin-bar .name').textContent = A.settings.store_name;
        el.whatsapp.value = A.settings.whatsapp;
        toast('Cambios guardados');
      } catch (ex) { msg.textContent = ex.message; }
      saveBtn.disabled = false; saveBtn.textContent = 'Guardar cambios';
    },
  },
  h('div', { class: 'box' },
    h('h3', { class: 'sub' }, 'Datos de la tienda'),
    h('p', { class: 'muted' }, 'Lo que ven tus clientes en la cabecera, el pie y al enviar un pedido.'),
    field('Nombre de la tienda', h('input', { class: 'input', name: 'store_name', maxlength: '60', value: s.store_name })),
    field('Frase corta (opcional)', h('input', { class: 'input', name: 'tagline', maxlength: '120', value: s.tagline, placeholder: 'Ej. Ropa de diario, bien hecha' })),
    h('div', { class: 'grid2' },
      field('WhatsApp para recibir pedidos', h('input', { class: 'input', name: 'whatsapp', type: 'tel', inputmode: 'numeric', value: s.whatsapp, placeholder: '51987654321' }), 'Con código de país y sin el signo +. Perú empieza con 51.'),
      field('Símbolo de moneda', h('input', { class: 'input', name: 'currency', maxlength: '6', value: s.currency }), 'Ej. S/ o $')),
    field('Instagram (opcional)', h('input', { class: 'input', name: 'instagram', maxlength: '30', value: s.instagram, placeholder: 'tu_usuario' }), 'Solo el usuario, sin @'),
    field('Mensaje de envío y pago', h('textarea', { class: 'textarea', name: 'shipping_note', maxlength: '300', rows: '2' }, s.shipping_note), 'Aparece en cada prenda y en el pedido')),
  h('div', { class: 'box' },
    h('h3', { class: 'sub' }, 'Apariencia'),
    h('p', { class: 'muted' }, 'La portada es lo primero que ve la clienta.'),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Logo (opcional)'),
      imageField({ value: draft.logo, logo: true, onChange: (u) => { draft.logo = u; } }),
      h('span', { class: 'hint' }, 'Si no subes uno, se muestra el nombre de la tienda.')),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Color principal'),
      h('div', { class: 'swatches' }, swatchEls, colorInput)),
    field('Título de la portada', h('input', { class: 'input', name: 'hero_title', maxlength: '120', value: s.hero_title })),
    field('Texto bajo el título', h('textarea', { class: 'textarea', name: 'hero_subtitle', maxlength: '300', rows: '2' }, s.hero_subtitle)),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Foto de portada (opcional)'),
      imageField({ value: draft.hero_image, wide: true, onChange: (u) => { draft.hero_image = u; } }),
      h('span', { class: 'hint' }, 'Mejor vertical (la modelo de cuerpo entero). Si no subes una, la portada usa la foto de tu temporada actual o de una prenda destacada.'))),
  h('div', { class: 'savebar' }, saveBtn, h('a', { class: 'btn', href: '/', target: '_blank', rel: 'noopener' }, 'Ver mi tienda'), msg));

  // Contraseña
  const pwMsg = h('p', { class: 'form-msg', role: 'alert' });
  const pwForm = h('form', {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const el = e.target.elements;
      pwMsg.classList.remove('is-ok'); pwMsg.textContent = '';
      if (el.next.value !== el.again.value) { pwMsg.textContent = 'Las dos contraseñas nuevas no coinciden.'; return; }
      try {
        await call('/api/admin/password', { method: 'POST', body: { current: el.current.value, next: el.next.value } });
        e.target.reset(); pwMsg.classList.add('is-ok'); pwMsg.textContent = 'Contraseña actualizada.';
      } catch (ex) { pwMsg.textContent = ex.message; }
    },
  },
  h('div', { class: 'box' },
    h('h3', { class: 'sub' }, 'Contraseña'),
    h('p', { class: 'muted' }, 'Usa al menos 8 caracteres.'),
    field('Contraseña actual', h('input', { class: 'input', type: 'password', name: 'current', autocomplete: 'current-password' })),
    h('div', { class: 'grid2' },
      field('Contraseña nueva', h('input', { class: 'input', type: 'password', name: 'next', autocomplete: 'new-password', minlength: '8' })),
      field('Repite la nueva', h('input', { class: 'input', type: 'password', name: 'again', autocomplete: 'new-password' }))),
    pwMsg,
    h('button', { class: 'btn btn-dark', type: 'submit' }, 'Cambiar contraseña')));

  return h('div', {}, h('div', { class: 'panel-head' }, h('h2', { class: 'title' }, 'Mi tienda')), storeForm, pwForm, wipeForm());
}

// Borrar datos: para limpiar lo que se cargó de prueba y empezar de cero. Pide la contraseña y no se puede deshacer.
const WIPE = [
  ['pedidos', 'Pedidos', 'Todos los pedidos de la tienda. Las prendas de los pedidos no cancelados vuelven al stock.'],
  ['clientes', 'Clientes', 'Con su historial (notas, llamadas). También borra las campañas.'],
  ['campanas', 'Campañas', 'Solo las campañas; los clientes se quedan.'],
  ['ventas', 'Registro de ventas', 'Las ventas anotadas en Inventario y ventas.'],
  ['compras', 'Compras Shein', 'Cuentas, contraseñas guardadas, compras e inventario.'],
  ['prendas', 'Prendas de la tienda', 'Todas las prendas publicadas y sus fotos.'],
  ['categorias', 'Categorías', 'Las prendas que queden pasan a "Sin categoría".'],
  ['temporadas', 'Temporadas', 'Las prendas que queden pasan a "Sin temporada".'],
];

function wipeForm() {
  const msg = h('p', { class: 'form-msg', role: 'alert' });
  const btn = h('button', { class: 'btn btn-danger-dark', type: 'submit', disabled: true }, 'Borrar lo seleccionado');
  const sync = (form) => { btn.disabled = !WIPE.some(([k]) => form.elements[`w_${k}`].checked); };
  const form = h('form', {
    class: 'box danger-box', novalidate: true,
    onchange: (e) => sync(e.currentTarget),
    onsubmit: async (e) => {
      e.preventDefault();
      const el = e.target.elements;
      const parts = WIPE.map(([k]) => k).filter((k) => el[`w_${k}`].checked);
      msg.classList.remove('is-ok'); msg.textContent = '';
      if (el.wconfirm.value.trim().toUpperCase() !== 'BORRAR') { msg.textContent = 'Escribe BORRAR para confirmar.'; el.wconfirm.focus(); return; }
      if (!el.wpass.value) { msg.textContent = 'Escribe tu contraseña del panel.'; el.wpass.focus(); return; }
      btn.disabled = true; btn.textContent = 'Borrando…';
      try {
        const r = await call('/api/admin/wipe', { method: 'POST', body: { parts, password: el.wpass.value } });
        Object.assign(A, await (async () => {
          const [categories, seasons, products, orders, accounts] = await Promise.all([
            call('/api/admin/categories'), call('/api/admin/seasons'), call('/api/admin/products'), call('/api/admin/orders'), call('/api/admin/accounts')]);
          return { categories, seasons, products, orders, accounts };
        })());
        drawTabs();
        e.target.reset(); sync(e.target);
        const done = Object.entries(r.counts).map(([k, n]) => `${n} ${k}`).join(', ');
        msg.classList.add('is-ok'); msg.textContent = `Listo. Se borró: ${done}.`;
        toast('Datos borrados');
      } catch (ex) { msg.textContent = ex.message; }
      btn.textContent = 'Borrar lo seleccionado';
    },
  },
  h('h3', { class: 'sub' }, 'Borrar datos'),
  h('p', { class: 'muted' }, 'Para limpiar lo que cargaste de prueba y empezar de cero. Elige qué borrar. ', h('strong', {}, 'No se puede deshacer.')),
  h('div', { class: 'wipe-list' }, WIPE.map(([k, label, hint]) => h('label', { class: 'wipe-opt' },
    h('input', { type: 'checkbox', name: `w_${k}` }), h('span', {}, h('strong', {}, label), h('small', {}, hint))))),
  h('div', { class: 'grid2' },
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'Escribe BORRAR para confirmar'), h('input', { class: 'input', name: 'wconfirm', autocomplete: 'off', placeholder: 'BORRAR' })),
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'Tu contraseña del panel'), h('input', { class: 'input', type: 'password', name: 'wpass', autocomplete: 'current-password' }))),
  msg, btn);
  return form;
}

// ------------------------------------------------------------------ arranque

// Arranca cuando ya cargaron todos los scripts (crm.js y reports.js definen secciones del panel).
window.addEventListener('DOMContentLoaded', async function boot() {
  window.addEventListener('hashchange', route);
  try {
    await api('/api/admin/me'); // ¿ya hay sesión? Si no, va directo a la pantalla de entrada
    await start();
  } catch (e) {
    if (e.status === 401) { showLogin(); return; }
    root.replaceChildren(h('main', { class: 'login-wrap' }, h('div', { class: 'login' },
      h('h1', { class: 'display' }, 'No se pudo cargar'), h('p', { class: 'muted' }, e.message),
      h('button', { class: 'btn btn-dark', type: 'button', onclick: () => location.reload() }, 'Intentar de nuevo'))));
  }
});
