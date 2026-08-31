const crypto = require('crypto');

const COOKIE_NAME = 'cc_session';
const SESSION_HOURS = 8;

// Protección contra fuerza bruta en /api/login: bloquea por IP+usuario tras
// varios intentos fallidos dentro de una ventana de tiempo. En memoria por
// instancia; es una capa de defensa adicional, no un reemplazo de un WAF.
const LOGIN_MAX_INTENTOS = 8;
const LOGIN_VENTANA_MS = 15 * 60 * 1000;
const intentosLogin = new Map();

function claveIntentoLogin(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  const usuario = String(req.body?.usuario || '').trim().toLowerCase();
  return `${ip}:${usuario}`;
}

function limitarIntentosLogin(req, res, next) {
  if (intentosLogin.size > 5000) intentosLogin.clear();
  const clave = claveIntentoLogin(req);
  const ahora = Date.now();
  const registro = intentosLogin.get(clave);
  if (registro && ahora - registro.primerIntento < LOGIN_VENTANA_MS && registro.count >= LOGIN_MAX_INTENTOS) {
    const restanteMin = Math.ceil((LOGIN_VENTANA_MS - (ahora - registro.primerIntento)) / 60000);
    return res.status(429).json({ mensaje: `Demasiados intentos fallidos. Intenta de nuevo en ${restanteMin} minuto(s).` });
  }
  next();
}

function registrarIntentoLoginFallido(req) {
  const clave = claveIntentoLogin(req);
  const ahora = Date.now();
  const registro = intentosLogin.get(clave);
  if (registro && ahora - registro.primerIntento < LOGIN_VENTANA_MS) registro.count += 1;
  else intentosLogin.set(clave, { count: 1, primerIntento: ahora });
}

function limpiarIntentosLogin(req) {
  intentosLogin.delete(claveIntentoLogin(req));
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const N = 16384;
  const r = 8;
  const p = 1;
  const key = crypto.scryptSync(String(password), salt, 64, { N, r, p, maxmem: 32 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt}$${key.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const value = String(stored || '');
  if (!value.startsWith('scrypt$')) return false;
  const [, N, r, p, salt, hex] = value.split('$');
  if (!N || !r || !p || !salt || !hex) return false;
  try {
    const expected = Buffer.from(hex, 'hex');
    const actual = crypto.scryptSync(String(password), salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 32 * 1024 * 1024
    });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (_) {
    return false;
  }
}

function esHashSeguro(value) {
  return String(value || '').startsWith('scrypt$');
}

function crearTokenSesion() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function fechaExpiracion() {
  const d = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  return d;
}

function cookieSesion(token, req) {
  const secure = req?.secure || req?.headers?.['x-forwarded-proto'] === 'https';
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 60 * 60}${secure ? '; Secure' : ''}`;
}

function leerCookie(req, nombre) {
  const header = String(req.headers.cookie || '');
  for (const parte of header.split(';')) {
    const [k, ...rest] = parte.trim().split('=');
    if (k === nombre) return decodeURIComponent(rest.join('='));
  }
  return '';
}

async function crearSesion(db, usuarioId, req, res) {
  const token = crearTokenSesion();
  const hash = hashToken(token);
  const expira = fechaExpiracion();
  await db.query('DELETE FROM sesiones_combustible WHERE expira_en < NOW()');
  await db.query('INSERT INTO sesiones_combustible(token_hash,usuario_id,expira_en,ip,agente) VALUES(?,?,?,?,?)', [
    hash,
    usuarioId,
    expira,
    String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').slice(0, 100),
    String(req.headers['user-agent'] || '').slice(0, 255)
  ]);
  res.setHeader('Set-Cookie', cookieSesion(token, req));
  return token;
}

async function destruirSesion(db, req, res) {
  const token = leerCookie(req, COOKIE_NAME);
  if (token) await db.query('DELETE FROM sesiones_combustible WHERE token_hash=?', [hashToken(token)]);
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

async function autenticarSolicitud(db, req, res, next) {
  try {
    const token = leerCookie(req, COOKIE_NAME);
    if (!token) return res.status(401).json({ mensaje: 'Sesión no válida o expirada.' });

    const [rows] = await db.query(`
      SELECT s.usuario_id, u.usuario, u.rol, u.debe_cambiar_contrasena
      FROM sesiones_combustible s
      INNER JOIN usuarios_combustible u ON u.id=s.usuario_id
      WHERE s.token_hash=? AND s.expira_en > NOW()
      LIMIT 1
    `, [hashToken(token)]);

    if (!rows.length) return res.status(401).json({ mensaje: 'Sesión no válida o expirada.' });

    const usuario = rows[0];
    const [permisos] = await db.query('SELECT vista FROM permisos_usuarios_combustible WHERE usuario_id=?', [usuario.usuario_id]);
    usuario.id = usuario.usuario_id;
    usuario.permisos = usuario.rol === 'super_administrador' ? [] : permisos.map(p => p.vista);
    delete usuario.usuario_id;

    if (Boolean(usuario.debe_cambiar_contrasena) && !['/cambiar-contrasena','/sesion','/logout'].includes(req.path)) {
      return res.status(403).json({ mensaje: 'Debes cambiar tu contraseña antes de continuar.', codigo: 'CAMBIO_CONTRASENA_REQUERIDO' });
    }

    await db.query('UPDATE sesiones_combustible SET ultimo_uso=NOW() WHERE token_hash=?', [hashToken(token)]);
    req.user = usuario;
    next();
  } catch (e) {
    next(e);
  }
}

function requirePermission(vista) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ mensaje: 'Sesión no válida.' });
    if (req.user.rol === 'super_administrador') return next();
    if (req.user.permisos.includes(vista)) return next();
    return res.status(403).json({ mensaje: `No tienes permiso para realizar esta acción en ${vista}.` });
  };
}

function requireAnyPermission(vistas) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ mensaje: 'Sesión no válida.' });
    if (req.user.rol === 'super_administrador') return next();
    if (vistas.some(v => req.user.permisos.includes(v))) return next();
    return res.status(403).json({ mensaje: 'No tienes permisos suficientes para esta acción.' });
  };
}

function requireSuperAdmin(req, res, next) {
  if (req.user?.rol === 'super_administrador') return next();
  return res.status(403).json({ mensaje: 'Solo el super administrador puede realizar esta acción.' });
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  esHashSeguro,
  crearSesion,
  destruirSesion,
  autenticarSolicitud,
  requirePermission,
  requireAnyPermission,
  requireSuperAdmin,
  limitarIntentosLogin,
  registrarIntentoLoginFallido,
  limpiarIntentosLogin
};
