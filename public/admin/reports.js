'use strict';
// Resumen y reportería del panel. Los números vienen de /api/admin/reports (calculados en reports.js del servidor).

const R = { days: 30 };
const PERIODS = [[7, '7 días'], [30, '30 días'], [90, '90 días'], [365, '12 meses'], [0, 'Todo']];
// Colores de gráficos, validados para daltonismo (no cambian con el color de la marca).
const SERIES = { ventas: '#892E54', compras: '#2A7FA8' };
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const monthLabel = (m, withYear) => { const [y, mo] = m.split('-'); return `${MONTHS[Number(mo) - 1]}${withYear ? ` ${y.slice(2)}` : ''}`; };
const pct = (x) => `${Math.round(x * 100)} %`;

function reportsView() {
  return asyncView(() => call(`/api/admin/reports?days=${R.days}`), renderReports);
}

function delta(now, before) {
  if (before == null) return null;
  if (!before) return now ? h('span', { class: 'delta up' }, 'Nuevo') : null;
  const d = (now - before) / before;
  const cls = d > 0.005 ? 'up' : d < -0.005 ? 'down' : 'flat';
  const arrow = cls === 'up' ? '▲' : cls === 'down' ? '▼' : '■';
  return h('span', { class: `delta ${cls}` }, `${arrow} ${Math.abs(Math.round(d * 100))} % vs. periodo anterior`);
}

function kpi(label, value, extra, hint) {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-l' }, label), h('span', { class: 'stat-v' }, value), extra || null, hint ? h('span', { class: 'stat-h' }, hint) : null);
}

