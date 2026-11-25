'use strict';
// Servidor de la tienda: API JSON + archivos estáticos. Sin dependencias externas.
//   node server.js   (o: npm start)

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, getSettings, setSettings, publicSettings, tx, normPhone, upsertCustomer } = require('./db');
const auth = require('./auth');
const vault = require('./vault');
const { orderHasSales } = require('./sales');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, 'uploads'));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------------------------------------------------------------- utilidades

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);

const slugify = (s) =>
  String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';

function uniqueSlug(table, base, excludeId = 0) {
  let slug = base, n = 1;
  const stmt = db.prepare(`SELECT id FROM ${table} WHERE slug = ? AND id != ?`);
  while (stmt.get(slug, excludeId)) slug = `${base}-${++n}`;
  return slug;
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { tooBig = true; chunks.length = 0; return; }
      if (!tooBig) chunks.push(c);
    });
    req.on('end', () => (tooBig ? reject(new HttpError(413, 'El archivo es demasiado grande')) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const body = await readBody(req, 200_000);
  if (!body.length) return {};
  // Exigir JSON evita que otra web envíe formularios en nombre del admin (CSRF).
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
    throw new HttpError(415, 'Se esperaba JSON');
  }
  try { return JSON.parse(body.toString('utf8')); } catch { throw bad('JSON inválido'); }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

const isSecure = (req) => req.headers['x-forwarded-proto'] === 'https' || process.env.COOKIE_SECURE === '1';

// ------------------------------------------------------ productos y categorías

const PRODUCT_SELECT = `
  SELECT p.*, c.name AS category_name, c.slug AS category_slug, s.name AS season_name, s.slug AS season_slug
  FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN seasons s ON s.id = p.season_id`;

function toProduct(r) {
  return {
    id: r.id, name: r.name, slug: r.slug, description: r.description,
    price: r.price_cents / 100,
    compare_price: r.compare_cents == null ? null : r.compare_cents / 100,
    category_id: r.category_id, category_name: r.category_name ?? null, category_slug: r.category_slug ?? null,
    season_id: r.season_id ?? null, season_name: r.season_name ?? null, season_slug: r.season_slug ?? null,
    images: JSON.parse(r.images), sizes: JSON.parse(r.sizes), colors: JSON.parse(r.colors),
    stock: r.stock, active: !!r.active, featured: !!r.featured, created_at: r.created_at,
  };
}

// Versión pública: no revela el stock exacto, solo si está agotado o quedan pocas.
function toPublicProduct(r) {
  const p = toProduct(r);
  const out = { ...p, sold_out: p.stock !== null && p.stock <= 0, low_stock: p.stock !== null && p.stock > 0 && p.stock <= 3 ? p.stock : null };
  delete out.stock; delete out.active;
  return out;
}

function listCategories(onlyActive) {
  const cond = onlyActive ? 'AND p.active = 1' : '';
  return db.prepare(`
    SELECT c.id, c.name, c.slug, c.position, c.image,
      (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id ${cond}) AS count
    FROM categories c ORDER BY c.position, c.id`).all();
}

// Temporadas: la tienda solo ve las activas que tienen prendas visibles.
function listSeasons(onlyPublic) {
  const cond = onlyPublic ? 'AND p.active = 1' : '';
  const rows = db.prepare(`
    SELECT s.id, s.name, s.slug, s.description, s.image, s.active, s.position, s.created_at,
      (SELECT COUNT(*) FROM products p WHERE p.season_id = s.id ${cond}) AS count
    FROM seasons s ${onlyPublic ? 'WHERE s.active = 1' : ''} ORDER BY s.position, s.id DESC`).all();
  return rows.map((r) => ({ ...r, active: !!r.active }));
}

const money = (v) => {
  // "35,50" y "35.50" valen lo mismo. Solo se convierte una coma decimal; "1,240" no se toca.
  const n = Number(typeof v === 'string' ? v.trim().replace(/^(\d*),(\d{1,2})$/, '$1.$2') : v);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return null;
  return Math.round(n * 100);
};

function cleanList(v, maxItems, maxLen) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const x of v) {
    const s = str(String(x ?? ''), maxLen);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

const UPLOAD_URL = /^\/uploads\/[\w.-]+$/;
const SETTINGS_IMAGE_URL = /^\/(uploads|brand)\/[\w.-]+$/; // el logo de la marca viene incluido en /brand/

function cleanProduct(b) {
  const name = str(b.name, 120);
  if (!name) throw bad('Escribe el nombre de la prenda');
  const price_cents = money(b.price);
  if (price_cents === null || b.price === '' || b.price == null) throw bad('Escribe un precio válido');
  let compare_cents = null;
  if (b.compare_price !== '' && b.compare_price != null) {
    compare_cents = money(b.compare_price);
    if (compare_cents === null) throw bad('El precio anterior no es válido');
  }
  let stock = null;
  if (b.stock !== '' && b.stock != null) {
    stock = Number.parseInt(b.stock, 10);
    if (!Number.isInteger(stock) || stock < 0 || stock > 100000) throw bad('El stock debe ser un número entero');
  }
  let category_id = null;
  if (b.category_id) {
    category_id = Number.parseInt(b.category_id, 10);
    if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(category_id)) throw bad('La categoría no existe');
  }
  let season_id = null;
  if (b.season_id) {
    season_id = Number.parseInt(b.season_id, 10);
    if (!db.prepare('SELECT 1 FROM seasons WHERE id = ?').get(season_id)) throw bad('La temporada no existe');
  }
  const images = (Array.isArray(b.images) ? b.images : []).filter((u) => typeof u === 'string' && UPLOAD_URL.test(u)).slice(0, 8);
  return {
    name, price_cents, compare_cents, stock, category_id, season_id, images,
    description: str(b.description, 2000),
    sizes: cleanList(b.sizes, 20, 12),
    colors: cleanList(b.colors, 20, 20),
    active: b.active === false ? 0 : 1,
    featured: b.featured ? 1 : 0,
  };
}

