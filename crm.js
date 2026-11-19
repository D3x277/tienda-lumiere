'use strict';
// CRM: clientes, su historial (registros) y campañas masivas por WhatsApp.
// server.js llama a register() y le pasa sus utilidades para no repetirlas.

const { db, tx, normPhone } = require('./db');

// Un pedido cuenta como venta cuando ya se confirmó (los "nuevos" aún no se pagan).
const SALE_STATUSES = "('confirmado','enviado','entregado')";

// Compras de un cliente = pedidos de la tienda + ventas registradas a mano (WhatsApp, Instagram, en persona…).
// Las ventas registradas con canal "tienda" no se suman: ese dinero ya está en su pedido.
const MANUAL_SALES = "FROM sales s WHERE s.customer_id = c.id AND s.channel != 'tienda'";
const CUSTOMER_STATS = `
  SELECT c.*,
    (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status != 'cancelado')
      + (SELECT COUNT(*) ${MANUAL_SALES}) AS orders_count,
    (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status IN ${SALE_STATUSES})
      + (SELECT COUNT(*) ${MANUAL_SALES}) AS buys_count,
    (SELECT COALESCE(SUM(o.total_cents), 0) FROM orders o WHERE o.customer_id = c.id AND o.status IN ${SALE_STATUSES})
      + (SELECT COALESCE(SUM(s.price_cents * s.qty), 0) ${MANUAL_SALES}) AS spent_cents,
    (SELECT MAX(x) FROM (
      SELECT MAX(o.created_at) AS x FROM orders o WHERE o.customer_id = c.id AND o.status != 'cancelado'
      UNION ALL SELECT MAX(s.sold_on || ' 12:00:00') ${MANUAL_SALES})) AS last_order_at
  FROM customers c`;

const toCustomer = (r) => ({
  id: r.id, name: r.name, phone: r.phone || '', email: r.email || '', district: r.district,
  tags: JSON.parse(r.tags), notes: r.notes, opt_in: !!r.opt_in, opt_in_at: r.opt_in_at, source: r.source,
  created_at: r.created_at, orders_count: r.orders_count, buys_count: r.buys_count,
  spent: r.spent_cents / 100, last_order_at: r.last_order_at,
});

const ACTIVITY_KINDS = ['nota', 'llamada', 'whatsapp', 'campaña', 'sistema'];
const logActivity = (customerId, kind, body) =>
  db.prepare('INSERT INTO customer_activities (customer_id, kind, body) VALUES (?, ?, ?)').run(customerId, kind, body);

