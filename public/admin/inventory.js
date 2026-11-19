'use strict';
// Inventario y ventas: las tablas del reporte de compras (resumen por compra, por tipo y detalle por prenda),
// con proyecciones que se recalculan al cambiar un precio, y el registro de ventas con la ganancia real.
// Depende de dom.js y admin.js (A, call, toast, formModal, ffield, money, plural, num, pctFmt, PRICE_SOURCE…).

const I = { tab: 'resumen', month: '', account: '', type: '', status: '', q: '', sort: 'n', dir: 1, channel: '' };
const INV_TABS = [['resumen', 'Resumen'], ['prendas', 'Detalle por prenda'], ['ventas', 'Registro de ventas']];
const CHANNEL = { tienda: 'Tienda online', whatsapp: 'WhatsApp', instagram: 'Instagram', tiktok: 'TikTok', presencial: 'En persona', otro: 'Otro' };
const PAYMENT = { yape: 'Yape / Plin', transferencia: 'Transferencia', tarjeta: 'Tarjeta', efectivo: 'Efectivo', otro: 'Otro' };
const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const monthName = (m) => { const [y, mo] = m.split('-'); return `${MONTH_NAMES[Number(mo) - 1]} ${y}`; };
const margin = (gain, sale) => (sale ? pctFmt(gain / sale) : '—');
let INV = { sales: [], customers: [] };

function inventoryView() {
  return asyncView(async () => {
    const [accounts, sales, customers] = await Promise.all([call('/api/admin/accounts'), call('/api/admin/sales'), call('/api/admin/customers')]);
    A.accounts = accounts;
    INV = { sales, customers };
  }, renderInventory);
}

// Une compras, prendas y ventas en un solo modelo, con los filtros de mes y cuenta aplicados.
function buildModel() {
  const purchases = A.accounts
    .flatMap((a) => a.purchases.filter((p) => p.lines.length).map((p) => ({ ...p, email: a.email, account: a })))
    .filter((p) => (!I.month || p.date.startsWith(I.month)) && (!I.account || String(p.account_id) === I.account))
    .sort((x, y) => x.date.localeCompare(y.date) || x.id - y.id);
  const items = [];
  purchases.forEach((p, i) => {
    p.n = i + 1;
    const sum = p.lines.reduce((s, l) => s + l.price * l.qty, 0);
    p.factor = sum ? p.cost / sum : 1;
    p.lines.forEach((l) => items.push({ ...l, purchase: p, real: l.price * p.factor, n: items.length + 1 }));
  });
  return { purchases, items };
}

// Totales de un grupo de prendas: costo real, venta proyectada, ganancia, vendidas.
function totals(items) {
  const t = { units: 0, cost: 0, sale: 0, pricedCost: 0, unpriced: 0, sold: 0, left: 0, leftValue: 0 };
  for (const it of items) {
    t.units += it.qty; t.cost += it.real * it.qty; t.sold += it.sold; t.left += it.qty - it.sold;
    if (it.sale_price) { t.sale += it.sale_price * it.qty; t.pricedCost += it.real * it.qty; t.leftValue += it.sale_price * (it.qty - it.sold); }
    else t.unpriced += it.qty;
  }
  t.gain = t.sale - t.pricedCost;
  return t;
}

function salesTotals(list) {
  const t = { count: list.length, units: 0, revenue: 0, cost: 0, noCost: 0 };
  for (const s of list) {
    t.units += s.qty; t.revenue += s.price * s.qty;
    if (s.cost == null) t.noCost += s.qty; else t.cost += s.cost * s.qty;
  }
  t.gain = t.revenue - t.cost;
  return t;
}

