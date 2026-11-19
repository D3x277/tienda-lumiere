# Tienda de ropa con panel de administración

Tienda online para vender ropa, hecha desde cero y sin dependencias externas (solo Node.js).
Los clientes eligen prendas, arman su pedido y lo envían por WhatsApp. La dueña sube y edita sus prendas desde un panel.

## Cómo ejecutarla

Necesitas Node.js 22.13 o superior (`node --version`).

```bash
npm start            # o: node server.js
```

- Tienda: http://127.0.0.1:3000
- Panel: http://127.0.0.1:3000/admin

La primera vez, la consola muestra la **contraseña inicial** del panel. Cámbiala en *Mi tienda > Contraseña*.
Para probar con prendas de ejemplo: `npm run seed` (no lo uses en la tienda real).
Para cargar las 7 compras de noviembre 2026 (30 prendas) del reporte de compras: `npm run importar-noviembre` (pregunta a qué cuenta de Shein asignarlas y no duplica si lo corres dos veces).

| Variable | Para qué sirve | Por defecto |
|---|---|---|
| `PORT` | Puerto del servidor | `3000` |
| `HOST` | Dirección. Usa `0.0.0.0` para publicarla | `127.0.0.1` |
| `ADMIN_PASSWORD` | Contraseña inicial (solo la primera vez) | aleatoria |
| `DATA_DIR` / `UPLOAD_DIR` | Dónde se guardan la base de datos y las fotos | `./data`, `./uploads` |
| `TRUST_PROXY=1` | Actívala detrás de un proxy (Render): el límite de intentos de login distingue a cada visitante | apagado |
| `VAULT_KEY` | Llave (64 caracteres hex) para cifrar las contraseñas de las cuentas Shein. Si no la defines, se crea sola en `data/vault.key` | automática |
| `TZ_OFFSET_HOURS` | Zona horaria de los reportes (horas respecto a UTC) | `-5` (Perú) |
| `COOKIE_SECURE=1` | Marca la sesión como solo-HTTPS (actívala al publicar con HTTPS) | apagado |

## Qué puede hacer la dueña desde el panel

- **Prendas**: subir fotos (se reducen solas), nombre, descripción, precio y precio anterior (oferta), categoría, tallas, colores, stock; ocultar o mostrar con un interruptor; destacar en la portada.
- **Categorías**: crear, renombrar, ordenar y eliminar.
- **Pedidos**: ver cada pedido con el detalle, cambiar su estado y escribir al cliente por WhatsApp. Al cancelar, las prendas vuelven al stock.
- **Resumen (reportes)**: ventas confirmadas, pedidos, ticket promedio, unidades, pedidos por confirmar, clientes nuevos y recurrentes, compras a proveedor y "ventas − compras", con comparación contra el periodo anterior. Gráfico de ventas y compras por mes, lo más vendido, ventas por categoría, mejores clientes, pedidos por estado, prendas vs. accesorios comprados y stock bajo. Descarga de pedidos, productos vendidos, clientes y compras en CSV.
- **Clientes (CRM)**: se crean solos con cada pedido (se reconocen por celular o correo, así no se duplican). Lista con búsqueda, filtros, orden, etiquetas y acciones en grupo; ficha de cada cliente con sus datos, cuánto ha comprado e historial (pedidos, notas, llamadas, campañas). Importar y exportar en CSV.
- **Campañas**: eliges a quién va (etiqueta, si compró o no, cuánto tiempo sin comprar, distrito, monto mínimo), escribes el mensaje con `{nombre}` y el panel te abre WhatsApp con el texto listo para cada persona, marcando a quién ya le enviaste. Solo incluye a quienes aceptaron recibir promociones.
- **Compras Shein**: registro privado de cada cuenta nueva (correo, contraseña cifrada y notas) y de cada compra: n° de pedido, llegada aproximada, total pagado y una fila por producto con nombre, talla/color, tipo (Vestido fiesta, Playa, Accesorio…), precio en el pedido, unidades, precio de venta proyectado y origen del precio.
- **Inventario y ventas**: las tablas del reporte de compras, interactivas. Resumen por compra y por tipo, detalle por prenda con costo real, ganancia y margen; cambias un precio de venta (o el de todo un tipo) y la proyección se recalcula. Registro de ventas por prenda (canal, forma de pago, cliente) con ganancia real, cuánto de lo invertido ya volvió y qué falta vender. Se imprime o guarda como PDF y se descarga en CSV.
- **Mi tienda**: nombre, logo, color principal, textos de la portada, número de WhatsApp, Instagram y contraseña.
- **Borrar datos** (al final de Mi tienda): limpia lo cargado de prueba eligiendo qué borrar (pedidos, clientes, campañas, ventas, compras, prendas, categorías). Pide escribir BORRAR y la contraseña del panel. También se pueden eliminar uno por uno los pedidos, las prendas (desde la lista) y varios clientes a la vez.

