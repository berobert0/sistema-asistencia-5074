/*
 * LECTOR QR - I.E. 5074 ALCIDES SPELUCÍN VEGA
 * GitHub Pages -> Apps Script -> Google Sheets.
 * Requiere abrirse desde el botón autenticado del sistema para recibir ticket y api.
 */
'use strict';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(window.location.search);
const API_URL = (params.get('api') || '').trim();
const TICKET = (params.get('ticket') || '').trim();

let qrScanner = null;
let processing = false;
let lastAcceptedCode = '';
let lastAcceptedAt = 0;

function setStatus(title, message, error = false) {
  const titleEl = $('statusTitle');
  const messageEl = $('statusText');
  if (titleEl) {
    titleEl.textContent = title;
    titleEl.classList.toggle('error-text', !!error);
  }
  if (messageEl) messageEl.textContent = message;
}

function showResult(title, message, type = 'ok', student = null, attendance = {}) {
  const panel = $('result');
  if (panel) panel.className = 'result ' + type;
  if ($('studentName')) $('studentName').textContent = title || 'Estudiante';
  if ($('resultMessage')) $('resultMessage').textContent = message || '';
  if ($('resultIcon')) $('resultIcon').textContent = type === 'error' ? '!' : (type === 'warning' ? '⚠' : '✓');

  const details = $('studentDetails');
  if (!details) return;
  details.replaceChildren();
  if (!student) {
    details.hidden = true;
    return;
  }
  details.hidden = false;

  const photo = String(student.FOTO_URL || student.FOTO || '').trim();
  if (photo && /^https:\/\//i.test(photo)) {
    const img = document.createElement('img');
    img.className = 'student-photo';
    img.alt = 'Fotografía del estudiante';
    img.referrerPolicy = 'no-referrer';
    img.src = photo;
    img.onerror = () => img.remove();
    details.appendChild(img);
  }

  const meta = document.createElement('div');
  meta.className = 'student-meta';
  const rows = [
    ['Código', student.CODIGO_ALUMNO || ''],
    ['Grado', student.GRADO || ''],
    ['Sección', student.SECCION || ''],
    ['Estado', attendance.estado || ''],
    ['Hora', attendance.hora || '']
  ];
  rows.forEach(([label, value]) => {
    if (value === '' || value == null) return;
    const p = document.createElement('p');
    const b = document.createElement('strong');
    b.textContent = label + ': ';
    p.append(b, document.createTextNode(String(value)));
    meta.appendChild(p);
  });
  details.appendChild(meta);
}

function jsonp(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const callback = 'asistenciaQR_' + Date.now() + '_' + Math.floor(Math.random() * 1000000);
    const script = document.createElement('script');
    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { delete window[callback]; } catch (_) { window[callback] = undefined; }
      script.remove();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Google Apps Script no respondió en 20 segundos. Verifica que publicaste una nueva versión como aplicación web.'));
    }, timeoutMs);

    window[callback] = (data) => {
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('No se pudo cargar la respuesta de Apps Script. Comprueba la URL /exec y el acceso de la aplicación web.'));
    };
    const separator = url.includes('?') ? '&' : '?';
    script.src = url + separator + 'callback=' + encodeURIComponent(callback) + '&_=' + Date.now();
    document.head.appendChild(script);
  });
}

function validateConnection() {
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('La cámara necesita GitHub Pages con HTTPS y permiso del navegador.');
  }
  if (!window.Html5Qrcode) {
    throw new Error('No se cargó html5-qrcode. Recarga la página y revisa tu conexión a internet.');
  }
  if (!API_URL || !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?.*)?$/i.test(API_URL)) {
    throw new Error('No llegó una URL válida de Apps Script. Cierra esta pestaña e ingresa nuevamente desde el botón Escáner QR del sistema 5074.');
  }
  if (!TICKET) {
    throw new Error('Falta el ticket de autorización. Inicia sesión en el sistema 5074 y abre el escáner desde su botón.');
  }
}

function cleanScannedValue(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  // Los QR pueden contener el código directo o una URL con el código como parámetro.
  if (/^https?:\/\//i.test(value)) {
    try {
      const u = new URL(value);
      for (const key of ['codigo', 'code', 'qr', 'id', 'CODIGO_ALUMNO', 'CODIGO_QR']) {
        const found = u.searchParams.get(key);
        if (found) return found.trim();
      }
      const last = u.pathname.split('/').filter(Boolean).pop();
      if (last) value = last;
    } catch (_) { /* se envía el contenido original */ }
  }
  return value.replace(/[\r\n\t]/g, '').trim();
}

