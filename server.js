// ============================================================================
// server.js — PUNTO DE ENTRADA DE TODA LA APLICACIÓN
// ----------------------------------------------------------------------------
// Aquí se arma el servidor Express: middlewares de seguridad, archivos
// estáticos, las URLs de las páginas HTML y el montaje de todas las rutas /api.
// Si quieres AGREGAR UNA PÁGINA nueva -> arreglo "paginas" (línea ~110).
// Si quieres AGREGAR UN MÓDULO nuevo de API -> crea su carpeta en src/ y
// registra su router en el bloque app.use('/api', ...) de más abajo.
// La base de datos es PostgreSQL (Supabase): ver src/shared/infrastructure/db.js
// y supabase/schema.sql. Las tablas se crean con:  npm run db:migrar
// ============================================================================

const path = require('path'); // Utilidades para armar rutas de archivos del sistema
const express = require('express'); // Framework web que maneja rutas y peticiones HTTP
require('dotenv').config(); // Carga las variables del archivo .env en process.env

// --- Infraestructura compartida (base de datos, archivos, seguridad) ---
const { crearBaseDeDatos } = require('./src/shared/infrastructure/db'); // PostgreSQL / Supabase
const { crearAlmacenamiento } = require('./src/shared/infrastructure/storage'); // Supabase Storage
const { autenticarSolicitud } = require('./src/shared/infrastructure/security'); // Valida la cookie de sesión

// --- Módulo USUARIOS: repositorio (SQL) + servicio (reglas) + rutas (HTTP) ---
const { PgUserRepository } = require('./src/users/infrastructure/pg-user.repository');
const { UserService } = require('./src/users/application/user.service');
const { crearRutasUsuarios } = require('./src/users/infrastructure/user.routes');

// --- Módulo TRACTORES (maquinaria) ---
const { PgTractorRepository } = require('./src/tractors/infrastructure/pg-tractor.repository');
const { TractorService } = require('./src/tractors/application/tractor.service');
const { crearRutasTractores } = require('./src/tractors/infrastructure/tractor.routes');

// --- Módulo OPERARIOS ---
const { PgOperatorRepository } = require('./src/operators/infrastructure/pg-operator.repository');
const { OperatorService } = require('./src/operators/application/operator.service');
const { crearRutasOperarios } = require('./src/operators/infrastructure/operator.routes');

// --- Módulo JORNADAS (lecturas M1/M2 del día, checklist y cierre) ---
const { PgJornadaRepository } = require('./src/jornadas/infrastructure/pg-jornada.repository');
const { JornadaService } = require('./src/jornadas/application/jornada.service');
const { crearRutasJornadas } = require('./src/jornadas/infrastructure/jornada.routes');

// --- Módulo REGISTROS (suministros de combustible a cada máquina) ---
const { PgRecordRepository } = require('./src/records/infrastructure/pg-record.repository');
const { RecordService } = require('./src/records/application/record.service');
const { crearRutasRegistros } = require('./src/records/infrastructure/record.routes');

// --- Módulo REPORTES (se calculan al momento, no hay tabla) ---
const { ReportService } = require('./src/reports/application/report.service');
const { crearRutasReportes } = require('./src/reports/infrastructure/report.routes');

// --- Módulo ALERTAS (sobrecapacidad, promedio, horómetro, inspección, cierre) ---
const { PgAlertRepository } = require('./src/alerts/infrastructure/pg-alert.repository');
const { AlertService } = require('./src/alerts/application/alert.service');
const { crearRutasAlertas } = require('./src/alerts/infrastructure/alert.routes');

// --- Módulo AUDITORÍA (bitácora de quién hizo qué, solo lectura) ---
const { crearRutasAuditoria } = require('./src/auditoria/infrastructure/auditoria.routes');

// --- Módulo PUSH (notificaciones al celular/tablet) y TAREAS programadas (cron) ---
const { PushService } = require('./src/push/push.service');
const { crearRutasPush } = require('./src/push/push.routes');
const { crearRutasTareas } = require('./src/tareas/tareas.routes');

const app = express(); // Instancia principal de Express
const port = process.env.PUERTO || process.env.PORT || 3000; // Puerto local (3000 si no se define)
const root = path.join(__dirname, 'public'); // Carpeta con todo el frontend (html, css, js)
const db = crearBaseDeDatos(); // Conexión reutilizada por todos los módulos
app.locals.db = db; // Expuesta para scripts y pruebas

