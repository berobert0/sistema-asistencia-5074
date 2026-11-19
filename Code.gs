/**
 * SISTEMA DE ASISTENCIA QR - I.E. 5074 ALCIDES SPELUCÍN VEGA
 * Backend para ejecutar como aplicación web de Google Apps Script.
 * Versión preparada para docentes de 1.º a 6.º, secciones A/B/C.
 * IMPORTANTE: hacer copia del Code.gs actual antes de reemplazarlo.
 */
const CFG = {
  SPREADSHEET_ID: '15XB5QsVVCi2j1Gh66yfOFu9vEKGmHsqYLxqpzlsw4_Q', // Google Sheets oficial de la I.E. 5074.
  TZ: 'America/Lima',
  ADMIN_USER: '42764301',
  ADMIN_NAME: 'EGUSQUIZA CONTRERAS ROBERT GREGORY',
  ADMIN_INITIAL_PASSWORD: '42764301',
  SHEETS: {
    ALUMNOS: 'ALUMNOS',
    DOCENTES: 'DOCENTES',
    ASISTENCIA: 'ASISTENCIA',
    USUARIOS: 'USUARIOS',
    CONFIG: 'CONFIGURACIÓN'
  },
  SESSION_HOURS: 8
};

function ss_() {
  return CFG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(CFG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}
function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('No existe la hoja: ' + name);
  return sh;
}
function headers_(sh) {
  if (sh.getLastColumn() < 1) return [];
  return sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0].map(x=>String(x).trim());
}
function col_(headers, name) {
  const i = headers.indexOf(name);
  if (i < 0) throw new Error('Falta la columna ' + name);
  return i;
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function doGet(e) {
  const accion = e && e.parameter ? String(e.parameter.accion || '') : '';
  if (accion === 'registrarQR') return respuestaJsonpEscaner_(e);
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Asistencia QR | I.E. 5074');
}

/** Ejecutar UNA SOLA VEZ desde Apps Script antes de publicar. */
function configurarSistemaInicial() {
  const required = Object.values(CFG.SHEETS);
  const missing = required.filter(n => !ss_().getSheetByName(n));
  if (missing.length) throw new Error('Faltan estas hojas: ' + missing.join(', '));
  const sh = sheet_(CFG.SHEETS.USUARIOS);
  const h = headers_(sh);
  ['CODIGO_USUARIO','USUARIO','ROL','CODIGO_DOCENTE','ESTADO','FECHA_CREACION','ULTIMO_ACCESO']
    .forEach(x => { if (!h.includes(x)) throw new Error('Falta encabezado en USUARIOS: '+x); });

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('AUTH_SALT')) {
    props.setProperty('AUTH_SALT', Utilities.getUuid() + Utilities.getUuid());
  }
  const salt = props.getProperty('AUTH_SALT');
  const key = 'PWD_' + CFG.ADMIN_USER;
  if (!props.getProperty(key)) {
    props.setProperty(key, hashPassword_(CFG.ADMIN_INITIAL_PASSWORD, salt));
  }
  const values = sh.getDataRange().getDisplayValues();
  const exists = values.slice(1).some(r => r[h.indexOf('USUARIO')] === CFG.ADMIN_USER);
  if (!exists) {
    const row = new Array(h.length).fill('');
    row[h.indexOf('CODIGO_USUARIO')] = 'USR-ADMIN-001';
    row[h.indexOf('USUARIO')] = CFG.ADMIN_USER;
    row[h.indexOf('ROL')] = 'ADMIN';
    row[h.indexOf('CODIGO_DOCENTE')] = '';
    row[h.indexOf('ESTADO')] = 'ACTIVO';
    row[h.indexOf('FECHA_CREACION')] = new Date();
    sh.appendRow(row);
  }
  return 'Configuración inicial correcta. Usuario administrador creado.';
}
function hashPassword_(password, salt) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    salt + '|' + password,
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}
function login(usuario, password) {
  usuario = String(usuario || '').trim();
  password = String(password || '');
  if (!usuario || !password) return {ok:false, message:'Ingresa usuario y contraseña.'};
  const sh = sheet_(CFG.SHEETS.USUARIOS), h = headers_(sh);
  const data = sh.getDataRange().getDisplayValues();
  const ui = col_(h, 'USUARIO'), ei = col_(h, 'ESTADO'), ri = col_(h, 'ROL');
  const rowIndex = data.findIndex((r,i)=>i>0 && String(r[ui]).trim().toLowerCase()===usuario.toLowerCase());
  if (rowIndex < 1 || String(data[rowIndex][ei]).trim().toUpperCase() !== 'ACTIVO') {
    Utilities.sleep(350); return {ok:false, message:'Usuario o contraseña incorrectos.'};
  }
  const rol = String(data[rowIndex][ri] || '').trim().toUpperCase();
  if (!['ADMIN','DOCENTE'].includes(rol)) return {ok:false, message:'La cuenta no tiene un rol autorizado.'};
  const hashCol = h.indexOf('HASH_CLAVE'), saltCol = h.indexOf('SALT_CLAVE');
  let valid = false;
  if (hashCol >= 0 && saltCol >= 0 && data[rowIndex][hashCol] && data[rowIndex][saltCol]) {
    valid = hashPasswordV2_(password, data[rowIndex][saltCol]) === data[rowIndex][hashCol];
  } else {
    const props = PropertiesService.getScriptProperties();
    const legacySalt = props.getProperty('AUTH_SALT'), expected = props.getProperty('PWD_' + usuario);
    valid = !!(legacySalt && expected && hashPassword_(password, legacySalt) === expected);
    if (valid) {
      const cols = asegurarColumnasSeguridadUsuarios_();
      const salt = Utilities.getUuid() + Utilities.getUuid();
      sh.getRange(rowIndex + 1, cols.hash + 1).setValue(hashPasswordV2_(password, salt));
      sh.getRange(rowIndex + 1, cols.salt + 1).setValue(salt);
      props.deleteProperty('PWD_' + usuario); // Retira la credencial heredada tras migrarla.
    }
  }
  if (!valid) { Utilities.sleep(500); return {ok:false, message:'Usuario o contraseña incorrectos.'}; }
  const docenteCode = h.indexOf('CODIGO_DOCENTE') >= 0 ? String(data[rowIndex][h.indexOf('CODIGO_DOCENTE')] || '').trim() : '';
  let nombre = usuario === CFG.ADMIN_USER ? CFG.ADMIN_NAME : usuario;
  const user = {usuario:String(data[rowIndex][ui]).trim(), rol, nombre, codigoDocente:docenteCode, seccionAsignada:''};
  if (rol === 'DOCENTE') {
    if (!docenteCode) return {ok:false, message:'La cuenta docente no tiene un código vinculado. Contacta al administrador.'};
    try { const asignacion = docenteAsignado_(user); user.seccionAsignada = asignacion.grado + asignacion.seccion; user.nombre = asignacion.nombre || user.nombre; }
    catch (error) { return {ok:false, message:'La cuenta docente no tiene una asignación válida o está inactiva.'}; }
  }
  const token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('SESSION_'+token, JSON.stringify(user), CFG.SESSION_HOURS*3600);
  const lastCol = h.indexOf('ULTIMO_ACCESO');
  if (lastCol >= 0) sh.getRange(rowIndex+1,lastCol+1).setValue(new Date());
  registrarAuditoria5074_(user.usuario, 'INICIO_SESION', 'Rol: '+rol);
  return {ok:true, token, user};
}
function logout(token) {
  if (token) CacheService.getScriptCache().remove('SESSION_'+token);
  return {ok:true};
}
function auth_(token) {
  token = String(token || '').trim();
  if (!token || token.length < 40) throw new Error('Sesión no válida. Inicia sesión nuevamente.');
  const cache = CacheService.getScriptCache(), key = 'SESSION_' + token, raw = cache.get(key);
  if (!raw) throw new Error('Sesión vencida. Vuelve a iniciar sesión.');
  let user;
  try { user = JSON.parse(raw); } catch (e) { cache.remove(key); throw new Error('Sesión inválida. Inicia sesión nuevamente.'); }
  const sh = sheet_(CFG.SHEETS.USUARIOS), h = headers_(sh), data = sh.getDataRange().getDisplayValues();
  const ui = col_(h,'USUARIO'), ri = col_(h,'ROL'), ei = col_(h,'ESTADO'), di = h.indexOf('CODIGO_DOCENTE');
  const row = data.slice(1).find(r => String(r[ui]).trim().toLowerCase() === String(user.usuario||'').trim().toLowerCase());
  if (!row || String(row[ei]).trim().toUpperCase() !== 'ACTIVO') { cache.remove(key); throw new Error('La cuenta está inactiva o no existe. Contacta al administrador.'); }
  const rolActual = String(row[ri]||'').trim().toUpperCase(), docenteActual = di >= 0 ? String(row[di]||'').trim() : '';
  if (!['ADMIN','DOCENTE'].includes(rolActual)) { cache.remove(key); throw new Error('Rol de usuario no autorizado.'); }
  if (rolActual !== String(user.rol||'').toUpperCase() || docenteActual !== String(user.codigoDocente||'').trim()) { cache.remove(key); throw new Error('Los permisos de tu cuenta cambiaron. Inicia sesión nuevamente.'); }
  if (rolActual === 'DOCENTE') { try { docenteAsignado_(user); } catch (e) { cache.remove(key); throw new Error('Tu asignación docente está inactiva o no es válida. Contacta al administrador.'); } }
  return user;
}
function normalizarGradoSeccion_(valor) {
  return String(valor || '')
    .toUpperCase()
    .replace(/\s/g, '')
    .replace(/[.º°]/g, '')
    .replace(/PRIMERO/g, '1')
    .replace(/SEGUNDO/g, '2')
    .replace(/TERCERO/g, '3')
    .replace(/CUARTO/g, '4')
    .replace(/QUINTO/g, '5')
    .replace(/SEXTO/g, '6')
    .replace(/1RO|1ER/g, '1')
    .replace(/2DO/g, '2')
    .replace(/3RO/g, '3')
    .replace(/4TO/g, '4')
    .replace(/5TO/g, '5')
    .replace(/6TO/g, '6');
}