function renderInventory() {
  const allMonths = [...new Set(A.accounts.flatMap((a) => a.purchases.map((p) => p.date.slice(0, 7))).concat(INV.sales.map((s) => s.date.slice(0, 7))))].sort().reverse();
  const root = h('div', { class: 'inv' });
  const body = h('div', {});
  const kpiBox = h('div', {});

  const sel = (value, label, options, onchange) => h('select', { class: 'select', value, 'aria-label': label, onchange: (e) => { onchange(e.target.value); draw(); } },
    options.map(([v, t]) => h('option', { value: v }, t)));

  function drawKpis() {
    const { purchases, items } = buildModel();
    const t = totals(items);
    const invested = purchases.reduce((s, p) => s + p.cost, 0);
    const itemIds = new Set(items.map((i) => i.id));
    const realSales = salesTotals(INV.sales.filter((s) => itemIds.has(s.item_id)));
    const tile = (label, value, hint, cls = '') => h('div', { class: `stat ${cls}` }, h('span', { class: 'stat-l' }, label), h('span', { class: 'stat-v' }, value), hint ? h('span', { class: 'stat-h' }, hint) : null);
    kpiBox.replaceChildren(
      h('p', { class: 'kpi-cap' }, 'Proyección'),
      h('div', { class: 'stats kpis' },
        tile('Invertido', money(invested), plural(purchases.length, 'compra', 'compras')),
        tile('Prendas', t.units, t.unpriced ? `${t.unpriced} sin precio de venta` : null),
        tile('Venta proyectada', money(t.sale)),
        tile('Ganancia proyectada', money(t.gain)),
        tile('Margen', margin(t.gain, t.sale), 'Ganancia ÷ venta')),
      h('p', { class: 'kpi-cap' }, 'Lo que ya pasó'),
      h('div', { class: 'stats kpis' },
        tile('Vendidas', `${t.sold} de ${t.units}`, t.units ? `${pctFmt(t.sold / t.units)} del inventario` : null),
        tile('Ingresos reales', money(realSales.revenue)),
        tile('Ganancia real', money(realSales.gain), realSales.revenue ? `Margen ${margin(realSales.gain, realSales.revenue)}` : null),
        tile('Recuperado', invested ? pctFmt(Math.min(1, realSales.revenue / invested)) : '—', 'De lo invertido, cuánto ya volvió'),
        tile('Por vender', plural(t.left, 'prenda', 'prendas'), t.leftValue ? `${money(t.leftValue)} a precio proyectado` : null)));
  }

  function draw() {
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === I.tab)));
    drawKpis();
    kpiBox.hidden = I.tab === 'ventas';
    body.replaceChildren(I.tab === 'resumen' ? resumenTab(drawKpis) : I.tab === 'prendas' ? prendasTab(drawKpis) : ventasTab());
  }

  const tabs = h('div', { class: 'seg-btns', role: 'group', 'aria-label': 'Vista' },
    INV_TABS.map(([id, label]) => h('button', { class: 'chip-btn', type: 'button', 'data-tab': id, onclick: () => { I.tab = id; draw(); } }, label)));

  const months = [['', 'Todos los meses'], ...allMonths.map((m) => [m, monthName(m)])];
  root.append(
    h('div', { class: 'panel-head' },
      h('div', {}, h('h2', { class: 'title' }, 'Inventario y ventas'),
        h('p', { class: 'muted' }, 'Lo que compraste, a cuánto lo venderías y lo que ya vendiste.')),
      h('div', { class: 'head-actions no-print' },
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => window.print() }, 'Imprimir / PDF'),
        h('button', { class: 'btn btn-small', type: 'button', onclick: exportInventory }, 'Descargar CSV'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openSaleEditor(null, null, draw) }, 'Registrar venta'))),
    h('div', { class: 'filterbar no-print' },
      tabs,
      h('span', { class: 'grow' }),
      sel(I.month, 'Mes', months, (v) => { I.month = v; }),
      A.accounts.length > 1 ? sel(I.account, 'Cuenta', [['', 'Todas las cuentas'], ...A.accounts.map((a) => [String(a.id), a.email])], (v) => { I.account = v; }) : null),
    h('p', { class: 'print-only print-title' }, `${A.settings.store_name}: ${I.month ? `compras de ${monthName(I.month)}` : 'inventario y ventas'}`),
    kpiBox, body);
  draw();
  return root;
}

// ------------------------------------------------------------------ pestaña: resumen

