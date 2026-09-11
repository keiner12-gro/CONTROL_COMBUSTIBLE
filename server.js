// ============================================================================
// server.js — PUNTO DE ENTRADA DE TODA LA APLICACIÓN
// ----------------------------------------------------------------------------
// Aquí se arma el servidor Express: middlewares de seguridad, archivos
// estáticos, las URLs de las páginas HTML y el montaje de todas las rutas /api.
// Si quieres AGREGAR UNA PÁGINA nueva -> arreglo "paginas" (línea ~76).
// Si quieres AGREGAR UN MÓDULO nuevo de API -> crea su carpeta en src/ y
// registra su router en el bloque app.use('/api', ...) de más abajo.
// ============================================================================

const path = require('path'); // Utilidades para armar rutas de archivos del sistema
const express = require('express'); // Framework web que maneja rutas y peticiones HTTP
require('dotenv').config(); // Carga las variables del archivo .env en process.env

// --- Infraestructura compartida (base de datos, esquema y seguridad) ---
const { crearConexionMySQL } = require('./src/shared/infrastructure/mysql'); // Pool de conexiones MySQL
const { prepararTablas } = require('./src/shared/infrastructure/schema'); // Crea/actualiza tablas al arrancar
const { autenticarSolicitud } = require('./src/shared/infrastructure/security'); // Valida la cookie de sesión

// --- Módulo USUARIOS: repositorio (SQL) + servicio (reglas) + rutas (HTTP) ---
const { MySQLUserRepository } = require('./src/users/infrastructure/mysql-user.repository');
const { UserService } = require('./src/users/application/user.service');
const { crearRutasUsuarios } = require('./src/users/infrastructure/user.routes');

// --- Módulo TRACTORES (maquinaria) ---
const {
  MySQLTractorRepository
} = require('./src/tractors/infrastructure/mysql-tractor.repository');
const { TractorService } = require('./src/tractors/application/tractor.service');
const { crearRutasTractores } = require('./src/tractors/infrastructure/tractor.routes');

// --- Módulo OPERARIOS ---
const {
  MySQLOperatorRepository
} = require('./src/operators/infrastructure/mysql-operator.repository');
const { OperatorService } = require('./src/operators/application/operator.service');
const { crearRutasOperarios } = require('./src/operators/infrastructure/operator.routes');

// --- Módulo REGISTROS (las cargas diarias de combustible) ---
const { MySQLRecordRepository } = require('./src/records/infrastructure/mysql-record.repository');
const { RecordService } = require('./src/records/application/record.service');
const { crearRutasRegistros } = require('./src/records/infrastructure/record.routes');

// --- Módulo REPORTES (cierres mensuales) ---
const { MySQLReportRepository } = require('./src/reports/infrastructure/mysql-report.repository');
const { ReportService } = require('./src/reports/application/report.service');
const { crearRutasReportes } = require('./src/reports/infrastructure/report.routes');

// --- Módulo ALERTAS (sobrecapacidad / consumo fuera de promedio) ---
const { MySQLAlertRepository } = require('./src/alerts/infrastructure/mysql-alert.repository');
const { AlertService } = require('./src/alerts/application/alert.service');
const { crearRutasAlertas } = require('./src/alerts/infrastructure/alert.routes');

// --- Módulo AUDITORÍA (bitácora de quién hizo qué) ---
const { crearRutasAuditoria } = require('./src/auditoria/infrastructure/auditoria.routes');

const app = express(); // Instancia principal de Express
const port = process.env.PUERTO || process.env.PORT || 3000; // Puerto local (3000 si no se define)
const root = path.join(__dirname, 'public'); // Carpeta con todo el frontend (html, css, js)
const db = crearConexionMySQL(); // Pool de conexiones reutilizado por todos los módulos

app.disable('x-powered-by'); // Oculta la cabecera que delata que el servidor es Express
app.set('trust proxy', 1); // Confía en el proxy de Vercel para leer la IP real y si es HTTPS
app.use(express.json({ limit: '10mb' })); // Interpreta cuerpos JSON (10 MB por las firmas en base64)

// Content-Security-Policy: lista blanca de desde dónde el navegador puede cargar
// recursos. Si algún día agregas una librería por CDN, debes añadir su dominio
// en "script-src" o el navegador la bloqueará.
const CSP = [
  "default-src 'self'", // Por defecto solo se permite contenido del propio dominio
  "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'", // JS propio + CDN jsdelivr (xlsx, jspdf)
  "style-src 'self' 'unsafe-inline'", // CSS propio y estilos en línea
  "img-src 'self' data: blob:", // Imágenes propias, en base64 (firmas) y blobs
  "font-src 'self' data:", // Fuentes propias o embebidas
  "connect-src 'self'", // fetch/XHR solo hacia este mismo servidor
  "object-src 'none'", // Prohíbe <object>/<embed> (vector clásico de ataques)
  "base-uri 'self'", // Impide que inyecten un <base> para secuestrar rutas
  "form-action 'self'", // Los formularios solo pueden enviarse a este dominio
  "frame-ancestors 'none'" // Nadie puede meter esta app dentro de un iframe
].join('; ');

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

  // Las páginas HTML nunca se cachean: así al cerrar sesión el botón "atrás"
  // no muestra una pantalla con datos de la sesión anterior.
  if (req.path === '/' || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Clear-Site-Data', '"cache"');
  }
  next(); // Continúa con el siguiente middleware/ruta
});

