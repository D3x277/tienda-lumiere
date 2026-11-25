'use strict';
// Registro de ventas: lo que realmente se vendió. Cada venta elige prendas del catálogo; el precio se llena solo
// (y se puede cambiar si hubo descuento) y el stock se descuenta. Una venta puede salir de un pedido web o ser directa.
// Depende de dom.js y admin.js (A, call, toast, route, formModal, ffield, confirmButton, money, today, dayLabel, plural, asyncView).

const SALE_CHANNELS = { whatsapp: 'WhatsApp', instagram: 'Instagram', tiktok: 'TikTok', presencial: 'En persona', tienda: 'Tienda online', otro: 'Otro' };
const SALE_PAYMENTS = { yape: 'Yape / Plin', transferencia: 'Transferencia', efectivo: 'Efectivo', tarjeta: 'Tarjeta', otro: 'Otro' };
const MONTH_FULL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const monthFull = (m) => { const [y, mo] = m.split('-'); return `${MONTH_FULL[Number(mo) - 1]} ${y}`; };
const decimal = (v) => { const n = Number(String(v ?? '').trim().replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const stockLabel = (p) => (p.stock === null ? 'Sin límite' : p.stock <= 0 ? 'Agotada' : `${p.stock} en stock`);
const SV = { month: '', q: '', sales: [] };

function salesView() {
  return asyncView(async () => {
    [SV.sales, A.products] = await Promise.all([call('/api/admin/sales'), call('/api/admin/products')]);
  }, renderSales);
}

function renderSales() {
  const months = [...new Set(SV.sales.map((s) => s.date.slice(0, 7)))];
  if (SV.month && !months.includes(SV.month)) SV.month = '';
  const box = h('div', {});

  const draw = () => {
    const q = norm(SV.q);
    const list = SV.sales.filter((s) => (!SV.month || s.date.startsWith(SV.month))
      && (!q || norm(`${s.name} ${s.customer_name} ${s.order_code} ${s.notes}`).includes(q)));
    const total = list.reduce((n, s) => n + s.total, 0);
    const units = list.reduce((n, s) => n + s.qty, 0);
    box.replaceChildren(
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('span', { class: 'stat-v' }, money(total)), h('span', { class: 'stat-l' }, 'Vendido')),
        h('div', { class: 'stat' }, h('span', { class: 'stat-v' }, units), h('span', { class: 'stat-l' }, units === 1 ? 'Prenda' : 'Prendas'))),
      list.length
        ? h('div', { class: 'sale-list' }, list.map(saleRow))
        : h('div', { class: 'empty-note box' },
          h('strong', {}, SV.sales.length ? 'No hay ventas con ese filtro' : 'Todavía no registras ventas'),
          SV.sales.length ? 'Cambia el mes o la búsqueda.' : 'Cada vez que vendas una prenda, regístrala aquí. Si vino de la web, regístrala desde Pedidos web.'));
  };

  const monthSel = months.length > 1 ? h('select', {
    class: 'select', value: SV.month, 'aria-label': 'Mes', onchange: (e) => { SV.month = e.target.value; draw(); },
  }, h('option', { value: '' }, 'Todos los meses'), months.map((m) => h('option', { value: m }, monthFull(m)))) : null;
  const search = SV.sales.length > 5 ? h('input', {
    class: 'input', type: 'search', placeholder: 'Buscar prenda, clienta o pedido', 'aria-label': 'Buscar venta', value: SV.q,
    oninput: (e) => { SV.q = e.target.value; draw(); },
  }) : null;

  draw();
  return h('div', {},
    h('div', { class: 'panel-head' },
      h('h2', { class: 'title' }, 'Registro de ventas'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openSaleEditor({}) }, 'Registrar venta')),
    h('p', { class: 'hint-block' }, 'Aquí va todo lo que realmente vendiste: es lo que suma en "Vendí". ',
      'Si la clienta pidió por la web, regístralo desde ', h('a', { href: '#pedidos' }, 'Pedidos web'), ' para no contarlo dos veces.'),
    monthSel || search ? h('div', { class: 'filterbar' }, monthSel, search) : null,
    box);
}

function saleRow(s) {
  const who = [SALE_CHANNELS[s.channel] || 'Otro', SALE_PAYMENTS[s.payment], s.customer_name].filter(Boolean).join(' · ');
  return h('article', { class: 'sale' },
    h('div', { class: 'pthumb' }, s.image ? h('img', { src: s.image, alt: '' }) : null),
    h('div', { class: 'sale-main' },
      h('p', { class: 'pname' }, s.name, s.variant ? h('span', { class: 'muted' }, ` · ${s.variant}`) : null),
      h('p', { class: 'pcat' }, dayLabel(s.date), ' · ', who, s.order_code ? h('span', { class: 'order-tag' }, `Pedido ${s.order_code}`) : null),
      s.notes ? h('p', { class: 'note' }, s.notes) : null),
    h('div', { class: 'sale-side' },
      h('strong', {}, money(s.total)),
      h('span', { class: 'muted' }, `${s.qty} × ${money(s.price)}`),
      h('button', { class: 'link-btn', type: 'button', onclick: () => openSaleEditor({ sale: s }) }, 'Editar')));
}