## Identidad de marca (Lumiere)

La tienda ya viene con la marca aplicada: *Lumiere, silenciosamente icónica*.

| Elemento | Valor | Dónde se cambia |
|---|---|---|
| Rosa Lumiere (color principal: botones, enlaces) | `#892E54` | Panel → Mi tienda → Color principal |
| Rosa metálico (etiqueta de precio) | degradado `#F6E3EC → #D9A5BF → #BF7F9E` | `public/base.css`, variable `--tag` |
| Fondo / tinta | `#FBF5F7` / `#2B0E1C` | `public/base.css` (variables al inicio) |
| Tipografía de marca (gótica) | Grenze Gotisch, solo en portada, "Prendas" y pie | `--font-brand` en `base.css` |
| Tipografía de lectura | Hanken Grotesk | `--font-body` en `base.css` |
| Logo y favicon | `public/brand/lumiere-logo.png`, `public/brand/favicon.png` | Logo: Panel → Mi tienda. Favicon: reemplaza el archivo |

- El elemento distintivo es la **etiqueta de precio** con hilo (como las de una prenda en tienda), en rosa metálico para hacer eco del logo.
- Los datos de la marca (nombre, frase, WhatsApp, Instagram) están en `DEFAULTS` de `db.js`. Aplican a una instalación nueva; si ya guardaste ajustes en el panel, esos valores mandan.
- Las fuentes se cargan desde Google Fonts. Sin internet la tienda usa una tipografía serif y sans del sistema; se ve bien pero distinta.

## Para aprender e-commerce: dónde está cada idea

| Concepto | Dónde verlo |
|---|---|
| Modelo de datos (productos, categorías, pedidos, ajustes) | `db.js` |
| Precios en céntimos (enteros) para evitar errores de decimales | `db.js`, `toProduct()` en `server.js` |
| API pública y API del administrador | `server.js`, sección "rutas" |
| Carrito del lado del cliente (`localStorage`) | `public/store.js`, sección "carrito" |
| Checkout: **el precio se lee siempre de la base de datos**, nunca del navegador | `createOrder()` en `server.js` |
| Transacciones: guardar el pedido y descontar stock, o nada | `tx()` en `db.js` |
| Copia (snapshot) de lo comprado con el precio de ese día | columna `orders.items` |
| Pedido por WhatsApp (enlace `wa.me` con el mensaje armado) | `waMessage()` en `server.js` |
| Login del administrador: contraseña con hash (scrypt) + cookie `HttpOnly` | `auth.js` |
| Subida de imágenes: se valida el contenido real del archivo, no su extensión | `detectImage()` en `server.js` |
| Guardar contraseñas que hay que poder volver a leer: **cifrado** (AES-256-GCM), no hash | `vault.js` |
| CRM: un cliente por persona, reconocido por su celular normalizado (`51` + 9 dígitos) | `normPhone()` y `upsertCustomer()` en `db.js` |
| Migraciones: agregar columnas a una base que ya tiene datos | `addColumn()` en `db.js` |
| Consentimiento para marketing (opt-in) y su registro en el historial | `crm.js`, casilla del checkout en `public/store.js` |
| Segmentar clientes con SQL (filtros que se combinan) | `segmentCustomers()` en `crm.js` |
| Reportes con SQL: `GROUP BY`, `json_each` para leer los productos de cada pedido | `reports.js` |
| Qué cuenta como venta: solo pedidos confirmados, enviados o entregados | `SALE_STATUSES` en `crm.js` |
| Gráfico de barras en SVG, sin librerías | `monthlyChart()` en `public/admin/reports.js` |
| Costo real: repartir envío, impuestos y descuentos de un pedido entre sus prendas | `realCost()` en `sales.js`, `buildModel()` en `public/admin/inventory.js` |
| Proyección vs. realidad: precio de venta proyectado y ventas registradas | `public/admin/inventory.js` |
| Editar sin perder relaciones: actualizar filas en lugar de borrarlas y crearlas | `savePurchaseLines()` en `server.js` |
| Reducir fotos en el navegador antes de subirlas | `prepareImage()` en `public/admin/admin.js` |

### Decisiones de seguridad que ya están aplicadas

- Todas las rutas `/api/admin/*` exigen sesión; las contraseñas nunca se guardan en texto plano.
- Límite de intentos de login (5 por 10 minutos por IP).
- El texto que escribe un usuario siempre se escapa (`h()` en `public/dom.js` no usa `innerHTML`).
- No se aceptan SVG como subida (pueden esconder scripts); lo subido se sirve con CSP restrictiva.
- Las rutas que modifican datos exigen JSON, lo que bloquea formularios enviados desde otras webs (CSRF).
- Protección contra rutas tipo `../` al servir archivos.

## Publicarla en internet