function renderReports(r) {
  const s = r.sales, p = r.previous;
  const periodBar = h('div', { class: 'seg-btns', role: 'group', 'aria-label': 'Periodo' },
    PERIODS.map(([d, label]) => h('button', {
      class: 'chip-btn', type: 'button', 'aria-pressed': String(R.days === d),
      onclick: () => { R.days = d; route(); },
    }, label)));

  const periodName = R.days ? `últimos ${PERIODS.find((x) => x[0] === R.days)[1]}` : 'desde el inicio';

  return h('div', { class: 'reports' },
    h('div', { class: 'panel-head' },
      h('div', {}, h('h2', { class: 'title' }, 'Resumen'), h('p', { class: 'muted' }, `Cómo va tu tienda: ${periodName}.`)),
      periodBar),

    h('div', { class: 'stats kpis' },
      kpi('Ventas confirmadas', money(s.revenue), p ? delta(s.revenue, p.revenue) : null),
      kpi('Pedidos', s.orders, p ? delta(s.orders, p.orders) : null),
      kpi('Ticket promedio', s.orders ? money(s.avg_ticket) : '—', null, 'Lo que gasta un cliente por pedido'),
      kpi('Unidades vendidas', s.units),
      kpi('Por confirmar', money(r.pending.amount), null, `${plural(r.pending.orders, 'pedido nuevo', 'pedidos nuevos')} sin confirmar`)),

    h('div', { class: 'stats kpis' },
      kpi('Clientes nuevos', r.customers.new),
      kpi('Compraron en el periodo', r.customers.buyers),
      kpi('Clientes recurrentes', r.customers.buyers ? pct(r.customers.repeat_rate) : '—', null, 'De los que compraron, cuántos ya habían comprado antes'),
      kpi('Compras a proveedor', money(r.purchases.cost), null, `${plural(r.purchases.items, 'unidad', 'unidades')} en ${plural(r.purchases.purchases, 'compra', 'compras')}`),
      kpi('Ventas − compras', money(r.purchases.result), null, 'Cuánto entró menos lo que gastaste en mercadería')),

    h('section', { class: 'box' },
      h('div', { class: 'box-head' },
        h('div', {}, h('h3', { class: 'sub' }, 'Ventas y compras por mes'), h('p', { class: 'muted' }, 'Últimos 12 meses, sin importar el periodo elegido arriba.'))),
      monthlyChart(r.monthly)),

    h('div', { class: 'rep-grid' },
      h('section', { class: 'box' }, h('h3', { class: 'sub' }, 'Lo más vendido'), h('p', { class: 'muted' }, 'Por unidades, en el periodo.'),
        rankList(r.top_products, (x) => x.units, (x) => `${plural(x.units, 'unidad', 'unidades')} · ${money(x.revenue)}`, 'Aún no hay ventas confirmadas en este periodo.')),
      h('section', { class: 'box' }, h('h3', { class: 'sub' }, 'Ventas por categoría'), h('p', { class: 'muted' }, 'En dinero, en el periodo.'),
        rankList(r.by_category, (x) => x.revenue, (x) => `${money(x.revenue)} · ${plural(x.units, 'unidad', 'unidades')}`, 'Aún no hay ventas confirmadas en este periodo.')),
      h('section', { class: 'box' }, h('h3', { class: 'sub' }, 'Mejores clientes'), h('p', { class: 'muted' }, 'Quiénes más compraron en el periodo.'),
        r.top_customers.length
          ? h('table', { class: 'dtable compact' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Cliente'), h('th', { class: 'num' }, 'Pedidos'), h('th', { class: 'num' }, 'Total'))),
            h('tbody', {}, r.top_customers.map((c) => h('tr', {},
              h('td', {}, h('a', { href: `#clientes/${c.id}` }, c.name)), h('td', { class: 'num' }, c.orders), h('td', { class: 'num nowrap' }, money(c.spent))))))
          : h('p', { class: 'empty-small' }, 'Aún no hay ventas confirmadas en este periodo.')),
      h('section', { class: 'box' }, h('h3', { class: 'sub' }, 'Pedidos por estado'), h('p', { class: 'muted' }, 'Todos los pedidos del periodo.'),
        r.by_status.length
          ? h('table', { class: 'dtable compact' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Estado'), h('th', { class: 'num' }, 'Pedidos'), h('th', { class: 'num' }, 'Monto'))),
            h('tbody', {}, Object.keys(STATUS).map((k) => r.by_status.find((x) => x.status === k)).filter(Boolean).map((x) => h('tr', {},
              h('td', {}, h('span', { class: `st-chip st-${x.status}` }, STATUS[x.status])), h('td', { class: 'num' }, x.orders), h('td', { class: 'num nowrap' }, money(x.amount))))))
          : h('p', { class: 'empty-small' }, 'No hay pedidos en este periodo.')),
      h('section', { class: 'box' }, h('h3', { class: 'sub' }, 'Compras: prendas y accesorios'), h('p', { class: 'muted' }, 'Solo compras registradas con detalle, en el periodo.'),
        kindSplit(r.purchases.by_kind)),
      h('section', { class: 'box' }, h('h3', { class: 'sub' }, 'Stock bajo'), h('p', { class: 'muted' }, 'Prendas visibles con 3 unidades o menos.'),
        r.low_stock.length
          ? h('ul', { class: 'stock-list' }, r.low_stock.map((x) => h('li', {}, h('span', {}, x.name),
            h('span', { class: x.stock <= 0 ? 'out' : 'warn' }, x.stock <= 0 ? 'Agotada' : `Quedan ${x.stock}`))))
          : h('p', { class: 'empty-small' }, 'Todo bien: ninguna prenda está por agotarse.'))),

    h('section', { class: 'box' },
      h('h3', { class: 'sub' }, 'Descargar datos'),
      h('p', { class: 'muted' }, 'Archivos CSV que abres en Excel o Google Sheets. Útiles para tu contador o para analizar a tu manera.'),
      h('div', { class: 'head-actions' },
        h('button', { class: 'btn btn-small', type: 'button', onclick: exportOrders }, 'Pedidos'),
        h('button', { class: 'btn btn-small', type: 'button', onclick: exportOrderLines }, 'Detalle de productos vendidos'),
        h('button', { class: 'btn btn-small', type: 'button', onclick: async () => exportCustomers(await loadCustomers()) }, 'Clientes'),
        h('button', { class: 'btn btn-small', type: 'button', onclick: exportPurchases }, 'Compras a proveedor'))));
}

// ------------------------------------------------------------------ gráfico de barras por mes

function niceMax(v) {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 4, 6, 8, 10].map((m) => m * p).find((m) => m >= v); // divisible en 4 tramos redondos
}
const short = (n) => (n >= 1000 ? `${(n / 1000).toLocaleString('es-PE', { maximumFractionDigits: 1 })} mil` : String(Math.round(n)));

function monthlyChart(data) {
  // En el celular se dibuja más angosto para que los textos no se encojan hasta ser ilegibles.
  const narrow = matchMedia('(max-width: 600px)').matches;
  const W = narrow ? 360 : 720, H = narrow ? 220 : 240, L = narrow ? 40 : 52, Rt = 8, T = 12, B = 28;
  const max = niceMax(Math.max(...data.map((d) => Math.max(d.revenue, d.purchases))));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const step = (W - L - Rt) / data.length;
  const bw = Math.min(16, (step - 10) / 2); // barras finas, con 2px de separación entre ellas
  const ns = 'http://www.w3.org/2000/svg';
  const s = (tag, attrs, text) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text != null) el.textContent = text;
    return el;
  };
  // Barra con las puntas superiores redondeadas (4px) y la base recta, apoyada en el eje.
  const bar = (x, v, color) => {
    if (v <= 0) return null;
    const top = y(v), base = y(0), r = Math.min(4, (base - top) / 2, bw / 2);
    return s('path', { d: `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${base} Z`, fill: color });
  };

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Ventas y compras de los últimos 12 meses. La tabla de abajo tiene los mismos datos.' });
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, yy = y(v);
    svg.append(s('line', { x1: L, x2: W - Rt, y1: yy, y2: yy, class: i ? 'grid' : 'axis' }));
    svg.append(s('text', { x: L - 8, y: yy + 4, 'text-anchor': 'end', class: 'tick' }, short(v)));
  }
  const tip = h('div', { class: 'tip', hidden: true });
  const wrap = h('div', { class: 'chart-wrap' });
  data.forEach((d, i) => {
    const x0 = L + step * i + (step - (bw * 2 + 2)) / 2;
    const g = s('g', { class: 'col' });
    g.append(s('rect', { x: L + step * i, y: T, width: step, height: H - T - B, class: 'hit' }));
    [bar(x0, d.revenue, SERIES.ventas), bar(x0 + bw + 2, d.purchases, SERIES.compras)].forEach((b) => b && g.append(b));
    const showYear = i === 0 || d.month.endsWith('-01');
    if (!narrow || i % 2 === 1) g.append(s('text', { x: L + step * i + step / 2, y: H - 8, 'text-anchor': 'middle', class: 'tick' }, monthLabel(d.month, showYear && !narrow)));
    const show = () => {
      g.classList.add('on');
      tip.replaceChildren(h('strong', {}, monthLabel(d.month, true)),
        h('span', {}, h('i', { class: 'sw', style: `background:${SERIES.ventas}` }), `Ventas ${money(d.revenue)}`),
        h('span', {}, h('i', { class: 'sw', style: `background:${SERIES.compras}` }), `Compras ${money(d.purchases)}`),
        h('span', { class: 'muted' }, plural(d.orders, 'pedido', 'pedidos')));
      tip.hidden = false;
      const left = ((L + step * i + step / 2) / W) * 100;
      tip.style.left = `${Math.min(80, Math.max(8, left))}%`;
    };
    const hide = () => { g.classList.remove('on'); tip.hidden = true; };
    g.addEventListener('pointerenter', show);
    g.addEventListener('pointerleave', hide);
    svg.append(g);
  });

  const legend = h('div', { class: 'legend' },
    h('span', {}, h('i', { class: 'sw', style: `background:${SERIES.ventas}` }), 'Ventas confirmadas'),
    h('span', {}, h('i', { class: 'sw', style: `background:${SERIES.compras}` }), 'Compras a proveedor'));

  const table = h('div', { class: 'table-wrap', hidden: true }, h('table', { class: 'dtable compact' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Mes'), h('th', { class: 'num' }, 'Pedidos'), h('th', { class: 'num' }, 'Ventas'), h('th', { class: 'num' }, 'Compras'), h('th', { class: 'num' }, 'Diferencia'))),
    h('tbody', {}, [...data].reverse().map((d) => h('tr', {}, h('td', {}, monthLabel(d.month, true)), h('td', { class: 'num' }, d.orders),
      h('td', { class: 'num nowrap' }, money(d.revenue)), h('td', { class: 'num nowrap' }, money(d.purchases)), h('td', { class: 'num nowrap' }, money(d.revenue - d.purchases)))))));
  const toggle = h('button', {
    class: 'link-btn', type: 'button', 'aria-expanded': 'false',
    onclick: () => { table.hidden = !table.hidden; toggle.setAttribute('aria-expanded', String(!table.hidden)); toggle.textContent = table.hidden ? 'Ver como tabla' : 'Ocultar tabla'; },
  }, 'Ver como tabla');

  wrap.append(svg, tip);
  return h('div', {}, h('div', { class: 'legend-row' }, legend, toggle), wrap, table);
}

