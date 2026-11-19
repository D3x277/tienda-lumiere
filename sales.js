'use strict';
// Registro de ventas e inventario: qué prendas compradas ya se vendieron, a cuánto y con qué ganancia.
//
// Costo real de una prenda = su precio en el pedido de Shein + su parte proporcional del envío,
// impuestos y descuentos de ese pedido. Así la suma de los costos es exactamente lo que pagaste.

const { db, upsertCustomer, getSettings } = require('./db');

const CHANNELS = { tienda: 'Tienda online', whatsapp: 'WhatsApp', instagram: 'Instagram', tiktok: 'TikTok', presencial: 'En persona', otro: 'Otro' };
const PAYMENTS = { yape: 'Yape / Plin', transferencia: 'Transferencia', tarjeta: 'Tarjeta', efectivo: 'Efectivo', otro: 'Otro' };

// Una prenda del inventario con su costo real por unidad (en céntimos, con decimales).
const ITEM_SQL = `
  SELECT i.*, p.cost_cents AS p_cost, p.order_number, p.bought_on,
    (SELECT SUM(x.unit_cost_cents * x.qty) FROM supplier_purchase_items x WHERE x.purchase_id = i.purchase_id) AS p_sum
  FROM supplier_purchase_items i JOIN supplier_purchases p ON p.id = i.purchase_id`;
const realCost = (r) => (r.p_sum ? (r.unit_cost_cents * r.p_cost) / r.p_sum : r.unit_cost_cents);

const SALE_SQL = `
  SELECT s.*, i.variant, i.unit_cost_cents, p.cost_cents AS p_cost, p.order_number, p.bought_on,
    (SELECT SUM(x.unit_cost_cents * x.qty) FROM supplier_purchase_items x WHERE x.purchase_id = i.purchase_id) AS p_sum
  FROM sales s
  LEFT JOIN supplier_purchase_items i ON i.id = s.item_id
  LEFT JOIN supplier_purchases p ON p.id = i.purchase_id`;

function toSale(r) {
  // Si la venta viene del inventario, el costo se calcula siempre al día (si corriges la compra, se corrige aquí).
  const unitCost = r.unit_cost_cents != null ? realCost(r) : r.cost_cents;
  return {
    id: r.id, item_id: r.item_id, name: r.name, variant: r.variant || '', type: r.type, qty: r.qty,
    price: r.price_cents / 100, cost: unitCost == null ? null : Math.round(unitCost) / 100,
    date: r.sold_on, channel: r.channel, payment: r.payment, customer_id: r.customer_id, customer_name: r.customer_name,
    notes: r.notes, order_number: r.order_number || '', created_at: r.created_at,
  };
}

