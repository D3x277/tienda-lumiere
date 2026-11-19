'use strict';
// Utilidades compartidas por la tienda y el panel.

// h('div', { class: 'caja', onclick: fn }, 'texto', otroElemento)
// Crea elementos del DOM sin usar innerHTML: el texto siempre se escapa solo (evita XSS).
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  let selectValue;
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value' && tag === 'select') selectValue = v; // se asigna después de crear las opciones
    else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (kid) => {
    if (Array.isArray(kid)) kid.forEach(add);
    else if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  };
  kids.forEach(add);
  if (selectValue !== undefined) el.value = selectValue;
  return el;
}

const $ = (sel, root = document) => root.querySelector(sel);

// Llama a la API y devuelve el JSON. Si hay error, lanza un Error con un mensaje legible.
async function api(path, { method = 'GET', body, raw, headers } = {}) {
  const opts = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (raw !== undefined) opts.body = raw;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try { res = await fetch(path, opts); }
  catch { throw new Error('No hay conexión. Revisa tu internet e inténtalo de nuevo.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Algo salió mal. Inténtalo de nuevo.');
    err.status = res.status;
    throw err;
  }
  return data;
}

const fmtMoney = (n, cur) =>
  `${cur} ${Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Elige texto blanco u oscuro según qué tan claro es el color de la marca.
function readableInk(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.42 ? '#161A23' : '#FFFFFF';
}

function applyAccent(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return;
  const root = document.documentElement.style;
  root.setProperty('--accent', hex);
  root.setProperty('--accent-ink', readableInk(hex));
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
