'use strict';
// Tienda pública: portada por secciones (categorías, nuevos ingresos, temporadas), catálogo,
// página de prenda, favoritos y carrito con envío del pedido por WhatsApp.
// Depende de dom.js (h, $, api, fmtMoney, applyAccent, norm).

const CART_KEY = 'cart.v1';
const FAV_KEY = 'fav.v1';
const NEW_DAYS = 21; // una prenda lleva la etiqueta "Nuevo" durante estos días
const state = { settings: {}, categories: [], seasons: [], products: [] };

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
  $('#cart-count-sr').textContent = `Ver mi carrito, ${n} ${n === 1 ? 'prenda' : 'prendas'}`;
  $('#cart-btn').classList.toggle('has-items', n > 0);
}

// ------------------------------------------------------------------ favoritos (solo en este navegador)

let favs = loadFavs();

function loadFavs() {
  try {
    const list = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
    return new Set(Array.isArray(list) ? list.filter(Number.isInteger) : []);
  } catch { return new Set(); }
}

function toggleFav(id) {
  if (favs.has(id)) favs.delete(id); else favs.add(id);
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...favs])); } catch { /* modo privado */ }
  document.querySelectorAll(`[data-fav="${id}"]`).forEach(syncFav);
}

function syncFav(b) {
  const on = favs.has(Number(b.dataset.fav));
  b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', on ? `Quitar ${b.dataset.name} de favoritos` : `Guardar ${b.dataset.name} en favoritos`);
}

function favButton(p, extra = '') {
  const b = h('button', {
    class: `fav ${extra}`, type: 'button', 'data-fav': p.id, 'data-name': p.name,
    onclick: (e) => { e.preventDefault(); toggleFav(p.id); },
  });
  syncFav(b);
  return b;
}

// ------------------------------------------------------------------ piezas

const isNew = (p) => {
  const t = Date.parse(`${String(p.created_at || '').replace(' ', 'T')}Z`);
  return Number.isFinite(t) && Date.now() - t < NEW_DAYS * 864e5;
};

function photo(src, alt) {
  return src ? h('img', { src, alt, loading: 'lazy', decoding: 'async' }) : h('span', { class: 'ph' }, 'Sin foto');
}

const arrow = () => h('span', { class: 'arrow', 'aria-hidden': 'true' });
const pill = (href, text) => h('a', { class: 'btn-pill', href }, text, arrow());

function priceLine(p, big) {
  return h('p', { class: `price${big ? ' price-big' : ''}` },
    p.sold_out ? h('span', { class: 'price-off' }, 'Agotado') : money(p.price),
    p.compare_price && !p.sold_out
      ? h('s', { class: 'price-old' }, h('span', { class: 'sr-only' }, 'Precio anterior '), money(p.compare_price))
      : null);
}

function badge(p) {
  if (p.sold_out) return h('span', { class: 'badge badge-off' }, 'Agotado');
  if (p.compare_price && p.compare_price > p.price) return h('span', { class: 'badge badge-sale' }, `-${Math.round((1 - p.price / p.compare_price) * 100)}%`);
  if (isNew(p)) return h('span', { class: 'badge' }, 'Nuevo');
  return null;
}

function card(p) {
  const [first, second] = p.images;
  return h('article', { class: 'card' },
    h('div', { class: `card-img${p.sold_out ? ' is-off' : ''}` },
      photo(first, ''),
      second ? h('img', { class: 'alt', src: second, alt: '', loading: 'lazy' }) : null,
      badge(p)),
    favButton(p),
    h('div', { class: 'card-info' },
      h('h3', { class: 'card-name' }, h('a', { href: `#/p/${p.slug}` }, p.name)),
      priceLine(p)));
}

function grid(list, empty) {
  return list.length ? h('div', { class: 'grid' }, list.map(card)) : empty;
}

// Título de sección con moño y líneas o destellos, como en el diseño.
function secHead({ title, kicker, style = 'lines', tag = 'h2' }) {
  return h('div', { class: `sec-head sec-${style}` },
    h('span', { class: 'bow', 'aria-hidden': 'true' }),
    h(tag, {}, title),
    kicker ? h('p', { class: 'kicker' }, kicker) : null);
}

const emptyBox = (title, text, action) => h('div', { class: 'empty' }, h('strong', {}, title), h('p', {}, text), action || null);

