'use strict';
// Acceso del administrador: contraseña con hash (scrypt) + sesión por cookie.

const crypto = require('node:crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Sesiones en memoria: si reinicias el servidor, hay que volver a entrar.
const sessions = new Map();
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_MS);
  return token;
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* cookie inválida */ }
    }
  }
  return out;
}

function isAuthed(req) {
  const token = parseCookies(req).sid;
  const expires = token && sessions.get(token);
  if (!expires) return false;
  if (expires < Date.now()) { sessions.delete(token); return false; }
  return true;
}

function destroySession(req) {
  const token = parseCookies(req).sid;
  if (token) sessions.delete(token);
}

function sessionCookie(token, secure) {
  const parts = [`sid=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${SESSION_MS / 1000}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearCookie() {
  return 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
}

module.exports = { hashPassword, verifyPassword, createSession, isAuthed, destroySession, sessionCookie, clearCookie };