function docenteAsignado_(user) {
  const docenteSh = sheet_(CFG.SHEETS.DOCENTES);
  const dh = headers_(docenteSh);
  const dd = docenteSh.getDataRange().getDisplayValues();
  const codeCol = col_(dh, 'CODIGO_DOCENTE');
  const secCol = col_(dh, 'GRADOS_Y_SECCIONES');
  const nameCol = col_(dh, 'APELLIDOS_Y_NOMBRES');
  const statusCol = dh.indexOf('ESTADO');

  const found = dd.slice(1).find(r =>
    String(r[codeCol]).trim() === String(user.codigoDocente || '').trim()
  );
  if (!found) throw new Error('No se encontró el docente vinculado a esta cuenta.');

  if (statusCol >= 0 && String(found[statusCol]).toUpperCase() !== 'ACTIVO') {
    throw new Error('El docente está inactivo.');
  }

  const asignacion = normalizarGradoSeccion_(found[secCol]);
  const match = asignacion.match(/^([1-6])([A-C])$/);
  if (!match) {
    throw new Error('La asignación del docente debe tener formato de grado y sección, por ejemplo 3C.');
  }

  return {
    codigo: String(found[codeCol]).trim(),
    nombre: String(found[nameCol] || '').trim(),
    grado: match[1],
    seccion: match[2]
  };
}