const catImage = (c) => c.image || state.products.find((p) => p.category_id === c.id && p.images.length)?.images[0];
const seasonImage = (x) => x.image || state.products.find((p) => p.season_id === x.id && p.images.length)?.images[0];

// ------------------------------------------------------------------ inicio

function homeView() {
  const s = state.settings;
  const [current, ...older] = state.seasons;
  const withPhoto = state.products.filter((p) => p.images.length);
  const heroSrc = s.hero_image || (current && current.image) || (withPhoto.find((p) => p.featured) || withPhoto[0])?.images[0];

  const hero = h('section', { class: 'hero' },
    h('div', { class: 'wrap hero-in' },
      h('div', { class: 'hero-copy' },
        h('span', { class: 'sparkle', 'aria-hidden': 'true' }),
        h('h1', {}, s.hero_title),
        h('span', { class: 'bow-line', 'aria-hidden': 'true' }),
        s.hero_subtitle ? h('p', {}, s.hero_subtitle) : null,
        pill('#/tienda', 'Ver colección')),
      h('div', { class: 'hero-media' },
        h('div', { class: 'arch' }, heroSrc ? h('img', { src: heroSrc, alt: '', fetchpriority: 'high' }) : null))));

  const perks = h('section', { class: 'perks', 'aria-label': 'Por qué comprar en Lumiere' },
    h('ul', { class: 'wrap' },
      [['truck', 'Envíos a todo el Perú'], ['lock', 'Compra segura'], ['heart', 'Atención personalizada']].map(([icon, text]) =>
        h('li', {}, h('span', { class: `ico ico-${icon}`, 'aria-hidden': 'true' }), text))));

  const cats = state.categories.length
    ? h('section', { class: 'wrap sec reveal', 'aria-label': 'Explora por categoría' },
      secHead({ title: 'Explora por categoría' }),
      h('ul', { class: 'cats' }, state.categories.map((c) => {
        const src = catImage(c);
        return h('li', {}, h('a', { class: 'cat', href: `#/c/${c.slug}` },
          h('span', { class: 'cat-img' }, src ? h('img', { src, alt: '', loading: 'lazy' }) : null),
          h('span', { class: 'cat-name' }, c.name)));
      })))
    : null;

  const fresh = state.products.slice(0, 8);
  const arrivals = h('section', { class: 'wrap sec reveal', id: 'nuevos' },
    secHead({ title: 'Nuevos ingresos', kicker: 'Descubre lo más reciente', style: 'sparkles' }),
    grid(fresh, emptyBox('Estamos preparando la tienda', 'Muy pronto verás aquí los primeros outfits.')),
    state.products.length ? h('div', { class: 'center' }, pill('#/tienda', 'Ver todas las prendas')) : null);

  let seasonFeature = null, seasonList = null;
  if (current) {
    const src = seasonImage(current);
    seasonFeature = h('section', { class: 'season-feature reveal' },
      h('div', { class: 'wrap season-in' },
        h('a', { class: 'season-media', href: `#/temporada/${current.slug}`, tabindex: '-1', 'aria-hidden': 'true' },
          src ? h('img', { src, alt: '', loading: 'lazy' }) : null),
        h('div', { class: 'season-copy' },
          h('span', { class: 'sparkle', 'aria-hidden': 'true' }),
          h('p', { class: 'kicker' }, 'Nueva temporada'),
          h('h2', {}, current.name),
          current.description ? h('p', { class: 'season-desc' }, current.description) : null,
          h('p', { class: 'season-count' }, `${current.count} ${current.count === 1 ? 'outfit nuevo' : 'outfits nuevos'}`),
          pill(`#/temporada/${current.slug}`, 'Ver temporada'))));
  }
  if (older.length) {
    seasonList = h('section', { class: 'wrap sec reveal' },
      secHead({ title: 'Temporadas', kicker: 'Cada temporada, nuevos outfits', style: 'sparkles' }),
      h('ul', { class: 'seasons' }, older.map((x) => {
        const src = seasonImage(x);
        return h('li', {}, h('a', { class: 'season-card', href: `#/temporada/${x.slug}` },
          h('span', { class: 'season-card-img' }, src ? h('img', { src, alt: '', loading: 'lazy' }) : null),
          h('span', { class: 'season-card-name' }, x.name),
          h('span', { class: 'season-card-count' }, `${x.count} ${x.count === 1 ? 'prenda' : 'prendas'}`)));
      })));
  }

  return h('div', {}, hero, perks, cats, arrivals, seasonFeature, seasonList, aboutTeaser());
}

