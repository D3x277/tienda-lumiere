'use strict';
// Registro de ventas y reporte "Mi negocio".
//
// Una venta es lo que REALMENTE se vendió. La registra la dueña de dos formas:
//   - desde un pedido web que se concretó (por WhatsApp): sus prendas ya estaban apartadas, no se descuenta otra vez;
//   - directa (Instagram, en persona…): se elige la prenda del catálogo y se descuenta de su stock.
// Solo estas ventas cuentan como "Vendí" en el reporte, así nada se cuenta dos veces.

const { db, tx, upsertCustomer, getSettings } = require('./db');

const CHANNELS = { whatsapp: 'WhatsApp', instagram: 'Instagram', tiktok: 'TikTok', presencial: 'En persona', tienda: 'Tienda online', otro: 'Otro' };
const PAYMENTS = { yape: 'Yape / Plin', transferencia: 'Transferencia', efectivo: 'Efectivo', tarjeta: 'Tarjeta', otro: 'Otro' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SALE_SQL = `
  SELECT s.*, pr.images AS product_images, pr.stock AS product_stock, o.code AS order_code, i.variant AS item_variant
  FROM sales s
  LEFT JOIN products pr ON pr.id = s.product_id
  LEFT JOIN orders o ON o.id = s.order_id
  LEFT JOIN supplier_purchase_items i ON i.id = s.item_id`;

function toSale(r) {
  const images = r.product_images ? JSON.parse(r.product_images) : [];
  return {
    id: r.id, product_id: r.product_id, order_id: r.order_id, order_code: r.order_code || '',
    name: r.name, size: r.size, color: r.color, variant: [r.size, r.color].filter(Boolean).join(' · ') || r.item_variant || '',
    image: images[0] || '', qty: r.qty, price: r.price_cents / 100, total: (r.price_cents * r.qty) / 100,
    date: r.sold_on, channel: r.channel, payment: r.payment, customer_id: r.customer_id, customer_name: r.customer_name,
    notes: r.notes, stock_taken: r.stock_taken, created_at: r.created_at,
  };
}

const orderHasSales = (orderId) => !!db.prepare('SELECT 1 FROM sales WHERE order_id = ?').get(orderId);

function register({ route, HttpError, bad, str, money, readJson, intParam }) {
  const admin = { admin: true };
  const list = () => db.prepare(`${SALE_SQL} ORDER BY s.sold_on DESC, s.id DESC`).all().map(toSale);

  // Datos comunes a toda la venta: fecha, canal, pago, cliente y nota.
  function cleanCommon(b) {
    const date = str(b.date, 10);
    if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) throw bad('Elige la fecha de la venta');
    let customerId = b.customer_id ? Number.parseInt(b.customer_id, 10) : null;
    let customerName = str(b.customer_name, 80);
    const phone = str(b.customer_phone, 30);
    if (customerId) {
      const c = db.prepare('SELECT name FROM customers WHERE id = ?').get(customerId);
      if (!c) customerId = null; else customerName = customerName || c.name;
    }
    // Si das su celular, la clienta queda guardada en Clientes (o se une a la que ya existe).
    if (!customerId && phone) {
      if (!customerName) throw bad('Escribe el nombre de la clienta para guardarla');
      customerId = upsertCustomer({ name: customerName, phone, source: 'manual' });
    }
    return {
      date, channel: CHANNELS[b.channel] ? b.channel : 'otro', payment: PAYMENTS[b.payment] ? b.payment : '',
      customer_id: customerId, customer_name: customerName, notes: str(b.notes, 500),
    };
  }

  function cleanQtyPrice(it, n) {
    const qty = Number.parseInt(it.qty, 10);
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000) throw bad(`La cantidad de la prenda ${n} debe ser 1 o más`);
    const price = money(it.price);
    if (price === null || it.price === '' || it.price == null) throw bad(`Escribe el precio de venta de la prenda ${n}`);
    return { qty, price };
  }

  const logSale = (customerId, text) => {
    if (customerId) db.prepare("INSERT INTO customer_activities (customer_id, kind, body) VALUES (?, 'sistema', ?)").run(customerId, text);
  };

  route('GET', '/api/admin/sales', () => list(), admin);

  // Registra una venta con una o varias prendas. Con order_id, sale de un pedido web.
  route('POST', '/api/admin/sales', async ({ req }) => {
    const b = await readJson(req);
    if (!Array.isArray(b.items) || !b.items.length) throw bad('Elige al menos una prenda');
    if (b.items.length > 50) throw bad('Máximo 50 prendas por venta');

    tx(() => {
      let order = null;
      if (b.order_id) {
        order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number.parseInt(b.order_id, 10));
        if (!order) throw new HttpError(404, 'Ese pedido ya no existe');
        if (order.status === 'cancelado') throw bad('Ese pedido está cancelado: sus prendas ya volvieron al stock');
        if (orderHasSales(order.id)) throw new HttpError(409, `El pedido ${order.code} ya está registrado como venta`);
        if (!b.customer_id && !b.customer_phone && order.customer_id) { b.customer_id = order.customer_id; b.customer_name ||= order.customer_name; }
      }
      const c = cleanCommon(b);
      if (order && !CHANNELS[b.channel]) c.channel = 'tienda';

      const insert = db.prepare(`INSERT INTO sales (product_id, order_id, name, type, size, color, qty, price_cents, sold_on, channel, payment,
        customer_id, customer_name, notes, stock_taken) VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const summary = [];
      let total = 0;
      b.items.forEach((it, i) => {
        const n = i + 1;
        const p = db.prepare('SELECT id, name, stock FROM products WHERE id = ?').get(Number.parseInt(it.product_id, 10));
        if (!p) throw bad(`Elige la prenda ${n} del catálogo`);
        const { qty, price } = cleanQtyPrice(it, n);
        let taken = 0;
        // Venta directa: sale del stock ahora. Desde un pedido: el pedido ya la había apartado.
        if (!order && p.stock !== null) {
          if (qty > p.stock) throw new HttpError(409, p.stock > 0 ? `Solo quedan ${p.stock} de "${p.name}"` : `"${p.name}" está agotada. Reactívala en Prendas si te llegó stock.`);
          db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(qty, p.id);
          taken = qty;
        }
        insert.run(p.id, order ? order.id : null, p.name, str(it.size, 12), str(it.color, 20), qty, price, c.date, c.channel, c.payment,
          c.customer_id, c.customer_name, c.notes, taken);
        summary.push(`${qty} × ${p.name}`);
        total += price * qty;
      });
      // El pedido se concretó: pasa a confirmado.
      if (order && order.status === 'nuevo') db.prepare("UPDATE orders SET status = 'confirmado' WHERE id = ?").run(order.id);
      logSale(c.customer_id, `Compró ${summary.join(', ')} por ${getSettings().currency} ${(total / 100).toFixed(2)} (${CHANNELS[c.channel]})`);
    });
    return list();
  }, admin);

  // Corrige una venta (una prenda). Si la venta descontó stock, el stock se ajusta a la nueva cantidad.
  route('PUT', '/api/admin/sales/:id', async ({ req, params }) => {
    const id = intParam(params.id);
    const b = await readJson(req);
    tx(() => {
      const s = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
      if (!s) throw new HttpError(404, 'La venta no existe');
      const c = cleanCommon(b);
      const { qty, price } = cleanQtyPrice(b, 1);
      let taken = s.stock_taken;
      if (s.stock_taken > 0 && s.product_id) {
        const p = db.prepare('SELECT name, stock FROM products WHERE id = ?').get(s.product_id);
        if (p && p.stock !== null) {
          const diff = qty - s.stock_taken;
          if (diff > p.stock) throw new HttpError(409, `Solo quedan ${p.stock} más de "${p.name}"`);
          db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(diff, s.product_id);
          taken = qty;
        }
      }
      db.prepare(`UPDATE sales SET qty = ?, price_cents = ?, size = ?, color = ?, sold_on = ?, channel = ?, payment = ?,
        customer_id = ?, customer_name = ?, notes = ?, stock_taken = ? WHERE id = ?`)
        .run(qty, price, str(b.size, 12), str(b.color, 20), c.date, c.channel, c.payment, c.customer_id, c.customer_name, c.notes, taken, id);
    });
    return list();
  }, admin);

  // Al borrar una venta directa, sus unidades vuelven al stock. Si venía de un pedido, el pedido sigue apartándolas.
  route('DELETE', '/api/admin/sales/:id', ({ params }) => {
    const id = intParam(params.id);
    tx(() => {
      const s = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
      if (!s) return;
      if (s.stock_taken > 0 && s.product_id) db.prepare('UPDATE products SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL').run(s.stock_taken, s.product_id);
      db.prepare('DELETE FROM sales WHERE id = ?').run(id);
    });
    return list();
  }, admin);

  // ------------------------------------------------------------ reporte "Mi negocio"
  // Gasté (compras Shein) vs Vendí (ventas registradas) en un rango de fechas, más el histórico y lo que falta vender.
  route('GET', '/api/admin/business', ({ query }) => {
    const from = DATE_RE.test(query.get('from') || '') ? query.get('from') : '0000-01-01';
    const to = DATE_RE.test(query.get('to') || '') ? query.get('to') : '9999-12-31';

    const spentIn = (a, z) => db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(cost_cents), 0) AS c, COALESCE(SUM(items_count), 0) AS items
      FROM supplier_purchases WHERE bought_on BETWEEN ? AND ?`).get(a, z);
    const soldIn = (a, z) => db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(qty), 0) AS units, COALESCE(SUM(price_cents * qty), 0) AS c
      FROM sales WHERE sold_on BETWEEN ? AND ?`).get(a, z);
    const pack = (sp, so) => ({ spent: sp.c / 100, purchases: sp.n, bought_items: sp.items, sold: so.c / 100, sales: so.n, units: so.units, result: (so.c - sp.c) / 100 });

    const months = new Map();
    for (const r of db.prepare('SELECT substr(bought_on, 1, 7) AS m, SUM(cost_cents) AS c FROM supplier_purchases GROUP BY m').all()) {
      months.set(r.m, { month: r.m, spent: r.c / 100, sold: 0, units: 0 });
    }
    for (const r of db.prepare('SELECT substr(sold_on, 1, 7) AS m, SUM(price_cents * qty) AS c, SUM(qty) AS u FROM sales GROUP BY m').all()) {
      const row = months.get(r.m) || { month: r.m, spent: 0, sold: 0, units: 0 };
      row.sold = r.c / 100; row.units = r.u;
      months.set(r.m, row);
    }

    const top = db.prepare(`SELECT COALESCE(s.product_id, -s.id) AS k, COALESCE(pr.name, s.name) AS name, pr.images,
        SUM(s.qty) AS units, SUM(s.price_cents * s.qty) AS c
      FROM sales s LEFT JOIN products pr ON pr.id = s.product_id
      WHERE s.sold_on BETWEEN ? AND ? GROUP BY k ORDER BY units DESC, c DESC LIMIT 8`).all(from, to)
      .map((r) => ({ name: r.name, image: r.images ? JSON.parse(r.images)[0] || '' : '', units: r.units, total: r.c / 100 }));

    const byChannel = db.prepare(`SELECT channel, SUM(qty) AS units, SUM(price_cents * qty) AS c FROM sales
      WHERE sold_on BETWEEN ? AND ? GROUP BY channel ORDER BY c DESC`).all(from, to)
      .map((r) => ({ channel: r.channel, label: CHANNELS[r.channel] || 'Otro', units: r.units, total: r.c / 100 }));

    const stock = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(stock), 0) AS units, COALESCE(SUM(stock * price_cents), 0) AS c
      FROM products WHERE active = 1 AND stock > 0`).get();
    const unlimited = db.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1 AND stock IS NULL').get().n;
    const soldOut = db.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1 AND stock IS NOT NULL AND stock <= 0').get().n;

    const pending = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS c,
        SUM(CASE WHEN created_at < datetime('now', '-3 days') THEN 1 ELSE 0 END) AS old
      FROM orders o WHERE status = 'nuevo' AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.order_id = o.id)`).get();

    return {
      from: from === '0000-01-01' ? '' : from, to: to === '9999-12-31' ? '' : to,
      period: pack(spentIn(from, to), soldIn(from, to)),
      all_time: pack(spentIn('0000-01-01', '9999-12-31'), soldIn('0000-01-01', '9999-12-31')),
      months: [...months.values()].sort((a, b2) => b2.month.localeCompare(a.month)).slice(0, 24),
      top, by_channel: byChannel,
      to_sell: { products: stock.n, units: stock.units, value: stock.c / 100, unlimited, sold_out: soldOut },
      pending_orders: { orders: pending.n, amount: pending.c / 100, old: pending.old || 0 },
    };
  }, admin);
}

module.exports = { register, CHANNELS, PAYMENTS, orderHasSales };
