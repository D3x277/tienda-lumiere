'use strict';
// CRM del panel: clientes (lista, ficha, historial, importar/exportar) y campañas masivas por WhatsApp.
// Depende de dom.js y admin.js (A, call, toast, formModal, ffield, chipInput, confirmButton, money, plural, asyncView…).

const SOURCE = { tienda: 'Tienda', manual: 'Manual', importado: 'Importado' };
const ACT = { nota: 'Nota', llamada: 'Llamada', whatsapp: 'WhatsApp', 'campaña': 'Campaña', sistema: 'Sistema' };
const C = { q: '', tag: '', seg: '', sort: 'recent', shown: 50, selected: new Set() };

// ------------------------------------------------------------------ CSV (Excel, Google Sheets)

// Lee un CSV con comillas, comas o punto y coma (Excel en español usa ";").
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function downloadCsv(filename, header, rows) {
  const esc = (v) => { const s = String(v ?? ''); return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n'); // BOM: Excel lee bien las tildes
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const dateOnly = (s) => (s ? when(s) : '');
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const waLink = (phone, text) => `https://wa.me/${phone}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
const fillMessage = (msg, c) => msg.replace(/\{nombre\}/gi, firstName(c.name)).replace(/\{tienda\}/gi, A.settings.store_name);

function exportCustomers(list) {
  downloadCsv(`clientes-${today()}.csv`,
    ['Nombre', 'Celular', 'Correo', 'Distrito', 'Etiquetas', 'Acepta promociones', 'Compras', 'Comprado', 'Última compra', 'Origen', 'Registrado'],
    list.map((c) => [c.name, c.phone, c.email, c.district, c.tags.join('; '), c.opt_in ? 'Sí' : 'No', c.orders_count,
      c.spent.toFixed(2), c.last_order_at || '', SOURCE[c.source] || c.source, c.created_at]));
}

// ------------------------------------------------------------------ clientes: lista

let customersCache = null;
const loadCustomers = async () => (customersCache = await call('/api/admin/customers'));

function customersView(param) {
  if (param) return customerDetailView(Number(param));
  return asyncView(loadCustomers, renderCustomers);
}

function renderCustomers(all) {
  const tags = [...new Set(all.flatMap((c) => c.tags))].sort((a, b) => a.localeCompare(b, 'es'));
  const body = h('tbody', {});
  const more = h('div', { class: 'more' });
  const countNote = h('p', { class: 'muted count-line', 'aria-live': 'polite' });
  const bulk = h('div', { class: 'bulkbar', hidden: true });
  let current = [];

  const filtered = () => {
    const q = norm(C.q);
    const list = all.filter((c) =>
      (!q || norm(`${c.name} ${c.phone} ${c.email} ${c.district}`).includes(q)) &&
      (!C.tag || c.tags.includes(C.tag)) &&
      (C.seg !== 'buyers' || c.orders_count > 0) &&
      (C.seg !== 'never' || c.orders_count === 0) &&
      (C.seg !== 'optin' || c.opt_in) &&
      (C.seg !== 'nooptin' || !c.opt_in));
    const sorts = {
      recent: (a, b) => (b.last_order_at || b.created_at).localeCompare(a.last_order_at || a.created_at),
      spent: (a, b) => b.spent - a.spent || b.orders_count - a.orders_count,
      name: (a, b) => a.name.localeCompare(b.name, 'es'),
    };
    return list.sort(sorts[C.sort]);
  };

  const rowEl = (c) => h('tr', {},
    h('td', { class: 'td-check' }, h('input', {
      type: 'checkbox', checked: C.selected.has(c.id), 'aria-label': `Seleccionar a ${c.name}`,
      onchange: (e) => { e.target.checked ? C.selected.add(c.id) : C.selected.delete(c.id); drawBulk(); },
    })),
    h('td', {}, h('a', { class: 'cname', href: `#clientes/${c.id}` }, c.name)),
    h('td', { class: 'nowrap' }, c.phone ? `+${c.phone}` : h('span', { class: 'muted' }, '—')),
    h('td', { class: 'td-email' }, c.email || h('span', { class: 'muted' }, '—')),
    h('td', {}, c.district || h('span', { class: 'muted' }, '—')),
    h('td', {}, c.tags.map((t) => h('span', { class: 'tagchip' }, t))),
    h('td', { class: 'num' }, c.orders_count),
    h('td', { class: 'num nowrap' }, money(c.spent)),
    h('td', { class: 'nowrap' }, c.last_order_at ? dateOnly(c.last_order_at) : h('span', { class: 'muted' }, 'Sin pedidos')),
    h('td', {}, c.opt_in ? h('span', { class: 'yes' }, 'Sí') : h('span', { class: 'muted' }, 'No')));

  function draw() {
    current = filtered();
    countNote.textContent = `${plural(current.length, 'cliente', 'clientes')}${current.length !== all.length ? ` de ${all.length}` : ''}`;
    const page = current.slice(0, C.shown);
    body.replaceChildren(...(page.length ? page.map(rowEl)
      : [h('tr', {}, h('td', { colspan: '10', class: 'empty-cell' }, all.length ? 'Ningún cliente coincide con los filtros.' : 'Aún no tienes clientes. Se crean solos con cada pedido de la tienda, o agrégalos a mano o desde un archivo.'))]));
    more.replaceChildren(current.length > C.shown
      ? h('button', { class: 'btn btn-small', type: 'button', onclick: () => { C.shown += 50; draw(); } }, `Ver más (${current.length - C.shown} restantes)`) : '');
    drawBulk();
  }

  const bulkTag = h('input', { class: 'input', placeholder: 'Etiqueta, ej. VIP', maxlength: '24', list: 'tag-list', 'aria-label': 'Etiqueta para los seleccionados' });
  async function applyBulk(kind) {
    const tag = bulkTag.value.trim();
    if (!tag) { bulkTag.focus(); return; }
    try {
      all = await call('/api/admin/customers/bulk', { method: 'POST', body: { ids: [...C.selected], [kind]: tag } });
      customersCache = all; toast(kind === 'add_tag' ? 'Etiqueta agregada' : 'Etiqueta quitada');
      $('#panel').replaceChildren(renderCustomers(all));
    } catch (ex) { toast(ex.message); }
  }
  function drawBulk() {
    const n = C.selected.size;
    bulk.hidden = !n;
    if (!n) return;
    bulk.replaceChildren(
      h('strong', {}, `${plural(n, 'seleccionado', 'seleccionados')}`),
      bulkTag,
      h('button', { class: 'btn btn-small btn-dark', type: 'button', onclick: () => applyBulk('add_tag') }, 'Agregar etiqueta'),
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => applyBulk('remove_tag') }, 'Quitar etiqueta'),
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => exportCustomers(all.filter((c) => C.selected.has(c.id))) }, 'Exportar'),
      confirmButton({
        label: 'Eliminar', confirmLabel: `Sí, eliminar ${n}`, cls: 'btn btn-small btn-danger-dark',
        onConfirm: async () => {
          try {
            all = await call('/api/admin/customers/bulk-delete', { method: 'POST', body: { ids: [...C.selected] } });
            customersCache = all; C.selected.clear(); toast(`${plural(n, 'cliente eliminado', 'clientes eliminados')}`);
            $('#panel').replaceChildren(renderCustomers(all));
          } catch (ex) { toast(ex.message); }
        },
      }),
      h('button', { class: 'btn btn-small btn-quiet', type: 'button', onclick: () => { C.selected.clear(); draw(); } }, 'Quitar selección'));
  }

  const selectAll = h('input', {
    type: 'checkbox', 'aria-label': 'Seleccionar todos los de la lista',
    onchange: (e) => { current.forEach((c) => (e.target.checked ? C.selected.add(c.id) : C.selected.delete(c.id))); draw(); },
  });

  const sel = (value, onchange, label, options) => h('select', { class: 'select', value, 'aria-label': label, onchange: (e) => { onchange(e.target.value); C.shown = 50; draw(); } },
    options.map(([v, t]) => h('option', { value: v }, t)));

  const buyers = all.filter((c) => c.orders_count > 0).length;
  const optin = all.filter((c) => c.opt_in).length;
  const stat = (label, value, hint) => h('div', { class: 'stat' }, h('span', { class: 'stat-v' }, value), h('span', { class: 'stat-l' }, label), hint ? h('span', { class: 'stat-h' }, hint) : null);

  draw();
  return h('div', {},
    h('datalist', { id: 'tag-list' }, tags.map((t) => h('option', { value: t }))),
    h('div', { class: 'panel-head' },
      h('h2', { class: 'title' }, 'Clientes'),
      h('div', { class: 'head-actions' },
        h('button', { class: 'btn btn-small', type: 'button', onclick: openImport }, 'Importar CSV'),
        h('button', { class: 'btn btn-small', type: 'button', disabled: !all.length, onclick: () => exportCustomers(current) }, 'Exportar CSV'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openCustomerEditor(null) }, 'Nuevo cliente'))),
    h('div', { class: 'stats' },
      stat('Clientes', all.length),
      stat('Ya compraron', buyers, all.length ? `${Math.round((buyers / all.length) * 100)} %` : null),
      stat('Aceptan promociones', optin, 'Pueden recibir campañas'),
      stat('Sin compras', all.length - buyers)),
    h('div', { class: 'filterbar' },
      h('input', { class: 'input', type: 'search', placeholder: 'Buscar por nombre, celular, correo o distrito', 'aria-label': 'Buscar cliente', value: C.q, oninput: (e) => { C.q = e.target.value; C.shown = 50; draw(); } }),
      sel(C.seg, (v) => { C.seg = v; }, 'Filtrar clientes', [['', 'Todos'], ['buyers', 'Ya compraron'], ['never', 'Sin compras'], ['optin', 'Aceptan promociones'], ['nooptin', 'No aceptan promociones']]),
      tags.length ? sel(C.tag, (v) => { C.tag = v; }, 'Filtrar por etiqueta', [['', 'Todas las etiquetas'], ...tags.map((t) => [t, t])]) : null,
      sel(C.sort, (v) => { C.sort = v; }, 'Ordenar', [['recent', 'Actividad reciente'], ['spent', 'Más compraron'], ['name', 'Nombre A-Z']])),
    countNote,
    bulk,
    h('div', { class: 'table-wrap' }, h('table', { class: 'dtable' },
      h('thead', {}, h('tr', {},
        h('th', { class: 'td-check' }, selectAll), h('th', {}, 'Nombre'), h('th', {}, 'Celular'), h('th', {}, 'Correo'), h('th', {}, 'Distrito'),
        h('th', {}, 'Etiquetas'), h('th', { class: 'num' }, 'Compras'), h('th', { class: 'num' }, 'Comprado'), h('th', {}, 'Última compra'), h('th', {}, 'Promos'))),
      body)),
    more,
    h('p', { class: 'fine-print' }, '"Comprado" suma los pedidos confirmados, enviados o entregados de la tienda y las ventas registradas en Inventario y ventas.'));
}