// ------------------------------------------------------------------ nosotros

const aboutParas = () => String(state.settings.about_text || '').split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean);
const aboutImage = () => {
  const s = state.settings;
  return s.about_image || s.hero_image || state.products.find((p) => p.featured && p.images.length)?.images[0] || state.products.find((p) => p.images.length)?.images[0];
};

function aboutTeaser() {
  const paras = aboutParas();
  if (!paras.length) return null;
  const src = aboutImage();
  return h('section', { class: 'about-teaser reveal' },
    h('div', { class: 'wrap about-in' },
      h('div', { class: 'about-media' }, src ? h('img', { src, alt: '', loading: 'lazy' }) : null),
      h('div', { class: 'about-copy' },
        h('span', { class: 'bow', 'aria-hidden': 'true' }),
        h('p', { class: 'kicker' }, 'Nosotros'),
        h('h2', {}, state.settings.about_title || 'Nosotros'),
        h('p', { class: 'about-lead' }, paras[0]),
        pill('#/nosotros', 'Conoce más'))));
}

function aboutView() {
  const s = state.settings;
  const paras = aboutParas();
  if (!paras.length) return missing('Pronto te contaremos nuestra historia', 'Mientras tanto, mira los nuevos ingresos.');
  document.title = `Nosotros · ${s.store_name}`;
  const src = aboutImage();
  return h('div', {},
    h('section', { class: 'season-hero about-hero' },
      h('div', { class: 'wrap season-in' },
        h('div', { class: 'season-media' }, src ? h('img', { src, alt: '' }) : null),
        h('div', { class: 'season-copy' },
          h('span', { class: 'sparkle', 'aria-hidden': 'true' }),
          h('p', { class: 'kicker' }, 'Nosotros'),
          h('h1', {}, s.about_title || 'Nosotros'),
          h('span', { class: 'bow-line', 'aria-hidden': 'true' })))),
    h('section', { class: 'wrap about-body reveal' },
      paras.map((t, i) => h('p', { class: i === 0 ? 'about-lead' : '' }, t)),
      h('ul', { class: 'pdp-perks about-perks' },
        h('li', {}, h('span', { class: 'ico ico-truck', 'aria-hidden': 'true' }), 'Envíos a todo el Perú'),
        h('li', {}, h('span', { class: 'ico ico-lock', 'aria-hidden': 'true' }), 'Compra segura con Yape, Plin o transferencia'),
        h('li', {}, h('span', { class: 'ico ico-heart', 'aria-hidden': 'true' }), 'Atención personalizada por WhatsApp')),
      h('div', { class: 'center' }, pill('#/tienda', 'Ver la colección'))));
}

// ------------------------------------------------------------------ listados (tienda, categoría, temporada, favoritos)

// pool: prendas de esta página. Encima se puede filtrar por categoría/temporada y buscar.
function listView({ title, kicker, pool, banner, filterCats = true, filterSeasons = false, empty }) {
  let cat = '', season = '', q = '';
  const box = h('div', {});
  const count = h('p', { class: 'count-note', 'aria-live': 'polite' });

  const chipGroup = (label, options, get, set) => {
    if (options.length < 2) return null;
    const wrap = h('div', { class: 'chips', role: 'group', 'aria-label': label });
    const draw = () => wrap.replaceChildren(...[{ slug: '', name: 'Todo' }, ...options].map((o) =>
      h('button', { class: 'chip', type: 'button', 'aria-pressed': String(get() === o.slug), onclick: () => { set(o.slug); draw(); drawGrid(); } }, o.name)));
    draw();
    return wrap;
  };

  const cats = filterCats ? state.categories.filter((c) => pool.some((p) => p.category_id === c.id)) : [];
  const seasons = filterSeasons ? state.seasons.filter((x) => pool.some((p) => p.season_id === x.id)) : [];

  const drawGrid = () => {
    const nq = norm(q);
    const list = pool.filter((p) => (!cat || p.category_slug === cat) && (!season || p.season_slug === season)
      && (!nq || norm(`${p.name} ${p.description} ${p.category_name || ''}`).includes(nq)));
    count.textContent = `${list.length} ${list.length === 1 ? 'prenda' : 'prendas'}`;
    box.replaceChildren(grid(list, pool.length
      ? emptyBox('No encontramos prendas con ese filtro', 'Prueba con otra palabra o elige "Todo".')
      : empty));
  };

  const search = pool.length > 4 ? h('input', {
    class: 'input search', type: 'search', placeholder: 'Buscar una prenda', 'aria-label': 'Buscar una prenda',
    oninput: (e) => { q = e.target.value; drawGrid(); },
  }) : null;

  const tools = [chipGroup('Categorías', cats, () => cat, (v) => { cat = v; }), chipGroup('Temporadas', seasons, () => season, (v) => { season = v; }), search].filter(Boolean);
  drawGrid();

  return h('div', {},
    banner || null,
    h('section', { class: 'wrap sec list' },
      banner ? null : secHead({ title, kicker, style: 'sparkles', tag: 'h1' }),
      h('div', { class: 'list-meta' }, h('a', { class: 'back', href: '#/' }, 'Inicio'), count),
      tools.length ? h('div', { class: 'toolbar' }, tools) : null,
      box));
}

