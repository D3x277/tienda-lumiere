'use strict';
// "Gasté y vendí": cuánto se gastó en Shein contra cuánto se vendió (ventas registradas), por periodo, por mes
// y desde el inicio, más lo que queda por vender en el catálogo. Se descarga en un archivo que abre Excel.
// Depende de dom.js, admin.js (A, call, money, plural, today, asyncView), crm.js (downloadCsv) y sales.js (monthFull, SALE_CHANNELS, SALE_PAYMENTS).

const BIZ_PERIODS = [['mes', 'Este mes'], ['pasado', 'Mes pasado'], ['tres', 'Últimos 3 meses'], ['anio', 'Este año'], ['todo', 'Todo']];
let bizPeriod = 'mes';

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function periodRange(key) {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  if (key === 'mes') return [ymd(new Date(y, m, 1)), ymd(new Date(y, m + 1, 0))];
  if (key === 'pasado') return [ymd(new Date(y, m - 1, 1)), ymd(new Date(y, m, 0))];
  if (key === 'tres') return [ymd(new Date(y, m - 2, 1)), ymd(new Date(y, m + 1, 0))];
  if (key === 'anio') return [`${y}-01-01`, `${y}-12-31`];
  return ['', ''];
}

function businessView() {
  const [from, to] = periodRange(bizPeriod);
  return asyncView(() => call(`/api/admin/business?from=${from}&to=${to}`), renderBusiness);
}

const signed = (n) => `${n > 0 ? '+ ' : n < 0 ? '− ' : ''}${money(Math.abs(n))}`;

function renderBusiness(r) {
  const p = r.period, all = r.all_time;
  const periodName = BIZ_PERIODS.find(([k]) => k === bizPeriod)[1].toLowerCase();

  const big = (label, value, sub, cls = '') => h('div', { class: `big-stat ${cls}` },
    h('span', { class: 'big-l' }, label), h('span', { class: 'big-v' }, value), h('span', { class: 'big-s' }, sub));

  const monthRows = r.months.map((m) => h('tr', {},
    h('td', { class: 'nowrap' }, monthFull(m.month)),
    h('td', { class: 'num' }, money(m.spent)),
    h('td', { class: 'num' }, money(m.sold)),
    h('td', { class: `num ${m.sold - m.spent >= 0 ? 'pos' : 'neg'}` }, signed(m.sold - m.spent))));

  return h('div', {},
    h('div', { class: 'panel-head' },
      h('div', {}, h('h2', { class: 'title' }, 'Gasté y vendí'), h('p', { class: 'muted' }, 'Lo que gastaste en Shein contra lo que vendiste.')),
      h('button', { class: 'btn', type: 'button', onclick: () => exportBusiness(r).catch((e) => toast(e.message)) }, 'Descargar Excel')),
    h('div', { class: 'seg-btns', role: 'group', 'aria-label': 'Periodo', style: 'margin-bottom:1rem' },
      BIZ_PERIODS.map(([k, label]) => h('button', {
        class: 'chip-btn', type: 'button', 'aria-pressed': String(bizPeriod === k), onclick: () => { bizPeriod = k; route(); },
      }, label))),

    r.pending_orders.orders ? h('div', { class: 'warn-box' },
      h('strong', {}, `${plural(r.pending_orders.orders, 'pedido web', 'pedidos web')} por confirmar (${money(r.pending_orders.amount)}).`),
      ' Aún no suman en "Vendí". Cuando se concreten, regístralos en ', h('a', { href: '#pedidos' }, 'Pedidos web'), '.') : null,

    h('div', { class: 'big-stats' },
      big('Gasté en Shein', money(p.spent), plural(p.purchases, 'compra', 'compras')),
      big('Vendí', money(p.sold), `${plural(p.units, 'prenda', 'prendas')} · ${plural(p.sales, 'venta', 'ventas')}`),
      big('Me queda', signed(p.result), `en ${periodName}`, p.result >= 0 ? 'pos' : 'neg')),

    h('div', { class: 'box to-sell' },
      h('div', {}, h('strong', {}, `Por vender: ${money(r.to_sell.value)}`),
        h('span', { class: 'muted' }, ` en ${plural(r.to_sell.units, 'prenda', 'prendas')} con stock en tu catálogo (a precio de la web)`)),
      r.to_sell.sold_out || r.to_sell.unlimited ? h('p', { class: 'muted' },
        [r.to_sell.sold_out ? `${plural(r.to_sell.sold_out, 'prenda agotada', 'prendas agotadas')}` : null,
          r.to_sell.unlimited ? `${plural(r.to_sell.unlimited, 'prenda', 'prendas')} sin stock definido (no suman aquí)` : null].filter(Boolean).join(' · ')) : null),

    h('div', { class: 'rep-grid' },
      h('section', { class: 'box' },
        h('h3', { class: 'sub' }, 'Mes a mes'),
        r.months.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'dtable compact' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Mes'), h('th', { class: 'num' }, 'Gasté'), h('th', { class: 'num' }, 'Vendí'), h('th', { class: 'num' }, 'Me queda'))),
          h('tbody', {}, monthRows),
          h('tfoot', {}, h('tr', {},
            h('th', {}, 'Desde que empecé'), h('th', { class: 'num' }, money(all.spent)), h('th', { class: 'num' }, money(all.sold)),
            h('th', { class: `num ${all.result >= 0 ? 'pos' : 'neg'}` }, signed(all.result))))))
          : h('p', { class: 'muted' }, 'Aún no hay compras ni ventas registradas.')),
      h('section', { class: 'box' },
        h('h3', { class: 'sub' }, 'Lo más vendido'),
        h('p', { class: 'muted' }, `En ${periodName}.`),
        r.top.length ? h('ol', { class: 'top-list' }, r.top.map((t) => h('li', {},
          h('span', { class: 'pthumb' }, t.image ? h('img', { src: t.image, alt: '' }) : null),
          h('span', { class: 'top-name' }, t.name, h('small', {}, plural(t.units, 'prenda', 'prendas'))),
          h('strong', {}, money(t.total))))) : h('p', { class: 'muted' }, 'Sin ventas registradas en este periodo.'),
        r.by_channel.length > 1 ? [h('h3', { class: 'sub', style: 'margin-top:1.25rem' }, 'Por dónde vendiste'),
          h('ul', { class: 'channel-list' }, r.by_channel.map((c) => h('li', {}, h('span', {}, c.label), h('span', { class: 'muted' }, plural(c.units, 'prenda', 'prendas')), h('strong', {}, money(c.total)))))] : null)),

    h('div', { class: 'box notes-box' },
      h('h3', { class: 'sub' }, 'Cómo se calcula'),
      h('ul', {},
        h('li', {}, h('strong', {}, 'Gasté: '), 'la suma de tus compras en ', h('a', { href: '#cuentas' }, 'Compras Shein'), ', por su fecha de compra.'),
        h('li', {}, h('strong', {}, 'Vendí: '), 'solo las ventas del ', h('a', { href: '#ventas' }, 'Registro de ventas'), '. Los pedidos web cuentan cuando los registras como venta.'),
        h('li', {}, h('strong', {}, 'Me queda: '), 'Vendí menos Gasté en ese periodo. Lo que compras un mes puede venderse al siguiente, por eso el número más fiel es ', h('strong', {}, '"Desde que empecé"'), '.'))));
}