La tienda necesita un servidor Node con **disco permanente**, porque la base de datos, las fotos y la llave de cifrado son archivos. El proyecto trae listo el plano para **Render** (`render.yaml`). Cuesta unos USD 7 al mes más USD 0.25 por el disco de 1 GB, y Render hace una copia diaria del disco.

### 1. Subir el código a GitHub (repositorio **privado**)

El repositorio debe ser **privado**: `importar-noviembre.js` tiene tus costos y números de pedido. La base de datos, las fotos y `vault.key` nunca se suben (están en `.gitignore`).

1. Crea una cuenta en https://github.com y un repositorio nuevo, por ejemplo `lumiere-tienda`. Marca **Private** y no agregues README ni .gitignore.
2. En la carpeta del proyecto (ya es un repositorio git con todo guardado):
   ```bash
   git remote add origin https://github.com/TU_USUARIO/lumiere-tienda.git
   git push -u origin main
   ```

### 2. Crear el servicio en Render

1. Crea una cuenta en https://render.com, entrando con tu cuenta de GitHub.
2. Ve a **New → Blueprint**, elige el repositorio `lumiere-tienda` y confirma. Render lee `render.yaml` y arma todo: el servidor, el disco y las variables.
3. Te pedirá **ADMIN_PASSWORD**: es la contraseña del panel en internet. Usa una nueva y larga (12 caracteres o más) y guárdala en tu gestor de contraseñas.
4. Agrega una tarjeta para el plan Starter y espera a que diga **Live** (2 a 5 minutos).
5. Tu tienda queda en `https://lumiere-tienda.onrender.com` y el panel en `https://lumiere-tienda.onrender.com/admin`.

### 3. Primeros pasos en la tienda publicada

La tienda en internet empieza **vacía**: tu computadora y el servidor son dos tiendas distintas.

1. Entra al panel con la contraseña del paso 2 y revisa **Mi tienda** (nombre, WhatsApp, logo, colores).
2. Sube tus prendas y crea tus categorías.
3. En **Compras Shein**, registra tus cuentas con sus contraseñas.
4. Para cargar las compras de noviembre: en Render, abre tu servicio → **Environment**, agrega la variable `IMPORTAR_NOVIEMBRE` con el correo de la cuenta de Shein (por ejemplo `micuenta@gmail.com`) y guarda. El servicio se reinicia y las carga solo. Si la cuenta no existe, se crea. Puedes dejar la variable puesta: nunca duplica compras.
5. Si olvidas la contraseña del panel: **Shell** → `npm run reset-password`.

### 4. Tu propio dominio (opcional)

Compra un dominio, por ejemplo `lumiere.pe` en punto.pe o `lumiere.shop` en Namecheap. En Render ve a **Settings → Custom Domains**, agrégalo y copia los registros DNS que te indique en la página donde compraste el dominio. El candado HTTPS es automático.

### 5. Actualizar la tienda después

Cada cambio que guardes y subas con `git push` se publica solo en 2 o 3 minutos. Tus datos no se tocan: viven en el disco, no en el código.

```bash
git add -A
git commit -m "Describe el cambio"
git push
```

### Si usas otro proveedor

Railway, un VPS o similares también sirven. Checklist: `HOST=0.0.0.0`, `PORT` el que indique la plataforma, `ADMIN_PASSWORD`, `COOKIE_SECURE=1` y `TRUST_PROXY=1` detrás de HTTPS. Un disco permanente montado en `DATA_DIR` y `UPLOAD_DIR`. Y copias de seguridad de esas carpetas: la de `data/` debe incluir `vault.key`, porque sin ese archivo las contraseñas de las cuentas Shein no se pueden leer.

## Límites actuales (para tenerlos presentes)

- Las sesiones del panel viven en memoria: si el servidor se reinicia, hay que volver a entrar.
- Un solo servidor y una sola administradora. Para varios usuarios o varias instancias haría falta una tabla de usuarios y sesiones en la base de datos.
- El stock es por prenda, no por talla o color.
- Al eliminar una prenda, sus fotos quedan en `uploads/` (no se borran).
- La tienda carga todas las prendas de una vez: va bien hasta unos cientos; con más conviene paginar.
- El pago se coordina por WhatsApp; no hay pasarela de pago. En el checkout la clienta elige "Yape, Plin o transferencia" o "Tarjeta de crédito o débito"; con tarjeta se le indica que sí puede y que el enlace de pago se le envía por WhatsApp (el pedido llega marcado así al panel).
- Las campañas no se envían solas: el panel abre WhatsApp con el mensaje listo y tú tocas Enviar en cada chat. Para envíos automáticos haría falta la API de WhatsApp Business (de pago, de Meta) o un servicio de correo como Brevo o Mailchimp (puedes exportar los clientes en CSV).

## Siguientes pasos naturales

Pagos (Yape/Plin con comprobante, o una pasarela como Culqi o Mercado Pago), stock por talla y color, costos de envío por distrito, cupones, correo de confirmación, datos para buscadores (SEO) y estadísticas de ventas.