function seasonView(slug) {
  const x = state.seasons.find((s) => s.slug === slug);
  if (!x) return missing('Esa temporada ya no está disponible', 'Puede que haya terminado. Mira los nuevos ingresos.');
  document.title = `${x.name} · ${state.settings.store_name}`;
  const src = seasonImage(x);
  const banner = h('section', { class: 'season-hero' },
    h('div', { class: 'wrap season-in' },
      h('div', { class: 'season-media' }, src ? h('img', { src, alt: '' }) : null),
      h('div', { class: 'season-copy' },
        h('span', { class: 'sparkle', 'aria-hidden': 'true' }),
        h('p', { class: 'kicker' }, x === state.seasons[0] ? 'Nueva temporada' : 'Temporada'),
        h('h1', {}, x.name),
        x.description ? h('p', { class: 'season-desc' }, x.description) : null)));
  return listView({ pool: state.products.filter((p) => p.season_id === x.id), banner, empty: emptyBox('Pronto llegan los outfits', 'Esta temporada aún no tiene prendas.') });
}

function missing(title, text) {
  document.title = state.settings.store_name;
  return h('section', { class: 'wrap notice' }, h('h1', {}, title), h('p', {}, text), pill('#/', 'Volver al inicio'));
}

// ------------------------------------------------------------------ una prenda