app.disable('x-powered-by'); // Oculta la cabecera que delata que el servidor es Express
app.set('trust proxy', 1); // Confía en el proxy de Vercel para leer la IP real y si es HTTPS
app.use(express.json({ limit: '4mb' })); // Interpreta cuerpos JSON (Vercel corta en 4,5 MB; soportes en base64 + firmas)

// Content-Security-Policy: lista blanca de desde dónde el navegador puede cargar
// recursos. Las librerías (SweetAlert2, Chart.js) se sirven desde /vendor, sin CDN.
// Si algún día agregas una librería externa, cópiala a public/vendor/ o añade su
// dominio en "script-src"; de lo contrario el navegador la bloqueará.
const CSP = [
  "default-src 'self'", // Por defecto solo se permite contenido del propio dominio
  "script-src 'self' 'unsafe-inline'", // Solo JS propio (las librerías están en /vendor: sin CDN)
  "style-src 'self' 'unsafe-inline'", // CSS propio y estilos en línea
  "img-src 'self' data: blob:", // Imágenes propias, en base64 (firmas) y blobs
  "font-src 'self' data:", // Fuentes propias o embebidas
  "connect-src 'self'", // fetch/XHR solo hacia este mismo servidor
  "worker-src 'self'", // El service worker (modo app instalable) solo puede ser del propio dominio
  "manifest-src 'self'", // El manifiesto de la app instalable
  "object-src 'none'", // Prohíbe <object>/<embed> (vector clásico de ataques)
  "base-uri 'self'", // Impide que inyecten un <base> para secuestrar rutas
  "form-action 'self'", // Los formularios solo pueden enviarse a este dominio
  "frame-ancestors 'none'" // Nadie puede meter esta app dentro de un iframe
].join('; ');

// Listado de páginas HTML de la aplicación. Agregar una página nueva es
// simplemente añadir su nombre aquí y crear public/html/<nombre>.html.
const paginas = [
  'login', // Pantalla de acceso
  'menu', // Menú principal con los módulos
  'index', // Formulario de registro diario de combustible
  'tablas', // Consulta de registros guardados
  'usuarios', // Administración de usuarios y permisos
  'tractores', // Administración de maquinaria
  'operarios', // Administración de operarios
  'reportes', // Listado de cierres mensuales
  'reporte-detalle', // Detalle/exportación de un reporte mensual
  'alertas', // Bandeja de alertas de consumo
  'auditoria', // Bitácora de acciones
  'cambiar-contrasena' // Cambio obligatorio/voluntario de contraseña
];
const esPagina = (ruta) => ruta === '/' || paginas.includes(ruta.replace(/^\//, ''));

// Middleware de cabeceras de seguridad: se ejecuta en TODAS las peticiones.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); // El navegador respeta el tipo de archivo declarado
  res.setHeader('X-Frame-Options', 'DENY'); // Anti clickjacking (versión antigua de frame-ancestors)
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); // Limita la info del referente
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()'); // Apaga APIs no usadas
  res.setHeader('Content-Security-Policy', CSP); // Aplica la política definida arriba

  // Si la conexión viaja por HTTPS, se exige HTTPS por un año (HSTS).
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Las páginas HTML nunca se cachean en el navegador: así al cerrar sesión el
  // botón "atrás" no muestra una pantalla con datos de la sesión anterior.
  // (El service worker guarda una copia propia para poder abrir sin internet.)
  if (esPagina(req.path) || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next(); // Continúa con el siguiente middleware/ruta
});

// El service worker se revisa siempre en el servidor (para que las
// actualizaciones de la app lleguen a los equipos instalados).
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Service-Worker-Allowed', '/');
  res.type('application/javascript').sendFile(path.join(root, 'sw.js'));
});

// Verificación de la app Android (APK tipo TWA): Android pide este archivo para
// confiar en que el APK pertenece a este dominio. Ver docs/GUIA-APP-MOVIL.md.
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.sendFile(path.join(root, 'assetlinks.json'), (error) => {
    if (error) res.status(404).json([]);
  });
});

// Sirve css, js e imágenes de /public. index:false evita que se entregue
// automáticamente un index.html: las páginas se resuelven abajo a mano.
app.use(express.static(root, { index: false }));

// La raíz del sitio siempre muestra el login.
app.get('/', (req, res) => res.sendFile(path.join(root, 'html', 'login.html')));