// ------------------------------------------------------------------ clientes: crear / importar

function customerFields(c = {}) {
  const tags = chipInput({ values: c.tags || [], placeholder: 'Escribe una etiqueta y presiona Enter', label: 'Etiquetas' });
  const fields = [
    ffield('Nombre', h('input', { class: 'input', name: 'name', maxlength: '80', value: c.name || '', autocomplete: 'off' })),
    h('div', { class: 'grid2' },
      ffield('Celular / WhatsApp', h('input', { class: 'input', name: 'phone', type: 'tel', maxlength: '30', value: c.phone || '', placeholder: '987 654 321' }), 'Si es de Perú, basta con los 9 dígitos'),
      ffield('Correo', h('input', { class: 'input', name: 'email', type: 'email', maxlength: '120', value: c.email || '' }))),
    ffield('Distrito o ciudad', h('input', { class: 'input', name: 'district', maxlength: '60', value: c.district || '', placeholder: 'Ej. Miraflores' })),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Etiquetas'), tags.el, h('span', { class: 'hint' }, 'Sirven para agrupar y para elegir a quién va una campaña. Ej. VIP, Instagram, Mayorista.')),
    ffield('Notas', h('textarea', { class: 'textarea', name: 'notes', rows: '3', maxlength: '1000', placeholder: 'Talla habitual, gustos, cómo llegó a la tienda…' }, c.notes || '')),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'opt_in', checked: !!c.opt_in }), 'Aceptó recibir promociones por WhatsApp'),
    h('p', { class: 'hint-block' }, 'Marca esto solo si la persona te dio permiso. Las campañas solo llegan a quienes lo aceptaron.'),
  ];
  const read = (el) => ({ name: el.name.value, phone: el.phone.value, email: el.email.value, district: el.district.value, notes: el.notes.value, opt_in: el.opt_in.checked, tags: tags.get() });
  return { fields, read };
}