function register({ route, HttpError, bad, str, money, readJson, intParam }) {
  const admin = { admin: true };
  const list = () => db.prepare(`${SALE_SQL} ORDER BY s.sold_on DESC, s.id DESC`).all().map(toSale);

  function cleanSale(b, saleId = 0) {
    const date = str(b.date, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw bad('Elige la fecha de la venta');
    const qty = Number.parseInt(b.qty, 10);
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000) throw bad('La cantidad debe ser 1 o más');
    const price = money(b.price);
    if (price === null || b.price === '' || b.price == null) throw bad('Escribe a cuánto la vendiste');

    let item = null, name = str(b.name, 120), type = str(b.type, 30), cost = null;
    if (b.item_id) {
      item = db.prepare(`${ITEM_SQL} WHERE i.id = ?`).get(Number.parseInt(b.item_id, 10));
      if (!item) throw bad('Esa prenda ya no está en el inventario');
      const sold = db.prepare('SELECT COALESCE(SUM(qty), 0) AS n FROM sales WHERE item_id = ? AND id != ?').get(item.id, saleId).n;
      const left = item.qty - sold;
      if (qty > left) throw new HttpError(409, left > 0 ? `Solo quedan ${left} de "${item.name}"` : `"${item.name}" ya está vendida`);
      name = item.name; type = item.type;
    } else {
      if (!name) throw bad('Escribe qué vendiste');
      if (b.cost !== '' && b.cost != null) {
        cost = money(b.cost);
        if (cost === null) throw bad('El costo no es válido');
      }
    }

    // Cliente: si das su celular, queda guardado en Clientes (o se une al que ya existe).
    let customerId = b.customer_id ? Number.parseInt(b.customer_id, 10) : null;
    let customerName = str(b.customer_name, 80);
    const phone = str(b.customer_phone, 30);
    if (customerId) {
      const c = db.prepare('SELECT name FROM customers WHERE id = ?').get(customerId);
      if (!c) customerId = null; else customerName = customerName || c.name;
    }
    if (!customerId && phone) {
      if (!customerName) throw bad('Escribe el nombre del cliente para guardarlo');
      customerId = upsertCustomer({ name: customerName, phone, source: 'manual' });
    }

    return {
      item_id: item ? item.id : null, name, type, qty, price, cost, date,
      channel: CHANNELS[b.channel] ? b.channel : 'otro',
      payment: PAYMENTS[b.payment] ? b.payment : '',
      customer_id: customerId, customer_name: customerName, notes: str(b.notes, 500),
    };
  }

  const logSale = (s) => {
    if (!s.customer_id) return;
    const cur = getSettings().currency;
    db.prepare("INSERT INTO customer_activities (customer_id, kind, body) VALUES (?, 'sistema', ?)").run(s.customer_id,
      `Compró ${s.qty} × ${s.name} por ${cur} ${((s.price * s.qty) / 100).toFixed(2)} (${CHANNELS[s.channel]})`);
  };

  route('GET', '/api/admin/sales', () => list(), admin);

  route('POST', '/api/admin/sales', async ({ req }) => {
    const s = cleanSale(await readJson(req));
    db.prepare(`INSERT INTO sales (item_id, name, type, qty, price_cents, cost_cents, sold_on, channel, payment, customer_id, customer_name, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(s.item_id, s.name, s.type, s.qty, s.price, s.cost, s.date, s.channel, s.payment, s.customer_id, s.customer_name, s.notes);
    logSale(s);
    return list();
  }, admin);

  route('PUT', '/api/admin/sales/:id', async ({ req, params }) => {
    const id = intParam(params.id);
    if (!db.prepare('SELECT 1 FROM sales WHERE id = ?').get(id)) throw new HttpError(404, 'La venta no existe');
    const s = cleanSale(await readJson(req), id);
    db.prepare(`UPDATE sales SET item_id = ?, name = ?, type = ?, qty = ?, price_cents = ?, cost_cents = ?, sold_on = ?, channel = ?,
      payment = ?, customer_id = ?, customer_name = ?, notes = ? WHERE id = ?`)
      .run(s.item_id, s.name, s.type, s.qty, s.price, s.cost, s.date, s.channel, s.payment, s.customer_id, s.customer_name, s.notes, id);
    return list();
  }, admin);

  route('DELETE', '/api/admin/sales/:id', ({ params }) => {
    db.prepare('DELETE FROM sales WHERE id = ?').run(intParam(params.id));
    return list();
  }, admin);

  // Precio de venta proyectado: para una prenda (edición en la tabla) o para varias a la vez (por tipo).
  route('POST', '/api/admin/purchase-items/price', async ({ req }) => {
    const b = await readJson(req);
    const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter((n) => n > 0).slice(0, 5000) : [];
    if (!ids.length) throw bad('Elige al menos una prenda');
    let price = null;
    if (b.sale_price !== '' && b.sale_price != null) {
      price = money(b.sale_price);
      if (price === null) throw bad('El precio de venta no es válido');
    }
    const up = db.prepare('UPDATE supplier_purchase_items SET sale_price_cents = ? WHERE id = ?');
    for (const id of ids) up.run(price, id);
    return { ok: true, updated: ids.length };
  }, admin);
}

module.exports = { register, CHANNELS, PAYMENTS };