function resumenTab(onChange) {
  const { purchases, items } = buildModel();
  if (!purchases.length) return emptyInventory();
  const all = totals(items);
  const soldCell = (t) => h('td', { class: 'num' }, `${t.sold}/${t.units}`);

  const byPurchase = h('section', { class: 'box' },
    h('h3', { class: 'sub' }, 'Resumen por compra'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'dtable' },
      h('thead', {}, h('tr', {}, ['Compra', 'Fecha', 'Llegada', 'Prendas', 'Pagado', 'Venta proyectada', 'Ganancia', 'Margen', 'Vendidas', ''].map((c, i) => h('th', { class: i >= 3 && i <= 8 ? 'num' : '' }, c)))),
      h('tbody', {}, purchases.map((p) => {
        const t = totals(items.filter((it) => it.purchase === p));
        return h('tr', {},
          h('td', {}, h('strong', {}, `Compra ${p.n}`), h('span', { class: 'cell-sub' }, p.order_number || p.email)),
          h('td', { class: 'nowrap' }, dayLabel(p.date)), h('td', { class: 'nowrap' }, p.arrival || '—'),
          h('td', { class: 'num' }, t.units), h('td', { class: 'num nowrap' }, money(p.cost)),
          h('td', { class: 'num nowrap' }, money(t.sale)), h('td', { class: 'num nowrap' }, money(t.gain)),
          h('td', { class: 'num' }, margin(t.gain, t.sale)), soldCell(t),
          h('td', { class: 'no-print' }, h('button', { class: 'link-btn', type: 'button', onclick: () => openPurchaseEditor(p.account, p) }, 'Editar')));
      })),
      h('tfoot', {}, h('tr', {}, h('td', { colspan: '3' }, 'Total'), h('td', { class: 'num' }, all.units),
        h('td', { class: 'num nowrap' }, money(purchases.reduce((s, p) => s + p.cost, 0))), h('td', { class: 'num nowrap' }, money(all.sale)),
        h('td', { class: 'num nowrap' }, money(all.gain)), h('td', { class: 'num' }, margin(all.gain, all.sale)), soldCell(all), h('td', { class: 'no-print' }))))));

  // Por tipo, con un atajo para ponerle el mismo precio de venta a todas las prendas del tipo.
  const types = [...new Set(items.map((i) => i.type || 'Sin tipo'))];
  const byType = h('section', { class: 'box' },
    h('div', { class: 'box-head' }, h('h3', { class: 'sub' }, 'Resumen por tipo de prenda'),
      h('p', { class: 'muted no-print' }, 'Pon un precio en "Precio para todas" y toca Aplicar: la proyección se recalcula.')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'dtable' },
      h('thead', {}, h('tr', {}, ['Tipo de prenda', 'Prendas', 'Costo real', 'Venta proyectada', 'Ganancia', 'Margen', 'Vendidas'].map((c, i) => h('th', { class: i ? 'num' : '' }, c)),
        h('th', { class: 'no-print' }, 'Precio para todas'))),
      h('tbody', {}, types.map((type) => {
        const group = items.filter((i) => (i.type || 'Sin tipo') === type);
        const t = totals(group);
        const input = h('input', { class: 'input input-sm', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', placeholder: 'S/', 'aria-label': `Precio de venta para todas las prendas de tipo ${type}` });
        const apply = async () => {
          if (input.value === '') { input.focus(); return; }
          try {
            await call('/api/admin/purchase-items/price', { method: 'POST', body: { ids: group.map((g) => g.id), sale_price: input.value } });
            const price = Number(input.value);
            A.accounts.forEach((a) => a.purchases.forEach((p) => p.lines.forEach((l) => { if (group.some((g) => g.id === l.id)) l.sale_price = price; })));
            toast(`Precio aplicado a ${plural(group.length, 'prenda', 'prendas')}`); route();
          } catch (ex) { toast(ex.message); }
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
        return h('tr', {},
          h('td', {}, h('span', { class: 'kind' + (type === 'Accesorio' ? ' kind-accesorio' : ' kind-prenda') }, type)),
          h('td', { class: 'num' }, t.units), h('td', { class: 'num nowrap' }, money(t.cost)), h('td', { class: 'num nowrap' }, money(t.sale)),
          h('td', { class: 'num nowrap' }, money(t.gain)), h('td', { class: 'num' }, margin(t.gain, t.sale)), soldCell(t),
          h('td', { class: 'no-print' }, h('div', { class: 'apply-row' }, input, h('button', { class: 'btn btn-small', type: 'button', onclick: apply }, 'Aplicar'))));
      })),
      h('tfoot', {}, h('tr', {}, h('td', {}, 'Total'), h('td', { class: 'num' }, all.units), h('td', { class: 'num nowrap' }, money(all.cost)),
        h('td', { class: 'num nowrap' }, money(all.sale)), h('td', { class: 'num nowrap' }, money(all.gain)), h('td', { class: 'num' }, margin(all.gain, all.sale)),
        soldCell(all), h('td', { class: 'no-print' }))))));

  return h('div', {}, byPurchase, byType,
    h('div', { class: 'box notes-box' }, h('h3', { class: 'sub' }, 'Cómo se calcula'),
      h('ul', {},
        h('li', {}, 'Costo real = precio de la prenda en el pedido + su parte proporcional del envío, impuestos y descuentos. Así la suma de los costos es exactamente lo que pagaste.'),
        h('li', {}, 'Ganancia proyectada = precio de venta − costo real. Margen = ganancia ÷ precio de venta. Solo cuentan las prendas que tienen precio de venta.'),
        h('li', {}, 'Es ganancia bruta: no incluye envíos a clientas, empaques, publicidad ni comisiones.'))));
}