// Buscador de prendas del catálogo, con foto, precio y stock.
function productPicker(onPick) {
  const results = h('div', { class: 'pick-results', role: 'listbox' });
  const input = h('input', {
    class: 'input', type: 'search', placeholder: 'Busca la prenda por su nombre…', 'aria-label': 'Buscar prenda del catálogo', autocomplete: 'off',
    oninput: () => draw(),
    onfocus: () => draw(),
    onkeydown: (e) => { // Enter elige la primera prenda en vez de enviar el formulario
      if (e.key !== 'Enter') return;
      e.preventDefault();
      results.querySelector('.pick:not(:disabled)')?.click();
    },
  });
  function draw() {
    const q = norm(input.value);
    const list = A.products.filter((p) => !q || norm(`${p.name} ${p.category_name || ''}`).includes(q)).slice(0, 8);
    results.replaceChildren(...(list.length ? list.map((p) => {
      const out = p.stock !== null && p.stock <= 0;
      return h('button', {
        class: 'pick', type: 'button', role: 'option', disabled: out,
        onclick: () => { results.replaceChildren(); onPick(p); },
      },
      h('span', { class: 'pthumb' }, p.images[0] ? h('img', { src: p.images[0], alt: '' }) : null),
      h('span', { class: 'pick-name' }, p.name, h('small', {}, [p.category_name, p.active ? null : 'oculta en la web'].filter(Boolean).join(' · '))),
      h('span', { class: 'pick-side' }, money(p.price), h('small', { class: out ? 'out' : '' }, stockLabel(p))));
    }) : [h('p', { class: 'muted pick-empty' }, A.products.length ? 'No hay prendas con ese nombre.' : 'Aún no hay prendas en el catálogo.')]));
  }
  return h('div', { class: 'picker' }, input, results);
}

