'use strict';
// Carga en el panel las 7 compras de noviembre 2026 (30 prendas) del reporte "Lumiere: compras de noviembre 2026".
//   npm run importar-noviembre
// Pregunta a qué cuenta de Shein asignarlas (luego puedes mover cada compra desde el panel: Editar compra > Cuenta).
// En el servidor publicado, sin terminal: pon la variable IMPORTAR_NOVIEMBRE=correo@de-la-cuenta.com y reinicia.
// Si una compra ya existe (mismo n° de pedido), se salta: puedes correrlo dos veces sin duplicar nada.

const readline = require('node:readline/promises');
const { db, tx } = require('./db');

// [prenda, talla / color, tipo, precio en el pedido, precio de venta, origen del precio]
const COMPRAS = [
  { pedido: 'GSH19P59C00NH95', pagado: 95.25, llegada: '16-29 nov', nota: 'Precios del pedido', prendas: [
    ['Top de flecos (Lumalex)', 'Albaricoque / S', 'Top', 16.56, 55],
    ['Cadena de cintura dorada', '', 'Accesorio', 6.47, 25],
    ['Vestido mini encaje transparente', 'Negro / M', 'Vestido fiesta', 19.41, 90],
    ['Vestido mini encaje transparente', 'Blanco / S', 'Vestido fiesta', 19.20, 90],
    ['Vestido de playa con conjunto (Aloruh)', 'Granate / M', 'Playa', 23.30, 75],
    ['Set collar y aretes geométricos', '', 'Accesorio', 6.87, 25],
  ] },
  { pedido: 'GSH1A102F001KVJ', pagado: 103.41, llegada: '19 nov - 4 dic', nota: 'Precios del pedido', prendas: [
    ['Vestido drapeado mangas acampanadas (Swim Glamine)', 'Beis / M', 'Vestido fiesta', 13.98, 90],
    ['Vestido extra largo (Aloruh)', 'Caqui / S', 'Vestido largo', 32.97, 100],
    ['Vestido de gasa para playa (Aloruh)', 'Albaricoque / M', 'Playa', 26.01, 75],
    ['Conjunto 2 piezas top halter y falda (Aloruh)', 'Burdeos / S', 'Conjunto', 27.06, 90],
  ] },
  { pedido: 'GSH1AM31X00NQRH', pagado: 105.93, llegada: '17-30 nov', nota: 'Precios del pedido', prendas: [
    ['Cadena de espalda con perlas', '', 'Accesorio', 3.10, 20],
    ['Vestido largo animal print (Opulessa)', 'Multicolor / S', 'Vestido largo', 31.79, 100],
    ['Vestido cover-up cebra (Glamine)', '', 'Playa', 19.56, 75],
    ['Vestido mini cuello drapeado (Swim Glamine)', 'Marrón / M', 'Vestido fiesta', 17.30, 90],
    ['Conjunto 2 piezas top tubo y pantalón', 'Blanco / S', 'Conjunto', 30.74, 90],
  ] },
  { pedido: 'GSH1AM52X001B5R', pagado: 95.11, llegada: '17-30 nov', nota: 'Los 2 pañuelos son aproximados', prendas: [
    ['Vestido mini romántico con flor (Soleia)', 'Amarillo / M', 'Vestido fiesta', 24.94, 90],
    ['Conjunto top encaje y pantalón largo (Bonvoyette)', 'Negro / M', 'Conjunto', 26.07, 90],
    ['Vestido largo con volantes (Aloruh)', 'Rojo / S', 'Vestido largo', 31.91, 100],
    ['Pañuelo estampado', '', 'Accesorio', 3.58, 15, 'aprox'],
    ['Pañuelo de encaje de ganchillo', '', 'Accesorio', 5.21, 15, 'aprox'],
  ] },
  { pedido: 'GSH1A152T00MQBG', pagado: 62.58, llegada: '18 nov - 1 dic', nota: 'Precios del pedido', prendas: [
    ['Vestido maxi halter de punto (Firerie)', 'Albaricoque / S', 'Vestido largo', 30.95, 100],
    ['Conjunto top halter encaje y falda (Aloruh)', 'Beis / S', 'Conjunto', 28.24, 90],
  ] },
  { pedido: 'GSH1A220100NMGR', pagado: 101.06, llegada: '22 nov - 7 dic', nota: 'Última compra (10/11)', prendas: [
    ['Blusa encaje transparente con pelo (EgrlEra)', 'Negro / M', 'Top', 15.62, 55],
    ['Top de encaje rosa', '', 'Top', 19.30, 55],
    ['Vestido mini rojo halter (Soleia)', 'Rojo / S', 'Vestido fiesta', 25.36, 95],
    ['Vestido mini lentejuelas (Glamine)', 'Dorado / M', 'Vestido fiesta', 37.39, 100],
  ] },
  { pedido: 'GSH19J52N000K6M', pagado: 93.63, llegada: '10-22 nov', nota: 'Precios de la página del producto, ajustados al total pagado', prendas: [
    ['Conjunto top camisola y falda tejida (Soleia)', 'Blanco / S', 'Conjunto', 44.92, 75, 'pagina'],
    ['Vestido mini ajustado bohemio (Amplova)', 'Naranja / M', 'Vestido fiesta', 17.74, 90, 'pagina'],
    ['Vestido suéter con brillo y escote profundo', 'Dorado / S', 'Vestido fiesta', 50.57, 100, 'pagina'],
    ['Vestido mini halter de punto (Firerie)', 'Albaricoque / S', 'Vestido fiesta', 47.87, 90, 'pagina'],
  ] },
];
const FECHA = '2026-11-10'; // el reporte no trae la fecha de cada compra; corrígela en el panel si quieres
const cents = (n) => Math.round(n * 100);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Carga las compras en la cuenta indicada. Salta las que ya existen (mismo n° de pedido).
function importar(accountId) {
  let added = 0, skipped = 0, units = 0;
  tx(() => {
    for (const c of COMPRAS) {
      if (db.prepare('SELECT 1 FROM supplier_purchases WHERE order_number = ?').get(c.pedido)) { skipped++; continue; }
      const sum = c.prendas.reduce((s, p) => s + cents(p[3]), 0);
      const pid = Number(db.prepare(`INSERT INTO supplier_purchases (account_id, bought_on, items_count, cost_cents, shipping_cents, description, order_number, arrival)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(accountId, FECHA, c.prendas.length, cents(c.pagado), cents(c.pagado) - sum, c.nota, c.pedido, c.llegada).lastInsertRowid);
      for (const [name, variant, type, price, sale, source = 'pedido'] of c.prendas) {
        db.prepare(`INSERT INTO supplier_purchase_items (purchase_id, name, variant, type, kind, unit_cost_cents, qty, sale_price_cents, price_source)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(pid, name, variant, type, type === 'Accesorio' ? 'accesorio' : 'prenda', cents(price), cents(sale), source);
        units++;
      }
      added++;
    }
  });
  return { added, skipped, units };
}

// Busca la cuenta por correo; si no existe, la crea (sin contraseña: se pone luego desde el panel).
function cuentaPorCorreo(email) {
  email = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Error(`"${email}" no es un correo válido`);
  const row = db.prepare('SELECT id FROM supplier_accounts WHERE email = ?').get(email);
  return row ? row.id : Number(db.prepare("INSERT INTO supplier_accounts (email, password_enc, notes) VALUES (?, '', '')").run(email).lastInsertRowid);
}

// En un servidor sin terminal (Railway, Render): con la variable IMPORTAR_NOVIEMBRE=correo@cuenta.com
// el servidor carga las compras al arrancar. Como salta las que ya existen, dejarla puesta no duplica nada.
function importarDesdeVariable() {
  const email = process.env.IMPORTAR_NOVIEMBRE;
  if (!email) return;
  try {
    const r = importar(cuentaPorCorreo(email));
    console.log(`  Compras de noviembre: ${r.added} cargadas (${r.units} prendas)${r.skipped ? `, ${r.skipped} ya estaban` : ''}.`);
  } catch (e) { console.error(`  No se pudieron cargar las compras de noviembre: ${e.message}`); }
}

module.exports = { importar, importarDesdeVariable };

// Uso en la terminal: npm run importar-noviembre (pregunta a qué cuenta asignarlas).
if (require.main === module) {
  (async () => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const lines = rl[Symbol.asyncIterator]();
    const ask = async (q) => { process.stdout.write(q); const r = await lines.next(); return r.done ? '' : r.value.trim(); };

    const accounts = db.prepare('SELECT id, email FROM supplier_accounts ORDER BY id').all();
    let accountId;
    try {
      if (!accounts.length) {
        accountId = cuentaPorCorreo(await ask('No tienes cuentas de Shein registradas. Escribe el correo de la cuenta para estas compras: '));
        console.log('Cuenta creada. Ponle la contraseña desde el panel si quieres guardarla.');
      } else {
        console.log('\n¿A qué cuenta de Shein asigno las 7 compras de noviembre?');
        accounts.forEach((a, i) => console.log(`  ${i + 1}. ${a.email}`));
        const pick = Number.parseInt(await ask('Número de la cuenta [1]: ') || '1', 10);
        if (!(pick >= 1 && pick <= accounts.length)) throw new Error('Número no válido');
        accountId = accounts[pick - 1].id;
      }
    } catch (e) { console.log(`\n${e.message}. No se cargó nada.`); process.exit(1); }
    rl.close();

    const r = importar(accountId);
    console.log(`\nListo: ${r.added} compras nuevas (${r.units} prendas)${r.skipped ? `, ${r.skipped} ya estaban y se saltaron` : ''}.`);
    console.log('Míralas en el panel: Compras > Inventario y ventas.');
  })();
}