function emptyInventory() {
  return h('div', { class: 'empty-note box' }, h('strong', {}, 'No hay compras con detalle en este periodo'),
    'Registra tus compras en "Compras Shein" con el detalle de cada prenda, o cambia el mes de arriba.',
    h('div', {}, h('a', { class: 'btn btn-primary', href: '#cuentas' }, 'Ir a Compras Shein')));
}

// ------------------------------------------------------------------ pestaña: detalle por prenda

function prendasTab(onChange) {
  const { purchases, items } = buildModel();
  if (!purchases.length) return emptyInventory();
  const types = [...new Set(items.map((i) => i.type || 'Sin tipo'))];
  const tbody = h('tbody', {});
  const count = h('p', { class: 'muted count-line' });

  const COLS = [
    ['n', '#', 'num'], ['compra', 'Compra', ''], ['name', 'Prenda', ''], ['variant', 'Talla / color', ''], ['type', 'Tipo', ''],
    ['price', 'Precio en pedido', 'num'], ['real', 'Costo real', 'num'], ['sale', 'Precio de venta', 'num'], ['gain', 'Ganancia', 'num'],
    ['margin', 'Margen', 'num'], ['source', 'Origen del precio', ''], ['status', 'Estado', ''],
  ];
  const val = {
    n: (i) => i.n, compra: (i) => i.purchase.n, name: (i) => i.name.toLowerCase(), variant: (i) => i.variant, type: (i) => i.type,
    price: (i) => i.price, real: (i) => i.real, sale: (i) => i.sale_price || 0, gain: (i) => (i.sale_price ? i.sale_price - i.real : -1e9),
    margin: (i) => (i.sale_price ? (i.sale_price - i.real) / i.sale_price : -1), source: (i) => i.price_source, status: (i) => i.sold / i.qty,
  };

  const headRow = h('tr', {});
  const drawHead = () => headRow.replaceChildren(...COLS.map(([k, label, cls]) => h('th', { class: cls, 'aria-sort': I.sort === k ? (I.dir > 0 ? 'ascending' : 'descending') : null },
    h('button', { class: 'sort-btn', type: 'button', onclick: () => { I.dir = I.sort === k ? -I.dir : 1; I.sort = k; drawHead(); drawRows(); } },
      label, I.sort === k ? (I.dir > 0 ? ' ▲' : ' ▼') : ''))), h('th', { class: 'no-print' }));

  function row(it) {
    const gainCell = h('td', { class: 'num nowrap' }), marginCell = h('td', { class: 'num' });
    const paint = (price) => {
      const p = Number(price) || 0;
      gainCell.textContent = p ? money(p - it.real) : '—';
      marginCell.textContent = p ? pctFmt((p - it.real) / p) : '—';
      marginCell.className = `num${p && (p - it.real) / p < 0.3 ? ' low' : ''}`;
    };
    const input = h('input', {
      class: 'input input-sm price-in', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: it.sale_price ?? '', placeholder: '—',
      'aria-label': `Precio de venta de ${it.name}`,
      oninput: (e) => paint(e.target.value),
      onchange: async (e) => {
        const v = e.target.value;
        try {
          await call('/api/admin/purchase-items/price', { method: 'POST', body: { ids: [it.id], sale_price: v } });
          const price = v === '' ? null : Number(v);
          A.accounts.forEach((a) => a.purchases.forEach((p) => p.lines.forEach((l) => { if (l.id === it.id) l.sale_price = price; })));
          it.sale_price = price; onChange(); toast('Precio de venta guardado');
        } catch (ex) { toast(ex.message); e.target.value = it.sale_price ?? ''; paint(it.sale_price); }
      },
    });
    paint(it.sale_price);
    const left = it.qty - it.sold;
    const status = it.sold >= it.qty ? h('span', { class: 'st-chip st-entregado' }, it.qty > 1 ? `Vendidas ${it.sold}/${it.qty}` : 'Vendida')
      : it.sold ? h('span', { class: 'st-chip st-confirmado' }, `${it.sold}/${it.qty} vendidas`)
        : h('span', { class: 'st-chip' }, it.qty > 1 ? `${it.qty} disponibles` : 'Disponible');
    return h('tr', { class: left ? '' : 'is-sold' },
      h('td', { class: 'num' }, it.n), h('td', {}, `C${it.purchase.n}`),
      h('td', { class: 'td-name' }, it.name, it.qty > 1 ? h('span', { class: 'cell-sub' }, `${it.qty} unidades`) : null),
      h('td', {}, it.variant || '—'), h('td', { class: 'nowrap' }, it.type),
      h('td', { class: 'num nowrap' }, money(it.price)), h('td', { class: 'num nowrap' }, money(it.real)),
      h('td', { class: 'num' }, h('span', { class: 'no-print' }, input), h('span', { class: 'print-only' }, it.sale_price ? money(it.sale_price) : '—')),
      gainCell, marginCell,
      h('td', { class: 'nowrap' }, PRICE_SOURCE[it.price_source] || it.price_source), h('td', {}, status),
      h('td', { class: 'no-print' }, left ? h('button', { class: 'btn btn-small btn-dark', type: 'button', onclick: () => openSaleEditor(null, it, route) }, 'Vender') : null));
  }

  function drawRows() {
    const q = norm(I.q);
    const list = items.filter((i) =>
      (!I.type || (i.type || 'Sin tipo') === I.type) &&
      (!q || norm(`${i.name} ${i.variant} ${i.purchase.order_number}`).includes(q)) &&
      (I.status !== 'disponible' || i.sold < i.qty) && (I.status !== 'vendida' || i.sold > 0) && (I.status !== 'sinprecio' || !i.sale_price))
      .sort((a, b) => { const x = val[I.sort](a), y = val[I.sort](b); return (x > y ? 1 : x < y ? -1 : a.n - b.n) * I.dir; });
    count.textContent = `${plural(list.length, 'prenda', 'prendas')}${list.length !== items.length ? ` de ${items.length}` : ''}`;
    tbody.replaceChildren(...(list.length ? list.map(row) : [h('tr', {}, h('td', { colspan: '13', class: 'empty-cell' }, 'Ninguna prenda coincide con los filtros.'))]));
  }

  const sel = (value, label, options, onchange) => h('select', { class: 'select', value, 'aria-label': label, onchange: (e) => { onchange(e.target.value); drawRows(); } },
    options.map(([v, t]) => h('option', { value: v }, t)));

  drawHead(); drawRows();
  return h('section', { class: 'box' },
    h('div', { class: 'box-head' }, h('h3', { class: 'sub' }, 'Detalle por prenda'),
      h('p', { class: 'muted no-print' }, 'Cambia el precio de venta en la tabla: se guarda solo y la proyección de arriba se actualiza. Toca un encabezado para ordenar.')),
    h('div', { class: 'filterbar no-print' },
      h('input', { class: 'input', type: 'search', placeholder: 'Buscar prenda, talla o n° de pedido', 'aria-label': 'Buscar prenda', value: I.q, oninput: (e) => { I.q = e.target.value; drawRows(); } }),
      sel(I.type, 'Tipo', [['', 'Todos los tipos'], ...types.map((t) => [t, t])], (v) => { I.type = v; }),
      sel(I.status, 'Estado', [['', 'Todas'], ['disponible', 'Disponibles'], ['vendida', 'Vendidas'], ['sinprecio', 'Sin precio de venta']], (v) => { I.status = v; })),
    count,
    h('div', { class: 'table-wrap' }, h('table', { class: 'dtable inv-table' }, h('thead', {}, headRow), tbody)),
    h('p', { class: 'fine-print' }, 'Margen en rojo: menos de 30 %. Revisa si el precio de venta cubre tus otros gastos.'));
}