function alumnosVisibles_(user) {
  const rol = String(user.rol || '').trim().toUpperCase();

  if (!['ADMIN', 'DOCENTE'].includes(rol)) {
    throw new Error('No tienes autorización para consultar estudiantes.');
  }

  const sh = sheet_(CFG.SHEETS.ALUMNOS);
  const h = headers_(sh);
  const data = sh.getDataRange().getDisplayValues();

  const gi = col_(h, 'GRADO');
  const si = col_(h, 'SECCION');
  const ei = h.indexOf('ESTADO');

  let rows = data.slice(1);

  if (rol === 'DOCENTE') {
    const asignado = docenteAsignado_(user);
    rows = rows.filter(r =>
      normalizarGradoSeccion_(r[gi]) === asignado.grado &&
      normalizarGradoSeccion_(r[si]) === asignado.seccion
    );
  }

  if (ei >= 0) {
    rows = rows.filter(r =>
      !r[ei] || String(r[ei]).trim().toUpperCase() === 'ACTIVO'
    );
  }

  return {headers: h, rows};
}

function obtenerResumen(token) {
  const user = auth_(token);
  const sh = sheet_(CFG.SHEETS.ASISTENCIA), h = headers_(sh);
  const rows = sh.getLastRow()>1 ? sh.getRange(2,1,sh.getLastRow()-1,h.length).getValues() : [];
  const idx = n => h.indexOf(n);
  const today = Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd');
  const f = idx('FECHA'), e = idx('ESTADO');
  const todays = rows.filter(r => {
    const d = r[f] instanceof Date ? Utilities.formatDate(r[f],CFG.TZ,'yyyy-MM-dd') : String(r[f]).slice(0,10);
    return d === today;
  });
  const count = s => todays.filter(r=>String(r[e]).toUpperCase()===s).length;
  const visible = alumnosVisibles_(user);
  const allowed = new Set(visible.rows.map(r => r[col_(visible.headers, 'CODIGO_ALUMNO')]));
  const scopedToday = user.rol === 'ADMIN' ? todays : todays.filter(r => allowed.has(String(r[col_(h,'CODIGO_ALUMNO')])));
  const countScoped = s => scopedToday.filter(r => String(r[e]).toUpperCase() === s).length;
  const students = visible.rows.length;
  return {ok:true,user,fecha:today,totalEstudiantes:Math.max(0,students),
    registros: scopedToday.length, presentes:countScoped('PRESENTE'), tardanzas:countScoped('TARDANZA'), faltas:countScoped('FALTA')};
}
function buscarAlumno(token, codigo) {
  const user = auth_(token), visible = alumnosVisibles_(user), h = visible.headers;
  const cCode = col_(h,'CODIGO_ALUMNO'), cQr = h.indexOf('CODIGO_QR');
  const scanned = String(codigo || '').trim();
  const found = visible.rows.find(r => String(r[cCode] || '').trim().toUpperCase() === scanned.toUpperCase() || (cQr >= 0 && String(r[cQr] || '').trim().toUpperCase() === scanned.toUpperCase()));
  if (!found) return {ok:false,message:user.rol === 'DOCENTE' ? 'El estudiante no pertenece a tu sección asignada.' : 'No se encontró el código del estudiante.'};
  const obj = {};
  ['CODIGO_ALUMNO','APELLIDOS_Y_NOMBRES','GRADO','SECCION','FOTO_URL','CODIGO_QR','ESTADO']
    .forEach(k => { const i = h.indexOf(k); if (i >= 0) obj[k] = found[i]; });
  return {ok:true,alumno:obj};
}