// ---------------------------------------------------------------- imágenes

function detectImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null; // Ni SVG ni otros formatos: un SVG puede esconder scripts.
}

// ---------------------------------------------------------------- ajustes

function cleanSettings(b) {
  const out = {};
  const text = { store_name: 60, tagline: 120, hero_title: 120, hero_subtitle: 300, currency: 6, shipping_note: 300 };
  for (const [k, max] of Object.entries(text)) if (k in b) out[k] = str(b[k], max);
  if ('store_name' in out && !out.store_name) throw bad('El nombre de la tienda no puede estar vacío');
  if ('currency' in out && !out.currency) out.currency = 'S/';
  if ('accent' in b) {
    if (!/^#[0-9a-f]{6}$/i.test(String(b.accent))) throw bad('El color no es válido');
    out.accent = String(b.accent).toUpperCase();
  }
  if ('whatsapp' in b) {
    const digits = String(b.whatsapp).replace(/\D/g, '');
    if (digits && (digits.length < 8 || digits.length > 15)) throw bad('El WhatsApp debe incluir el código de país, por ejemplo 51987654321');
    out.whatsapp = digits;
  }
  if ('instagram' in b) out.instagram = str(b.instagram, 30).replace(/^@/, '').replace(/[^\w.]/g, '');
  for (const k of ['logo', 'hero_image']) {
    if (k in b) {
      if (b[k] && !SETTINGS_IMAGE_URL.test(b[k])) throw bad('Imagen no válida');
      out[k] = b[k] || '';
    }
  }
  return out;
}

// ---------------------------------------------------------------- pedidos

function waMessage(order, items, s) {
  const fmt = (c) => `${s.currency} ${(c / 100).toFixed(2)}`;
  const lines = [`Hola, quiero hacer este pedido (${order.code}):`, ''];
  for (const it of items) {
    const variant = [it.size, it.color].filter(Boolean).join(', ');
    lines.push(`• ${it.qty} × ${it.name}${variant ? ` (${variant})` : ''} — ${fmt(it.price_cents * it.qty)}`);
  }
  lines.push('', `Total: ${fmt(order.total_cents)}`, `Nombre: ${order.customer_name}`);
  if (order.customer_phone) lines.push(`Teléfono: ${order.customer_phone}`);
  if (order.payment_method) lines.push(`Pago: ${PAYMENT_LABELS[order.payment_method]}`);
  if (order.notes) lines.push(`Notas: ${order.notes}`);
  return lines.join('\n');
}

// Forma de pago de la tienda: Yape, Plin o transferencia (no se acepta tarjeta).
const PAYMENT_LABELS = { transferencia: 'Yape, Plin o transferencia' };

function createOrder(b) {
  const name = str(b.name, 80);
  if (!name) throw bad('Escribe tu nombre');
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 50) throw bad('Tu pedido está vacío');
  const phone = str(b.phone, 30), notes = str(b.notes, 500);
  const email = str(b.email, 120).toLowerCase();
  if (email && !EMAIL_RE.test(email)) throw bad('El correo no es válido');
  if (phone && !normPhone(phone)) throw bad('Revisa tu teléfono: debe tener entre 8 y 15 dígitos');
  const payment = 'transferencia';

  return tx(() => {
    const items = [], used = new Map();
    let total = 0;
    for (const it of b.items) {
      const id = Number.parseInt(it.id, 10), qty = Number.parseInt(it.qty, 10);
      if (!(id > 0) || !(qty >= 1 && qty <= 20)) throw bad('Los datos del pedido no son válidos');
      // El precio SIEMPRE se lee de la base de datos, nunca del navegador del cliente.
      const row = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(id);
      if (!row) throw new HttpError(409, 'Una de las prendas ya no está disponible');
      const sizes = JSON.parse(row.sizes), colors = JSON.parse(row.colors);
      const size = str(it.size, 12), color = str(it.color, 20);
      if (sizes.length && !sizes.includes(size)) throw bad(`Elige una talla para ${row.name}`);
      if (colors.length && !colors.includes(color)) throw bad(`Elige un color para ${row.name}`);
      if (row.stock !== null) {
        const next = (used.get(id) || 0) + qty;
        if (next > row.stock) throw new HttpError(409, `No hay stock suficiente de ${row.name}`);
        used.set(id, next);
      }
      total += row.price_cents * qty;
      items.push({ id, name: row.name, price_cents: row.price_cents, qty, size, color, image: JSON.parse(row.images)[0] || '' });
    }
    for (const [id, qty] of used) db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(qty, id);

    let code, tries = 0;
    do {
      code = 'P-' + crypto.randomBytes(4).toString('hex').slice(0, 5).toUpperCase();
      if (++tries > 8) throw new HttpError(500, 'No se pudo generar el pedido');
    } while (db.prepare('SELECT 1 FROM orders WHERE code = ?').get(code));

    // CRM: el pedido queda unido a un cliente (se crea si es la primera vez que compra).
    const customerId = upsertCustomer({ name, phone, email, opt_in: b.opt_in === true, source: 'tienda' });
    db.prepare(`INSERT INTO orders (code, customer_name, customer_phone, customer_email, notes, items, total_cents, customer_id, payment_method)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(code, name, phone, email, notes, JSON.stringify(items), total, customerId, payment);

    const s = getSettings();
    const order = { code, customer_name: name, customer_phone: phone, notes, total_cents: total, payment_method: payment };
    const whatsapp_url = s.whatsapp ? `https://wa.me/${s.whatsapp}?text=${encodeURIComponent(waMessage(order, items, s))}` : null;
    return { code, total: total / 100, whatsapp_url, payment_method: payment };
  });
}

const ORDER_STATUSES = ['nuevo', 'confirmado', 'enviado', 'entregado', 'cancelado'];

const toOrder = (r) => ({
  id: r.id, code: r.code, customer_id: r.customer_id, customer_name: r.customer_name, customer_phone: r.customer_phone,
  customer_email: r.customer_email, notes: r.notes, payment_method: r.payment_method,
  items: JSON.parse(r.items).map((i) => ({ ...i, price: i.price_cents / 100 })),
  total: r.total_cents / 100, status: r.status, created_at: r.created_at,
  sold: orderHasSales(r.id), // ya se registró como venta
});

// ---------------------------------------------------------------- rutas

const routes = [];
function route(method, pattern, handler, { admin = false } = {}) {
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
  routes.push({ method, re, handler, admin });
}
const intParam = (v) => {
  const n = Number.parseInt(v, 10);
  if (!(n > 0)) throw new HttpError(404, 'No encontrado');
  return n;
};

// --- Público
route('GET', '/api/store', () => ({
  settings: publicSettings(),
  categories: listCategories(true).filter((c) => c.count > 0),
  seasons: listSeasons(true).filter((s) => s.count > 0),
}));

route('GET', '/api/products', ({ query }) => {
  const where = ['p.active = 1'], args = [];
  const cat = query.get('category');
  if (cat) { where.push('c.slug = ?'); args.push(cat); }
  const q = (query.get('q') || '').trim().slice(0, 60);
  if (q) {
    where.push("(p.name LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\')");
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    args.push(like, like);
  }
  const rows = db.prepare(`${PRODUCT_SELECT} WHERE ${where.join(' AND ')} ORDER BY p.featured DESC, p.id DESC`).all(...args);
  return rows.map(toPublicProduct);
});

route('GET', '/api/products/:slug', ({ params }) => {
  const row = db.prepare(`${PRODUCT_SELECT} WHERE p.slug = ? AND p.active = 1`).get(params.slug);
  if (!row) throw new HttpError(404, 'Esa prenda no existe');
  return toPublicProduct(row);
});

// Detrás de un proxy (Render, etc.) todos llegan desde la misma IP. Con TRUST_PROXY=1 se busca la IP real del visitante:
//  1. True-Client-IP / CF-Connecting-IP: Render va detrás de Cloudflare, que fija esta cabecera con la IP real
//     y la sobrescribe, así que el visitante no puede falsearla.
//  2. Si no viene, la última dirección de X-Forwarded-For (la que añade el proxy; las anteriores sí se pueden falsear).
//  3. Si tampoco, la dirección de la conexión.
function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const ip = String(req.headers['true-client-ip'] || req.headers['cf-connecting-ip'] || '').trim();
    if (ip) return ip;
    const last = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
    if (last) return last;
  }
  return req.socket.remoteAddress || '?';
}