// ------------------------------------------------------------------ pestaña: registro de ventas

function ventasTab() {
  const list = INV.sales.filter((s) => (!I.month || s.date.startsWith(I.month)) && (!I.channel || s.channel === I.channel));
  const t = salesTotals(list);
  const tile = (label, value, hint) => h('div', { class: 'stat' }, h('span', { class: 'stat-l' }, label), h('span', { class: 'stat-v' }, value), hint ? h('span', { class: 'stat-h' }, hint) : null);
  const byChannel = Object.keys(CHANNEL).map((k) => [k, salesTotals(list.filter((s) => s.channel === k))]).filter(([, x]) => x.count);

  return h('div', {},
    h('div', { class: 'stats kpis six' },
      tile('Ventas', t.count, plural(t.units, 'prenda', 'prendas')),
      tile('Ingresos', money(t.revenue)),
      tile('Costo de lo vendido', money(t.cost), t.noCost ? `${t.noCost} sin costo conocido` : null),
      tile('Ganancia', money(t.gain)),
      tile('Margen', margin(t.gain, t.revenue)),
      tile('Ticket promedio', t.count ? money(t.revenue / t.count) : '—')),
    h('section', { class: 'box' },
      h('div', { class: 'box-head' }, h('h3', { class: 'sub' }, 'Registro de ventas'),
        h('div', { class: 'head-actions no-print' },
          h('select', { class: 'select', value: I.channel, 'aria-label': 'Canal', onchange: (e) => { I.channel = e.target.value; route(); } },
            h('option', { value: '' }, 'Todos los canales'), Object.entries(CHANNEL).map(([k, v]) => h('option', { value: k }, v))),
          h('button', { class: 'btn btn-small', type: 'button', onclick: () => exportSales(list) }, 'Descargar CSV'))),
      list.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'dtable inv-table' },
          h('thead', {}, h('tr', {}, ['Fecha', 'Prenda', 'Tipo', 'Cliente', 'Canal', 'Pago', 'Cant.', 'Precio', 'Costo', 'Ganancia', 'Margen'].map((c, i) => h('th', { class: i >= 6 ? 'num' : '' }, c)), h('th', { class: 'no-print' }))),
          h('tbody', {}, list.map((s) => {
            const gain = s.cost == null ? null : (s.price - s.cost) * s.qty;
            return h('tr', {},
              h('td', { class: 'nowrap' }, dayLabel(s.date)),
              h('td', { class: 'td-name' }, s.name, s.variant ? h('span', { class: 'cell-sub' }, s.variant) : null),
              h('td', { class: 'nowrap' }, s.type || '—'),
              h('td', {}, s.customer_id ? h('a', { href: `#clientes/${s.customer_id}` }, s.customer_name) : s.customer_name || '—'),
              h('td', { class: 'nowrap' }, CHANNEL[s.channel] || s.channel), h('td', { class: 'nowrap' }, PAYMENT[s.payment] || '—'),
              h('td', { class: 'num' }, s.qty), h('td', { class: 'num nowrap' }, money(s.price)),
              h('td', { class: 'num nowrap' }, s.cost == null ? '—' : money(s.cost)),
              h('td', { class: 'num nowrap' }, gain == null ? '—' : money(gain)),
              h('td', { class: 'num' }, gain == null ? '—' : margin(gain, s.price * s.qty)),
              h('td', { class: 'no-print' }, h('button', { class: 'link-btn', type: 'button', onclick: () => openSaleEditor(s, null, route) }, 'Editar')));
          })),
          h('tfoot', {}, h('tr', {}, h('td', { colspan: '6' }, 'Total'), h('td', { class: 'num' }, t.units), h('td', { class: 'num nowrap' }, money(t.revenue)),
            h('td', { class: 'num nowrap' }, money(t.cost)), h('td', { class: 'num nowrap' }, money(t.gain)), h('td', { class: 'num' }, margin(t.gain, t.revenue)), h('td', { class: 'no-print' })))))
        : h('div', { class: 'empty-note' }, h('strong', {}, 'Todavía no hay ventas registradas'), 'Cuando vendas una prenda, tócala en "Detalle por prenda" y luego "Vender", o usa "Registrar venta".')),
    byChannel.length > 1 ? h('section', { class: 'box' }, h('h3', { class: 'sub' }, 'Por canal'),
      h('table', { class: 'dtable compact' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Canal'), h('th', { class: 'num' }, 'Ventas'), h('th', { class: 'num' }, 'Ingresos'), h('th', { class: 'num' }, 'Ganancia'))),
        h('tbody', {}, byChannel.map(([k, x]) => h('tr', {}, h('td', {}, CHANNEL[k]), h('td', { class: 'num' }, x.count), h('td', { class: 'num nowrap' }, money(x.revenue)), h('td', { class: 'num nowrap' }, money(x.gain))))))) : null);
}

