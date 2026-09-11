// ============================================================================
// security.js — SEGURIDAD: CONTRASEÑAS, SESIONES Y PERMISOS
// ----------------------------------------------------------------------------
// Todo lo relacionado con "quién eres" y "qué puedes hacer" vive aquí:
//  1. Freno de fuerza bruta en el login.
//  2. Cifrado y verificación de contraseñas (scrypt).
//  3. Creación/destrucción de sesiones con cookie HttpOnly.
//  4. Middlewares de permisos usados por los routers (requirePermission...).
// Para cambiar cuánto dura una sesión -> SESSION_HOURS.
// Para cambiar cuántos intentos de login se permiten -> LOGIN_MAX_INTENTOS.
// ============================================================================

const crypto = require('crypto'); // Módulo nativo de Node para hashes y aleatorios seguros

const COOKIE_NAME = 'cc_session'; // Nombre de la cookie donde viaja el token de sesión
const SESSION_HOURS = 8; // Duración de la sesión en horas (jornada laboral)

// Protección contra fuerza bruta en /api/login: bloquea por IP+usuario tras
// varios intentos fallidos dentro de una ventana de tiempo. En memoria por
// instancia; es una capa de defensa adicional, no un reemplazo de un WAF.
const LOGIN_MAX_INTENTOS = 8; // Intentos fallidos permitidos antes de bloquear
const LOGIN_VENTANA_MS = 15 * 60 * 1000; // Ventana de 15 minutos para contar esos intentos
const intentosLogin = new Map(); // Contador en memoria: "ip:usuario" -> { count, primerIntento }

// Arma la llave del contador combinando IP real y nombre de usuario.
// Así un atacante no bloquea a otros usuarios desde otra IP.
function claveIntentoLogin(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
    .split(',')[0] // Con proxies la cabecera trae varias IPs: se toma la primera (el cliente)
    .trim();
  const usuario = String(req.body?.usuario || '')
    .trim()
    .toLowerCase(); // Normaliza para que "Juan" y "juan" cuenten igual
  return `${ip}:${usuario}`;
}

// Middleware que se pone ANTES del login: corta la petición si ya se superó el límite.
function limitarIntentosLogin(req, res, next) {
  if (intentosLogin.size > 5000) intentosLogin.clear(); // Válvula de escape para no llenar la memoria
  const clave = claveIntentoLogin(req);
  const ahora = Date.now();
  const registro = intentosLogin.get(clave);

  // Bloquea solo si los intentos están dentro de la ventana y superan el máximo.
  if (
    registro &&
    ahora - registro.primerIntento < LOGIN_VENTANA_MS &&
    registro.count >= LOGIN_MAX_INTENTOS
  ) {
    const restanteMin = Math.ceil((LOGIN_VENTANA_MS - (ahora - registro.primerIntento)) / 60000);
    return res.status(429).json({
      // 429 = demasiadas peticiones
      mensaje: `Demasiados intentos fallidos. Intenta de nuevo en ${restanteMin} minuto(s).`
    });
  }
  next();
}

// Suma un intento fallido. Si la ventana ya venció, reinicia el contador.
function registrarIntentoLoginFallido(req) {
  const clave = claveIntentoLogin(req);
  const ahora = Date.now();
  const registro = intentosLogin.get(clave);
  if (registro && ahora - registro.primerIntento < LOGIN_VENTANA_MS) registro.count += 1;
  else intentosLogin.set(clave, { count: 1, primerIntento: ahora });
}

// Borra el contador cuando el usuario acierta la contraseña.
function limpiarIntentosLogin(req) {
  intentosLogin.delete(claveIntentoLogin(req));
}

// Convierte una contraseña en texto plano a un hash seguro con scrypt.
// El resultado guardado en la base tiene la forma:
//   scrypt$N$r$p$salt$hash   (todos los parámetros viajan dentro del texto)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex'); // Sal aleatoria única por usuario
  const N = 16384; // Costo de CPU/memoria (a mayor N, más lento de romper)
  const r = 8; // Tamaño de bloque
  const p = 1; // Paralelismo
  const key = crypto.scryptSync(String(password), salt, 64, { N, r, p, maxmem: 32 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt}$${key.toString('hex')}`;
}

// Compara una contraseña escrita por el usuario contra el hash almacenado.
function verifyPassword(password, stored) {
  const value = String(stored || '');
  if (!value.startsWith('scrypt$')) return false; // Formato desconocido -> no autentica
  const [, N, r, p, salt, hex] = value.split('$'); // Recupera los parámetros usados al crear el hash
  if (!N || !r || !p || !salt || !hex) return false; // Hash incompleto/corrupto
  try {
    const expected = Buffer.from(hex, 'hex');
    // Recalcula el hash con la MISMA sal y parámetros
    const actual = crypto.scryptSync(String(password), salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 32 * 1024 * 1024
    });
    // timingSafeEqual compara en tiempo constante para no filtrar información
    // por la duración de la comparación (ataque de temporización).
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (_) {
    return false; // Cualquier error se trata como contraseña incorrecta
  }
}

// Indica si un valor guardado ya está cifrado (se usa para migrar contraseñas viejas).
function esHashSeguro(value) {
  return String(value || '').startsWith('scrypt$');
}

// Genera el token de sesión que se envía al navegador en la cookie.
function crearTokenSesion() {
  return crypto.randomBytes(32).toString('hex'); // 256 bits de aleatoriedad
}

// En la base NO se guarda el token sino su SHA-256: si alguien lee la tabla
// de sesiones no puede suplantar a nadie.
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// Calcula el momento en que vence la sesión (ahora + SESSION_HOURS).
function fechaExpiracion() {
  const d = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  return d;
}

// Construye la cabecera Set-Cookie de la sesión.
// HttpOnly = JavaScript del navegador no puede leerla (protege contra XSS).
// SameSite=Lax = no se envía en peticiones desde otros sitios (protege CSRF).
// Secure = solo viaja por HTTPS (se añade únicamente si la conexión es segura).
function cookieSesion(token, req) {
  const secure = req?.secure || req?.headers?.['x-forwarded-proto'] === 'https';
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 60 * 60}${secure ? '; Secure' : ''}`;
}

