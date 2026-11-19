'use strict';
// Pone una contraseña nueva al panel cuando olvidaste la anterior: npm run reset-password
// La contraseña se pide por teclado (no en el comando) para que la terminal no altere símbolos como $ o `.

const readline = require('node:readline/promises');
const { getSettings, setSettings } = require('./db');
const auth = require('./auth');

(async () => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (q) => { process.stdout.write(q); const r = await lines.next(); return r.done ? '' : r.value; };
  const first = await ask('Contraseña nueva (mínimo 8 caracteres): ');
  const again = await ask('Repítela: ');
  rl.close();
  if (first.length < 8) { console.log('\nMuy corta. No se cambió nada.'); process.exit(1); }
  if (first !== again) { console.log('\nNo coinciden. No se cambió nada.'); process.exit(1); }
  setSettings({ admin_password_hash: auth.hashPassword(first) });
  const ok = auth.verifyPassword(first, getSettings().admin_password_hash);
  console.log(ok ? '\nListo: contraseña cambiada. Ya puedes entrar al panel.' : '\nAlgo falló al guardarla.');
})();
