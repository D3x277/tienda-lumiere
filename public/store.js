'use strict';
// Tienda pública: catálogo, página de prenda, carrito y envío del pedido por WhatsApp.
// Depende de dom.js (h, api, fmtMoney, applyAccent, norm).

const CART_KEY = 'cart.v1';
const state = { settings: {}, categories: [], products: [], cat: '', q: '' };

// ------------------------------------------------------------------ carrito

let cart = loadCart();
let cartStage = 'cart'; // 'cart' | 'done'
let lastOrder = null;

function loadCart() {
  try {
    const list = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    return Array.isArray(list) ? list.filter((i) => i && Number.isInteger(i.id) && i.qty > 0) : [];
  } catch { return []; }
}

function saveCart() {
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* modo privado */ }
  updateBadge();
}

const money = (n) => fmtMoney(n, state.settings.currency || 'S/');
const productById = (id) => state.products.find((p) => p.id === id);
const cartLines = () => cart.map((item) => ({ item, product: productById(item.id) })).filter((l) => l.product);
const cartCount = () => cartLines().reduce((n, l) => n + l.item.qty, 0);

function addToCart({ id, size, color, qty }) {
  const same = cart.find((i) => i.id === id && i.size === size && i.color === color);
  if (same) same.qty = Math.min(20, same.qty + qty);
  else cart.push({ id, size, color, qty });
  saveCart();
}

function updateBadge() {
  const n = cartCount();
  $('#cart-count').textContent = n;
  $('#cart-count-sr').textContent = `Ver pedido, ${n} ${n === 1 ? 'prenda' : 'prendas'}`;
  $('#cart-btn').classList.toggle('has-items', n > 0);
}

// ------------------------------------------------------------------ piezas

function photo(src, alt) {
  return src ? h('img', { src, alt, loading: 'lazy', decoding: 'async' }) : h('span', { class: 'ph' }, 'Sin foto');
}

function priceTag(p, big) {
  return h('div', { class: `tag-wrap${big ? ' tag-big' : ''}${p.sold_out ? ' tag-off' : ''}` },
    h('div', { class: 'tag' },
      p.sold_out
        ? h('span', {}, 'Agotado')
        : [h('span', {}, money(p.price)),
          p.compare_price ? h('s', { class: 'tag-old' }, h('span', { class: 'sr-only' }, 'Precio anterior '), money(p.compare_price)) : null]));
}

function card(p) {
  const [first, second] = p.images;
  return h('a', { class: 'card', href: `#/p/${p.slug}` },
    h('div', { class: 'card-media' },
      h('div', { class: `card-img${p.sold_out ? ' is-off' : ''}` },
        photo(first, p.name),
        second ? h('img', { class: 'alt', src: second, alt: '', loading: 'lazy' }) : null),
      priceTag(p)),
    h('div', { class: 'card-info' },
      h('h3', { class: 'card-name' }, p.name),
      p.category_name ? h('p', { class: 'card-cat' }, p.category_name) : null));
}

// ------------------------------------------------------------------ inicio

