'use strict';
// I.E. 5074 — lector QR. Actualización de cámara, sin modificar el panel ni Sheets.
const PANEL_URL = 'https://script.google.com/macros/s/AKfycbzk4qk30eq65JoCO8vtTEIJit6sHPMHBEVItWmP-2BAwmw4MS_9MTNnkNC7um9dTfqP/exec';
const parametros = new URLSearchParams(location.search);
const ticket = (parametros.get('ticket') || '').trim();
const api = (parametros.get('api') || '').trim();
const $ = id => document.getElementById(id);
let lector = null, activa = false, iniciando = false, ocupado = false, ultimo = '';
function apiValida(valor) {
  try { const u = new URL(valor); return u.protocol === 'https:' && u.hostname === 'script.google.com' && /^\/macros\/s\/[^/]+\/exec$/.test(u.pathname); }
  catch (_) { return false; }
}
function autorizado() { return Boolean(ticket) && apiValida(api); }
function mostrar(estado, nombre, mensaje, tipo = '') {
  $('estado').textContent = estado;
  $('nombre').textContent = nombre;
  $('mensaje').textContent = mensaje;
  $('resultado').className = 'card result ' + tipo;
  $('resultIcon').textContent = tipo === 'ok' ? '✓' : tipo === 'error' ? '!' : tipo === 'warn' ? '⚠' : '⌁';
}
function configurarAcceso() {
  const ok = autorizado();
  $('authBadge').textContent = ok ? 'Acceso autorizado' : 'Falta autorización';
  $('authBadge').className = 'badge ' + (ok ? 'good' : 'bad');
  if (!ok) mostrar('Registro pendiente', 'Sin autorización', 'Puedes probar la cámara. Para guardar asistencias, entra al panel y utiliza su botón «Escáner QR».', 'warn');
  else mostrar('Lector autorizado', 'Listo para escanear', 'Inicia la cámara y presenta el carné.');
}
function consultar(codigo) {
  return new Promise((resolve, reject) => {
    const callback = 'qr5074_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    let terminado = false;
    const timer = setTimeout(() => finalizar(new Error('Apps Script no respondió. No se confirmó el registro.')), 20000);
    function finalizar(error, respuesta) {
      if (terminado) return;
      terminado = true;
      clearTimeout(timer);
      script.remove();
      try { delete window[callback]; } catch (_) { window[callback] = undefined; }
      if (error) reject(error); else resolve(respuesta);
    }
    window[callback] = respuesta => finalizar(null, respuesta);
    script.onerror = () => finalizar(new Error('No se pudo conectar con Apps Script.'));
    const url = new URL(api);
    url.searchParams.set('accion', 'registrarQR');
    url.searchParams.set('ticket', ticket);
    url.searchParams.set('codigo', codigo);
    url.searchParams.set('callback', callback);
    script.src = url.toString();
    document.body.appendChild(script);
  });
}
async function alLeer(texto) {
  const codigo = String(texto || '').trim();
  if (!codigo || ocupado || codigo === ultimo) return;
  ocupado = true; ultimo = codigo;
  try {
    if (!autorizado()) {
      mostrar('QR leído correctamente', 'Código detectado', 'La cámara funciona, pero falta autorización del panel para registrar.', 'warn');
      return;
    }
    mostrar('Consultando asistencia', 'Verificando estudiante', 'Esperando confirmación del servidor…');
    const r = await consultar(codigo);
    const alumno = r && r.alumno || {};
    const nombre = alumno.APELLIDOS_Y_NOMBRES || 'Estudiante';
    if (r && r.ok === true && r.saved === true) {
      mostrar('Asistencia registrada', nombre, r.message || 'Guardado confirmado por Apps Script.', 'ok');
      const foto = String(alumno.FOTO_URL || '');
      $('foto').hidden = !/^https:\/\//i.test(foto);
      if (!$('foto').hidden) $('foto').src = foto;
    } else if (r && r.duplicate) {
      mostrar('Registro duplicado', nombre, r.message || 'El alumno ya tiene asistencia hoy.', 'warn');
    } else {
      mostrar('No se registró la asistencia', nombre, r && r.message || 'El servidor no confirmó el guardado.', 'error');
    }
  } catch (error) {
    mostrar('No se registró la asistencia', 'Error de comunicación', String(error.message || error), 'error');
  } finally {
    setTimeout(() => { ocupado = false; ultimo = ''; }, 3000);
  }
}
async function iniciarCamara() {
  if (activa || iniciando) return;
  iniciando = true;
  $('startBtn').disabled = true;
  $('cameraStatus').textContent = 'Iniciando cámara…';
  try {
    if (!window.isSecureContext) throw new Error('La cámara requiere HTTPS.');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Este navegador no permite acceder a la cámara.');
    if (typeof Html5Qrcode === 'undefined') throw new Error('No se cargó la biblioteca html5-qrcode. Comprueba tu conexión a Internet.');
    if (!lector) lector = new Html5Qrcode('reader');
    const opciones = { fps: 10, qrbox: (ancho, alto) => { const lado = Math.max(100, Math.min(230, ancho - 24, alto - 24)); return { width: lado, height: lado }; } };
    try {
      await lector.start({ facingMode: 'environment' }, opciones, alLeer, () => {});
    } catch (primerError) {
      // Algunos Android no aceptan facingMode aunque sí permiten elegir una cámara por ID.
      const camaras = await Html5Qrcode.getCameras();
      if (!camaras || !camaras.length) throw primerError;
      const trasera = camaras.find(c => /back|rear|environment|trasera|posterior/i.test(c.label)) || camaras[camaras.length - 1];
      await lector.start(trasera.id, opciones, alLeer, () => {});
    }
    activa = true;
    $('stopBtn').disabled = false;
    $('cameraStatus').textContent = 'Cámara activa. Enfoca el código QR.';
  } catch (error) {
    const mensaje = String(error.message || error);
    $('cameraStatus').textContent = 'No se pudo abrir la cámara: ' + mensaje;
    mostrar('Error de cámara', 'No se inició la lectura', mensaje + ' Revisa los permisos de cámara de Chrome y vuelve a intentarlo.', 'error');
  } finally {
    iniciando = false;
    $('startBtn').disabled = activa;
  }
}
async function detenerCamara() {
  if (iniciando || !activa || !lector) return;
  try {
    await lector.stop();
    activa = false;
    $('stopBtn').disabled = true;
    $('startBtn').disabled = false;
    $('cameraStatus').textContent = 'Cámara detenida.';
  } catch (error) {
    $('cameraStatus').textContent = 'Error al detener: ' + String(error.message || error);
  }
}
$('panelLink').href = PANEL_URL;
$('startBtn').addEventListener('click', iniciarCamara);
$('stopBtn').addEventListener('click', detenerCamara);
configurarAcceso();
// Evita dos inicializaciones simultáneas; permite reintentar con el botón.
window.addEventListener('load', iniciarCamara, { once: true });