async function exportBusiness(r) {
  const [from, to] = periodRange(bizPeriod);
  const sales = (await call('/api/admin/sales')).filter((s) => (!from || s.date >= from) && (!to || s.date <= to));
  const purchases = A.accounts = await call('/api/admin/accounts');
  const buys = purchases.flatMap((a) => a.purchases.map((pu) => ({ ...pu, email: a.email })))
    .filter((pu) => (!from || pu.date >= from) && (!to || pu.date <= to))
    .sort((x, y) => x.date.localeCompare(y.date));
  const name = BIZ_PERIODS.find(([k]) => k === bizPeriod)[1];
  const rows = [
    ['RESUMEN', name, from && to ? `${from} a ${to}` : 'todo', ''],
    ['Gasté en Shein', r.period.spent.toFixed(2), '', ''],
    ['Vendí', r.period.sold.toFixed(2), '', ''],
    ['Me queda', r.period.result.toFixed(2), '', ''],
    ['Por vender (catálogo)', r.to_sell.value.toFixed(2), '', ''],
    [], ['MES A MES', 'Gasté', 'Vendí', 'Me queda'],
    ...r.months.map((m) => [monthFull(m.month), m.spent.toFixed(2), m.sold.toFixed(2), (m.sold - m.spent).toFixed(2)]),
    ['Desde que empecé', r.all_time.spent.toFixed(2), r.all_time.sold.toFixed(2), r.all_time.result.toFixed(2)],
    [], ['VENTAS', 'Fecha', 'Prenda', 'Talla / color', 'Cantidad', 'Precio c/u', 'Total', 'Canal', 'Pago', 'Clienta', 'Pedido web', 'Nota'],
    ...sales.map((s) => ['', s.date, s.name, s.variant, s.qty, s.price.toFixed(2), s.total.toFixed(2), SALE_CHANNELS[s.channel] || 'Otro', SALE_PAYMENTS[s.payment] || '', s.customer_name, s.order_code, s.notes]),
    [], ['COMPRAS SHEIN', 'Fecha', 'Cuenta', 'N° de pedido', 'Prendas', 'Gasté', 'Nota'],
    ...buys.map((b) => ['', b.date, b.email, b.order_number, b.items || '', b.cost.toFixed(2), b.description]),
  ];
  downloadCsv(`gaste-y-vendi-${bizPeriod}-${today()}.csv`, rows[0], rows.slice(1));
}