// Sirve css, js e imágenes de /public. index:false evita que se entregue
// automáticamente un index.html: las páginas se resuelven abajo a mano.
app.use(express.static(root, { index: false }));
// Los soportes de alertas ya NO se sirven como archivos estáticos públicos:
// se entregan solo mediante GET /api/alertas/:id/soporte (ver alert.routes.js),
// que exige sesión y permiso antes de leer el archivo del disco.

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

// La raíz del sitio siempre muestra el login.
app.get('/', (req, res) => res.sendFile(path.join(root, 'html', 'login.html')));

paginas.forEach((pagina) => {
  // URL limpia (sin .html): es la que ve el usuario en la barra de direcciones.
  app.get(`/${pagina}`, (req, res) => res.sendFile(path.join(root, 'html', `${pagina}.html`)));
  // La ruta con .html redirige a la limpia, asi los enlaces/marcadores viejos siguen funcionando.
  app.get(`/${pagina}.html`, (req, res) => res.redirect(301, `/${pagina}`));
});

// --- Cableado de dependencias (inyección manual) -----------------------------
// Patrón por capas: Repositorio (habla con MySQL) -> Servicio (reglas de
// negocio) -> Rutas (HTTP). Aquí se conectan las tres capas de cada módulo.
const userService = new UserService(new MySQLUserRepository(db));
const tractorRepository = new MySQLTractorRepository(db);
const tractorService = new TractorService(tractorRepository);
const operatorService = new OperatorService(new MySQLOperatorRepository(db));
const recordRepository = new MySQLRecordRepository(db);
const reportService = new ReportService(new MySQLReportRepository(db), recordRepository);
const alertRepository = new MySQLAlertRepository(db);
const alertService = new AlertService(alertRepository);
// RecordService necesita tractores (para la capacidad) y alertas (para generarlas).
const recordService = new RecordService(recordRepository, tractorRepository, alertService);

// Evita que un arranque en frío atienda peticiones a la API antes de que el
// esquema (tablas/columnas nuevas) termine de prepararse.
app.use('/api', (req, res, next) => {
  tablasListas.then(() => next());
});

// Login es la única API pública. Todas las demás APIs pasan por sesión HttpOnly.
app.use('/api', (req, res, next) => {
  if (req.path === '/login' && req.method === 'POST') return next();
  return autenticarSolicitud(db, req, res, next); // Verifica cookie y carga req.user
});

// --- Montaje de los routers de cada módulo bajo el prefijo /api -------------
app.use('/api', crearRutasUsuarios(userService, db)); // /api/usuarios, /api/login, /api/sesion...
app.use('/api', crearRutasTractores(tractorService, db)); // /api/tractores
app.use('/api', crearRutasOperarios(operatorService, db)); // /api/operarios
app.use('/api', crearRutasReportes(reportService)); // /api/reportes
app.use('/api', crearRutasRegistros(recordService, reportService, db)); // /api/registros
app.use('/api', crearRutasAlertas(alertService, db)); // /api/alertas y notificaciones
app.use('/api', crearRutasAuditoria(db)); // /api/auditoria

// Manejador global de errores: cualquier excepción no controlada termina aquí.
// Si el error no trae "status" se responde 500 con mensaje genérico para no
// filtrar detalles internos al cliente.
app.use((err, req, res, next) => {
  console.error(err); // Traza completa solo en los logs del servidor
  if (res.headersSent) return next(err); // Si ya se empezó a responder, delega a Express
  res
    .status(err.status || 500)
    .json({ mensaje: err.status ? err.message : 'Error interno del servidor.' });
});

// Prepara/actualiza el esquema siempre (idempotente): en local y también en
// cada arranque en frío de la función serverless de Vercel, ya que ahí nunca
// se ejecuta este archivo como script y de lo contrario el esquema en
// producción queda desactualizado (columnas nuevas nunca se crean).
const tablasListas = prepararTablas(db).catch((error) =>
  console.error('Error al preparar tablas:', error.message)
);

// En local se levanta un servidor escuchando el puerto. En producción (Vercel)
// no se llama a listen: la app se exporta y la plataforma la invoca.
if (process.env.NODE_ENV !== 'production') {
  tablasListas.then(() =>
    app.listen(port, () => console.log(`Servidor Express iniciado en http://localhost:${port}`))
  );
}

module.exports = app; // Export requerido por Vercel (ver vercel.json)
