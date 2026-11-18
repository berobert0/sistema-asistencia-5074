// Basado en el escáner que el usuario confirmó que funciona.
// Se conserva el método de cámara original: Html5Qrcode.start({facingMode:"environment"}).
// Esta versión solo prueba cámara y lectura. No registra directamente en Sheets
// ni utiliza el endpoint público del ejemplo, porque no valida sesión ni rol.

let bloqueado = false;
let qr = null;

function mostrar(nombre, estado, mensaje) {
  document.getElementById("nombre").textContent = nombre;
  document.getElementById("estado").textContent = estado;
  document.getElementById("mensaje").textContent = mensaje;
}

async function iniciarCamara() {
  const retry = document.getElementById("retry");
  retry.hidden = true;

  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    mostrar("Cámara no disponible", "ERROR", "Abre esta página con GitHub Pages HTTPS en Chrome/Safari y permite el acceso a la cámara.");
    retry.hidden = false;
    return;
  }
  if (!window.Html5Qrcode) {
    mostrar("No se cargó el lector QR", "ERROR", "Revisa tu conexión a internet y vuelve a cargar la página.");
    retry.hidden = false;
    return;
  }

  try {
    if (!qr) qr = new Html5Qrcode("reader");
    mostrar("Solicitando cámara…", "INICIANDO", "Acepta el permiso de cámara del navegador.");
    await qr.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 200 },
      texto => {
        if (bloqueado) return;
        bloqueado = true;
        mostrar("Código QR leído", "LECTURA CORRECTA", "Código detectado: " + texto + ". El registro institucional se conectará después de validar la sesión.");
        try { navigator.vibrate?.(180); } catch(e) {}
        setTimeout(() => { bloqueado = false; }, 2500);
      },
      () => {}
    );
    mostrar("Cámara activa", "LISTO PARA ESCANEAR", "Enfoca el código QR dentro del recuadro.");
  } catch (err) {
    const detail = err?.message || String(err);
    mostrar("No se pudo activar la cámara", "ERROR", detail + " Revisa el permiso de cámara del sitio en el navegador.");
    retry.hidden = false;
  }
}

document.getElementById("retry").addEventListener("click", iniciarCamara);
window.addEventListener("load", () => setTimeout(iniciarCamara, 300));
window.addEventListener("pagehide", async () => {
  try { if (qr?.isScanning) await qr.stop(); } catch(e) {}
});