// ------------------------------------------------------------------ registrar / editar una venta

function openSaleEditor(sale, presetItem, after) {
  const { items } = (() => { const keep = { ...I }; I.month = ''; I.account = ''; const m = buildModel(); Object.assign(I, keep); return m; })();
  const current = sale?.item_id;
  const available = items.filter((i) => i.qty - i.sold > 0 || i.id === current);
  const byId = new Map(items.map((i) => [i.id, i]));
  let itemId = presetItem ? presetItem.id : sale ? sale.item_id || '' : '';

  const leftOf = (it) => it.qty - it.sold + (sale && sale.item_id === it.id ? sale.qty : 0);
  const itemSel = h('select', { class: 'select', name: 'item', onchange: () => { itemId = Number(itemSel.value) || ''; syncItem(true); } },
    h('option', { value: '' }, 'Otra prenda (no está en el inventario)'),
    available.map((i) => h('option', { value: String(i.id) }, `${i.name}${i.variant ? ` · ${i.variant}` : ''} · C${i.purchase.n} ${i.purchase.order_number ? `(${i.purchase.order_number})` : ''} · quedan ${leftOf(i)}`)));
  itemSel.value = String(itemId);

  const qty = h('input', { class: 'input', name: 'qty', type: 'number', min: '1', step: '1', value: sale?.qty ?? 1, oninput: () => calc() });
  const price = h('input', { class: 'input', name: 'price', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: sale?.price ?? '', oninput: () => calc() });
  const cost = h('input', { class: 'input', name: 'cost', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: sale && !sale.item_id ? sale.cost ?? '' : '', oninput: () => calc() });
  const freeBox = h('div', { class: 'grid2' },
    ffield('Qué vendiste', h('input', { class: 'input', name: 'name', maxlength: '120', value: sale && !sale.item_id ? sale.name : '' })),
    ffield('Tipo', h('input', { class: 'input', name: 'type', maxlength: '30', list: 'type-list2', value: sale && !sale.item_id ? sale.type : '' })),
    ffield('Costo por unidad (opcional)', cost, 'Para calcular la ganancia'));
  const result = h('div', { class: 'ptotal', 'aria-live': 'polite' });

  function syncItem(setPrice) {
    const it = byId.get(itemId);
    freeBox.hidden = !!it;
    if (it) {
      qty.max = String(leftOf(it));
      if (setPrice && it.sale_price) price.value = it.sale_price;
    } else qty.removeAttribute('max');
    calc();
  }
  function calc() {
    const it = byId.get(itemId);
    const q = num(qty.value), p = num(price.value);
    const c = it ? it.real : cost.value !== '' ? num(cost.value) : null;
    result.replaceChildren(
      h('div', {}, h('span', {}, `${plural(q, 'prenda', 'prendas')} × ${money(p)}`), c != null ? h('span', {}, `Costo ${money(c * q)}`) : null),
      h('div', {}, h('strong', {}, `Total ${money(p * q)}`),
        c != null && p ? h('span', {}, `Ganancia ${money((p - c) * q)} (${pctFmt((p - c) / p)})`) : h('span', {}, 'Sin costo: no se calcula la ganancia')));
  }

  const customerIn = h('input', { class: 'input', name: 'customer_name', maxlength: '80', list: 'cust-list', value: sale?.customer_name || '', placeholder: 'Nombre (opcional)' });
  syncItem(!sale && !!presetItem);

  formModal({
    title: sale ? 'Editar venta' : 'Registrar venta', saveLabel: 'Guardar venta',
    body: [
      h('datalist', { id: 'cust-list' }, INV.customers.map((c) => h('option', { value: c.name }, c.phone ? `+${c.phone}` : ''))),
      h('datalist', { id: 'type-list2' }, allTypes().map((t) => h('option', { value: t }))),
      ffield('Prenda', itemSel),
      freeBox,
      h('div', { class: 'grid2' },
        ffield('Fecha de la venta', h('input', { class: 'input', name: 'date', type: 'date', value: sale?.date || today(), max: today() })),
        ffield('Cantidad', qty)),
      ffield('Precio de venta por unidad', price, `En ${A.settings.currency}, lo que realmente te pagaron`),
      h('div', { class: 'grid2' },
        ffield('Canal', h('select', { class: 'select', name: 'channel', value: sale?.channel || 'whatsapp' }, Object.entries(CHANNEL).map(([k, v]) => h('option', { value: k }, v)))),
        ffield('Forma de pago', h('select', { class: 'select', name: 'payment', value: sale?.payment || 'yape' }, Object.entries(PAYMENT).map(([k, v]) => h('option', { value: k }, v))))),
      h('div', { class: 'grid2' },
        ffield('Cliente', customerIn, 'Si ya está en Clientes, elígelo de la lista'),
        ffield('Celular del cliente (opcional)', h('input', { class: 'input', name: 'customer_phone', type: 'tel', maxlength: '30', placeholder: '987 654 321' }), 'Si lo pones, se guarda en Clientes')),
      ffield('Nota (opcional)', h('input', { class: 'input', name: 'notes', maxlength: '500', value: sale?.notes || '', placeholder: 'Ej. delivery a Surco' })),
      result,
    ],
    onSave: async (el) => {
      const name = el.customer_name.value.trim();
      const match = INV.customers.find((c) => c.name.toLowerCase() === name.toLowerCase());
      const body = {
        item_id: itemId || null, name: el.name.value, type: el.type.value, cost: cost.value,
        date: el.date.value, qty: qty.value, price: price.value, channel: el.channel.value, payment: el.payment.value,
        customer_id: match ? match.id : (sale && sale.customer_name === name ? sale.customer_id : null),
        customer_name: name, customer_phone: el.customer_phone.value, notes: el.notes.value,
      };
      INV.sales = await call(sale ? `/api/admin/sales/${sale.id}` : '/api/admin/sales', { method: sale ? 'PUT' : 'POST', body });
      A.accounts = await call('/api/admin/accounts');
      toast('Venta guardada');
      if (A.tab === 'inventario') route(); else after?.();
    },
    onDelete: sale ? async () => {
      INV.sales = await call(`/api/admin/sales/${sale.id}`, { method: 'DELETE' });
      A.accounts = await call('/api/admin/accounts');
      toast('Venta eliminada'); route();
    } : null,
  });
}

