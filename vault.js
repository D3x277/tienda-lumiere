'use strict';
// Cifrado de las contraseñas de las cuentas de proveedor (Shein, etc.).
// A diferencia de la contraseña del panel (que se guarda con hash y no se puede leer),
// estas hay que poder verlas de nuevo, así que se CIFRAN con AES-256-GCM.
//
// La llave se toma de la variable VAULT_KEY (64 caracteres hex) o, si no existe,
// se crea una vez en data/vault.key. Sin esa llave las contraseñas no se pueden leer:
// inclúyela en tus copias de seguridad junto con tienda.db.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

function loadKey() {
  if (process.env.VAULT_KEY) {
    const key = Buffer.from(process.env.VAULT_KEY, 'hex');
    if (key.length !== 32) throw new Error('VAULT_KEY debe tener 64 caracteres hexadecimales (32 bytes)');
    return key;
  }
  const file = path.join(DATA_DIR, 'vault.key');
  try {
    const key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
    if (key.length === 32) return key;
  } catch { /* todavía no existe */ }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const key = crypto.randomBytes(32);
  fs.writeFileSync(file, key.toString('hex'), { mode: 0o600, flag: 'wx' });
  return key;
}

let KEY;
const key = () => (KEY ||= loadKey());

function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

function decrypt(stored) {
  if (!stored) return '';
  const [v, iv, tag, data] = String(stored).split(':');
  if (v !== 'v1') throw new Error('Formato de cifrado desconocido');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