function homeView() {
  const s = state.settings;
  const withPhoto = state.products.filter((p) => p.images.length);
  const picks = [...withPhoto.filter((p) => p.featured), ...withPhoto.filter((p) => !p.featured)].slice(0, 3);

  let visual = null;
  if (s.hero_image) visual = h('div', { class: 'hero-photo' }, h('img', { src: s.hero_image, alt: '' }));
  else if (picks.length) {
    visual = h('div', { class: 'rail' },
      picks.map((p) => h('a', { href: `#/p/${p.slug}`, 'aria-label': p.name }, h('img', { src: p.images[0], alt: '' }))));
  }

  const grid = h('div', { class: 'grid', id: 'grid' });
  const count = h('p', { class: 'count-note', 'aria-live': 'polite' });

  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Categorías' });
  const drawChips = () => {
    chips.replaceChildren(
      ...[{ slug: '', name: 'Todo' }, ...state.categories].map((c) =>
        h('button', {
          class: 'chip', type: 'button', 'aria-pressed': String(state.cat === c.slug),
          onclick: () => { state.cat = c.slug; drawChips(); drawGrid(); },
        }, c.name)));
  };

  const drawGrid = () => {
    const q = norm(state.q);
    const list = state.products.filter((p) =>
      (!state.cat || p.category_slug === state.cat) && (!q || norm(`${p.name} ${p.description}`).includes(q)));
    count.textContent = `${list.length} ${list.length === 1 ? 'prenda' : 'prendas'}`;
    if (list.length) grid.replaceChildren(...list.map(card));
    else {
      grid.replaceChildren(state.products.length
        ? h('div', { class: 'empty' }, h('strong', {}, 'No encontramos prendas con ese filtro'), 'Prueba con otra palabra o elige "Todo".')
        : h('div', { class: 'empty' }, h('strong', {}, 'Estamos preparando la tienda'), 'Muy pronto verás aquí las primeras prendas.'));
    }
  };

  const search = h('input', {
    class: 'input search', type: 'search', placeholder: 'Buscar una prenda', 'aria-label': 'Buscar una prenda', value: state.q,
    oninput: (e) => { state.q = e.target.value; drawGrid(); },
  });

  drawChips();
  drawGrid();

  return h('div', {},
    h('section', { class: 'wrap hero' },
      h('div', { class: 'hero-copy' },
        h('h1', {}, s.hero_title),
        s.hero_subtitle ? h('p', {}, s.hero_subtitle) : null,
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => $('#catalogo').scrollIntoView({ behavior: 'smooth' }) }, 'Ver las prendas')),
      visual),
    h('section', { class: 'wrap', id: 'catalogo' },
      h('div', { class: 'catalog-head' }, h('h2', {}, 'Prendas'), count),
      h('div', { class: 'toolbar' }, state.categories.length ? chips : null, search),
      grid));
}

// ------------------------------------------------------------------ una prenda

function productView(slug) {
  const p = state.products.find((x) => x.slug === slug);
  if (!p) {
    document.title = state.settings.store_name;
    return h('section', { class: 'wrap notice' },
      h('h1', {}, 'Esa prenda ya no está disponible'),
      h('p', {}, 'Puede que se haya agotado o que la dirección haya cambiado.'),
      h('a', { class: 'btn btn-dark', href: '#/' }, 'Ver todas las prendas'));
  }
  document.title = `${p.name} · ${state.settings.store_name}`;

  let size = '', color = '', qty = 1;
  const maxQty = p.low_stock || 10;

  // Galería
  const main = h('div', { class: 'gallery-main' }, photo(p.images[0], p.name));
  const thumbs = p.images.length > 1
    ? h('div', { class: 'thumbs' }, p.images.map((src, i) =>
      h('button', {
        class: 'thumb', type: 'button', 'aria-label': `Ver foto ${i + 1}`, 'aria-current': String(i === 0),
        onclick: (e) => {
          main.replaceChildren(photo(src, p.name));
          thumbs.querySelectorAll('.thumb').forEach((t) => t.setAttribute('aria-current', 'false'));
          e.currentTarget.setAttribute('aria-current', 'true');
        },
      }, h('img', { src, alt: '' }))))
    : null;

  // Tallas y colores
  const group = (label, values, onPick) => {
    const picked = h('span', { class: 'opt-picked' });
    const buttons = values.map((v) => h('button', {
      class: 'opt', type: 'button', 'aria-pressed': 'false',
      onclick: () => {
        onPick(v); picked.textContent = v;
        buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === v)));
        msg.textContent = '';
      },
    }, v));
    return h('div', { class: 'opt-group' }, h('p', { class: 'opt-label' }, label, ' ', picked), h('div', { class: 'opts' }, buttons));
  };

  const msg = h('p', { class: 'form-msg', role: 'alert' });
  const out = h('output', {}, '1');
  const minus = h('button', { type: 'button', 'aria-label': 'Una menos', disabled: true, onclick: () => setQty(qty - 1) }, '−');
  const plus = h('button', { type: 'button', 'aria-label': 'Una más', disabled: maxQty <= 1, onclick: () => setQty(qty + 1) }, '+');
  const setQty = (n) => {
    qty = Math.max(1, Math.min(maxQty, n));
    out.textContent = qty; minus.disabled = qty <= 1; plus.disabled = qty >= maxQty;
  };

  const add = () => {
    if (p.sizes.length && !size) { msg.textContent = 'Elige una talla para continuar.'; return; }
    if (p.colors.length && !color) { msg.textContent = 'Elige un color para continuar.'; return; }
    addToCart({ id: p.id, size, color, qty });
    openCart();
  };

  const related = state.products.filter((x) => x.id !== p.id && p.category_id && x.category_id === p.category_id).slice(0, 4);

  return h('div', { class: 'wrap' },
    h('a', { class: 'back', href: '#/' }, 'Volver a la tienda'),
    h('article', { class: 'pdp' },
      h('div', {}, main, thumbs),
      h('div', { class: 'pdp-info' },
        p.category_name ? h('p', { class: 'pdp-cat' }, p.category_name) : null,
        h('h1', {}, p.name),
        priceTag(p, true),
        p.description ? h('p', { class: 'pdp-desc' }, p.description) : null,
        p.sizes.length ? group('Talla', p.sizes, (v) => { size = v; }) : null,
        p.colors.length ? group('Color', p.colors, (v) => { color = v; }) : null,
        p.sold_out
          ? h('p', { class: 'stock-note' }, 'Esta prenda está agotada por ahora.')
          : [
            msg,
            h('div', { class: 'buy-row' },
              h('div', { class: 'stepper', role: 'group', 'aria-label': 'Cantidad' }, minus, out, plus),
              h('button', { class: 'btn btn-primary', type: 'button', onclick: add }, 'Agregar a mi pedido')),
            p.low_stock ? h('p', { class: 'stock-note' }, `Quedan solo ${p.low_stock}.`) : null,
          ],
        state.settings.shipping_note ? h('p', { class: 'ship-note' }, state.settings.shipping_note) : null,
        h('p', { class: 'ship-note' }, 'Paga con Yape, Plin, transferencia o tarjeta de crédito.'))),
    related.length
      ? h('section', { class: 'related' }, h('h2', {}, `Más de ${p.category_name}`), h('div', { class: 'grid' }, related.map(card)))
      : null);
}

