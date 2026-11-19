'use strict';
// Reportería: ventas, clientes, productos e inventario, y compras a proveedores.
// Todo se calcula con SQL sobre la misma base de datos; nada se guarda aparte.

const { db } = require('./db');
const { SALE_STATUSES } = require('./crm');

// Las fechas se guardan en UTC. Perú es UTC-5; cámbialo con TZ_OFFSET_HOURS si vendes en otro país.
const OFFSET_H = Number(process.env.TZ_OFFSET_HOURS ?? -5);
const TZ = `${OFFSET_H >= 0 ? '+' : ''}${OFFSET_H} hours`;

// Filtro de periodo sobre una columna de fecha-hora UTC. back=1 es el periodo anterior (para comparar).
function period(col, days, back = 0) {
  if (!days) return { sql: '1 = 1', args: [] };
  if (!back) return { sql: `${col} >= datetime('now', ?)`, args: [`-${days} days`] };
  return {
    sql: `${col} >= datetime('now', ?) AND ${col} < datetime('now', ?)`,
    args: [`-${days * (back + 1)} days`, `-${days * back} days`],
  };
}
// Igual, para fechas locales AAAA-MM-DD (las compras a proveedores).
function periodDate(col, days, back = 0) {
  if (!days) return { sql: '1 = 1', args: [] };
  return {
    sql: `${col} > date('now', '${TZ}', ?) AND ${col} <= date('now', '${TZ}', ?)`,
    args: [`-${days * (back + 1)} days`, back ? `-${days * back} days` : '+0 days'],
  };
}

function salesTotals(days, back) {
  const p = period('created_at', days, back);
  const s = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS rev FROM orders
    WHERE status IN ${SALE_STATUSES} AND ${p.sql}`).get(...p.args);
  const pu = period('o.created_at', days, back);
  const u = db.prepare(`SELECT COALESCE(SUM(json_extract(j.value, '$.qty')), 0) AS units
    FROM orders o, json_each(o.items) j WHERE o.status IN ${SALE_STATUSES} AND ${pu.sql}`).get(...pu.args);
  return { orders: s.n, revenue: s.rev / 100, units: u.units, avg_ticket: s.n ? s.rev / s.n / 100 : 0 };
}

function purchaseTotals(days, back) {
  const p = periodDate('bought_on', days, back);
  const r = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(cost_cents), 0) AS cost, COALESCE(SUM(items_count), 0) AS items
    FROM supplier_purchases WHERE ${p.sql}`).get(...p.args);
  return { purchases: r.n, cost: r.cost / 100, items: r.items };
}

// Últimos 12 meses, con los meses vacíos en cero para que el gráfico no salte meses.
function monthly() {
  const sales = new Map(db.prepare(`SELECT strftime('%Y-%m', created_at, '${TZ}') AS m, COUNT(*) AS n, SUM(total_cents) AS rev
    FROM orders WHERE status IN ${SALE_STATUSES} AND created_at >= datetime('now', '-400 days') GROUP BY m`).all().map((r) => [r.m, r]));
  const buys = new Map(db.prepare(`SELECT substr(bought_on, 1, 7) AS m, SUM(cost_cents) AS cost
    FROM supplier_purchases WHERE bought_on >= date('now', '-400 days') GROUP BY m`).all().map((r) => [r.m, r]));
  const now = new Date(Date.now() + OFFSET_H * 3600e3);
  const out = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const m = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push({ month: m, orders: sales.get(m)?.n || 0, revenue: (sales.get(m)?.rev || 0) / 100, purchases: (buys.get(m)?.cost || 0) / 100 });
  }
  return out;
}