// sale: corregir una venta. order: registrar la venta de un pedido web. Sin nada: venta directa.
function openSaleEditor({ sale, order }) {
  const byId = (id) => A.products.find((p) => p.id === id);
  // Una fila por prenda: { product, size, color, qty, price }
  const lines = sale
    ? [{ product: byId(sale.product_id) || { id: sale.product_id, name: sale.name, images: sale.image ? [sale.image] : [], sizes: [], colors: [], stock: null }, size: sale.size, color: sale.color, qty: sale.qty, price: sale.price }]
    : order
      ? order.items.map((it) => ({ product: byId(it.id) || { id: it.id, name: it.name, images: it.image ? [it.image] : [], sizes: [], colors: [], stock: null }, size: it.size || '', color: it.color || '', qty: it.qty, price: it.price }))
      : [];
  const fixed = !!(sale || order); // en una corrección o un pedido no se cambian las prendas
  const linesBox = h('div', { class: 'sale-lines' });
  const totalBox = h('p', { class: 'sale-total', 'aria-live': 'polite' });

  const drawTotal = () => {
    const t = lines.reduce((n, l) => n + decimal(l.price) * (Number.parseInt(l.qty, 10) || 0), 0);
    totalBox.replaceChildren(h('span', {}, 'Total de la venta'), h('strong', {}, money(t)));
  };

  const optionSelect = (label, values, key, l) => (values.length
    ? h('select', { class: 'select', value: l[key], 'aria-label': label, onchange: (e) => { l[key] = e.target.value; } },
      h('option', { value: '' }, `${label}…`), values.map((v) => h('option', { value: v }, v)))
    : null);

  function drawLines() {
    linesBox.replaceChildren(...lines.map((l, i) => {
      const p = l.product;
      return h('div', { class: 'sale-line' },
        h('div', { class: 'sale-line-head' },
          h('span', { class: 'pthumb' }, p.images?.[0] ? h('img', { src: p.images[0], alt: '' }) : null),
          h('div', {}, h('p', { class: 'pname' }, p.name),
            h('p', { class: 'muted' }, order ? `Del pedido · ${[l.size, l.color].filter(Boolean).join(' · ') || 'sin talla'}` : `Precio en la web ${money(p.price ?? l.price)} · ${stockLabel(p)}`)),
          fixed ? null : h('button', { class: 'link-btn', type: 'button', onclick: () => { lines.splice(i, 1); drawLines(); } }, 'Quitar')),
        h('div', { class: 'sale-line-fields' },
          order ? null : optionSelect('Talla', p.sizes || [], 'size', l),
          order ? null : optionSelect('Color', p.colors || [], 'color', l),
          h('label', { class: 'mini-field' }, h('span', {}, 'Cantidad'),
            h('input', { class: 'input', type: 'number', min: '1', step: '1', inputmode: 'numeric', value: l.qty, oninput: (e) => { l.qty = e.target.value; drawTotal(); } })),
          h('label', { class: 'mini-field' }, h('span', {}, `Precio c/u (${A.settings.currency})`),
            h('input', { class: 'input', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: l.price, oninput: (e) => { l.price = e.target.value; drawTotal(); } }))));
    }));
    drawTotal();
  }
  drawLines();

  const picker = fixed ? null : productPicker((p) => {
    lines.push({ product: p, size: p.sizes.length === 1 ? p.sizes[0] : '', color: p.colors.length === 1 ? p.colors[0] : '', qty: 1, price: p.price });
    picker.querySelector('input').value = '';
    drawLines();
  });

  const channels = Object.entries(SALE_CHANNELS).filter(([k]) => (order || sale ? true : k !== 'tienda'));
  const current = sale || {};
  formModal({
    title: sale ? 'Editar venta' : order ? `Registrar venta · Pedido ${order.code}` : 'Registrar venta',
    saveLabel: sale ? 'Guardar cambios' : 'Registrar venta',
    body: [
      order ? h('p', { class: 'hint-block' }, `Revisa que la venta se concretó. Si hubo descuento, cambia el precio. Las prendas ya estaban apartadas por el pedido.`) : null,
      fixed ? null : h('div', { class: 'field' }, h('span', { class: 'label' }, 'Prendas vendidas'), picker,
        h('span', { class: 'hint' }, 'El precio se llena solo con el de la web; cámbialo si hiciste descuento. Al guardar se descuenta del stock.')),
      linesBox,
      totalBox,
      h('div', { class: 'grid2' },
        ffield('Fecha', h('input', { class: 'input', name: 'date', type: 'date', value: current.date || today(), max: today() })),
        ffield('Por dónde vendiste', h('select', { class: 'select', name: 'channel', value: current.channel || (order ? 'whatsapp' : 'whatsapp') },
          channels.map(([k, v]) => h('option', { value: k }, v))))),
      h('div', { class: 'grid2' },
        ffield('Cómo te pagaron', h('select', { class: 'select', name: 'payment', value: current.payment || 'yape' },
          Object.entries(SALE_PAYMENTS).map(([k, v]) => h('option', { value: k }, v)))),
        order
          ? ffield('Clienta', h('input', { class: 'input', name: 'customer_name', value: order.customer_name, readonly: true }))
          : ffield('Clienta (opcional)', h('input', { class: 'input', name: 'customer_name', maxlength: '80', value: current.customer_name || '', placeholder: 'Nombre' }))),
      order || current.customer_id ? null
        : ffield('Celular de la clienta (opcional)', h('input', { class: 'input', name: 'customer_phone', type: 'tel', inputmode: 'tel', maxlength: '30', placeholder: '987 654 321' }),
          'Si lo pones, queda guardada en Clientes.'),
      ffield('Nota (opcional)', h('textarea', { class: 'textarea', name: 'notes', rows: '2', maxlength: '500', placeholder: 'Ej. descuento por 2 prendas, entrega en Miraflores…' }, current.notes || '')),
    ],
    onSave: async (el) => {
      if (!lines.length) throw new Error('Busca y elige al menos una prenda.');
      lines.forEach((l, i) => {
        if (l.product.sizes?.length && !l.size && !order && !sale) throw new Error(`Elige la talla de "${l.product.name}".`);
        if (!(Number.parseInt(l.qty, 10) >= 1)) throw new Error(`La cantidad de la prenda ${i + 1} debe ser 1 o más.`);
        if (String(l.price).trim() === '') throw new Error(`Escribe el precio de "${l.product.name}".`);
      });
      const common = {
        date: el.date.value, channel: el.channel.value, payment: el.payment.value, notes: el.notes.value,
        customer_name: el.customer_name.value, customer_phone: el.customer_phone?.value || '',
        customer_id: sale?.customer_id || undefined,
      };
      if (sale) {
        const l = lines[0];
        SV.sales = await call(`/api/admin/sales/${sale.id}`, { method: 'PUT', body: { ...common, qty: l.qty, price: l.price, size: l.size, color: l.color } });
      } else {
        SV.sales = await call('/api/admin/sales', {
          method: 'POST',
          body: { ...common, order_id: order?.id, items: lines.map((l) => ({ product_id: l.product.id, size: l.size, color: l.color, qty: l.qty, price: l.price })) },
        });
      }
      [A.products, A.orders] = await Promise.all([call('/api/admin/products'), call('/api/admin/orders')]);
      route(); toast(sale ? 'Venta actualizada' : 'Venta registrada');
    },
    onDelete: sale ? async () => {
      SV.sales = await call(`/api/admin/sales/${sale.id}`, { method: 'DELETE' });
      [A.products, A.orders] = await Promise.all([call('/api/admin/products'), call('/api/admin/orders')]);
      route(); toast(sale.stock_taken ? 'Venta eliminada: las prendas volvieron al stock' : 'Venta eliminada');
    } : null,
    deleteLabel: sale?.stock_taken ? 'Eliminar (vuelve al stock)' : null,
  });
}
