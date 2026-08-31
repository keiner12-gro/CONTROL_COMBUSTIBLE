const path = require('path');
const express = require('express');
require('dotenv').config();
const { crearConexionMySQL } = require('./src/shared/infrastructure/mysql');
const { prepararTablas } = require('./src/shared/infrastructure/schema');
const { autenticarSolicitud } = require('./src/shared/infrastructure/security');
const { MySQLUserRepository } = require('./src/users/infrastructure/mysql-user.repository');
const { UserService } = require('./src/users/application/user.service');
const { crearRutasUsuarios } = require('./src/users/infrastructure/user.routes');
const { MySQLTractorRepository } = require('./src/tractors/infrastructure/mysql-tractor.repository');
const { TractorService } = require('./src/tractors/application/tractor.service');
const { crearRutasTractores } = require('./src/tractors/infrastructure/tractor.routes');
const { MySQLOperatorRepository } = require('./src/operators/infrastructure/mysql-operator.repository');
const { OperatorService } = require('./src/operators/application/operator.service');
const { crearRutasOperarios } = require('./src/operators/infrastructure/operator.routes');
const { MySQLRecordRepository } = require('./src/records/infrastructure/mysql-record.repository');
const { RecordService } = require('./src/records/application/record.service');
const { crearRutasRegistros } = require('./src/records/infrastructure/record.routes');
const { MySQLReportRepository } = require('./src/reports/infrastructure/mysql-report.repository');
const { ReportService } = require('./src/reports/application/report.service');
const { crearRutasReportes } = require('./src/reports/infrastructure/report.routes');
const { MySQLAlertRepository } = require('./src/alerts/infrastructure/mysql-alert.repository');
const { AlertService } = require('./src/alerts/application/alert.service');
const { crearRutasAlertas } = require('./src/alerts/infrastructure/alert.routes');

const app = express();
const port = process.env.PUERTO || process.env.PORT || 3000;
const root = path.join(__dirname, 'public');
const db = crearConexionMySQL();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  res.setHeader('Content-Security-Policy', CSP);
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (req.path === '/' || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Clear-Site-Data', '"cache"');
  }
  next();
});

app.use(express.static(root, { index: false }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const paginas = ['login', 'menu', 'index', 'tablas', 'usuarios', 'tractores', 'operarios', 'reportes', 'reporte-detalle', 'alertas', 'cambiar-contrasena'];
app.get('/', (q, s) => s.sendFile(path.join(root, 'html', 'login.html')));
paginas.forEach(p => app.get(`/${p}.html`, (q, s) => s.sendFile(path.join(root, 'html', `${p}.html`))));

const userService = new UserService(new MySQLUserRepository(db));
const tractorRepository = new MySQLTractorRepository(db);
const tractorService = new TractorService(tractorRepository);
const operatorService = new OperatorService(new MySQLOperatorRepository(db));
const recordRepository = new MySQLRecordRepository(db);
const reportService = new ReportService(new MySQLReportRepository(db), recordRepository);
const alertRepository = new MySQLAlertRepository(db);
const alertService = new AlertService(alertRepository);
const recordService = new RecordService(recordRepository, tractorRepository, alertService);

// Login es la única API pública. Todas las demás APIs pasan por sesión HttpOnly.
app.use('/api', (req, res, next) => {
  if (req.path === '/login' && req.method === 'POST') return next();
  return autenticarSolicitud(db, req, res, next);
});

app.use('/api', crearRutasUsuarios(userService, db));
app.use('/api', crearRutasTractores(tractorService, db));
app.use('/api', crearRutasOperarios(operatorService, db));
app.use('/api', crearRutasReportes(reportService));
app.use('/api', crearRutasRegistros(recordService, reportService, db));
app.use('/api', crearRutasAlertas(alertService, db));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ mensaje: err.status ? err.message : 'Error interno del servidor.' });
});

// En desarrollo local inicializa las tablas y el listener
if (process.env.NODE_ENV !== 'production') {
  prepararTablas(db)
    .then(() => app.listen(port, () => console.log(`Servidor Express iniciado en http://localhost:${port}`)))
    .catch(e => console.error('Error al inicializar tablas en local:', e.message));
}

module.exports = app;