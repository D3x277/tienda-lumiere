'use strict';
// Carga prendas de ejemplo para probar la tienda: npm run seed
// (No uses esto en la tienda real: agrega datos de demostración.)

const fs = require('node:fs');
const path = require('node:path');
const { db } = require('./db');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

if (db.prepare('SELECT COUNT(*) AS n FROM products').get().n > 0 && !process.argv.includes('--force')) {
  console.log('Ya hay prendas cargadas. Usa --force si quieres agregar los ejemplos igual.');
  process.exit(0);
}

// Siluetas simples para que las fotos de ejemplo se parezcan a ropa.
const SHAPES = {
  polo: 'M200 120 L120 160 L70 250 L130 280 L160 240 L160 640 L440 640 L440 240 L470 280 L530 250 L480 160 L400 120 Q300 175 200 120 Z',
  poleron: 'M200 130 L110 170 L60 520 L130 530 L170 300 L170 640 L430 640 L430 300 L470 530 L540 520 L490 170 L400 130 Q300 195 200 130 Z',
  vestido: 'M240 110 L360 110 L372 250 L460 650 L140 650 L228 250 Z',
  pantalon: 'M210 120 L390 120 L440 670 L330 670 L300 300 L270 670 L160 670 Z',
  falda: 'M215 200 L385 200 L480 620 L120 620 Z',
};

function image(file, shape, bg, fabric) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800">
<rect width="600" height="800" fill="${bg}"/>
<ellipse cx="300" cy="735" rx="190" ry="14" fill="#000" opacity=".08"/>
<path d="${SHAPES[shape]}" fill="${fabric}"/>
<path d="${SHAPES[shape]}" fill="none" stroke="#000" stroke-opacity=".12" stroke-width="3"/>
</svg>`;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), svg);
  return `/uploads/${file}`;
}

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const cats = ['Polos', 'Polerones', 'Vestidos', 'Pantalones', 'Faldas'];
cats.forEach((name, i) =>
  db.prepare('INSERT OR IGNORE INTO categories (name, slug, position) VALUES (?, ?, ?)').run(name, slug(name), i + 1));
const catId = (name) => db.prepare('SELECT id FROM categories WHERE name = ?').get(name).id;

const demo = [
  { name: 'Polo básico algodón', cat: 'Polos', shape: 'polo', price: 45, compare: null, sizes: ['S', 'M', 'L', 'XL'], colors: ['Blanco', 'Negro'], stock: 12, featured: 1, bg: '#F3E4EB', fabric: '#FFFFFF', bg2: '#EBD7E0', fabric2: '#2B0E1C', desc: 'Algodón peinado de 160 g, corte recto y cuello reforzado. Se siente fresco y mantiene la forma después de muchos lavados.' },
  { name: 'Polerón con capucha', cat: 'Polerones', shape: 'poleron', price: 129.9, compare: 159.9, sizes: ['S', 'M', 'L'], colors: ['Rosa', 'Vino'], stock: 6, featured: 1, bg: '#F1E2E8', fabric: '#C9A3B6', bg2: '#EAD9E1', fabric2: '#892E54', desc: 'Franela afelpada por dentro, bolsillo canguro y puños elásticos.' },
  { name: 'Vestido midi satinado', cat: 'Vestidos', shape: 'vestido', price: 189, compare: null, sizes: ['XS', 'S', 'M', 'L'], colors: ['Rosa', 'Vino'], stock: 4, featured: 1, bg: '#F6E7EE', fabric: '#D9A5BF', bg2: '#F1E0E8', fabric2: '#892E54', desc: 'Satén con caída fluida, tirantes finos y largo hasta la pantorrilla.' },
  { name: 'Pantalón wide leg', cat: 'Pantalones', shape: 'pantalon', price: 149, compare: null, sizes: ['28', '30', '32', '34'], colors: ['Negro', 'Beige'], stock: 9, featured: 0, bg: '#EFE0E7', fabric: '#2B0E1C', bg2: '#F3E8E2', fabric2: '#CDB8A6', desc: 'Tiro alto y pierna ancha. Tela ligera que no se arruga fácil.' },
  { name: 'Falda plisada', cat: 'Faldas', shape: 'falda', price: 99, compare: 120, sizes: ['S', 'M', 'L'], colors: ['Vino', 'Negro'], stock: 0, featured: 0, bg: '#F0DFE6', fabric: '#892E54', bg2: '#EADCE3', fabric2: '#2B0E1C', desc: 'Plisado permanente, cintura elástica y largo midi.' },
  { name: 'Polo oversize', cat: 'Polos', shape: 'polo', price: 59, compare: null, sizes: ['M', 'L', 'XL'], colors: ['Crema'], stock: null, featured: 0, bg: '#EBD7E0', fabric: '#F3E9E4', bg2: '#EBD7E0', fabric2: '#E8DBD4', desc: 'Corte holgado con caída relajada.' },
  { name: 'Vestido corto de verano', cat: 'Vestidos', shape: 'vestido', price: 119, compare: null, sizes: ['XS', 'S', 'M'], colors: ['Rosa'], stock: 3, featured: 0, bg: '#F3E3EA', fabric: '#E7A9C1', bg2: '#F3E3EA', fabric2: '#DB93B0', desc: 'Tela fresca con forro interior y cierre oculto en la espalda.' },
  { name: 'Polerón cuello redondo', cat: 'Polerones', shape: 'poleron', price: 119, compare: null, sizes: ['S', 'M', 'L', 'XL'], colors: ['Vino', 'Crema'], stock: 15, featured: 0, bg: '#F1E1E8', fabric: '#5C1336', bg2: '#EFE2E6', fabric2: '#EFE4DF', desc: 'Algodón french terry, suave por dentro y sin pelusa por fuera.' },
];

demo.forEach((d, i) => {
  const imgs = [image(`demo-${i + 1}a.svg`, d.shape, d.bg, d.fabric), image(`demo-${i + 1}b.svg`, d.shape, d.bg2, d.fabric2)];
  db.prepare(`INSERT OR IGNORE INTO products (name, slug, description, price_cents, compare_cents, category_id, images, sizes, colors, stock, featured)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    d.name, slug(d.name), d.desc, Math.round(d.price * 100), d.compare ? Math.round(d.compare * 100) : null,
    catId(d.cat), JSON.stringify(imgs), JSON.stringify(d.sizes), JSON.stringify(d.colors), d.stock, d.featured);
});


console.log(`Listo: ${demo.length} prendas y ${cats.length} categorías de ejemplo.`);