function openCustomerEditor() {
  const f = customerFields();
  formModal({
    title: 'Nuevo cliente', saveLabel: 'Guardar cliente', body: f.fields,
    onSave: async (el) => {
      const c = await call('/api/admin/customers', { method: 'POST', body: f.read(el) });
      toast('Cliente guardado'); location.hash = `#clientes/${c.id}`;
    },
  });
}

const COLS = {
  name: ['nombre', 'nombres', 'name', 'cliente', 'nombre completo'],
  phone: ['celular', 'telefono', 'teléfono', 'phone', 'whatsapp', 'movil', 'móvil', 'numero', 'número'],
  email: ['correo', 'email', 'e-mail', 'mail', 'correo electronico', 'correo electrónico'],
  district: ['distrito', 'ciudad', 'district', 'city', 'zona'],
  tags: ['etiquetas', 'etiqueta', 'tags', 'grupo'],
  opt_in: ['acepta promociones', 'promociones', 'opt_in', 'opt-in', 'acepta', 'marketing'],
};

function openImport() {
  const file = h('input', { type: 'file', accept: '.csv,text/csv', class: 'sr-only', tabindex: '-1' });
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    const rows = parseCsv(await f.text());
    if (rows.length < 2) { toast('El archivo está vacío o no tiene encabezados'); return; }
    const header = rows[0].map((x) => norm(x.trim()));
    const idx = {};
    for (const [key, names] of Object.entries(COLS)) idx[key] = header.findIndex((x) => names.map(norm).includes(x));
    if (idx.name < 0 || (idx.phone < 0 && idx.email < 0)) {
      toast('No encontré las columnas "Nombre" y "Celular" o "Correo" en la primera fila'); return;
    }
    const yes = (v) => /^(si|sí|s|yes|y|1|true|x)$/i.test(String(v || '').trim());
    const data = rows.slice(1).map((r) => ({
      name: r[idx.name] || '', phone: idx.phone >= 0 ? r[idx.phone] : '', email: idx.email >= 0 ? r[idx.email] : '',
      district: idx.district >= 0 ? r[idx.district] : '', tags: idx.tags >= 0 ? r[idx.tags] : '',
      opt_in: idx.opt_in >= 0 ? yes(r[idx.opt_in]) : false,
    }));
    const found = Object.entries(idx).filter(([, i]) => i >= 0).map(([k]) => ({ name: 'Nombre', phone: 'Celular', email: 'Correo', district: 'Distrito', tags: 'Etiquetas', opt_in: 'Acepta promociones' }[k]));
    formModal({
      title: 'Importar clientes', saveLabel: `Importar ${data.length}`,
      body: [
        h('p', {}, `Encontré ${plural(data.length, 'fila', 'filas')} en `, h('strong', {}, f.name), '.'),
        h('p', { class: 'muted', style: 'margin:.5rem 0 1rem' }, `Columnas reconocidas: ${found.join(', ')}.`),
        h('div', { class: 'table-wrap', style: 'margin-bottom:1rem' }, h('table', { class: 'dtable' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Nombre'), h('th', {}, 'Celular'), h('th', {}, 'Correo'))),
          h('tbody', {}, data.slice(0, 5).map((d) => h('tr', {}, h('td', {}, d.name), h('td', {}, d.phone), h('td', {}, d.email)))))),
        idx.opt_in < 0 ? h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'all_opt_in' }), 'Todas estas personas aceptaron recibir promociones') : null,
        h('p', { class: 'hint-block' }, 'Si un celular o correo ya existe, se completan sus datos vacíos y se suman las etiquetas; no se duplica. Las filas sin nombre o sin celular/correo se saltan.'),
      ],
      onSave: async (el) => {
        if (el.all_opt_in?.checked) data.forEach((d) => { d.opt_in = true; });
        const r = await call('/api/admin/customers/import', { method: 'POST', body: { rows: data } });
        customersCache = r.customers;
        toast(`Listo: ${r.created} nuevos, ${r.updated} actualizados, ${r.skipped} saltados`);
        route();
      },
    });
  });
  document.body.append(file);
  file.click();
  setTimeout(() => file.remove(), 60_000);
}