/** Emite ticket temporal para el escáner después de autenticar al usuario. */
function crearTicketEscaner(token) {
  const user = auth_(token);
  if (!user || !['ADMIN','DOCENTE'].includes(String(user.rol || '').toUpperCase())) {
    return {ok:false, message:'Tu perfil no tiene permiso para utilizar el escáner.'};
  }
  const ticket = Utilities.getUuid().replace(/-/g,'') + Utilities.getUuid().replace(/-/g,'');
  CacheService.getScriptCache().put('QR_TICKET_' + ticket, String(token), 1200);
  return {ok:true, ticket:ticket, expiresIn:1200, endpoint:ScriptApp.getService().getUrl()};
}

/** Recibe el código desde GitHub Pages y delega la escritura al método autenticado. */
function respuestaJsonpEscaner_(e) {
  const p = e && e.parameter ? e.parameter : {};
  const callback = String(p.callback || '');
  const ticket = String(p.ticket || '');
  const codigo = String(p.codigo || '').trim();

  if (!/^[A-Za-z_$][0-9A-Za-z_$\\.]{0,80}$/.test(callback)) {
    return ContentService.createTextOutput('/* callback inválido */')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  let result;
  try {
    if (!ticket || !codigo || codigo.length > 200) throw new Error('Solicitud incompleta.');
    const token = CacheService.getScriptCache().get('QR_TICKET_' + ticket);
    if (!token) throw new Error('La autorización del escáner venció. Regresa al sistema y vuelve a abrirlo.');
    const user = auth_(token);
    if (!user || !['ADMIN','DOCENTE'].includes(String(user.rol || '').toUpperCase())) {
      throw new Error('No tienes permiso para registrar asistencia.');
    }
    result = registrarAsistencia(token, codigo);
  } catch (err) {
    result = {ok:false, message:err && err.message ? err.message : 'No se pudo validar el registro.'};
  }
  const json = JSON.stringify(result).replace(/</g,'\\\\u003c').replace(/>/g,'\\\\u003e').replace(/&/g,'\\\\u0026');
  return ContentService.createTextOutput(callback + '(' + json + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function registrarAsistencia(token, codigo) {
  const user = auth_(token);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const found = buscarAlumno(token,codigo);
    if (!found.ok) return found;
    const a = found.alumno;
    if (String(a.ESTADO||'ACTIVO').toUpperCase()!=='ACTIVO')
      return {ok:false,message:'El estudiante no está activo.'};
    const sh = sheet_(CFG.SHEETS.ASISTENCIA), h = headers_(sh);
    const today = Utilities.formatDate(new Date(),CFG.TZ,'yyyy-MM-dd');
    const code = a.CODIGO_ALUMNO;
    const vals = sh.getLastRow()>1 ? sh.getRange(2,1,sh.getLastRow()-1,h.length).getValues() : [];
    const ci = h.indexOf('CODIGO_ALUMNO'), fi=h.indexOf('FECHA');
    const duplicate = vals.some(r=>{
      const d = r[fi] instanceof Date ? Utilities.formatDate(r[fi],CFG.TZ,'yyyy-MM-dd') : String(r[fi]).slice(0,10);
      return String(r[ci])===code && d===today;
    });
    if (duplicate) return {ok:false,duplicate:true,alumno:a,message:'Este estudiante ya tiene registro hoy.'};
    const now = new Date(), row = new Array(h.length).fill('');
    const put=(name,value)=>{const i=h.indexOf(name);if(i>=0)row[i]=value;};
    put('ID_REGISTRO',Utilities.getUuid());
    put('CODIGO_ALUMNO',code);
    put('APELLIDOS_Y_NOMBRES',a.APELLIDOS_Y_NOMBRES);
    put('GRADO',a.GRADO); put('SECCION',a.SECCION);
    put('FECHA',today);
    put('HORA',Utilities.formatDate(now,CFG.TZ,'HH:mm:ss'));
    put('ESTADO','PRESENTE');
    put('TIPO_REGISTRO','QR');
    put('OBSERVACIÓN','Registrado por '+user.usuario);
    sh.appendRow(row);
    return {ok:true,alumno:a,estado:'PRESENTE',hora:Utilities.formatDate(now,CFG.TZ,'HH:mm:ss'),message:'Asistencia registrada correctamente.'};
  } finally { lock.releaseLock(); }
}
function listarAsistencias(token) {
  const user = auth_(token), sh = sheet_(CFG.SHEETS.ASISTENCIA), h = headers_(sh);
  const data = sh.getDataRange().getDisplayValues();
  let rows = data.slice(1).reverse();
  if (user.rol === 'DOCENTE') {
    const visible = alumnosVisibles_(user), allowed = new Set(visible.rows.map(r => r[col_(visible.headers,'CODIGO_ALUMNO')]));
    const ci = col_(h,'CODIGO_ALUMNO');
    rows = rows.filter(r => allowed.has(String(r[ci])));
  }
  return {ok:true,headers:h,rows:rows.slice(0,300)};
}

/**
 * Función antigua deshabilitada por seguridad.
 * No crea cuentas ni contraseñas predeterminadas.
 */
function crearAccesoDocente3C_LEGACY() {
  throw new Error('Función deshabilitada. Crea las cuentas docentes desde un procedimiento administrativo seguro.');
}

/** Devuelve únicamente los alumnos autorizados para el usuario autenticado. */
function listarAlumnos(token) {
  const user = auth_(token);
  const visible = alumnosVisibles_(user);
  const h = visible.headers;
  const wanted = ['CODIGO_ALUMNO','APELLIDOS_Y_NOMBRES','GRADO','SECCION','ESTADO'];
  const indexes = wanted.map(k => h.indexOf(k));
  const rows = visible.rows.map(r => indexes.map(i => i >= 0 ? r[i] : ''));
  return {ok:true, headers:wanted, rows};
}


/* =========================================================
   SEGURIDAD Y GESTIÓN DE DOCENTES — MODELO CECOOSDES
   HMAC-SHA256 + salt individual + pepper privado del servidor.
   Validación ADMIN en servidor y registro de auditoría.
   ========================================================= */
function asegurarColumnas_(sh, names) {
  let h = headers_(sh);
  names.forEach(name => { if (!h.includes(name)) { sh.getRange(1, sh.getLastColumn()+1).setValue(name); h = headers_(sh); } });
  return h;
}
function asegurarColumnasSeguridadUsuarios_() {
  const sh = sheet_(CFG.SHEETS.USUARIOS), h = asegurarColumnas_(sh,['HASH_CLAVE','SALT_CLAVE']);
  return {hash:h.indexOf('HASH_CLAVE'),salt:h.indexOf('SALT_CLAVE')};
}
function obtenerPepper_() {
  const props = PropertiesService.getScriptProperties();
  let pepper = props.getProperty('PASSWORD_PEPPER');
  if (!pepper) { pepper = Utilities.getUuid()+Utilities.getUuid()+Utilities.getUuid(); props.setProperty('PASSWORD_PEPPER',pepper); }
  return pepper;
}
function hashPasswordV2_(password,salt) {
  const signature = Utilities.computeHmacSha256Signature(String(password),obtenerPepper_()+'|'+String(salt),Utilities.Charset.UTF_8);
  return Utilities.base64Encode(signature);
}
function exigirAdmin5074_(user) {
  if (!user || String(user.rol||'').toUpperCase()!=='ADMIN') throw new Error('No tienes permiso para realizar esta operación.');
}
function registrarAuditoria5074_(usuario,accion,detalle) {
  try {
    const ss=ss_(); let sh=ss.getSheetByName('AUDITORIA');
    if(!sh){sh=ss.insertSheet('AUDITORIA');sh.appendRow(['FECHA_HORA','USUARIO','ACCION','DETALLE']);}
    sh.appendRow([new Date(),String(usuario||''),String(accion||''),String(detalle||'')]);
  } catch(e) { console.error('No se pudo registrar auditoría: '+e.message); }
}
function crearDocenteAdmin(token, datos) {
  const admin = auth_(token);
  exigirAdmin5074_(admin);
  datos = datos || {};

  const nombre = String(datos.nombre || '').trim().replace(/\s+/g, ' ');
  const dni = String(datos.dni || '').trim();
  const celular = String(datos.celular || '').trim();
  const correo = String(datos.correo || '').trim().toLowerCase();
  const gradoSeccion = normalizarGradoSeccion_(datos.gradoSeccion);
  const usuario = String(datos.usuario || '').trim();
  const clave = String(datos.clave || '');

  if (!nombre || nombre.split(' ').length < 2) return {ok:false, message:'Ingresa nombres y apellidos completos.'};
  if (!/^[1-6][A-C]$/.test(gradoSeccion)) return {ok:false, message:'Selecciona un grado y sección válidos (1A a 6C).'};
  if (!/^[a-zA-Z0-9._-]{4,30}$/.test(usuario)) return {ok:false, message:'El usuario debe tener entre 4 y 30 caracteres: letras, números, punto, guion o guion bajo.'};
  if (clave.length < 12) return {ok:false, message:'La contraseña inicial debe tener al menos 12 caracteres.'};
  if (dni && !/^\d{8,12}$/.test(dni)) return {ok:false, message:'El DNI debe contener entre 8 y 12 dígitos.'};
  if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return {ok:false, message:'El correo electrónico no es válido.'};

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let docenteRowNumber = 0;
  let userRowNumber = 0;
  let codigo = '';
  try {
    const userSh = sheet_(CFG.SHEETS.USUARIOS);
    const uh = asegurarColumnas_(userSh, [
      'CODIGO_USUARIO','USUARIO','ROL','CODIGO_DOCENTE','ESTADO',
      'FECHA_CREACION','ULTIMO_ACCESO','HASH_CLAVE','SALT_CLAVE'
    ]);
    const userRows = userSh.getDataRange().getDisplayValues();
    const userCol = uh.indexOf('USUARIO');
    if (userRows.slice(1).some(r => String(r[userCol] || '').trim().toLowerCase() === usuario.toLowerCase())) {
      return {ok:false, message:'Ese nombre de usuario ya existe.'};
    }

    const docSh = sheet_(CFG.SHEETS.DOCENTES);
    const dh = asegurarColumnas_(docSh, [
      'CODIGO_DOCENTE','APELLIDOS_Y_NOMBRES','GRADOS_Y_SECCIONES',
      'ESTADO','DNI','CELULAR','CORREO'
    ]);
    const docRows = docSh.getDataRange().getDisplayValues();
    const codeCol = dh.indexOf('CODIGO_DOCENTE');
    const dniCol = dh.indexOf('DNI');
    if (dni && docRows.slice(1).some(r => String(r[dniCol] || '').trim() === dni)) {
      return {ok:false, message:'Ya existe un docente registrado con ese DNI.'};
    }

    let max = 0;
    docRows.slice(1).forEach(r => {
      const m = String(r[codeCol] || '').match(/^DOC-(\d+)$/i);
      if (m) max = Math.max(max, Number(m[1]));
    });
    codigo = 'DOC-' + String(max + 1).padStart(3, '0');
    while (docRows.slice(1).some(r => String(r[codeCol] || '').trim().toUpperCase() === codigo)) {
      max++;
      codigo = 'DOC-' + String(max + 1).padStart(3, '0');
    }

    const salt = Utilities.getUuid() + Utilities.getUuid();
    const hash = hashPasswordV2_(clave, salt);
    const docenteRow = new Array(dh.length).fill('');
    const setDoc = (k,v) => { const i = dh.indexOf(k); if (i >= 0) docenteRow[i] = v; };
    setDoc('CODIGO_DOCENTE', codigo);
    setDoc('APELLIDOS_Y_NOMBRES', nombre);
    setDoc('GRADOS_Y_SECCIONES', gradoSeccion);
    setDoc('ESTADO', 'ACTIVO');
    setDoc('DNI', dni);
    setDoc('CELULAR', celular);
    setDoc('CORREO', correo);

    const accountRow = new Array(uh.length).fill('');
    const setUser = (k,v) => { const i = uh.indexOf(k); if (i >= 0) accountRow[i] = v; };
    setUser('CODIGO_USUARIO', Utilities.getUuid());
    setUser('USUARIO', usuario);
    setUser('ROL', 'DOCENTE');
    setUser('CODIGO_DOCENTE', codigo);
    setUser('ESTADO', 'ACTIVO');
    setUser('FECHA_CREACION', new Date());
    setUser('ULTIMO_ACCESO', '');
    setUser('HASH_CLAVE', hash);
    setUser('SALT_CLAVE', salt);

    // Guardado coordinado: si falla la cuenta, se revierte la ficha del docente.
    docSh.appendRow(docenteRow);
    docenteRowNumber = docSh.getLastRow();
    try {
      userSh.appendRow(accountRow);
      userRowNumber = userSh.getLastRow();
      SpreadsheetApp.flush();
    } catch (writeError) {
      if (docenteRowNumber > 1) docSh.deleteRow(docenteRowNumber);
      docenteRowNumber = 0;
      throw writeError;
    }

    registrarAuditoria5074_(admin.usuario, 'CREAR_DOCENTE',
      'Código: ' + codigo + ' | Usuario: ' + usuario + ' | Asignación: ' + gradoSeccion);
    return {ok:true, message:'Docente y cuenta creados correctamente.', codigoDocente:codigo,
      usuario:usuario, gradoSeccion:gradoSeccion};
  } catch (error) {
    // Evita dejar una cuenta huérfana si falla una operación posterior al alta.
    if (userRowNumber > 1) {
      try { sheet_(CFG.SHEETS.USUARIOS).deleteRow(userRowNumber); } catch (rollbackError) { console.error(rollbackError); }
    }
    if (docenteRowNumber > 1) {
      try { sheet_(CFG.SHEETS.DOCENTES).deleteRow(docenteRowNumber); } catch (rollbackError) { console.error(rollbackError); }
    }
    console.error('crearDocenteAdmin: ' + (error && error.stack ? error.stack : error));
    throw new Error('No se pudo completar el registro del docente. ' + (error && error.message ? error.message : error));
  } finally {
    lock.releaseLock();
  }
}

/** Diagnóstico para confirmar que la versión publicada contiene el módulo de docentes. */
function diagnosticoDocentesAdmin(token) {
  const admin = auth_(token);
  exigirAdmin5074_(admin);
  const docentes = sheet_(CFG.SHEETS.DOCENTES);
  const usuarios = sheet_(CFG.SHEETS.USUARIOS);
  return {
    ok:true,
    modulo:'DOCENTES_ADMIN_V2',
    hojas:{
      docentes:docentes.getName(),
      usuarios:usuarios.getName(),
      columnasDocentes:headers_(docentes),
      columnasUsuarios:headers_(usuarios)
    },
    mensaje:'Módulo de docentes disponible en esta versión.'
  };
}
function listarDocentesAdmin(token) {
  const admin=auth_(token);exigirAdmin5074_(admin);
  const sh=sheet_(CFG.SHEETS.DOCENTES),h=headers_(sh),rows=sh.getDataRange().getDisplayValues().slice(1);
  const us=sheet_(CFG.SHEETS.USUARIOS),uh=headers_(us),users=us.getDataRange().getDisplayValues().slice(1);
  const ix=k=>h.indexOf(k),ux=k=>uh.indexOf(k),accounts={};
  users.forEach(r=>{const c=ux('CODIGO_DOCENTE')>=0?String(r[ux('CODIGO_DOCENTE')]).trim():'';if(c)accounts[c]={usuario:ux('USUARIO')>=0?r[ux('USUARIO')]:'',estadoCuenta:ux('ESTADO')>=0?r[ux('ESTADO')]:''};});
  const docentes=rows.filter(r=>r.some(v=>String(v).trim())).map(r=>{const codigo=ix('CODIGO_DOCENTE')>=0?String(r[ix('CODIGO_DOCENTE')]).trim():'';return {codigo,nombre:ix('APELLIDOS_Y_NOMBRES')>=0?r[ix('APELLIDOS_Y_NOMBRES')]:'',asignacion:ix('GRADOS_Y_SECCIONES')>=0?r[ix('GRADOS_Y_SECCIONES')]:'',estado:ix('ESTADO')>=0?r[ix('ESTADO')]:'ACTIVO',dni:ix('DNI')>=0?r[ix('DNI')]:'',celular:ix('CELULAR')>=0?r[ix('CELULAR')]:'',correo:ix('CORREO')>=0?r[ix('CORREO')]:'',usuario:accounts[codigo]?accounts[codigo].usuario:'',estadoCuenta:accounts[codigo]?accounts[codigo].estadoCuenta:'SIN CUENTA'};});
  return {ok:true,docentes};
}
function cambiarEstadoDocenteAdmin(token,codigo,estado) {
  const admin=auth_(token);exigirAdmin5074_(admin);codigo=String(codigo||'').trim();estado=String(estado||'').trim().toUpperCase();
  if(!codigo||!['ACTIVO','INACTIVO'].includes(estado))return {ok:false,message:'Datos de estado no válidos.'};
  const lock=LockService.getScriptLock();lock.waitLock(15000);
  try {
    const ds=sheet_(CFG.SHEETS.DOCENTES),dh=headers_(ds),ci=col_(dh,'CODIGO_DOCENTE'),ei=dh.indexOf('ESTADO'),rows=ds.getDataRange().getDisplayValues();
    const pos=rows.findIndex((r,i)=>i>0&&String(r[ci]).trim()===codigo);if(pos<1)return {ok:false,message:'No se encontró el docente.'};
    if(ei>=0)ds.getRange(pos+1,ei+1).setValue(estado);
    const us=sheet_(CFG.SHEETS.USUARIOS),uh=headers_(us),uci=uh.indexOf('CODIGO_DOCENTE'),uei=uh.indexOf('ESTADO');
    if(uci>=0&&uei>=0){const ur=us.getDataRange().getDisplayValues();ur.forEach((r,i)=>{if(i>0&&String(r[uci]).trim()===codigo)us.getRange(i+1,uei+1).setValue(estado);});}
    registrarAuditoria5074_(admin.usuario,'CAMBIAR_ESTADO_DOCENTE','Código: '+codigo+' | Estado: '+estado);
    return {ok:true,message:'Estado del docente actualizado: '+estado+'.'};
  } finally {lock.releaseLock();}
}
function restablecerClaveDocenteAdmin(token,codigo,nuevaClave) {
  const admin=auth_(token);exigirAdmin5074_(admin);codigo=String(codigo||'').trim();nuevaClave=String(nuevaClave||'');
  if(nuevaClave.length<12)return {ok:false,message:'La nueva contraseña debe tener al menos 12 caracteres.'};
  const sh=sheet_(CFG.SHEETS.USUARIOS),cols=asegurarColumnasSeguridadUsuarios_(),h=headers_(sh),data=sh.getDataRange().getDisplayValues(),ci=h.indexOf('CODIGO_DOCENTE');
  const pos=data.findIndex((r,i)=>i>0&&ci>=0&&String(r[ci]).trim()===codigo);if(pos<1)return {ok:false,message:'No se encontró una cuenta vinculada a este docente.'};
  const salt=Utilities.getUuid()+Utilities.getUuid();sh.getRange(pos+1,cols.hash+1).setValue(hashPasswordV2_(nuevaClave,salt));sh.getRange(pos+1,cols.salt+1).setValue(salt);
  registrarAuditoria5074_(admin.usuario,'RESTABLECER_CLAVE_DOCENTE','Código: '+codigo);return {ok:true,message:'Contraseña restablecida correctamente.'};
}

function cambiarMiClave(token, claveActual, claveNueva) {
  const user=auth_(token);
  claveActual=String(claveActual||''); claveNueva=String(claveNueva||'');
  if(claveNueva.length<12)return {ok:false,message:'La nueva contraseña debe tener al menos 12 caracteres.'};
  if(claveNueva===claveActual)return {ok:false,message:'La nueva contraseña debe ser diferente a la actual.'};
  const sh=sheet_(CFG.SHEETS.USUARIOS), cols=asegurarColumnasSeguridadUsuarios_(), h=headers_(sh), rows=sh.getDataRange().getDisplayValues();
  const ui=col_(h,'USUARIO'), pos=rows.findIndex((r,i)=>i>0&&String(r[ui]).trim().toLowerCase()===String(user.usuario).trim().toLowerCase());
  if(pos<1)return {ok:false,message:'No se encontró la cuenta del usuario.'};
  const hashCol=h.indexOf('HASH_CLAVE'),saltCol=h.indexOf('SALT_CLAVE'); let valid=false;
  if(hashCol>=0&&saltCol>=0&&rows[pos][hashCol]&&rows[pos][saltCol]) valid=hashPasswordV2_(claveActual,rows[pos][saltCol])===rows[pos][hashCol];
  else {const props=PropertiesService.getScriptProperties(),legacySalt=props.getProperty('AUTH_SALT'),expected=props.getProperty('PWD_'+user.usuario);valid=!!(legacySalt&&expected&&hashPassword_(claveActual,legacySalt)===expected);}
  if(!valid)return {ok:false,message:'La contraseña actual no es correcta.'};
  const salt=Utilities.getUuid()+Utilities.getUuid();
  sh.getRange(pos+1,cols.hash+1).setValue(hashPasswordV2_(claveNueva,salt));
  sh.getRange(pos+1,cols.salt+1).setValue(salt);
  PropertiesService.getScriptProperties().deleteProperty('PWD_'+user.usuario);
  registrarAuditoria5074_(user.usuario,'CAMBIO_CLAVE','El usuario actualizó su contraseña.');
  return {ok:true,message:'Contraseña actualizada correctamente.'};
}