async function registerAttendance(rawCode) {
  const code = cleanScannedValue(rawCode);
  if (!code) return;
  const now = Date.now();
  if (processing || (code === lastAcceptedCode && now - lastAcceptedAt < 3500)) return;
  processing = true;
  lastAcceptedCode = code;
  lastAcceptedAt = now;

  try {
    validateConnection();
    setStatus('Código QR detectado', 'Validando al estudiante y enviando el registro a Google Sheets…');
    showResult('Procesando asistencia', 'No retires el código todavía.');

    const url = API_URL + '?accion=registrarQR'
      + '&ticket=' + encodeURIComponent(TICKET)
      + '&codigo=' + encodeURIComponent(code);
    const response = await jsonp(url);

    if (!response || typeof response !== 'object') {
      throw new Error('La respuesta del servidor no tiene un formato válido.');
    }

    const student = response.alumno || null;
    const studentName = student?.APELLIDOS_Y_NOMBRES || response.nombre || 'Estudiante';

    if (response.duplicate) {
      showResult(studentName, response.message || 'Este alumno ya tiene asistencia registrada hoy.', 'warning', student, {
        estado: response.estado || 'DUPLICADO', hora: response.hora || ''
      });
      setStatus('Asistencia ya registrada', 'No se agregó una fila duplicada a Google Sheets.');
      return;
    }

    if (response.ok !== true || response.saved === false) {
      throw new Error(response.message || 'El servidor no confirmó el registro.');
    }

    showResult(studentName, response.message || 'Asistencia guardada y verificada en Google Sheets.', 'ok', student, {
      estado: response.estado || 'PRESENTE', hora: response.hora || ''
    });
    setStatus('¡Asistencia guardada!', 'Google Sheets confirmó el registro de ' + studentName + '.');
    try { if (navigator.vibrate) navigator.vibrate([100, 60, 100]); } catch (_) {}

  } catch (error) {
    showResult('No se registró la asistencia', error.message || String(error), 'error');
    setStatus('Error de registro', error.message || String(error), true);
  } finally {
    // Evita leer el mismo QR varias veces mientras el alumno retira su tarjeta.
    setTimeout(() => { processing = false; }, 2200);
  }
}

async function startCamera() {
  const retry = $('retryBtn');
  if (retry) retry.hidden = true;
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Abre el lector desde la dirección HTTPS de GitHub Pages y permite el uso de la cámara.');
    }
    if (!window.Html5Qrcode) throw new Error('No se cargó la biblioteca del lector QR. Recarga la página.');

    setStatus('Activando cámara', 'Acepta el permiso de cámara del navegador.');
    if (!qrScanner) qrScanner = new Html5Qrcode('reader');

    try {
      await qrScanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 230, height: 230 }, aspectRatio: 1 },
        registerAttendance,
        () => {}
      );
    } catch (firstError) {
      const cameras = await Html5Qrcode.getCameras();
      if (!cameras || !cameras.length) throw firstError;
      const rear = cameras.filter(c => /back|rear|environment|trasera|posterior/i.test(c.label || ''));
      const candidates = rear.length ? rear.concat(cameras.filter(c => !rear.some(r => r.id === c.id))) : cameras;
      let started = false;
      let lastError = firstError;
      for (const camera of candidates) {
        try {
          await qrScanner.start(camera.id, { fps: 10, qrbox: { width: 230, height: 230 } }, registerAttendance, () => {});
          started = true;
          break;
        } catch (e) { lastError = e; }
      }
      if (!started) throw lastError;
    }

    // Se valida ticket/API antes de intentar registrar; la cámara puede abrirse para diagnóstico.
    if (TICKET && API_URL) {
      setStatus('Cámara activa y sistema enlazado', 'Enfoca el código QR del estudiante dentro del recuadro.');
      showResult('Escáner listo', 'Esperando el código QR del estudiante.');
    } else {
      setStatus('Cámara activa, falta autorización', 'Abre el lector desde el botón Escáner QR después de iniciar sesión.');
      showResult('Modo de prueba', 'La cámara lee códigos, pero no puede guardar asistencia sin ticket.', 'warning');
    }
  } catch (error) {
    setStatus('No se pudo iniciar la cámara', error.message || String(error), true);
    showResult('Error del escáner', error.message || String(error), 'error');
    if (retry) retry.hidden = false;
  }
}

if ($('retryBtn')) $('retryBtn').addEventListener('click', startCamera);
if ($('stopBtn')) $('stopBtn').addEventListener('click', async () => {
  try { if (qrScanner?.isScanning) await qrScanner.stop(); } catch (_) {}
  setStatus('Cámara detenida', 'Pulsa Reintentar cámara para volver a escanear.');
  if ($('retryBtn')) $('retryBtn').hidden = false;
});

window.addEventListener('pagehide', async () => {
  try { if (qrScanner?.isScanning) await qrScanner.stop(); } catch (_) {}
});
window.addEventListener('load', () => setTimeout(startCamera, 300));