// ------------------------------------------------------------------ clientes: ficha

function customerDetailView(id) {
  return asyncView(() => call(`/api/admin/customers/${id}`), (d) => renderCustomerDetail(d));
}

function renderCustomerDetail({ customer: c, orders, activities }) {
  document.title = `${c.name} · Clientes`;
  const f = customerFields(c);
  const msg = h('p', { class: 'form-msg', role: 'alert' });
  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Guardar cambios');

  const form = h('form', {
    class: 'box', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      msg.textContent = ''; save.disabled = true;
      try {
        await call(`/api/admin/customers/${c.id}`, { method: 'PUT', body: f.read(e.target.elements) });
        toast('Cliente actualizado'); route();
      } catch (ex) { msg.textContent = ex.message; save.disabled = false; }
    },
  }, h('h3', { class: 'sub' }, 'Datos'), h('div', { style: 'margin-top:.75rem' }, f.fields), msg,
  h('div', { class: 'savebar' }, save,
    h('span', { class: 'spacer' }),
    confirmButton({
      label: 'Eliminar cliente', confirmLabel: 'Toca otra vez para eliminar',
      onConfirm: async () => {
        try { await call(`/api/admin/customers/${c.id}`, { method: 'DELETE' }); toast('Cliente eliminado'); location.hash = '#clientes'; }
        catch (ex) { toast(ex.message); }
      },
    })));

  // Historial: notas y registros + pedidos, todo en una sola línea de tiempo.
  const timeline = h('ol', { class: 'timeline' });
  let acts = activities;
  const drawTimeline = () => {
    const items = [
      ...acts.map((a) => ({ at: a.created_at, el: h('li', { class: `tl tl-${a.kind === 'campaña' ? 'campana' : a.kind}` },
        h('div', { class: 'tl-head' }, h('span', { class: 'tl-kind' }, ACT[a.kind] || a.kind), h('span', { class: 'tl-when' }, when(a.created_at)),
          !['sistema', 'campaña'].includes(a.kind) ? h('button', {
            class: 'link-btn', type: 'button', onclick: async () => {
              try { await call(`/api/admin/activities/${a.id}`, { method: 'DELETE' }); acts = acts.filter((x) => x.id !== a.id); drawTimeline(); }
              catch (ex) { toast(ex.message); }
            },
          }, 'Borrar') : null),
        h('p', { class: 'tl-body' }, a.body)) })),
      ...orders.map((o) => ({ at: o.created_at, el: h('li', { class: 'tl tl-pedido' },
        h('div', { class: 'tl-head' }, h('span', { class: 'tl-kind' }, `Pedido ${o.code}`), h('span', { class: 'tl-when' }, when(o.created_at)),
          h('span', { class: `st-chip st-${o.status}` }, STATUS[o.status])),
        h('p', { class: 'tl-body' }, o.items.map((i) => `${i.qty} × ${i.name}`).join(', '), ' · ', h('strong', {}, money(o.total)))) })),
    ].sort((a, b) => b.at.localeCompare(a.at));
    timeline.replaceChildren(...(items.length ? items.map((i) => i.el) : [h('li', { class: 'muted' }, 'Todavía no hay registros.')]));
  };
  drawTimeline();

  const noteForm = h('form', {
    class: 'noteform', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const el = e.target.elements;
      if (!el.body.value.trim()) { el.body.focus(); return; }
      try {
        acts = await call(`/api/admin/customers/${c.id}/activities`, { method: 'POST', body: { kind: el.kind.value, body: el.body.value } });
        e.target.reset(); drawTimeline(); toast('Registro guardado');
      } catch (ex) { toast(ex.message); }
    },
  },
  h('div', { class: 'noteform-row' },
    h('select', { class: 'select', name: 'kind', 'aria-label': 'Tipo de registro' },
      h('option', { value: 'nota' }, 'Nota'), h('option', { value: 'llamada' }, 'Llamada'), h('option', { value: 'whatsapp' }, 'WhatsApp')),
    h('button', { class: 'btn btn-dark btn-small', type: 'submit' }, 'Guardar registro')),
  h('textarea', { class: 'textarea', name: 'body', rows: '2', maxlength: '2000', placeholder: 'Ej. Preguntó si llega el vestido en talla M. Le escribo el lunes.', 'aria-label': 'Detalle del registro' }));

  const tile = (label, value) => h('div', { class: 'stat' }, h('span', { class: 'stat-v' }, value), h('span', { class: 'stat-l' }, label));

  return h('div', {},
    h('a', { class: 'back-link', href: '#clientes' }, '← Clientes'),
    h('div', { class: 'panel-head' },
      h('div', {},
        h('h2', { class: 'title' }, c.name),
        h('p', { class: 'muted' }, `Cliente desde ${when(c.created_at)} · Origen: ${SOURCE[c.source] || c.source}`,
          c.opt_in ? [' · ', h('span', { class: 'yes' }, 'Acepta promociones')] : ' · No acepta promociones')),
      h('div', { class: 'head-actions' },
        c.phone ? h('a', { class: 'btn btn-small', href: waLink(c.phone), target: '_blank', rel: 'noopener' }, 'Escribir por WhatsApp') : null,
        c.phone ? h('button', { class: 'btn btn-small', type: 'button', onclick: () => copyText(`+${c.phone}`, 'Celular') }, 'Copiar celular') : null)),
    h('div', { class: 'stats' },
      tile('Compras', c.orders_count),
      tile('Comprado', money(c.spent)),
      tile('Ticket promedio', c.buys_count ? money(c.spent / c.buys_count) : '—'),
      tile('Última compra', c.last_order_at ? when(c.last_order_at) : '—')),
    h('div', { class: 'detail-grid' },
      form,
      h('section', { class: 'box' }, h('h3', { class: 'sub' }, 'Historial'),
        h('p', { class: 'muted' }, 'Pedidos, notas, llamadas y campañas de este cliente.'),
        noteForm, timeline)));
}