function register({ route, HttpError, bad, str, money, readJson, intParam, toOrder, cleanList, EMAIL_RE }) {
  const admin = { admin: true };

  const getCustomer = (id) => {
    const r = db.prepare(`SELECT * FROM (${CUSTOMER_STATS}) WHERE id = ?`).get(id);
    if (!r) throw new HttpError(404, 'El cliente no existe');
    return toCustomer(r);
  };
  const listCustomers = () =>
    db.prepare(`SELECT * FROM (${CUSTOMER_STATS}) ORDER BY COALESCE(last_order_at, created_at) DESC`).all().map(toCustomer);

  function cleanCustomer(b) {
    const name = str(b.name, 80);
    if (!name) throw bad('Escribe el nombre del cliente');
    const rawPhone = str(b.phone, 30);
    const phone = rawPhone ? normPhone(rawPhone) : null;
    if (rawPhone && !phone) throw bad('El teléfono debe tener entre 8 y 15 dígitos');
    const email = str(b.email, 120).toLowerCase() || null;
    if (email && !EMAIL_RE.test(email)) throw bad('El correo no es válido');
    return {
      name, phone, email,
      district: str(b.district, 60),
      tags: cleanList(b.tags, 12, 24),
      notes: str(b.notes, 1000),
      opt_in: b.opt_in === true ? 1 : 0,
    };
  }

  const uniqueError = (e) => {
    const m = String(e.message);
    if (m.includes('customers.phone')) throw new HttpError(409, 'Ya existe un cliente con ese teléfono');
    if (m.includes('customers.email')) throw new HttpError(409, 'Ya existe un cliente con ese correo');
    throw e;
  };

  // ------------------------------------------------------------ clientes

  route('GET', '/api/admin/customers', () => listCustomers(), admin);

  route('POST', '/api/admin/customers', async ({ req }) => {
    const c = cleanCustomer(await readJson(req));
    let id;
    try {
      id = Number(db.prepare(`INSERT INTO customers (name, phone, email, district, tags, notes, opt_in, opt_in_at, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? THEN datetime('now') END, 'manual')`)
        .run(c.name, c.phone, c.email, c.district, JSON.stringify(c.tags), c.notes, c.opt_in, c.opt_in).lastInsertRowid);
    } catch (e) { uniqueError(e); }
    if (c.opt_in) logActivity(id, 'sistema', 'Aceptó recibir promociones (registrado a mano)');
    return getCustomer(id);
  }, admin);

  route('GET', '/api/admin/customers/:id', ({ params }) => {
    const id = intParam(params.id);
    const customer = getCustomer(id);
    return {
      customer,
      orders: db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY id DESC').all(id).map(toOrder),
      activities: db.prepare('SELECT id, kind, body, created_at FROM customer_activities WHERE customer_id = ? ORDER BY id DESC').all(id),
    };
  }, admin);

  route('PUT', '/api/admin/customers/:id', async ({ req, params }) => {
    const id = intParam(params.id);
    const before = getCustomer(id);
    const c = cleanCustomer(await readJson(req));
    try {
      db.prepare(`UPDATE customers SET name = ?, phone = ?, email = ?, district = ?, tags = ?, notes = ?, opt_in = ?,
        opt_in_at = CASE WHEN ? AND opt_in = 0 THEN datetime('now') ELSE opt_in_at END, updated_at = datetime('now') WHERE id = ?`)
        .run(c.name, c.phone, c.email, c.district, JSON.stringify(c.tags), c.notes, c.opt_in, c.opt_in, id);
    } catch (e) { uniqueError(e); }
    // Dejar constancia del consentimiento: es lo que te permite enviar promociones.
    if (!before.opt_in && c.opt_in) logActivity(id, 'sistema', 'Aceptó recibir promociones');
    if (before.opt_in && !c.opt_in) logActivity(id, 'sistema', 'Ya no quiere recibir promociones');
    return getCustomer(id);
  }, admin);

  route('DELETE', '/api/admin/customers/:id', ({ params }) => {
    db.prepare('DELETE FROM customers WHERE id = ?').run(intParam(params.id)); // sus pedidos se conservan, sin cliente
    return { ok: true };
  }, admin);

  route('POST', '/api/admin/customers/:id/activities', async ({ req, params }) => {
    const id = intParam(params.id);
    getCustomer(id);
    const b = await readJson(req);
    const body = str(b.body, 2000);
    if (!body) throw bad('Escribe algo en el registro');
    const kind = ACTIVITY_KINDS.includes(b.kind) && b.kind !== 'sistema' ? b.kind : 'nota';
    logActivity(id, kind, body);
    return db.prepare('SELECT id, kind, body, created_at FROM customer_activities WHERE customer_id = ? ORDER BY id DESC').all(id);
  }, admin);

  route('DELETE', '/api/admin/activities/:id', ({ params }) => {
    db.prepare("DELETE FROM customer_activities WHERE id = ? AND kind NOT IN ('sistema', 'campaña')").run(intParam(params.id));
    return { ok: true };
  }, admin);

  // Etiquetar varios clientes a la vez.
  route('POST', '/api/admin/customers/bulk', async ({ req }) => {
    const b = await readJson(req);
    const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter((n) => n > 0).slice(0, 5000) : [];
    const add = str(b.add_tag, 24), remove = str(b.remove_tag, 24);
    if (!ids.length || (!add && !remove)) throw bad('Elige clientes y una etiqueta');
    tx(() => {
      for (const id of ids) {
        const row = db.prepare('SELECT tags FROM customers WHERE id = ?').get(id);
        if (!row) continue;
        let tags = JSON.parse(row.tags);
        if (add && !tags.includes(add) && tags.length < 12) tags.push(add);
        if (remove) tags = tags.filter((t) => t !== remove);
        db.prepare("UPDATE customers SET tags = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(tags), id);
      }
    });
    return listCustomers();
  }, admin);

  // Eliminar varios clientes a la vez (sus pedidos se conservan, sin cliente).
  route('POST', '/api/admin/customers/bulk-delete', async ({ req }) => {
    const b = await readJson(req);
    const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter((n) => n > 0).slice(0, 5000) : [];
    if (!ids.length) throw bad('Elige al menos un cliente');
    const del = db.prepare('DELETE FROM customers WHERE id = ?');
    tx(() => ids.forEach((id) => del.run(id)));
    return listCustomers();
  }, admin);

  // Importar desde una hoja de cálculo (CSV leído en el navegador).
  route('POST', '/api/admin/customers/import', async ({ req }) => {
    const { rows } = await readJson(req);
    if (!Array.isArray(rows) || !rows.length) throw bad('El archivo no tiene filas');
    if (rows.length > 2000) throw bad('Máximo 2000 clientes por archivo');
    const result = { created: 0, updated: 0, skipped: 0 };
    tx(() => {
      for (const r of rows) {
        const name = str(String(r.name ?? ''), 80);
        const phone = normPhone(r.phone);
        const emailRaw = str(String(r.email ?? ''), 120).toLowerCase();
        const email = EMAIL_RE.test(emailRaw) ? emailRaw : null;
        if (!name || (!phone && !email)) { result.skipped++; continue; }
        const tags = cleanList(String(r.tags ?? '').split(/[;,|]/), 12, 24);
        const district = str(String(r.district ?? ''), 60);
        const existing = (phone && db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone))
          || (email && db.prepare('SELECT * FROM customers WHERE email = ?').get(email));
        if (existing) {
          const merged = [...new Set([...JSON.parse(existing.tags), ...tags])].slice(0, 12);
          db.prepare(`UPDATE customers SET district = CASE WHEN district = '' THEN ? ELSE district END, tags = ?,
            email = COALESCE(email, ?), phone = COALESCE(phone, ?), updated_at = datetime('now') WHERE id = ?`)
            .run(district, JSON.stringify(merged),
              email && !db.prepare('SELECT 1 FROM customers WHERE email = ?').get(email) ? email : null,
              phone && !db.prepare('SELECT 1 FROM customers WHERE phone = ?').get(phone) ? phone : null, existing.id);
          result.updated++;
        } else {
          const optIn = r.opt_in === true ? 1 : 0;
          const id = Number(db.prepare(`INSERT INTO customers (name, phone, email, district, tags, opt_in, opt_in_at, source)
            VALUES (?, ?, ?, ?, ?, ?, CASE WHEN ? THEN datetime('now') END, 'importado')`)
            .run(name, phone, email, district, JSON.stringify(tags), optIn, optIn).lastInsertRowid);
          if (optIn) logActivity(id, 'sistema', 'Aceptó recibir promociones (según el archivo importado)');
          result.created++;
        }
      }
    });
    return { ...result, customers: listCustomers() };
  }, admin);

  // ------------------------------------------------------------ campañas

  function cleanSegment(s = {}) {
    const days = Number.parseInt(s.inactive_days, 10);
    const minSpent = s.min_spent === '' || s.min_spent == null ? 0 : money(s.min_spent);
    if (minSpent === null) throw bad('El monto mínimo no es válido');
    return {
      tag: str(s.tag, 24),
      bought: ['yes', 'no'].includes(s.bought) ? s.bought : 'any',
      inactive_days: Number.isInteger(days) && days > 0 && days <= 3650 ? days : 0,
      district: str(s.district, 60),
      min_spent: minSpent / 100,
    };
  }

  // Solo clientes que aceptaron promociones y tienen teléfono: así se respeta su consentimiento.
  function segmentCustomers(seg) {
    const where = ['opt_in = 1', 'phone IS NOT NULL'], args = [];
    if (seg.tag) { where.push('EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)'); args.push(seg.tag); }
    if (seg.bought === 'yes') where.push('orders_count > 0');
    if (seg.bought === 'no') where.push('orders_count = 0');
    if (seg.inactive_days) { where.push("orders_count > 0 AND last_order_at < datetime('now', ?)"); args.push(`-${seg.inactive_days} days`); }
    if (seg.district) { where.push('lower(district) = lower(?)'); args.push(seg.district); }
    if (seg.min_spent) { where.push('spent_cents >= ?'); args.push(Math.round(seg.min_spent * 100)); }
    return db.prepare(`SELECT * FROM (${CUSTOMER_STATS}) WHERE ${where.join(' AND ')} ORDER BY name`).all(...args);
  }

  const campaignSummary = (c) => {
    const n = db.prepare(`SELECT COUNT(*) AS total, SUM(status = 'enviado') AS sent, SUM(status = 'omitido') AS skipped
      FROM campaign_recipients WHERE campaign_id = ?`).get(c.id);
    return { id: c.id, name: c.name, message: c.message, segment: JSON.parse(c.segment), created_at: c.created_at,
      total: n.total, sent: n.sent || 0, skipped: n.skipped || 0 };
  };

  route('POST', '/api/admin/campaigns/preview', async ({ req }) => {
    const rows = segmentCustomers(cleanSegment((await readJson(req)).segment));
    return { count: rows.length, sample: rows.slice(0, 6).map((r) => r.name) };
  }, admin);

  route('GET', '/api/admin/campaigns', () =>
    db.prepare('SELECT * FROM campaigns ORDER BY id DESC').all().map(campaignSummary), admin);

  route('POST', '/api/admin/campaigns', async ({ req }) => {
    const b = await readJson(req);
    const name = str(b.name, 80);
    if (!name) throw bad('Ponle un nombre a la campaña, ej. "Liquidación de verano"');
    const message = str(b.message, 1500);
    if (!message) throw bad('Escribe el mensaje que vas a enviar');
    const seg = cleanSegment(b.segment);
    const rows = segmentCustomers(seg);
    if (!rows.length) throw bad('Ningún cliente cumple esos filtros (recuerda: solo los que aceptaron promociones)');
    // Se guarda la lista de destinatarios de este momento: si mañana entran clientes nuevos, no cambia.
    const id = tx(() => {
      const cid = Number(db.prepare('INSERT INTO campaigns (name, message, segment) VALUES (?, ?, ?)')
        .run(name, message, JSON.stringify(seg)).lastInsertRowid);
      const ins = db.prepare('INSERT INTO campaign_recipients (campaign_id, customer_id) VALUES (?, ?)');
      for (const r of rows) ins.run(cid, r.id);
      return cid;
    });
    return campaignSummary(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id));
  }, admin);

  route('GET', '/api/admin/campaigns/:id', ({ params }) => {
    const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(intParam(params.id));
    if (!c) throw new HttpError(404, 'La campaña no existe');
    const recipients = db.prepare(`SELECT r.customer_id, r.status, r.sent_at, cu.name, cu.phone, cu.opt_in
      FROM campaign_recipients r JOIN customers cu ON cu.id = r.customer_id
      WHERE r.campaign_id = ? ORDER BY cu.name`).all(c.id).map((r) => ({ ...r, opt_in: !!r.opt_in }));
    return { ...campaignSummary(c), recipients };
  }, admin);

  route('PUT', '/api/admin/campaigns/:id/recipients/:cid', async ({ req, params }) => {
    const id = intParam(params.id), cid = intParam(params.cid);
    const { status } = await readJson(req);
    if (!['pendiente', 'enviado', 'omitido'].includes(status)) throw bad('Estado no válido');
    const c = db.prepare('SELECT name FROM campaigns WHERE id = ?').get(id);
    const r = db.prepare(`SELECT r.status, cu.opt_in FROM campaign_recipients r JOIN customers cu ON cu.id = r.customer_id
      WHERE r.campaign_id = ? AND r.customer_id = ?`).get(id, cid);
    if (!c || !r) throw new HttpError(404, 'No encontrado');
    if (status === 'enviado' && !r.opt_in) throw new HttpError(409, 'Este cliente ya no acepta promociones');
    db.prepare(`UPDATE campaign_recipients SET status = ?, sent_at = CASE WHEN ? = 'enviado' THEN datetime('now') ELSE NULL END
      WHERE campaign_id = ? AND customer_id = ?`).run(status, status, id, cid);
    if (status === 'enviado' && r.status !== 'enviado') logActivity(cid, 'campaña', `Recibió la campaña «${c.name}» por WhatsApp`);
    return { ok: true };
  }, admin);

  route('DELETE', '/api/admin/campaigns/:id', ({ params }) => {
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(intParam(params.id));
    return { ok: true };
  }, admin);
}

module.exports = { register, SALE_STATUSES };