// ------------------------------------------------------------------ listas con barra

function rankList(items, value, label, emptyText) {
  if (!items.length) return h('p', { class: 'empty-small' }, emptyText);
  const max = Math.max(...items.map(value)) || 1;
  return h('ol', { class: 'rank' }, items.map((x) => h('li', {},
    h('div', { class: 'rank-top' }, h('span', { class: 'rank-name' }, x.name), h('span', { class: 'rank-val' }, label(x))),
    h('div', { class: 'rank-track' }, h('span', { class: 'rank-bar', style: `width:${Math.max(2, (value(x) / max) * 100)}%; background:${SERIES.ventas}` })))));
}

function kindSplit(byKind) {
  const get = (k) => byKind.find((x) => x.kind === k) || { units: 0, cost: 0 };
  const pr = get('prenda'), ac = get('accesorio');
  if (!pr.units && !ac.units) return h('p', { class: 'empty-small' }, 'Registra compras con detalle en "Compras Shein" para ver esta división.');
  const tile = (label, x) => h('div', { class: 'stat' }, h('span', { class: 'stat-l' }, label), h('span', { class: 'stat-v' }, x.units),
    h('span', { class: 'stat-h' }, `${money(x.cost)} · ${x.units ? money(x.cost / x.units) : '—'} c/u`));
  return h('div', { class: 'stats two' }, tile('Prendas', pr), tile('Accesorios', ac));
}