// ------------------------------------------------------------------ campañas

function campaignsView(param) {
  if (param) return asyncView(() => call(`/api/admin/campaigns/${Number(param)}`), renderCampaign);
  return asyncView(() => Promise.all([call('/api/admin/campaigns'), loadCustomers()]), ([list, customers]) => renderCampaigns(list, customers));
}

function progressBar(sent, skipped, total) {
  const pct = (n) => (total ? (n / total) * 100 : 0);
  return h('div', { class: 'progress', role: 'img', 'aria-label': `${sent} enviados y ${skipped} omitidos de ${total}` },
    h('span', { class: 'progress-sent', style: `width:${pct(sent)}%` }),
    h('span', { class: 'progress-skip', style: `width:${pct(skipped)}%` }));
}

function renderCampaigns(list, customers) {
  const optin = customers.filter((c) => c.opt_in && c.phone).length;
  return h('div', {},
    h('div', { class: 'panel-head' },
      h('h2', { class: 'title' }, 'Campañas'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openCampaignEditor(customers) }, 'Nueva campaña')),
    h('div', { class: 'box info-box' },
      h('p', {}, h('strong', {}, `${plural(optin, 'cliente puede', 'clientes pueden')} recibir campañas`), ' (aceptaron promociones y tienen celular).'),
      h('p', { class: 'muted' }, 'Eliges a quién va, escribes el mensaje una vez y el panel te abre WhatsApp con el texto listo para cada persona. Marca cada envío para no repetir.')),
    list.length
      ? list.map((c) => h('a', { class: 'camp', href: `#campanas/${c.id}` },
        h('div', { class: 'camp-head' }, h('strong', {}, c.name), h('span', { class: 'muted' }, when(c.created_at))),
        progressBar(c.sent, c.skipped, c.total),
        h('p', { class: 'muted camp-meta' }, `${c.sent} de ${c.total} enviados`, c.skipped ? ` · ${c.skipped} omitidos` : '',
          c.sent + c.skipped >= c.total ? ' · Terminada' : '')))
      : h('div', { class: 'empty-note box' }, h('strong', {}, 'Todavía no hay campañas'), 'Crea la primera, por ejemplo para avisar de prendas nuevas o una liquidación.'));
}