// Límite simple por visitante: evita que alguien llene la tienda de pedidos falsos y bloquee el stock.
const orderHits = new Map(); // ip -> { count, until }
function limitOrders(req) {
  const ip = clientIp(req), now = Date.now();
  const hit = orderHits.get(ip);
  if (hit && hit.until > now) {
    if (hit.count >= 8) throw new HttpError(429, 'Recibimos muchos pedidos seguidos desde tu conexión. Espera unos minutos o escríbenos por WhatsApp.');
    hit.count++;
  } else orderHits.set(ip, { count: 1, until: now + 10 * 60 * 1000 });
  if (orderHits.size > 5000) for (const [k, v] of orderHits) if (v.until <= now) orderHits.delete(k); // limpieza
}

route('POST', '/api/orders', async ({ req }) => { limitOrders(req); return createOrder(await readJson(req)); });

// --- Administrador: sesión
const attempts = new Map(); // ip -> { count, until }

route('POST', '/api/admin/login', async ({ req, res }) => {
  const ip = clientIp(req);
  const a = attempts.get(ip);
  if (a && a.count >= 5 && a.until > Date.now()) throw new HttpError(429, 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.');
  const { password } = await readJson(req);
  if (!auth.verifyPassword(password ?? '', getSettings().admin_password_hash)) {
    attempts.set(ip, { count: (a && a.until > Date.now() ? a.count : 0) + 1, until: Date.now() + 10 * 60 * 1000 });
    throw new HttpError(401, 'Contraseña incorrecta');
  }
  attempts.delete(ip);
  res.setHeader('Set-Cookie', auth.sessionCookie(auth.createSession(), isSecure(req)));
  return { ok: true };
});

route('POST', '/api/admin/logout', ({ req, res }) => {
  auth.destroySession(req);
  res.setHeader('Set-Cookie', auth.clearCookie());
  return { ok: true };
});

route('GET', '/api/admin/me', () => ({ ok: true }), { admin: true });

route('POST', '/api/admin/password', async ({ req }) => {
  const { current, next } = await readJson(req);
  if (!auth.verifyPassword(current ?? '', getSettings().admin_password_hash)) throw new HttpError(403, 'La contraseña actual no es correcta');
  if (typeof next !== 'string' || next.length < 8) throw bad('La nueva contraseña debe tener al menos 8 caracteres');
  setSettings({ admin_password_hash: auth.hashPassword(next) });
  return { ok: true };
}, { admin: true });

// --- Administrador: imágenes
route('POST', '/api/admin/upload', async ({ req }) => {
  const body = await readBody(req, 8 * 1024 * 1024);
  const ext = detectImage(body);
  if (!ext) throw new HttpError(415, 'Formato no válido. Usa una foto JPG, PNG o WebP.');
  const name = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name), body);
  return { url: `/uploads/${name}` };
}, { admin: true });