function report(days) {
  const p = period('o.created_at', days);
  const sale = `o.status IN ${SALE_STATUSES} AND ${p.sql}`;

  const current = salesTotals(days, 0);
  const previous = days ? salesTotals(days, 1) : null;

  const pending = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS amount FROM orders o
    WHERE o.status = 'nuevo' AND ${p.sql}`).get(...p.args);

  const byStatus = db.prepare(`SELECT status, COUNT(*) AS n, SUM(total_cents) AS amount FROM orders o
    WHERE ${p.sql} GROUP BY status`).all(...p.args).map((r) => ({ status: r.status, orders: r.n, amount: r.amount / 100 }));

  const topProducts = db.prepare(`SELECT json_extract(j.value, '$.id') AS id, json_extract(j.value, '$.name') AS name,
      SUM(json_extract(j.value, '$.qty')) AS units,
      SUM(json_extract(j.value, '$.qty') * json_extract(j.value, '$.price_cents')) AS rev
    FROM orders o, json_each(o.items) j WHERE ${sale}
    GROUP BY 1 ORDER BY units DESC, rev DESC LIMIT 8`).all(...p.args).map((r) => ({ ...r, revenue: r.rev / 100 }));

  const byCategory = db.prepare(`SELECT COALESCE(c.name, 'Sin categoría') AS name,
      SUM(json_extract(j.value, '$.qty')) AS units,
      SUM(json_extract(j.value, '$.qty') * json_extract(j.value, '$.price_cents')) AS rev
    FROM orders o, json_each(o.items) j
    LEFT JOIN products pr ON pr.id = json_extract(j.value, '$.id')
    LEFT JOIN categories c ON c.id = pr.category_id
    WHERE ${sale} GROUP BY 1 ORDER BY rev DESC`).all(...p.args).map((r) => ({ name: r.name, units: r.units, revenue: r.rev / 100 }));

  const topCustomers = db.prepare(`SELECT cu.id, cu.name, COUNT(o.id) AS orders, SUM(o.total_cents) AS spent
    FROM orders o JOIN customers cu ON cu.id = o.customer_id WHERE ${sale}
    GROUP BY cu.id ORDER BY spent DESC LIMIT 8`).all(...p.args).map((r) => ({ ...r, spent: r.spent / 100 }));

  // Clientes: nuevos en el periodo y cuántos de los que compraron ya habían comprado antes (recurrentes).
  const pc = period('created_at', days);
  const newCustomers = db.prepare(`SELECT COUNT(*) AS n FROM customers WHERE ${pc.sql}`).get(...pc.args).n;
  const buyers = db.prepare(`SELECT o.customer_id AS id,
      (SELECT COUNT(*) FROM orders x WHERE x.customer_id = o.customer_id AND x.status IN ${SALE_STATUSES}) AS lifetime
    FROM orders o WHERE o.customer_id IS NOT NULL AND ${sale} GROUP BY o.customer_id`).all(...p.args);
  const repeat = buyers.filter((b) => b.lifetime >= 2).length;
  const totals = db.prepare(`SELECT COUNT(*) AS customers, SUM(opt_in) AS opt_in FROM customers`).get();

  // Compras a proveedores: prendas vs accesorios (solo compras registradas con detalle).
  const pp = periodDate('sp.bought_on', days);
  const byKind = db.prepare(`SELECT i.kind, SUM(i.qty) AS units, SUM(i.qty * i.unit_cost_cents) AS cost
    FROM supplier_purchase_items i JOIN supplier_purchases sp ON sp.id = i.purchase_id
    WHERE ${pp.sql} GROUP BY i.kind`).all(...pp.args).map((r) => ({ kind: r.kind, units: r.units, cost: r.cost / 100 }));

  const lowStock = db.prepare(`SELECT id, name, stock FROM products WHERE active = 1 AND stock IS NOT NULL AND stock <= 3
    ORDER BY stock, name LIMIT 12`).all();

  const buys = purchaseTotals(days, 0);

  return {
    days,
    sales: current,
    previous,
    pending: { orders: pending.n, amount: pending.amount / 100 },
    by_status: byStatus,
    monthly: monthly(),
    top_products: topProducts,
    by_category: byCategory,
    top_customers: topCustomers,
    customers: {
      total: totals.customers, opt_in: totals.opt_in || 0, new: newCustomers,
      buyers: buyers.length, repeat, repeat_rate: buyers.length ? repeat / buyers.length : 0,
    },
    purchases: { ...buys, by_kind: byKind, result: current.revenue - buys.cost },
    low_stock: lowStock,
  };
}

function register({ route }) {
  route('GET', '/api/admin/reports', ({ query }) => {
    const d = Number.parseInt(query.get('days'), 10);
    return report([7, 30, 90, 365].includes(d) ? d : 0);
  }, { admin: true });
}

module.exports = { register };