function openCampaignEditor(customers) {
  const tags = [...new Set(customers.flatMap((c) => c.tags))].sort();
  const districts = [...new Set(customers.map((c) => c.district).filter(Boolean))].sort();
  const seg = { tag: '', bought: 'any', inactive_days: 0, district: '', min_spent: '' };
  const countEl = h('p', { class: 'reach', 'aria-live': 'polite' }, 'Calculando…');
  const preview = h('div', { class: 'bubble' });
  const msgInput = h('textarea', {
    class: 'textarea', name: 'message', rows: '5', maxlength: '1500',
    oninput: () => drawPreview(),
  }, `Hola {nombre}, llegaron prendas nuevas a {tienda}. Míralas aquí: ${location.origin}\n\nSi ya no quieres recibir estos mensajes, responde BAJA.`);

  let sample = 'María';
  const drawPreview = () => { preview.textContent = fillMessage(msgInput.value, { name: sample }); };
  let timer;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const r = await call('/api/admin/campaigns/preview', { method: 'POST', body: { segment: seg } });
        countEl.replaceChildren(h('strong', {}, `Llegará a ${plural(r.count, 'cliente', 'clientes')}`),
          r.sample.length ? h('span', { class: 'muted' }, ` · ${r.sample.join(', ')}${r.count > r.sample.length ? '…' : ''}`) : '');
        sample = firstName(r.sample[0]) || 'María'; drawPreview();
      } catch (ex) { countEl.textContent = ex.message; }
    }, 250);
  };
  const on = (k) => (e) => { seg[k] = e.target.value; refresh(); };
  const insert = (token) => {
    const s = msgInput.selectionStart ?? msgInput.value.length;
    msgInput.setRangeText(token, s, msgInput.selectionEnd ?? s, 'end'); msgInput.focus(); drawPreview();
  };

  drawPreview(); refresh();
  formModal({
    title: 'Nueva campaña', saveLabel: 'Crear campaña', wide: true,
    body: [
      ffield('Nombre de la campaña', h('input', { class: 'input', name: 'name', maxlength: '80', placeholder: 'Ej. Nuevos vestidos de verano' }), 'Solo lo ves tú.'),
      h('fieldset', { class: 'seg' },
        h('legend', {}, '¿A quién va?'),
        h('div', { class: 'grid2' },
          ffield('Etiqueta', h('select', { class: 'select', onchange: on('tag') }, h('option', { value: '' }, 'Cualquiera'), tags.map((t) => h('option', { value: t }, t)))),
          ffield('Compras', h('select', { class: 'select', onchange: on('bought') },
            h('option', { value: 'any' }, 'Todos'), h('option', { value: 'yes' }, 'Ya compraron'), h('option', { value: 'no' }, 'Nunca compraron'))),
          ffield('Sin comprar desde hace', h('select', { class: 'select', onchange: on('inactive_days') },
            h('option', { value: '0' }, 'No importa'), ...[30, 60, 90, 180, 365].map((d) => h('option', { value: String(d) }, `Más de ${d} días`)))),
          ffield('Distrito', h('select', { class: 'select', onchange: on('district') }, h('option', { value: '' }, 'Todos'), districts.map((d) => h('option', { value: d }, d))))),
        ffield('Han comprado al menos (opcional)', h('input', { class: 'input', type: 'number', min: '0', step: '0.01', placeholder: '0.00', oninput: on('min_spent') }), `En ${A.settings.currency}, sumando sus pedidos confirmados`),
        countEl,
        h('p', { class: 'hint-block' }, 'Solo se incluyen clientes que aceptaron recibir promociones y tienen celular.')),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Mensaje'), msgInput,
        h('div', { class: 'presets' }, h('span', { class: 'hint' }, 'Insertar:'),
          h('button', { class: 'btn btn-small', type: 'button', onclick: () => insert('{nombre}') }, 'Nombre del cliente'),
          h('button', { class: 'btn btn-small', type: 'button', onclick: () => insert('{tienda}') }, 'Nombre de la tienda'))),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Así lo verá'), preview),
    ],
    onSave: async (el) => {
      const c = await call('/api/admin/campaigns', { method: 'POST', body: { name: el.name.value, message: msgInput.value, segment: seg } });
      toast('Campaña creada'); location.hash = `#campanas/${c.id}`;
    },
  });
}