// --- Administrador: prendas
route('GET', '/api/admin/products', () =>
  db.prepare(`${PRODUCT_SELECT} ORDER BY p.id DESC`).all().map(toProduct), { admin: true });

function saveProduct(p, id) {
  const slug = uniqueSlug('products', slugify(p.name), id || 0);
  const vals = [p.name, slug, p.description, p.price_cents, p.compare_cents, p.category_id, p.season_id,
    JSON.stringify(p.images), JSON.stringify(p.sizes), JSON.stringify(p.colors), p.stock, p.active, p.featured];
  if (id) {
    db.prepare(`UPDATE products SET name=?, slug=?, description=?, price_cents=?, compare_cents=?, category_id=?, season_id=?,
      images=?, sizes=?, colors=?, stock=?, active=?, featured=?, updated_at=datetime('now') WHERE id=?`).run(...vals, id);
    return id;
  }
  return Number(db.prepare(`INSERT INTO products (name, slug, description, price_cents, compare_cents, category_id, season_id,
    images, sizes, colors, stock, active, featured) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...vals).lastInsertRowid);
}

const productById = (id) => toProduct(db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(id));

route('POST', '/api/admin/products', async ({ req }) =>
  productById(saveProduct(cleanProduct(await readJson(req)), null)), { admin: true });

route('PUT', '/api/admin/products/:id', async ({ req, params }) => {
  const id = intParam(params.id);
  if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(id)) throw new HttpError(404, 'La prenda no existe');
  return productById(saveProduct(cleanProduct(await readJson(req)), id));
}, { admin: true });

// Agotada = stock 0. Reactivar = poner las unidades que llegaron (vacío = sin límite).
route('PUT', '/api/admin/products/:id/stock', async ({ req, params }) => {
  const id = intParam(params.id);
  if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(id)) throw new HttpError(404, 'La prenda no existe');
  const b = await readJson(req);
  let stock = null;
  if (b.stock !== '' && b.stock != null) {
    stock = Number.parseInt(b.stock, 10);
    if (!Number.isInteger(stock) || stock < 0 || stock > 100000) throw bad('Escribe cuántas unidades tienes');
  }
  db.prepare("UPDATE products SET stock = ?, updated_at = datetime('now') WHERE id = ?").run(stock, id);
  return productById(id);
}, { admin: true });

route('DELETE', '/api/admin/products/:id', ({ params }) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(intParam(params.id));
  return { ok: true };
}, { admin: true });

// --- Administrador: categorías
route('GET', '/api/admin/categories', () => listCategories(false), { admin: true });

route('POST', '/api/admin/categories', async ({ req }) => {
  const name = str((await readJson(req)).name, 40);
  if (!name) throw bad('Escribe el nombre de la categoría');
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM categories').get().n;
  db.prepare('INSERT INTO categories (name, slug, position) VALUES (?, ?, ?)').run(name, uniqueSlug('categories', slugify(name)), pos);
  return listCategories(false);
}, { admin: true });

// Esta ruta va antes de /:id para que "order" no se confunda con un id.
route('PUT', '/api/admin/categories/order', async ({ req }) => {
  const { ids } = await readJson(req);
  if (!Array.isArray(ids)) throw bad('Orden no válido');
  tx(() => ids.forEach((id, i) => db.prepare('UPDATE categories SET position = ? WHERE id = ?').run(i + 1, Number(id))));
  return listCategories(false);
}, { admin: true });

route('PUT', '/api/admin/categories/:id', async ({ req, params }) => {
  const id = intParam(params.id);
  const name = str((await readJson(req)).name, 40);
  if (!name) throw bad('Escribe el nombre de la categoría');
  db.prepare('UPDATE categories SET name = ?, slug = ? WHERE id = ?').run(name, uniqueSlug('categories', slugify(name), id), id);
  return listCategories(false);
}, { admin: true });

route('DELETE', '/api/admin/categories/:id', ({ params }) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(intParam(params.id)); // las prendas quedan "sin categoría"
  return listCategories(false);
}, { admin: true });

route('PUT', '/api/admin/categories/:id/image', async ({ req, params }) => {
  const image = (await readJson(req)).image || '';
  if (image && !UPLOAD_URL.test(image)) throw bad('Imagen no válida');
  db.prepare('UPDATE categories SET image = ? WHERE id = ?').run(image, intParam(params.id));
  return listCategories(false);
}, { admin: true });

// --- Administrador: temporadas (cada temporada agrupa sus nuevos outfits)
function cleanSeason(b) {
  const name = str(b.name, 60);
  if (!name) throw bad('Escribe el nombre de la temporada');
  const image = b.image || '';
  if (image && !UPLOAD_URL.test(image)) throw bad('Imagen no válida');
  return { name, description: str(b.description, 300), image, active: b.active === false ? 0 : 1 };
}

route('GET', '/api/admin/seasons', () => listSeasons(false), { admin: true });

route('POST', '/api/admin/seasons', async ({ req }) => {
  const s = cleanSeason(await readJson(req));
  // La temporada nueva va primero: es la que se está lanzando.
  tx(() => {
    db.exec('UPDATE seasons SET position = position + 1');
    db.prepare('INSERT INTO seasons (name, slug, description, image, active, position) VALUES (?, ?, ?, ?, ?, 0)')
      .run(s.name, uniqueSlug('seasons', slugify(s.name)), s.description, s.image, s.active);
  });
  return listSeasons(false);
}, { admin: true });

// Esta ruta va antes de /:id para que "order" no se confunda con un id.
route('PUT', '/api/admin/seasons/order', async ({ req }) => {
  const { ids } = await readJson(req);
  if (!Array.isArray(ids)) throw bad('Orden no válido');
  tx(() => ids.forEach((id, i) => db.prepare('UPDATE seasons SET position = ? WHERE id = ?').run(i + 1, Number(id))));
  return listSeasons(false);
}, { admin: true });

route('PUT', '/api/admin/seasons/:id', async ({ req, params }) => {
  const id = intParam(params.id);
  if (!db.prepare('SELECT 1 FROM seasons WHERE id = ?').get(id)) throw new HttpError(404, 'La temporada no existe');
  const s = cleanSeason(await readJson(req));
  db.prepare('UPDATE seasons SET name = ?, slug = ?, description = ?, image = ?, active = ? WHERE id = ?')
    .run(s.name, uniqueSlug('seasons', slugify(s.name), id), s.description, s.image, s.active, id);
  return listSeasons(false);
}, { admin: true });

route('DELETE', '/api/admin/seasons/:id', ({ params }) => {
  db.prepare('DELETE FROM seasons WHERE id = ?').run(intParam(params.id)); // las prendas quedan "sin temporada"
  return listSeasons(false);
}, { admin: true });

// --- Administrador: pedidos
route('GET', '/api/admin/orders', () =>
  db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 300').all().map(toOrder), { admin: true });

// Al eliminar un pedido que no estaba cancelado, sus prendas vuelven al stock (igual que al cancelarlo).
function restock(order) {
  if (order.status === 'cancelado') return;
  for (const it of JSON.parse(order.items)) db.prepare('UPDATE products SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL').run(it.qty, it.id);
}

route('DELETE', '/api/admin/orders/:id', ({ params }) => {
  const id = intParam(params.id);
  tx(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) throw new HttpError(404, 'El pedido no existe');
    if (orderHasSales(id)) throw new HttpError(409, 'Este pedido ya se registró como venta. Borra primero la venta en Registro de ventas.');
    restock(order);
    db.prepare('DELETE FROM orders WHERE id = ?').run(id);
  });
  return { ok: true };
}, { admin: true });

route('PUT', '/api/admin/orders/:id', async ({ req, params }) => {
  const id = intParam(params.id);
  const { status } = await readJson(req);
  if (!ORDER_STATUSES.includes(status)) throw bad('Estado no válido');
  return tx(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) throw new HttpError(404, 'El pedido no existe');
    if (order.status === 'cancelado' && status !== 'cancelado') throw bad('Un pedido cancelado no se puede reactivar');
    if (status === 'cancelado' && orderHasSales(id)) throw new HttpError(409, 'Este pedido ya se registró como venta. Borra primero la venta en Registro de ventas.');
    if (status === 'cancelado' && order.status !== 'cancelado') {
      // Al cancelar, las prendas vuelven al stock.
      for (const it of JSON.parse(order.items)) db.prepare('UPDATE products SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL').run(it.qty, it.id);
    }
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
    return toOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
  });
}, { admin: true });

// --- Administrador: cuentas de proveedor (Shein) y sus compras
// La lista nunca incluye contraseñas; se piden una por una con /password.

function listAccounts() {
  const accounts = db.prepare(`SELECT id, email, notes, created_at, password_enc != '' AS has_password
    FROM supplier_accounts ORDER BY id DESC`).all();
  const purchases = db.prepare('SELECT * FROM supplier_purchases ORDER BY bought_on DESC, id DESC').all();
  const lines = new Map();
  for (const l of db.prepare(`SELECT i.*, (SELECT COALESCE(SUM(s.qty), 0) FROM sales s WHERE s.item_id = i.id) AS sold
    FROM supplier_purchase_items i ORDER BY i.id`).all()) {
    if (!lines.has(l.purchase_id)) lines.set(l.purchase_id, []);
    lines.get(l.purchase_id).push({
      id: l.id, name: l.name, variant: l.variant, type: l.type, kind: l.kind, price: l.unit_cost_cents / 100, qty: l.qty,
      sale_price: l.sale_price_cents == null ? null : l.sale_price_cents / 100, price_source: l.price_source, sold: l.sold,
    });
  }
  const byAccount = new Map(accounts.map((a) => [a.id, []]));
  for (const p of purchases) {
    byAccount.get(p.account_id)?.push({
      id: p.id, account_id: p.account_id, date: p.bought_on, items: p.items_count, cost: p.cost_cents / 100, description: p.description,
      shipping: p.shipping_cents / 100, order_number: p.order_number, arrival: p.arrival, lines: lines.get(p.id) || [],
    });
  }
  return accounts.map((a) => {
    const list = byAccount.get(a.id);
    return {
      id: a.id, email: a.email, notes: a.notes, created_at: a.created_at, has_password: !!a.has_password,
      purchases: list,
      total_items: list.reduce((n, p) => n + p.items, 0),
      total_cost: list.reduce((n, p) => n + Math.round(p.cost * 100), 0) / 100,
    };
  });
}

function cleanAccount(b, isNew) {
  const email = str(b.email, 120).toLowerCase();
  if (!EMAIL_RE.test(email)) throw bad('Escribe un correo válido');
  const out = { email, notes: str(b.notes, 500) };
  if (typeof b.password === 'string' && b.password !== '') {
    if (b.password.length > 200) throw bad('La contraseña es demasiado larga');
    out.password_enc = vault.encrypt(b.password);
  } else if (isNew) out.password_enc = '';
  return out;
}

function cleanPurchase(b) {
  const date = str(b.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw bad('Elige una fecha válida');
  const description = str(b.description, 500);
  const order_number = str(b.order_number, 40);
  const arrival = str(b.arrival, 40);
  const account_id = b.account_id ? Number.parseInt(b.account_id, 10) : null;
  let shipping = 0;
  if (b.shipping !== '' && b.shipping != null) {
    shipping = money(b.shipping);
    if (shipping === null) throw bad('El envío no es válido');
  }
  // Total pagado: lo que cobró Shein (con envío, impuestos y descuentos). Si no se da, es la suma de los productos.
  let total = null;
  if (b.total !== '' && b.total != null) {
    total = money(b.total);
    if (!total) throw bad('El total pagado no es válido');
  }

  // Con detalle: una fila por producto. Los totales se calculan aquí, no se confía en el navegador.
  if (Array.isArray(b.lines) && b.lines.length) {
    if (b.lines.length > 30) throw bad('Máximo 30 productos por compra');
    const lines = b.lines.map((l, i) => {
      const n = i + 1;
      const name = str(l.name, 120);
      if (!name) throw bad(`Escribe el nombre del producto ${n}`);
      const type = str(l.type, 30) || (l.kind === 'accesorio' ? 'Accesorio' : 'Prenda');
      const kind = slugify(type) === 'accesorio' || slugify(type) === 'accesorios' ? 'accesorio' : 'prenda';
      const price = money(l.price);
      if (price === null || l.price === '' || l.price == null) throw bad(`Escribe el precio del producto ${n}`);
      const qty = Number.parseInt(l.qty, 10);
      if (!Number.isInteger(qty) || qty < 1 || qty > 1000) throw bad(`Las unidades del producto ${n} deben ser 1 o más`);
      let sale_price = null;
      if (l.sale_price !== '' && l.sale_price != null) {
        sale_price = money(l.sale_price);
        if (sale_price === null) throw bad(`El precio de venta del producto ${n} no es válido`);
      }
      const id = Number.parseInt(l.id, 10) || null;
      return { id, name, variant: str(l.variant, 40), type, kind, price, qty, sale_price,
        price_source: PRICE_SOURCES.includes(l.price_source) ? l.price_source : 'pedido' };
    });
    const items = lines.reduce((s, l) => s + l.qty, 0);
    const sum = lines.reduce((s, l) => s + l.price * l.qty, 0);
    const cost = total ?? sum + shipping;
    return { date, items, cost, shipping: cost - sum, description, order_number, arrival, account_id, lines };
  }

  // Compra simple: cuánto gastaste (y, si quieres, cuántas prendas). Si la compra ya tenía detalle, se conserva.
  const cost = money(b.cost);
  if (!cost) throw bad('Escribe cuánto gastaste en esta compra');
  let items = 0;
  if (b.items !== '' && b.items != null) {
    items = Number.parseInt(b.items, 10);
    if (!Number.isInteger(items) || items < 0 || items > 10000) throw bad('La cantidad de prendas no es válida');
  }
  return { date, items, cost, shipping: null, description, order_number, arrival, account_id, lines: null };
}

const PRICE_SOURCES = ['pedido', 'pagina', 'aprox'];
const soldOf = (itemId) => db.prepare('SELECT COALESCE(SUM(qty), 0) AS n FROM sales WHERE item_id = ?').get(itemId).n;

// Guarda las filas de una compra. Las que ya existían se ACTUALIZAN (no se borran),
// para no perder el vínculo con sus ventas registradas.
function savePurchaseLines(purchaseId, lines) {
  const existing = new Set(db.prepare('SELECT id FROM supplier_purchase_items WHERE purchase_id = ?').all(purchaseId).map((r) => r.id));
  const keep = new Set();
  for (const l of lines) {
    const vals = [l.name, l.variant, l.type, l.kind, l.price, l.qty, l.sale_price, l.price_source];
    if (l.id && existing.has(l.id)) {
      const sold = soldOf(l.id);
      if (l.qty < sold) throw bad(`"${l.name}" ya tiene ${sold} vendidas: no puedes dejarle menos unidades`);
      db.prepare(`UPDATE supplier_purchase_items SET name = ?, variant = ?, type = ?, kind = ?, unit_cost_cents = ?, qty = ?,
        sale_price_cents = ?, price_source = ? WHERE id = ?`).run(...vals, l.id);
      keep.add(l.id);
    } else {
      db.prepare(`INSERT INTO supplier_purchase_items (purchase_id, name, variant, type, kind, unit_cost_cents, qty, sale_price_cents, price_source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(purchaseId, ...vals);
    }
  }
  for (const id of existing) {
    if (keep.has(id)) continue;
    if (soldOf(id)) throw bad('No puedes quitar un producto que ya tiene ventas registradas. Borra primero sus ventas.');
    db.prepare('DELETE FROM supplier_purchase_items WHERE id = ?').run(id);
  }
}

const accountExists = (id) => {
  if (!db.prepare('SELECT 1 FROM supplier_accounts WHERE id = ?').get(id)) throw new HttpError(404, 'La cuenta no existe');
};
const duplicateEmail = (e) => {
  if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Ya registraste una cuenta con ese correo');
  throw e;
};

route('GET', '/api/admin/accounts', () => listAccounts(), { admin: true });

route('POST', '/api/admin/accounts', async ({ req }) => {
  const a = cleanAccount(await readJson(req), true);
  try {
    db.prepare('INSERT INTO supplier_accounts (email, password_enc, notes) VALUES (?, ?, ?)').run(a.email, a.password_enc, a.notes);
  } catch (e) { duplicateEmail(e); }
  return listAccounts();
}, { admin: true });

route('PUT', '/api/admin/accounts/:id', async ({ req, params }) => {
  const id = intParam(params.id);
  accountExists(id);
  const a = cleanAccount(await readJson(req), false);
  try {
    db.prepare('UPDATE supplier_accounts SET email = ?, notes = ? WHERE id = ?').run(a.email, a.notes, id);
    if (a.password_enc !== undefined) db.prepare('UPDATE supplier_accounts SET password_enc = ? WHERE id = ?').run(a.password_enc, id);
  } catch (e) { duplicateEmail(e); }
  return listAccounts();
}, { admin: true });

route('DELETE', '/api/admin/accounts/:id', ({ params }) => {
  const id = intParam(params.id);
  const sold = db.prepare(`SELECT COUNT(*) AS n FROM sales s JOIN supplier_purchase_items i ON i.id = s.item_id
    JOIN supplier_purchases p ON p.id = i.purchase_id WHERE p.account_id = ?`).get(id).n;
  if (sold) throw new HttpError(409, 'Esta cuenta tiene prendas con ventas registradas. Mueve sus compras a otra cuenta o borra esas ventas.');
  db.prepare('DELETE FROM supplier_accounts WHERE id = ?').run(id); // sus compras se borran también
  return listAccounts();
}, { admin: true });

route('GET', '/api/admin/accounts/:id/password', ({ params }) => {
  const row = db.prepare('SELECT password_enc FROM supplier_accounts WHERE id = ?').get(intParam(params.id));
  if (!row) throw new HttpError(404, 'La cuenta no existe');
  try { return { password: vault.decrypt(row.password_enc) }; }
  catch { throw new HttpError(500, 'No se pudo leer la contraseña. ¿Cambió la llave de cifrado (vault.key)?'); }
}, { admin: true });

route('POST', '/api/admin/accounts/:id/purchases', async ({ req, params }) => {
  const id = intParam(params.id);
  accountExists(id);
  const p = cleanPurchase(await readJson(req));
  tx(() => {
    const pid = Number(db.prepare(`INSERT INTO supplier_purchases (account_id, bought_on, items_count, cost_cents, shipping_cents, description, order_number, arrival)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, p.date, p.items, p.cost, p.shipping ?? 0, p.description, p.order_number, p.arrival).lastInsertRowid);
    if (p.lines) savePurchaseLines(pid, p.lines);
  });
  return listAccounts();
}, { admin: true });

route('PUT', '/api/admin/purchases/:id', async ({ req, params }) => {
  const id = intParam(params.id);
  const p = cleanPurchase(await readJson(req));
  if (p.account_id) accountExists(p.account_id); // permite mover la compra a otra cuenta
  tx(() => {
    const old = db.prepare('SELECT * FROM supplier_purchases WHERE id = ?').get(id);
    if (!old) throw new HttpError(404, 'La compra no existe');
    // Compra simple sobre una que tenía detalle: el detalle y su envío se conservan; solo cambia el total y los datos.
    const keepDetail = !p.lines && db.prepare('SELECT 1 FROM supplier_purchase_items WHERE purchase_id = ?').get(id);
    db.prepare(`UPDATE supplier_purchases SET bought_on = ?, items_count = ?, cost_cents = ?, shipping_cents = ?, description = ?,
      order_number = ?, arrival = ?, account_id = COALESCE(?, account_id) WHERE id = ?`)
      .run(p.date, keepDetail && !p.items ? old.items_count : p.items, p.cost, p.shipping ?? old.shipping_cents, p.description,
        p.order_number, p.arrival || (p.lines ? '' : old.arrival), p.account_id, id);
    if (p.lines) savePurchaseLines(id, p.lines);
  });
  return listAccounts();
}, { admin: true });

route('DELETE', '/api/admin/purchases/:id', ({ params }) => {
  const id = intParam(params.id);
  const sold = db.prepare('SELECT COUNT(*) AS n FROM sales s JOIN supplier_purchase_items i ON i.id = s.item_id WHERE i.purchase_id = ?').get(id).n;
  if (sold) throw new HttpError(409, 'Esta compra tiene ventas registradas. Borra primero esas ventas.');
  db.prepare('DELETE FROM supplier_purchases WHERE id = ?').run(id);
  return listAccounts();
}, { admin: true });

// --- Administrador: CRM (clientes, campañas) y reportes, en sus propios archivos
require('./crm').register({ route, HttpError, bad, str, money, readJson, intParam, toOrder, cleanList, EMAIL_RE });
require('./reports').register({ route });
require('./sales').register({ route, HttpError, bad, str, money, readJson, intParam });

// --- Administrador: borrar datos (para empezar limpio después de probar)
// Pide la contraseña otra vez: es la acción más destructiva del panel y no se puede deshacer.
const WIPE_PARTS = ['pedidos', 'clientes', 'campanas', 'ventas', 'compras', 'prendas', 'categorias', 'temporadas'];

function removeUnusedUploads() {
  const s = getSettings();
  const kept = [s.logo, s.hero_image,
    ...db.prepare('SELECT image FROM categories').all().map((r) => r.image),
    ...db.prepare('SELECT image FROM seasons').all().map((r) => r.image)];
  const used = new Set(kept.filter((u) => u && u.startsWith('/uploads/')).map((u) => u.slice('/uploads/'.length)));
  let removed = 0;
  for (const name of fs.readdirSync(UPLOAD_DIR)) {
    if (!/^[\w.-]+$/.test(name) || used.has(name)) continue;
    try { fs.unlinkSync(path.join(UPLOAD_DIR, name)); removed++; } catch { /* ya no estaba */ }
  }
  return removed;
}

route('POST', '/api/admin/wipe', async ({ req }) => {
  const b = await readJson(req);
  if (!auth.verifyPassword(b.password ?? '', getSettings().admin_password_hash)) throw new HttpError(403, 'La contraseña no es correcta');
  const parts = Array.isArray(b.parts) ? b.parts.filter((p) => WIPE_PARTS.includes(p)) : [];
  if (!parts.length) throw bad('Elige qué quieres borrar');
  const has = (p) => parts.includes(p);
  const counts = {};
  const del = (key, table) => { counts[key] = db.prepare(`DELETE FROM ${table}`).run().changes; };
  tx(() => {
    if (has('pedidos')) {
      if (!has('prendas')) for (const o of db.prepare('SELECT status, items FROM orders').all()) restock(o);
      del('pedidos', 'orders');
    }
    if (has('ventas')) del('ventas', 'sales');
    if (has('campanas') || has('clientes')) del('campanas', 'campaigns');
    if (has('clientes')) del('clientes', 'customers'); // su historial se borra con ellos
    if (has('compras')) del('compras', 'supplier_purchases'), del('cuentas', 'supplier_accounts');
    if (has('prendas')) del('prendas', 'products');
    if (has('categorias')) del('categorias', 'categories');
    if (has('temporadas')) del('temporadas', 'seasons');
    // Los números (id) de lo borrado vuelven a empezar desde 1.
    const tables = { pedidos: ['orders'], ventas: ['sales'], campanas: ['campaigns'], clientes: ['customers', 'customer_activities', 'campaigns'],
      compras: ['supplier_purchases', 'supplier_purchase_items', 'supplier_accounts'], prendas: ['products'], categorias: ['categories'], temporadas: ['seasons'] };
    const reset = [...new Set(parts.flatMap((p) => tables[p]))];
    db.prepare(`DELETE FROM sqlite_sequence WHERE name IN (${reset.map(() => '?').join(',')})`).run(...reset);
  });
  if (has('prendas')) counts.fotos = removeUnusedUploads();
  return { ok: true, counts };
}, { admin: true });

// --- Administrador: ajustes de la tienda
route('GET', '/api/admin/settings', () => publicSettings(), { admin: true });

route('PUT', '/api/admin/settings', async ({ req }) => {
  setSettings(cleanSettings(await readJson(req)));
  return publicSettings();
}, { admin: true });

// ---------------------------------------------------------------- servidor

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

const PAGE_CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

async function handleApi(req, res, url) {
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    if (r.admin && !auth.isAuthed(req)) throw new HttpError(401, 'Inicia sesión para continuar');
    const data = await r.handler({ req, res, params: m.groups || {}, query: url.searchParams });
    return sendJson(res, 200, data ?? { ok: true });
  }
  throw new HttpError(404, 'No encontrado');
}

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método no permitido');
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { throw bad('Dirección no válida'); }
  let root = PUBLIC_DIR;
  const isUpload = p.startsWith('/uploads/');
  if (isUpload) { root = UPLOAD_DIR; p = p.slice('/uploads'.length); }
  else if (p === '/admin' || p === '/admin/') p = '/admin/index.html';
  else if (p.endsWith('/')) p += 'index.html';

  const file = path.join(root, p);
  if (!file.startsWith(root + path.sep)) throw new HttpError(403, 'Prohibido');

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('No encontrado');
    }
    const headers = {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': isUpload ? 'public, max-age=31536000, immutable' : 'no-cache',
    };
    // Lo subido nunca puede ejecutar código, aunque alguien lo abra directamente.
    if (isUpload) headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  // Publicada con HTTPS: el navegador recuerda usar siempre HTTPS (nunca la versión sin candado).
  if (process.env.COOKIE_SECURE === '1') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  if (!req.url.startsWith('/uploads/')) res.setHeader('Content-Security-Policy', PAGE_CSP);
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    if (res.headersSent) return res.end();
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
    console.error(e);
    sendJson(res, 500, { error: 'Algo salió mal. Inténtalo de nuevo.' });
  }
});

// Primera vez: crear la contraseña del administrador.
if (!getSettings().admin_password_hash) {
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('base64url');
  setSettings({ admin_password_hash: auth.hashPassword(password) });
  console.log('\n  ┌─ Panel de administración ─────────────────────');
  // Si la definiste en ADMIN_PASSWORD no se muestra: los registros del servidor los puede ver más gente.
  console.log(process.env.ADMIN_PASSWORD ? '  │  Contraseña inicial: la que pusiste en ADMIN_PASSWORD' : `  │  Contraseña inicial: ${password}`);
  console.log('  │  Cámbiala en Mi tienda > Contraseña.');
  console.log('  └───────────────────────────────────────────────\n');
}

if (require.main === module) {
  require('./importar-noviembre').importarDesdeVariable(); // solo actúa si existe la variable IMPORTAR_NOVIEMBRE
  server.listen(PORT, HOST, () => {
    console.log(`  Tienda:  http://${HOST}:${PORT}/`);
    console.log(`  Panel:   http://${HOST}:${PORT}/admin\n`);
  });
}

module.exports = { server };