// ------------------------------------------------------------------ carrito (panel)

const cartDialog = () => $('#cart');

function openCart() {
  cartStage = 'cart';
  renderCart();
  if (!cartDialog().open) cartDialog().showModal();
}

function closeCart() { cartDialog().close(); }

function renderCart() {
  const dlg = cartDialog();
  const head = h('div', { class: 'drawer-head' },
    h('h2', { id: 'cart-title' }, cartStage === 'done' ? 'Pedido registrado' : 'Mi pedido'),
    h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: closeCart }, 'Cerrar'));
  dlg.replaceChildren(head, h('div', { class: 'drawer-body' }, cartStage === 'done' ? doneView() : cartView()));
}

function cartView() {
  const lines = cartLines();
  if (!lines.length) {
    return h('div', { class: 'drawer-empty' },
      h('p', {}, 'Tu pedido está vacío. Elige una prenda y toca "Agregar a mi pedido".'),
      h('button', { class: 'btn btn-dark', type: 'button', onclick: () => { closeCart(); location.hash = '#/'; } }, 'Ver las prendas'));
  }

  const total = lines.reduce((sum, l) => sum + l.product.price * l.item.qty, 0);
  const hasSoldOut = lines.some((l) => l.product.sold_out);

  const changeQty = (item, n) => {
    item.qty = Math.max(1, Math.min(20, n));
    saveCart(); renderCart();
  };
  const remove = (item) => { cart = cart.filter((i) => i !== item); saveCart(); renderCart(); };

  const rows = lines.map(({ item, product: p }) => h('div', { class: 'line' },
    h('div', { class: 'line-img' }, photo(p.images[0], p.name)),
    h('div', {},
      h('p', { class: 'line-name' }, p.name),
      h('p', { class: 'line-variant' }, [item.size, item.color].filter(Boolean).join(' · ')),
      p.sold_out ? h('p', { class: 'line-warn' }, 'Agotada. Quítala para continuar.') : null,
      h('div', { class: 'stepper', role: 'group', 'aria-label': `Cantidad de ${p.name}` },
        h('button', { type: 'button', 'aria-label': 'Una menos', disabled: item.qty <= 1, onclick: () => changeQty(item, item.qty - 1) }, '−'),
        h('output', {}, String(item.qty)),
        h('button', { type: 'button', 'aria-label': 'Una más', onclick: () => changeQty(item, item.qty + 1) }, '+'))),
    h('div', { class: 'line-side' },
      h('span', {}, money(p.price * item.qty)),
      h('button', { class: 'link-btn', type: 'button', onclick: () => remove(item) }, 'Quitar'))));

  const err = h('p', { class: 'form-msg', role: 'alert' });
  const sendLabel = () => (payWith === 'tarjeta' ? 'Enviar pedido y pagar con tarjeta' : 'Enviar pedido por WhatsApp');
  const send = h('button', { class: 'btn btn-primary btn-block', type: 'submit', disabled: hasSoldOut }, 'Enviar pedido por WhatsApp');

  // Forma de pago. Con tarjeta: sí se puede; el enlace de pago se coordina por WhatsApp.
  let payWith = 'transferencia';
  const cardNote = h('div', { class: 'pay-note', hidden: true, role: 'status' },
    h('strong', {}, '¡Sí puedes pagar con tarjeta de crédito o débito!'),
    h('p', {}, 'Envía tu pedido y escríbenos por WhatsApp: te mandamos un enlace de pago seguro para completar la compra.'),
    state.settings.whatsapp ? h('a', {
      class: 'btn btn-small', target: '_blank', rel: 'noopener',
      href: `https://wa.me/${state.settings.whatsapp}?text=${encodeURIComponent(`Hola, quiero comprar y pagar con tarjeta de crédito: ${lines.map((l) => `${l.item.qty} × ${l.product.name}`).join(', ')}. Total ${money(total)}.`)}`,
    }, 'Preguntar por WhatsApp') : null);
  const payOption = (value, title, hint) => h('label', { class: 'pay-opt' },
    h('input', {
      type: 'radio', name: 'payment_method', value, checked: value === payWith,
      onchange: () => { payWith = value; cardNote.hidden = value !== 'tarjeta'; send.textContent = sendLabel(); },
    }),
    h('span', {}, h('strong', {}, title), h('small', {}, hint)));
  const payBox = h('fieldset', { class: 'pay' },
    h('legend', {}, '¿Cómo quieres pagar?'),
    payOption('transferencia', 'Yape, Plin o transferencia', 'Te enviamos los datos por WhatsApp'),
    payOption('tarjeta', 'Tarjeta de crédito o débito', 'Visa, Mastercard y más, con enlace de pago'),
    cardNote);

  const form = h('form', {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const name = String(f.get('name') || '').trim();
      if (!name) { err.textContent = 'Escribe tu nombre para registrar el pedido.'; e.target.elements.name.focus(); return; }
      err.textContent = '';
      send.disabled = true; send.textContent = 'Enviando…';
      try {
        lastOrder = await api('/api/orders', {
          method: 'POST',
          body: {
            name, phone: f.get('phone'), email: f.get('email'), notes: f.get('notes'), opt_in: f.get('opt_in') === 'on',
            payment_method: payWith,
            items: cart.map(({ id, size, color, qty }) => ({ id, size, color, qty })),
          },
        });
        cart = []; saveCart();
        cartStage = 'done'; renderCart();
        loadProducts(); // el stock cambió
      } catch (ex) {
        err.textContent = ex.message;
        send.disabled = hasSoldOut; send.textContent = sendLabel();
        if (ex.status === 409) loadProducts().then(renderCart);
      }
    },
  },
  h('label', { class: 'field' }, h('span', { class: 'label' }, 'Tu nombre'), h('input', { class: 'input', name: 'name', autocomplete: 'name', maxlength: '80', required: true })),
  h('label', { class: 'field' }, h('span', { class: 'label' }, 'Celular (opcional)'), h('input', { class: 'input', name: 'phone', type: 'tel', autocomplete: 'tel', maxlength: '30', placeholder: '987 654 321' })),
  h('label', { class: 'field' }, h('span', { class: 'label' }, 'Correo (opcional)'), h('input', { class: 'input', name: 'email', type: 'email', autocomplete: 'email', maxlength: '120' })),
  h('label', { class: 'field' }, h('span', { class: 'label' }, 'Notas (opcional)'), h('textarea', { class: 'textarea', name: 'notes', rows: '2', maxlength: '500', placeholder: 'Distrito de entrega, hora, dudas…' })),
  h('label', { class: 'consent' }, h('input', { type: 'checkbox', name: 'opt_in' }),
    h('span', {}, `Quiero recibir novedades y ofertas de ${state.settings.store_name} por WhatsApp. Puedo darme de baja cuando quiera.`)),
  payBox,
  err, send,
  state.settings.shipping_note ? h('p', { class: 'fine' }, state.settings.shipping_note) : null);

  return h('div', {}, rows,
    h('div', { class: 'total-row' }, h('span', {}, 'Total'), h('strong', {}, money(total))),
    h('h3', {}, 'Tus datos'), form);
}

