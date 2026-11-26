'use strict';
// Base de datos: SQLite incluido en Node (node:sqlite). Sin instalar nada.
// Un solo archivo (data/tienda.db) guarda todo: productos, categorías, pedidos y ajustes.

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'tienda.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL,
    slug     TEXT NOT NULL UNIQUE,
    position INTEGER NOT NULL DEFAULT 0
  );

  -- Los precios se guardan en céntimos (enteros) para evitar errores de decimales.
  CREATE TABLE IF NOT EXISTS products (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    slug          TEXT NOT NULL UNIQUE,
    description   TEXT NOT NULL DEFAULT '',
    price_cents   INTEGER NOT NULL,
    compare_cents INTEGER,                       -- precio anterior (tachado), opcional
    category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    images        TEXT NOT NULL DEFAULT '[]',    -- lista JSON de rutas /uploads/...
    sizes         TEXT NOT NULL DEFAULT '[]',    -- lista JSON: ["S","M","L"]
    colors        TEXT NOT NULL DEFAULT '[]',
    stock         INTEGER,                       -- NULL = sin control de stock
    active        INTEGER NOT NULL DEFAULT 1,    -- 1 = visible en la tienda
    featured      INTEGER NOT NULL DEFAULT 0,    -- 1 = sale en la portada
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);

  CREATE TABLE IF NOT EXISTS orders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    code           TEXT NOT NULL UNIQUE,
    customer_name  TEXT NOT NULL,
    customer_phone TEXT NOT NULL DEFAULT '',
    notes          TEXT NOT NULL DEFAULT '',
    items          TEXT NOT NULL,                -- copia (JSON) de lo comprado, con el precio de ese día
    total_cents    INTEGER NOT NULL,
    status         TEXT NOT NULL DEFAULT 'nuevo',
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Cuentas de proveedor (ej. Shein) creadas para aprovechar descuentos. Uso interno del panel.
  CREATE TABLE IF NOT EXISTS supplier_accounts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    email        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_enc TEXT NOT NULL DEFAULT '',       -- cifrada con vault.js, nunca en texto plano
    notes        TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Cada compra hecha con una cuenta: cuántas prendas y cuánto costó.
  CREATE TABLE IF NOT EXISTS supplier_purchases (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  INTEGER NOT NULL REFERENCES supplier_accounts(id) ON DELETE CASCADE,
    bought_on   TEXT NOT NULL,                   -- fecha AAAA-MM-DD
    items_count INTEGER NOT NULL,
    cost_cents  INTEGER NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_purchases_account ON supplier_purchases(account_id);

  -- Detalle de cada compra: una fila por producto (prenda o accesorio).
  CREATE TABLE IF NOT EXISTS supplier_purchase_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id     INTEGER NOT NULL REFERENCES supplier_purchases(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    kind            TEXT NOT NULL DEFAULT 'prenda',   -- 'prenda' | 'accesorio'
    unit_cost_cents INTEGER NOT NULL,
    qty             INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pitems_purchase ON supplier_purchase_items(purchase_id);

  -- CRM: cada persona que compra o que registras a mano.
  -- phone y email son NULL si no se conocen (UNIQUE permite varios NULL).
  CREATE TABLE IF NOT EXISTS customers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    phone      TEXT UNIQUE,                      -- solo dígitos, con código de país (51...)
    email      TEXT UNIQUE COLLATE NOCASE,
    district   TEXT NOT NULL DEFAULT '',
    tags       TEXT NOT NULL DEFAULT '[]',       -- lista JSON: ["VIP","Instagram"]
    notes      TEXT NOT NULL DEFAULT '',
    opt_in     INTEGER NOT NULL DEFAULT 0,       -- 1 = aceptó recibir promociones
    opt_in_at  TEXT,
    source     TEXT NOT NULL DEFAULT 'manual',   -- 'tienda' | 'manual' | 'importado'
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Historial del cliente: notas, llamadas, mensajes, campañas.
  CREATE TABLE IF NOT EXISTS customer_activities (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL DEFAULT 'nota',    -- 'nota' | 'llamada' | 'whatsapp' | 'campaña'
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_activities_customer ON customer_activities(customer_id);

  -- Campañas masivas: el mensaje, a quién va (segmento) y el avance de cada envío.
  CREATE TABLE IF NOT EXISTS campaigns (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    message    TEXT NOT NULL,
    segment    TEXT NOT NULL DEFAULT '{}',       -- filtros usados (JSON), para recordarlos
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS campaign_recipients (
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'pendiente', -- 'pendiente' | 'enviado' | 'omitido'
    sent_at     TEXT,
    PRIMARY KEY (campaign_id, customer_id)
  );
`);

// Migraciones: columnas nuevas en tablas que ya existían. Se agregan una sola vez.
function addColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn('orders', 'customer_id', 'INTEGER REFERENCES customers(id) ON DELETE SET NULL');
addColumn('orders', 'customer_email', "TEXT NOT NULL DEFAULT ''");
addColumn('supplier_purchases', 'shipping_cents', 'INTEGER NOT NULL DEFAULT 0'); // envío, impuestos y descuentos (puede ser negativo)
addColumn('supplier_purchases', 'order_number', "TEXT NOT NULL DEFAULT ''"); // N° de pedido de Shein
addColumn('supplier_purchases', 'arrival', "TEXT NOT NULL DEFAULT ''");      // llegada aproximada, texto libre
addColumn('supplier_purchase_items', 'variant', "TEXT NOT NULL DEFAULT ''"); // talla / color
addColumn('supplier_purchase_items', 'type', "TEXT NOT NULL DEFAULT ''");    // tipo: Vestido fiesta, Playa, Accesorio…
addColumn('supplier_purchase_items', 'sale_price_cents', 'INTEGER');          // precio de venta proyectado
addColumn('supplier_purchase_items', 'price_source', "TEXT NOT NULL DEFAULT 'pedido'"); // 'pedido' | 'pagina' | 'aprox'
db.exec(`UPDATE supplier_purchase_items SET type = CASE kind WHEN 'accesorio' THEN 'Accesorio' ELSE 'Prenda' END WHERE type = ''`);
addColumn('orders', 'payment_method', "TEXT NOT NULL DEFAULT ''"); // 'transferencia' (pedidos antiguos pueden decir 'tarjeta')
db.exec('CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id)');

// Temporadas: cada temporada (Verano 2026, Fiestas, Resort…) agrupa los outfits que nacen con ella.
db.exec(`
  CREATE TABLE IF NOT EXISTS seasons (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    image       TEXT NOT NULL DEFAULT '',        -- foto de portada de la temporada (/uploads/...)
    active      INTEGER NOT NULL DEFAULT 1,      -- 1 = se muestra en la tienda
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
addColumn('products', 'season_id', 'INTEGER REFERENCES seasons(id) ON DELETE SET NULL');
addColumn('categories', 'image', "TEXT NOT NULL DEFAULT ''"); // foto para "Explora por categoría"
db.exec('CREATE INDEX IF NOT EXISTS idx_products_season ON products(season_id)');

// Registro de ventas: cada prenda vendida (por la tienda, WhatsApp, Instagram o en persona),
// con su precio real. El costo se toma de la prenda comprada, así la ganancia es exacta.
db.exec(`
  CREATE TABLE IF NOT EXISTS sales (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id       INTEGER REFERENCES supplier_purchase_items(id) ON DELETE SET NULL,
    name          TEXT NOT NULL,
    type          TEXT NOT NULL DEFAULT '',
    qty           INTEGER NOT NULL DEFAULT 1,
    price_cents   INTEGER NOT NULL,              -- precio de venta por unidad
    cost_cents    INTEGER,                       -- costo por unidad si NO viene del inventario
    sold_on       TEXT NOT NULL,                 -- fecha AAAA-MM-DD
    channel       TEXT NOT NULL DEFAULT 'whatsapp',
    payment       TEXT NOT NULL DEFAULT '',
    customer_id   INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL DEFAULT '',
    notes         TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_sales_item ON sales(item_id);
  CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
`);
// Ventas unidas al catálogo y a los pedidos web.
addColumn('sales', 'product_id', 'INTEGER REFERENCES products(id) ON DELETE SET NULL'); // prenda del catálogo
addColumn('sales', 'order_id', 'INTEGER REFERENCES orders(id) ON DELETE SET NULL');     // pedido web del que salió
addColumn('sales', 'size', "TEXT NOT NULL DEFAULT ''");
addColumn('sales', 'color', "TEXT NOT NULL DEFAULT ''");
// Unidades que esta venta descontó del stock de la prenda (0 si vino de un pedido web: el pedido ya las apartó).
addColumn('sales', 'stock_taken', 'INTEGER NOT NULL DEFAULT 0');
db.exec('CREATE INDEX IF NOT EXISTS idx_sales_product ON sales(product_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_sales_order ON sales(order_id)');

// Teléfono normalizado: solo dígitos. Un celular peruano de 9 dígitos recibe el 51 delante,
// así "987 654 321", "+51987654321" y "51987654321" son la misma persona.
function normPhone(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length === 9 && d.startsWith('9')) return `51${d}`;
  return d.length >= 8 && d.length <= 15 ? d : null;
}

// Busca al cliente por teléfono, luego por correo; si no existe, lo crea.
// Nunca borra datos que ya tenía: solo completa los que faltan.
function upsertCustomer({ name, phone, email, opt_in, source = 'manual' }) {
  phone = normPhone(phone);
  email = String(email || '').trim().toLowerCase() || null;
  let row = (phone && db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone))
    || (email && db.prepare('SELECT * FROM customers WHERE email = ?').get(email));
  if (!row && !phone && !email) {
    row = db.prepare('SELECT * FROM customers WHERE phone IS NULL AND email IS NULL AND lower(name) = lower(?)').get(name);
  }
  if (row) {
    const sets = [], args = [];
    if (!row.phone && phone) { sets.push('phone = ?'); args.push(phone); }
    if (!row.email && email && !db.prepare('SELECT 1 FROM customers WHERE email = ?').get(email)) { sets.push('email = ?'); args.push(email); }
    if (opt_in && !row.opt_in) { sets.push("opt_in = 1, opt_in_at = datetime('now')"); }
    if (sets.length) db.prepare(`UPDATE customers SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...args, row.id);
    return row.id;
  }
  return Number(db.prepare(`INSERT INTO customers (name, phone, email, opt_in, opt_in_at, source)
    VALUES (?, ?, ?, ?, CASE WHEN ? THEN datetime('now') END, ?)`)
    .run(name, phone, email, opt_in ? 1 : 0, opt_in ? 1 : 0, source).lastInsertRowid);
}

// Los pedidos anteriores al CRM se convierten en clientes (solo pasa una vez por pedido).
for (const o of db.prepare('SELECT id, customer_name, customer_phone FROM orders WHERE customer_id IS NULL').all()) {
  const id = upsertCustomer({ name: o.customer_name, phone: o.customer_phone, source: 'tienda' });
  db.prepare('UPDATE orders SET customer_id = ? WHERE id = ?').run(id, o.id);
}

// Ajustes de la tienda y sus valores iniciales.
const DEFAULTS = {
  store_name: 'Lumiere',
  tagline: 'Ropa femenina con envíos a todo el Perú',
  hero_title: 'Silenciosamente icónica',
  hero_subtitle: 'Prendas pensadas para destacar sin hacer ruido.',
  hero_image: '',
  logo: '/brand/lumiere-logo.png',
  accent: '#892E54',
  whatsapp: '51944560192',
  currency: 'S/',
  instagram: 'L.umiere777',
  shipping_note: 'Enviamos a todo el Perú. Coordinamos el pago y el envío por WhatsApp.',
  // Sección "Nosotros": texto de ejemplo para que la dueña lo reemplace desde el panel (Mi tienda).
  about_title: 'Porque cada ocasión merece tu propia luz.',
  about_text: 'Lumière nace del deseo de hacerte sentir especial, hermosa y segura en cada momento. Seleccionamos cuidadosamente prendas únicas para acompañarte en esas ocasiones que se convierten en recuerdos inolvidables. Porque no se trata solo de vestir, sino de sentirte increíble siendo tú misma.\n\nNo naciste para encajar, naciste para brillar con tu propia luz.',
  about_image: '',
};

function getSettings() {
  const out = { ...DEFAULTS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}

function setSettings(obj) {
  const up = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  for (const [k, v] of Object.entries(obj)) up.run(k, String(v));
}

// Lo que ve cualquier visitante: nunca incluye datos privados (admin_*).
function publicSettings() {
  const s = getSettings();
  for (const k of Object.keys(s)) if (k.startsWith('admin_')) delete s[k];
  return s;
}

// Transacción: o se guarda todo, o no se guarda nada.
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { db, DEFAULTS, getSettings, setSettings, publicSettings, tx, normPhone, upsertCustomer };