// Lee una cookie concreta de la cabecera "Cookie" de la petición.
function leerCookie(req, nombre) {
  const header = String(req.headers.cookie || '');
  for (const parte of header.split(';')) {
    const [k, ...rest] = parte.trim().split('=');
    if (k === nombre) return decodeURIComponent(rest.join('=')); // rest.join por si el valor trae "="
  }
  return '';
}

// Inicia sesión: genera token, lo guarda hasheado en la tabla de sesiones y
// lo devuelve al navegador en la cookie.
async function crearSesion(db, usuarioId, req, res) {
  const token = crearTokenSesion();
  const hash = hashToken(token);
  const expira = fechaExpiracion();
  await db.query('DELETE FROM sesiones_combustible WHERE expira_en < NOW()'); // Limpieza de sesiones vencidas
  await db.query(
    'INSERT INTO sesiones_combustible(token_hash,usuario_id,expira_en,ip,agente) VALUES(?,?,?,?,?)',
    [
      hash,
      usuarioId,
      expira,
      String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').slice(0, 100), // IP (para trazabilidad)
      String(req.headers['user-agent'] || '').slice(0, 255) // Navegador/dispositivo usado
    ]
  );
  res.setHeader('Set-Cookie', cookieSesion(token, req));
  return token;
}

// Cierra sesión: borra la fila de la tabla y vacía la cookie en el navegador.
async function destruirSesion(db, req, res) {
  const token = leerCookie(req, COOKIE_NAME);
  if (token)
    await db.query('DELETE FROM sesiones_combustible WHERE token_hash=?', [hashToken(token)]);
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// Middleware que protege todas las rutas /api (excepto el login).
// Si la sesión es válida deja en req.user los datos del usuario y sus permisos.
async function autenticarSolicitud(db, req, res, next) {
  try {
    const token = leerCookie(req, COOKIE_NAME);
    if (!token) return res.status(401).json({ mensaje: 'Sesión no válida o expirada.' });

    // Busca la sesión vigente y trae de una vez los datos del usuario dueño.
    const [rows] = await db.query(
      `
      SELECT s.usuario_id, u.usuario, u.rol, u.debe_cambiar_contrasena
      FROM sesiones_combustible s
      INNER JOIN usuarios_combustible u ON u.id=s.usuario_id
      WHERE s.token_hash=? AND s.expira_en > NOW()
      LIMIT 1
    `,
      [hashToken(token)]
    );

    if (!rows.length) return res.status(401).json({ mensaje: 'Sesión no válida o expirada.' });

    const usuario = rows[0];
    // Carga las vistas a las que el usuario tiene acceso.
    const [permisos] = await db.query(
      'SELECT vista FROM permisos_usuarios_combustible WHERE usuario_id=?',
      [usuario.usuario_id]
    );
    usuario.id = usuario.usuario_id;
    // El super administrador no necesita permisos explícitos: puede todo.
    usuario.permisos = usuario.rol === 'super_administrador' ? [] : permisos.map((p) => p.vista);
    delete usuario.usuario_id;

    // Si el usuario tiene contraseña temporal, solo puede usar las rutas de
    // cambio de contraseña, consultar su sesión o cerrar sesión.
    if (
      Boolean(usuario.debe_cambiar_contrasena) &&
      !['/cambiar-contrasena', '/sesion', '/logout'].includes(req.path)
    ) {
      return res.status(403).json({
        mensaje: 'Debes cambiar tu contraseña antes de continuar.',
        codigo: 'CAMBIO_CONTRASENA_REQUERIDO' // El frontend detecta este código y redirige
      });
    }

    // Marca de actividad de la sesión (útil para auditoría).
    await db.query('UPDATE sesiones_combustible SET ultimo_uso=NOW() WHERE token_hash=?', [
      hashToken(token)
    ]);
    req.user = usuario; // A partir de aquí, cualquier ruta puede leer req.user
    next();
  } catch (e) {
    next(e); // Pasa el error al manejador global de server.js
  }
}

// Exige permiso sobre UNA vista concreta (ej. requirePermission('tractores')).
function requirePermission(vista) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ mensaje: 'Sesión no válida.' });
    if (req.user.rol === 'super_administrador') return next(); // El super admin siempre pasa
    if (req.user.permisos.includes(vista)) return next();
    return res
      .status(403)
      .json({ mensaje: `No tienes permiso para realizar esta acción en ${vista}.` });
  };
}

// Exige permiso sobre AL MENOS UNA de varias vistas (ej. ver tractores desde el registro).
function requireAnyPermission(vistas) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ mensaje: 'Sesión no válida.' });
    if (req.user.rol === 'super_administrador') return next();
    if (vistas.some((v) => req.user.permisos.includes(v))) return next();
    return res.status(403).json({ mensaje: 'No tienes permisos suficientes para esta acción.' });
  };
}

// Reserva la acción exclusivamente al super administrador (crear usuarios, anular, etc.).
function requireSuperAdmin(req, res, next) {
  if (req.user?.rol === 'super_administrador') return next();
  return res
    .status(403)
    .json({ mensaje: 'Solo el super administrador puede realizar esta acción.' });
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