function doneView() {
  const o = lastOrder;
  return h('div', { class: 'done' },
    h('h3', {}, o.whatsapp_url ? 'Falta un paso: envíalo por WhatsApp' : 'Recibimos tu pedido'),
    h('p', { class: 'code' }, `Pedido ${o.code}`),
    h('p', {}, o.whatsapp_url
      ? 'Tu pedido ya quedó guardado. Toca el botón para abrir WhatsApp con el detalle listo y envíalo; así lo confirmamos contigo.'
      : 'Te contactaremos pronto para confirmar el pago y la entrega.'),
    o.payment_method === 'tarjeta'
      ? h('p', { class: 'pay-note' }, h('strong', {}, 'Pago con tarjeta: '), 'en WhatsApp te enviamos el enlace de pago seguro para tu tarjeta de crédito o débito.')
      : null,
    o.whatsapp_url ? h('a', { class: 'btn btn-primary btn-block', href: o.whatsapp_url, target: '_blank', rel: 'noopener' }, 'Abrir WhatsApp') : null,
    h('button', { class: 'btn btn-block', type: 'button', onclick: () => { closeCart(); location.hash = '#/'; } }, 'Seguir viendo prendas'));
}

// ------------------------------------------------------------------ arranque

let view = '', homeScroll = 0;