// ------------------------------------------------------------------ exportar

function exportInventory() {
  const { items } = buildModel();
  downloadCsv(`inventario-${I.month || 'todo'}.csv`,
    ['#', 'Compra', 'N° de pedido', 'Fecha de compra', 'Prenda', 'Talla / color', 'Tipo', 'Unidades', 'Precio en pedido', 'Costo real', 'Precio de venta', 'Ganancia', 'Margen', 'Origen del precio', 'Vendidas'],
    items.map((i) => [i.n, `C${i.purchase.n}`, i.purchase.order_number, i.purchase.date, i.name, i.variant, i.type, i.qty, i.price.toFixed(2), i.real.toFixed(2),
      i.sale_price ? i.sale_price.toFixed(2) : '', i.sale_price ? (i.sale_price - i.real).toFixed(2) : '',
      i.sale_price ? `${Math.round(((i.sale_price - i.real) / i.sale_price) * 100)}%` : '', PRICE_SOURCE[i.price_source] || '', i.sold]));
}

function exportSales(list) {
  downloadCsv(`ventas-${I.month || 'todo'}.csv`,
    ['Fecha', 'Prenda', 'Talla / color', 'Tipo', 'Cliente', 'Canal', 'Pago', 'Cantidad', 'Precio unitario', 'Total', 'Costo unitario', 'Ganancia', 'N° de pedido Shein', 'Nota'],
    list.map((s) => [s.date, s.name, s.variant, s.type, s.customer_name, CHANNEL[s.channel] || s.channel, PAYMENT[s.payment] || '', s.qty, s.price.toFixed(2),
      (s.price * s.qty).toFixed(2), s.cost == null ? '' : s.cost.toFixed(2), s.cost == null ? '' : ((s.price - s.cost) * s.qty).toFixed(2), s.order_number, s.notes]));
}