paginas.forEach((pagina) => {
  // URL limpia (sin .html): es la que ve el usuario en la barra de direcciones.
  app.get(`/${pagina}`, (req, res) => res.sendFile(path.join(root, 'html', `${pagina}.html`)));
  // La ruta con .html redirige a la limpia, asi los enlaces/marcadores viejos siguen funcionando.
  app.get(`/${pagina}.html`, (req, res) => res.redirect(301, `/${pagina}`));
});

// --- Cableado de dependencias (inyección manual) -----------------------------
// Patrón por capas: Repositorio (habla con la base) -> Servicio (reglas de
// negocio) -> Rutas (HTTP). Aquí se conectan las tres capas de cada módulo.
const storage = crearAlmacenamiento(); // Supabase Storage (en local, carpeta uploads/)
const pushService = new PushService(db); // Notificaciones push (sin claves VAPID = apagado)
app.locals.pushService = pushService; // Expuesto para las pruebas
const userService = new UserService(new PgUserRepository(db));
const tractorRepository = new PgTractorRepository(db);
const tractorService = new TractorService(tractorRepository);
const operatorService = new OperatorService(new PgOperatorRepository(db));
const alertService = new AlertService(new PgAlertRepository(db), storage);
const jornadaRepository = new PgJornadaRepository(db);
const jornadaService = new JornadaService(jornadaRepository, alertService, pushService);
const recordRepository = new PgRecordRepository(db);
// RecordService necesita tractores (capacidad), alertas (para generarlas) y la jornada del día.
const recordService = new RecordService(
  recordRepository,
  tractorRepository,
  alertService,
  jornadaService
);
const reportService = new ReportService(recordRepository, jornadaRepository);

// TAREAS PROGRAMADAS (cron): se montan ANTES de la autenticación porque no las
// llama un usuario sino un programador externo, y se protegen con CRON_SECRET.
app.use('/api', crearRutasTareas(jornadaService));

// Login es la única API pública. Todas las demás APIs pasan por sesión HttpOnly.
app.use('/api', (req, res, next) => {
  if (req.path === '/login' && req.method === 'POST') return next();
  return autenticarSolicitud(db, req, res, next); // Verifica cookie y carga req.user
});

// --- Montaje de los routers de cada módulo bajo el prefijo /api -------------
app.use('/api', crearRutasUsuarios(userService, db)); // /api/usuarios, /api/login, /api/sesion...
app.use('/api', crearRutasTractores(tractorService, db)); // /api/tractores
app.use('/api', crearRutasOperarios(operatorService, db)); // /api/operarios
app.use('/api', crearRutasJornadas(jornadaService, db)); // /api/cierre-dia, /api/jornadas
app.use('/api', crearRutasReportes(reportService)); // /api/reportes
app.use('/api', crearRutasRegistros(recordService, db)); // /api/registros
app.use('/api', crearRutasAlertas(alertService, db, storage)); // /api/alertas y notificaciones
app.use('/api', crearRutasAuditoria(db)); // /api/auditoria
app.use('/api', crearRutasPush(pushService)); // /api/push/...

// Manejador global de errores: cualquier excepción no controlada termina aquí.
// Los errores de PostgreSQL más comunes se traducen a mensajes claros; si el
// error no trae "status" se responde 500 con mensaje genérico para no filtrar
// detalles internos al cliente.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err); // Si ya se empezó a responder, delega a Express
  if (err.code === '23505')
    return res.status(409).json({ mensaje: 'Ya existe un registro con esos datos.' });
  if (['22P02', '22007', '22008', '22003'].includes(err.code))
    return res.status(400).json({ mensaje: 'Alguno de los datos enviados no es válido.' });
  if (!err.status || err.status >= 500) console.error(err); // Traza completa solo de fallos reales (no de avisos 4xx)
  res
    .status(err.status || 500)
    .json({ mensaje: err.status ? err.message : 'Error interno del servidor.' });
});

// En local (node server.js) se levanta un servidor escuchando el puerto. En
// producción (Vercel) y al importarlo desde scripts/pruebas no se llama a
// listen: la app se exporta y quien la use la invoca.
if (require.main === module && process.env.NODE_ENV !== 'production') {
  // Aviso temprano si la base todavía no tiene las tablas (primer arranque).
  db.query('SELECT 1 FROM jornadas_combustible LIMIT 1').catch((error) =>
    console.error(
      `⚠ La base de datos no responde o no tiene las tablas (${error.message}). Ejecuta: npm run db:migrar`
    )
  );
  app.listen(port, () => console.log(`Servidor Express iniciado en http://localhost:${port}`));
}

module.exports = app; // Export requerido por Vercel (ver vercel.json)