function productView(slug) {
  const p = state.products.find((x) => x.slug === slug);
  if (!p) return missing('Esa prenda ya no está disponible', 'Puede que se haya agotado o que la dirección haya cambiado.');
  document.title = `${p.name} · ${state.settings.store_name}`;

  let size = '', color = '', qty = 1;
  const maxQty = p.low_stock || 10;

  // Galería
  const main = h('div', { class: 'gallery-main' }, photo(p.images[0], p.name), badge(p), favButton(p, 'fav-lg'));
  const thumbs = p.images.length > 1
    ? h('div', { class: 'thumbs' }, p.images.map((src, i) =>
      h('button', {
        class: 'thumb', type: 'button', 'aria-label': `Ver foto ${i + 1}`, 'aria-current': String(i === 0),
        onclick: (e) => {
          main.querySelector('img:not(.alt), .ph')?.replaceWith(photo(src, p.name));
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
  const crumbs = [h('a', { href: '#/' }, 'Inicio')];
  if (p.category_slug) crumbs.push(h('a', { href: `#/c/${p.category_slug}` }, p.category_name));

  return h('div', { class: 'wrap' },
    h('nav', { class: 'crumbs', 'aria-label': 'Estás en' }, crumbs),
    h('article', { class: 'pdp' },
      h('div', { class: 'gallery' }, main, thumbs),
      h('div', { class: 'pdp-info' },
        h('div', { class: 'pdp-tags' },
          p.season_slug ? h('a', { class: 'pdp-season', href: `#/temporada/${p.season_slug}` }, p.season_name) : null,
          p.category_name ? h('span', { class: 'pdp-cat' }, p.category_name) : null),
        h('h1', {}, p.name),
        priceLine(p, true),
        h('span', { class: 'bow-line', 'aria-hidden': 'true' }),
        p.description ? h('p', { class: 'pdp-desc' }, p.description) : null,
        p.sizes.length ? group('Talla', p.sizes, (v) => { size = v; }) : null,
        p.colors.length ? group('Color', p.colors, (v) => { color = v; }) : null,
        p.sold_out
          ? h('p', { class: 'stock-note' }, 'Esta prenda está agotada por ahora.')
          : [
            msg,
            h('div', { class: 'buy-row' },
              h('div', { class: 'stepper', role: 'group', 'aria-label': 'Cantidad' }, minus, out, plus),
              h('button', { class: 'btn-pill btn-buy', type: 'button', onclick: add }, 'Agregar al carrito')),
            p.low_stock ? h('p', { class: 'stock-note' }, `¡Quedan solo ${p.low_stock}!`) : null,
          ],
        h('ul', { class: 'pdp-perks' },
          h('li', {}, h('span', { class: 'ico ico-truck', 'aria-hidden': 'true' }), state.settings.shipping_note || 'Envíos a todo el Perú.'),
          h('li', {}, h('span', { class: 'ico ico-lock', 'aria-hidden': 'true' }), 'Paga con Yape, Plin o transferencia.')))),
    related.length
      ? h('section', { class: 'sec related reveal' }, secHead({ title: `Más ${p.category_name}`, style: 'sparkles' }), grid(related))
      : null);
}

// ------------------------------------------------------------------ menú lateral

const menuDialog = () => $('#menu');

function openMenu() {
  renderMenu();
  if (!menuDialog().open) menuDialog().showModal();
}

function closeMenu() { if (menuDialog().open) menuDialog().close(); }

function renderMenu() {
  const s = state.settings;
  const here = location.hash || '#/';
  const link = (href, text, extra) => h('a', { class: 'menu-link', href, 'aria-current': here === href ? 'page' : null, onclick: closeMenu }, text, extra || null);
  const social = [];
  if (s.instagram) social.push(h('a', { href: `https://instagram.com/${s.instagram}`, target: '_blank', rel: 'noopener' }, `Instagram @${s.instagram}`));
  if (s.whatsapp) social.push(h('a', { href: `https://wa.me/${s.whatsapp}`, target: '_blank', rel: 'noopener' }, 'Escríbenos por WhatsApp'));

  menuDialog().replaceChildren(
    h('div', { class: 'menu-head' },
      h('span', { class: 'menu-brand' }, s.logo ? h('img', { src: s.logo, alt: s.store_name }) : s.store_name),
      h('button', { class: 'close-x', type: 'button', 'aria-label': 'Cerrar menú', onclick: closeMenu })),
    h('nav', { class: 'menu-nav', 'aria-label': 'Secciones de la tienda' },
      link('#/', 'Inicio'),
      link('#/nuevos', 'Nuevos ingresos'),
      link('#/tienda', 'Todas las prendas'),
      aboutParas().length ? link('#/nosotros', 'Nosotros') : null,
      state.seasons.length ? [h('p', { class: 'menu-label' }, 'Temporadas'), state.seasons.map((x, i) =>
        link(`#/temporada/${x.slug}`, x.name, i === 0 ? h('span', { class: 'menu-pill' }, 'Nueva') : null))] : null,
      state.categories.length ? [h('p', { class: 'menu-label' }, 'Categorías'), state.categories.map((c) => link(`#/c/${c.slug}`, c.name))] : null,
      h('p', { class: 'menu-label' }, 'Para ti'),
      link('#/favoritos', 'Mis favoritos', favs.size ? h('span', { class: 'menu-pill' }, String(favs.size)) : null)),
    social.length ? h('div', { class: 'menu-social' }, social) : null);
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
    h('h2', { id: 'cart-title' }, cartStage === 'done' ? 'Pedido registrado' : 'Mi carrito'),
    h('button', { class: 'close-x', type: 'button', 'aria-label': 'Cerrar', onclick: closeCart }));
  dlg.replaceChildren(head, h('div', { class: 'drawer-body' }, cartStage === 'done' ? doneView() : cartView()));
}

function cartView() {
  const lines = cartLines();
  if (!lines.length) {
    return h('div', { class: 'drawer-empty' },
      h('span', { class: 'bow', 'aria-hidden': 'true' }),
      h('p', {}, 'Tu carrito está vacío. Elige una prenda y toca "Agregar al carrito".'),
      h('button', { class: 'btn-pill', type: 'button', onclick: () => { closeCart(); location.hash = '#/tienda'; } }, 'Ver las prendas', arrow()));
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
  const sendText = 'Enviar pedido por WhatsApp';
  const send = h('button', { class: 'btn-pill btn-block', type: 'submit', disabled: hasSoldOut }, sendText);

  // Pago: solo Yape, Plin o transferencia. Los datos se envían por WhatsApp.
  const payInfo = h('div', { class: 'pay-info' },
    h('span', { class: 'ico ico-lock', 'aria-hidden': 'true' }),
    h('p', {}, h('strong', {}, 'Pagas con Yape, Plin o transferencia'), 'Al enviar tu pedido te mandamos los datos de pago por WhatsApp.'));

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
            items: cart.map(({ id, size, color, qty }) => ({ id, size, color, qty })),
          },
        });
        cart = []; saveCart();
        cartStage = 'done'; renderCart();
        loadProducts(); // el stock cambió
      } catch (ex) {
        err.textContent = ex.message;
        send.disabled = hasSoldOut; send.textContent = sendText;
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
  payInfo,
  err, send,
  state.settings.shipping_note ? h('p', { class: 'fine' }, state.settings.shipping_note) : null);

  return h('div', {}, rows,
    h('div', { class: 'total-row' }, h('span', {}, 'Total'), h('strong', {}, money(total))),
    h('h3', {}, 'Tus datos'), form);
}

function doneView() {
  const o = lastOrder;
  return h('div', { class: 'done' },
    h('span', { class: 'bow', 'aria-hidden': 'true' }),
    h('h3', {}, o.whatsapp_url ? 'Falta un paso: envíalo por WhatsApp' : 'Recibimos tu pedido'),
    h('p', { class: 'code' }, `Pedido ${o.code}`),
    h('p', {}, o.whatsapp_url
      ? 'Tu pedido ya quedó guardado. Toca el botón para abrir WhatsApp con el detalle listo y envíalo; ahí te pasamos los datos para pagar con Yape, Plin o transferencia.'
      : 'Te contactaremos pronto para confirmar el pago y la entrega.'),
    o.whatsapp_url ? h('a', { class: 'btn-pill btn-block', href: o.whatsapp_url, target: '_blank', rel: 'noopener' }, 'Abrir WhatsApp') : null,
    h('button', { class: 'btn btn-block btn-soft', type: 'button', onclick: () => { closeCart(); location.hash = '#/'; } }, 'Seguir viendo prendas'));
}

// ------------------------------------------------------------------ rutas

// #/  ·  #/tienda  ·  #/nuevos  ·  #/favoritos  ·  #/c/<categoría>  ·  #/temporada/<temporada>  ·  #/p/<prenda>
function viewFor(page, slug) {
  const s = state.settings;
  document.title = s.store_name;
  switch (page) {
    case 'p': return productView(slug);
    case 'temporada': return seasonView(slug);
    case 'c': {
      const c = state.categories.find((x) => x.slug === slug);
      if (!c) return missing('Esa categoría ya no está disponible', 'Mira todas las prendas de la tienda.');
      document.title = `${c.name} · ${s.store_name}`;
      return listView({ title: c.name, kicker: 'Explora por categoría', pool: state.products.filter((p) => p.category_id === c.id), filterCats: false, filterSeasons: true });
    }
    case 'tienda':
      document.title = `Todas las prendas · ${s.store_name}`;
      return listView({ title: 'Todas las prendas', kicker: 'La colección completa', pool: state.products, filterSeasons: true,
        empty: emptyBox('Estamos preparando la tienda', 'Muy pronto verás aquí los primeros outfits.') });
    case 'nuevos':
      document.title = `Nuevos ingresos · ${s.store_name}`;
      return listView({ title: 'Nuevos ingresos', kicker: 'Descubre lo más reciente', pool: state.products.slice(0, 24),
        empty: emptyBox('Estamos preparando la tienda', 'Muy pronto verás aquí los primeros outfits.') });
    case 'nosotros': return aboutView();
    case 'favoritos':
      document.title = `Mis favoritos · ${s.store_name}`;
      return listView({ title: 'Mis favoritos', kicker: 'Lo que guardaste con ♡', pool: state.products.filter((p) => favs.has(p.id)),
        empty: emptyBox('Aún no guardas favoritos', 'Toca el corazón de una prenda para guardarla aquí.', pill('#/nuevos', 'Ver nuevos ingresos')) });
    default: return homeView();
  }
}

const scrolls = {};
let shown = null;

function render() {
  if (shown !== null) scrolls[shown] = window.scrollY;
  const [, page = '', raw = ''] = (location.hash.replace(/^#/, '') || '/').split('/');
  let slug = raw;
  try { slug = decodeURIComponent(raw); } catch { /* dirección rota: se trata como texto */ }
  shown = location.hash || '#/';
  $('#app').replaceChildren(viewFor(page, slug));
  window.scrollTo(0, page === 'p' ? 0 : scrolls[shown] || 0);
  observeReveals();
  updateWaFloat(page === 'p' ? state.products.find((p) => p.slug === slug) : null);
}

// Botón flotante de WhatsApp. En la página de una prenda, el mensaje ya dice cuál quiere.
function updateWaFloat(product) {
  const s = state.settings, a = $('#wa-float');
  if (!s.whatsapp) { a.hidden = true; return; }
  const text = product
    ? `Hola, quiero pedir "${product.name}" (${money(product.price)}). ${location.origin}/#/p/${product.slug}`
    : `Hola, quiero hacer un pedido en ${s.store_name}.`;
  a.href = `https://wa.me/${s.whatsapp}?text=${encodeURIComponent(text)}`;
  a.setAttribute('aria-label', product ? `Pedir ${product.name} por WhatsApp` : 'Hacer mi pedido por WhatsApp');
  a.hidden = false;
}

// Las secciones aparecen suavemente al bajar. Sin animación si la persona la desactivó.
const io = 'IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches
  ? new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -6% 0px' })
  : null;
if (io) document.documentElement.classList.add('anim');

function observeReveals() {
  if (io) document.querySelectorAll('.reveal:not(.in)').forEach((el) => io.observe(el));
}

// ------------------------------------------------------------------ arranque

function drawChrome() {
  const s = state.settings;
  applyAccent(s.accent);
  $('#brand').replaceChildren(s.logo ? h('img', { src: s.logo, alt: s.store_name }) : s.store_name);
  const links = [];
  if (s.instagram) links.push(h('li', {}, h('a', { href: `https://instagram.com/${s.instagram}`, target: '_blank', rel: 'noopener' }, `Instagram @${s.instagram}`)));
  if (s.whatsapp) links.push(h('li', {}, h('a', { href: `https://wa.me/${s.whatsapp}`, target: '_blank', rel: 'noopener' }, 'WhatsApp')));
  $('#footer').replaceChildren(h('div', { class: 'wrap foot' },
    h('div', {},
      h('a', { class: 'foot-brand', href: '#/', 'aria-label': `${s.store_name}, ir al inicio` },
        s.logo ? h('img', { src: s.logo, alt: s.store_name, loading: 'lazy' }) : s.store_name),
      s.tagline ? h('p', {}, s.tagline) : null,
      h('p', { class: 'foot-pay' }, 'Pagos: Yape · Plin · Transferencia')),
    h('ul', { class: 'foot-nav' },
      h('li', {}, h('a', { href: '#/nuevos' }, 'Nuevos ingresos')),
      h('li', {}, h('a', { href: '#/tienda' }, 'Todas las prendas')),
      h('li', {}, h('a', { href: '#/favoritos' }, 'Mis favoritos')),
      aboutParas().length ? h('li', {}, h('a', { href: '#/nosotros' }, 'Nosotros')) : null),
    links.length ? h('ul', { class: 'foot-social' }, links) : null));
}

async function loadProducts() {
  state.products = await api('/api/products');
}

async function boot() {
  try {
    const [store, products] = await Promise.all([api('/api/store'), api('/api/products')]);
    state.settings = store.settings;
    state.categories = store.categories;
    state.seasons = store.seasons || [];
    state.products = products;
  } catch (e) {
    $('#app').replaceChildren(h('section', { class: 'wrap notice' },
      h('h1', {}, 'No pudimos cargar la tienda'), h('p', {}, e.message),
      h('button', { class: 'btn-pill', type: 'button', onclick: () => location.reload() }, 'Intentar de nuevo')));
    return;
  }
  drawChrome();
  updateBadge();
  window.addEventListener('hashchange', () => { closeMenu(); render(); });
  $('#cart-btn').addEventListener('click', openCart);
  $('#menu-btn').addEventListener('click', openMenu);
  // Clic en el fondo oscuro cierra el panel.
  cartDialog().addEventListener('click', (e) => { if (e.target === cartDialog()) closeCart(); });
  menuDialog().addEventListener('click', (e) => { if (e.target === menuDialog()) closeMenu(); });
  render();
}

boot();