function render() {
  const app = $('#app');
  const m = location.hash.match(/^#\/p\/([^/?#]+)/);
  if (view === 'home') homeScroll = window.scrollY;
  if (m) {
    view = 'product';
    app.replaceChildren(productView(decodeURIComponent(m[1])));
    window.scrollTo(0, 0);
  } else {
    view = 'home';
    document.title = state.settings.store_name;
    app.replaceChildren(homeView());
    window.scrollTo(0, homeScroll);
  }
}

function drawChrome() {
  const s = state.settings;
  applyAccent(s.accent);
  $('#brand').replaceChildren(s.logo ? h('img', { src: s.logo, alt: s.store_name }) : s.store_name);
  const links = [];
  if (s.instagram) links.push(h('li', {}, h('a', { href: `https://instagram.com/${s.instagram}`, target: '_blank', rel: 'noopener' }, `Instagram @${s.instagram}`)));
  if (s.whatsapp) links.push(h('li', {}, h('a', { href: `https://wa.me/${s.whatsapp}`, target: '_blank', rel: 'noopener' }, 'WhatsApp')));
  $('#footer').replaceChildren(h('div', { class: 'wrap' },
    h('div', {}, h('strong', {}, s.store_name), s.tagline ? h('p', {}, s.tagline) : null),
    links.length ? h('ul', {}, links) : null));
}

async function loadProducts() {
  state.products = await api('/api/products');
}

async function boot() {
  try {
    const [store, products] = await Promise.all([api('/api/store'), api('/api/products')]);
    state.settings = store.settings;
    state.categories = store.categories;
    state.products = products;
  } catch (e) {
    $('#app').replaceChildren(h('section', { class: 'wrap notice' },
      h('h1', {}, 'No pudimos cargar la tienda'), h('p', {}, e.message),
      h('button', { class: 'btn btn-dark', type: 'button', onclick: () => location.reload() }, 'Intentar de nuevo')));
    return;
  }
  drawChrome();
  updateBadge();
  window.addEventListener('hashchange', render);
  $('#cart-btn').addEventListener('click', openCart);
  cartDialog().addEventListener('click', (e) => { if (e.target === cartDialog()) closeCart(); }); // clic en el fondo
  render();
}

boot();