// ------------------------------------------------------------------ exportar

async function exportOrders() {
  A.orders = await call('/api/admin/orders'); // pueden haber llegado pedidos nuevos
  downloadCsv(`pedidos-${today()}.csv`, ['Código', 'Fecha', 'Estado', 'Cliente', 'Celular', 'Correo', 'Unidades', 'Total', 'Notas'],
    A.orders.map((o) => [o.code, o.created_at, STATUS[o.status], o.customer_name, o.customer_phone, o.customer_email || '',
      o.items.reduce((n, i) => n + i.qty, 0), o.total.toFixed(2), o.notes]));
}

async function exportOrderLines() {
  A.orders = await call('/api/admin/orders');
  downloadCsv(`productos-vendidos-${today()}.csv`, ['Código', 'Fecha', 'Estado', 'Cliente', 'Producto', 'Talla', 'Color', 'Cantidad', 'Precio', 'Subtotal'],
    A.orders.flatMap((o) => o.items.map((i) => [o.code, o.created_at, STATUS[o.status], o.customer_name, i.name, i.size, i.color, i.qty, i.price.toFixed(2), (i.price * i.qty).toFixed(2)])));
}

function exportPurchases() {
  downloadCsv(`compras-proveedor-${today()}.csv`, ['Cuenta', 'Fecha', 'Producto', 'Tipo', 'Unidades', 'Precio unitario', 'Subtotal', 'Envío de la compra', 'Total de la compra', 'Nota'],
    A.accounts.flatMap((a) => a.purchases.flatMap((p) => (p.lines.length
      ? p.lines.map((l, i) => [a.email, p.date, l.name, l.kind, l.qty, l.price.toFixed(2), (l.price * l.qty).toFixed(2), i ? '' : p.shipping.toFixed(2), i ? '' : p.cost.toFixed(2), i ? '' : p.description])
      : [[a.email, p.date, '(sin detalle)', '', p.items, '', '', '', p.cost.toFixed(2), p.description]]))));
}