function renderCampaign(camp) {
  document.title = `${camp.name} · Campañas`;
  let filter = 'pendiente';
  const list = h('div', { class: 'rlist' });
  const head = h('div', {});
  const nextBtn = h('a', { class: 'btn btn-primary', target: '_blank', rel: 'noopener' });

  const setStatus = async (r, status) => {
    try {
      await call(`/api/admin/campaigns/${camp.id}/recipients/${r.customer_id}`, { method: 'PUT', body: { status } });
      if (r.status !== status) {
        const k = { enviado: 'sent', omitido: 'skipped' };
        if (k[r.status]) camp[k[r.status]]--;
        if (k[status]) camp[k[status]]++;
      }
      r.status = status; draw();
    } catch (ex) { toast(ex.message); }
  };

  function draw() {
    head.replaceChildren(progressBar(camp.sent, camp.skipped, camp.total),
      h('p', { class: 'muted camp-meta' }, `${camp.sent} enviados · ${camp.skipped} omitidos · ${camp.total - camp.sent - camp.skipped} pendientes`));
    const next = camp.recipients.find((r) => r.status === 'pendiente' && r.opt_in);
    nextBtn.hidden = !next;
    if (next) {
      nextBtn.textContent = `Enviar al siguiente: ${firstName(next.name)}`;
      nextBtn.href = waLink(next.phone, fillMessage(camp.message, next));
      nextBtn.onclick = () => setStatus(next, 'enviado');
    }
    const items = camp.recipients.filter((r) => !filter || r.status === filter);
    list.replaceChildren(...(items.length ? items.map((r) => h('div', { class: `rrow r-${r.status}` },
      h('div', {}, h('a', { href: `#clientes/${r.customer_id}` }, h('strong', {}, r.name)), h('span', { class: 'muted' }, ` +${r.phone}`),
        !r.opt_in ? h('span', { class: 'warn-chip' }, 'Ya no acepta promociones') : null),
      h('div', { class: 'rrow-act' },
        r.status === 'pendiente' && r.opt_in
          ? [h('a', { class: 'btn btn-small btn-dark', href: waLink(r.phone, fillMessage(camp.message, r)), target: '_blank', rel: 'noopener', onclick: () => setStatus(r, 'enviado') }, 'Abrir WhatsApp'),
            h('button', { class: 'btn btn-small btn-quiet', type: 'button', onclick: () => setStatus(r, 'omitido') }, 'Omitir')]
          : [h('span', { class: `st-chip st-${r.status === 'enviado' ? 'entregado' : 'nuevo'}` }, r.status === 'enviado' ? `Enviado ${r.sent_at ? when(r.sent_at) : ''}` : r.status === 'omitido' ? 'Omitido' : 'Pendiente'),
            r.status !== 'pendiente' ? h('button', { class: 'link-btn', type: 'button', onclick: () => setStatus(r, 'pendiente') }, 'Deshacer') : null])))
      : [h('p', { class: 'empty-note' }, filter === 'pendiente' ? '¡Listo! No quedan envíos pendientes.' : 'No hay nadie en esta lista.')]));
  }

  const filterSel = h('select', { class: 'select', 'aria-label': 'Mostrar', onchange: (e) => { filter = e.target.value; draw(); } },
    h('option', { value: 'pendiente' }, 'Pendientes'), h('option', { value: 'enviado' }, 'Enviados'), h('option', { value: 'omitido' }, 'Omitidos'), h('option', { value: '' }, 'Todos'));

  draw();
  return h('div', {},
    h('a', { class: 'back-link', href: '#campanas' }, '← Campañas'),
    h('div', { class: 'panel-head' },
      h('div', {}, h('h2', { class: 'title' }, camp.name), h('p', { class: 'muted' }, `Creada ${when(camp.created_at)}`)),
      h('div', { class: 'head-actions' },
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => downloadCsv(`campana-${camp.id}.csv`, ['Nombre', 'Celular', 'Estado', 'Mensaje'],
          camp.recipients.map((r) => [r.name, `+${r.phone}`, r.status, fillMessage(camp.message, r)])) }, 'Exportar lista'),
        confirmButton({
          label: 'Eliminar', confirmLabel: 'Toca otra vez para eliminar',
          onConfirm: async () => {
            try { await call(`/api/admin/campaigns/${camp.id}`, { method: 'DELETE' }); toast('Campaña eliminada'); location.hash = '#campanas'; }
            catch (ex) { toast(ex.message); }
          },
        }))),
    h('div', { class: 'detail-grid' },
      h('section', { class: 'box' }, h('h3', { class: 'sub' }, 'Mensaje'), h('div', { class: 'bubble', style: 'margin-top:.75rem' }, camp.message),
        h('p', { class: 'hint-block' }, '{nombre} se cambia por el nombre de cada cliente al abrir WhatsApp.')),
      h('section', { class: 'box' },
        h('h3', { class: 'sub' }, 'Envíos'), head,
        h('div', { class: 'camp-tools' }, nextBtn, filterSel),
        list)));
}
