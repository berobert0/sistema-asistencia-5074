
/* Escáner independiente para GitHub Pages.
   La cámara se inicia desde esta página HTTPS abierta como pestaña principal.
   No registra directamente: envía el QR a Apps Script con un ticket limitado. */

const CONFIG = {
  APPS_SCRIPT_URL: new URLSearchParams(location.search).get("api") || ""
};

const $ = id => document.getElementById(id);
let scanner = null;
let locked = false;
let ticket = new URLSearchParams(location.search).get("ticket") || "";
let lastCode = "";

function status(title, text, bad = false) {
  $("statusTitle").textContent = title;
  $("statusText").textContent = text;
  $("statusTitle").style.color = bad ? "#ff9aa8" : "#eaf2fb";
}

function showResult(title, message, kind = "ok", alumno = null, extra = {}) {
  const box = $("result");
  box.className = "result" +
    (kind === "error" ? " error" :
    kind === "warning" ? " warning" : "");

  $("studentName").textContent = title;
  $("resultMessage").textContent = message;
  $("resultIcon").textContent =
    kind === "error" ? "!" :
    kind === "warning" ? "⚠" : "✓";

  const details = $("studentDetails");
  if (!details) return;

  details.replaceChildren();

  if (!alumno) {
    details.hidden = true;
    return;
  }

  details.hidden = false;

  const photoUrl = String(alumno.FOTO_URL || "").trim();

  if (photoUrl) {
    const img = document.createElement("img");
    img.className = "student-photo";
    img.alt = "Fotografía del estudiante";
    img.referrerPolicy = "no-referrer";
    img.src = photoUrl;
    img.onerror = () => img.remove();
    details.appendChild(img);
  }

  const meta = document.createElement("div");
  meta.className = "student-meta";

  const fields = [
    ["Código", alumno.CODIGO_ALUMNO],
    ["Grado", alumno.GRADO],
    ["Sección", alumno.SECCION],
    ["Estado", extra.estado || alumno.ESTADO],
    ["Hora", extra.hora]
  ];

  fields.forEach(([label, value]) => {
    if (
      value === undefined ||
      value === null ||
      String(value).trim() === ""
    ) return;

    const line = document.createElement("p");
    const strong = document.createElement("strong");

    strong.textContent = label + ": ";
    line.append(strong, document.createTextNode(String(value)));
    meta.appendChild(line);
  });

  details.appendChild(meta);
}

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cb = "qrCb_" + Date.now() + "_" +
      Math.floor(Math.random() * 1e6);

    const script = document.createElement("script");

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(
        "Tiempo de espera agotado al conectar con el sistema."
      ));
    }, 15000);

    function cleanup() {
      clearTimeout(timer);
      delete window[cb];
      script.remove();
    }

    window[cb] = data => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error(
        "No se pudo conectar con Google Apps Script."
      ));
    };

    script.src = url +
      (url.includes("?") ? "&" : "?") +
      "callback=" + cb;

    document.body.appendChild(script);
  });
}

async function registerCode(code) {
  if (locked || !code) return;

  if (code === lastCode && locked) return;

  locked = true;
  lastCode = code;

  if (!ticket) {
    showResult(
      "Código leído: " + code,
      "La cámara funciona. Para registrar asistencia, abre este escáner desde el botón Asistencia QR después de iniciar sesión en el sistema 5074.",
      "warning"
    );

    status(
      "Cámara funcionando · falta autorización",
      "Vuelve al sistema 5074 e ingresa desde Asistencia QR."
    );

    locked = false;
    return;
  }

  status(
    "Validando código QR…",
    "Consultando el sistema institucional."
  );

  try {
    if (
      !CONFIG.APPS_SCRIPT_URL ||
      !/^https:\/\/script\.google\.com\/macros\/s\//.test(
        CONFIG.APPS_SCRIPT_URL
      )
    ) {
      throw new Error(
        "No llegó la dirección de Google Apps Script. Cierra el escáner y vuelve a abrirlo desde el botón del sistema 5074."
      );
    }

    const url = CONFIG.APPS_SCRIPT_URL +
      "?accion=registrarQR" +
      "&ticket=" + encodeURIComponent(ticket) +
      "&codigo=" + encodeURIComponent(code);

    const r = await jsonp(url);

    if (!r) {
      throw new Error("El sistema devolvió una respuesta vacía.");
    }

    const name =
      r.alumno?.APELLIDOS_Y_NOMBRES ||
      r.nombre ||
      "Estudiante";

    if (r.duplicate) {
      showResult(
        name,
        r.message || "Este estudiante ya tiene registro hoy.",
        "warning",
        r.alumno,
        {
          estado: r.estado || "YA REGISTRADO",
          hora: r.hora || ""
        }
      );

      status(
        "Registro duplicado",
        r.message || "El estudiante ya figura en asistencia."
      );

    } else if (!r.ok) {
      showResult(
        r.alumno ? name : "No se registró",
        r.message || "El sistema rechazó el registro.",
        "error",
        r.alumno
      );

      status(
        "No se pudo registrar",
        r.message || "Verifica tu sesión.",
        true
      );

    } else {
      showResult(
        name,
        r.message || "Asistencia registrada correctamente.",
        "ok",
        r.alumno,
        {
          estado: r.estado || "PRESENTE",
          hora: r.hora || ""
        }
      );

      status(
        "Asistencia registrada",
        r.message || "Registro validado por el sistema."
      );

      try {
        navigator.vibrate?.(120);
      } catch (e) {}
    }

  } catch (e) {
    showResult(
      "Error de conexión",
      e.message,
      "error"
    );

    status(
      "No se pudo conectar",
      e.message,
      true
    );

  } finally {
    setTimeout(() => {
      locked = false;
      lastCode = "";
    }, 1800);
  }
}

async function startCamera() {
  if (
    !window.isSecureContext ||
    !navigator.mediaDevices?.getUserMedia
  ) {
    status(
      "Cámara no disponible",
      "Abre esta página mediante GitHub Pages (HTTPS) en Chrome o Safari.",
      true
    );

    $("retryBtn").hidden = false;
    return;
  }

  try {
    status(
      "Solicitando permiso de cámara",
      "Acepta el permiso del navegador. Se priorizará la cámara posterior."
    );

    scanner = scanner || new Html5Qrcode("reader");

    try {
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 12,
          qrbox: { width: 240, height: 240 },
          aspectRatio: 1
        },
        registerCode,
        () => {}
      );

    } catch (firstError) {
      const cameras = await Html5Qrcode.getCameras();

      if (!cameras.length) throw firstError;

      const rear = cameras.filter(c =>
        /back|rear|environment|trasera|posterior/i.test(c.label)
      );

      const ordered = [
        ...rear,
        ...cameras.filter(c =>
          !rear.some(x => x.id === c.id)
        )
      ];

      let started = false;
      let lastError = firstError;

      for (const cam of ordered) {
        try {
          await scanner.start(
            cam.id,
            {
              fps: 12,
              qrbox: { width: 240, height: 240 }
            },
            registerCode,
            () => {}
          );

          started = true;
          break;

        } catch (e) {
          lastError = e;
        }
      }

      if (!started) throw lastError;
    }

    if (ticket) {
      status(
        "Cámara activa y autorizada",
        "Enfoca el código QR dentro del recuadro."
      );

      showResult(
        "Escáner listo",
        "Esperando el código QR del estudiante."
      );

    } else {
      status(
        "Cámara activa · modo de prueba",
        "Para registrar asistencia, abre el escáner desde el sistema 5074 después de iniciar sesión."
      );

      showResult(
        "Cámara funcionando",
        "La lectura QR está disponible; el registro requiere autorización del sistema 5074.",
        "warning"
      );
    }

    $("retryBtn").hidden = true;

  } catch (e) {
    status(
      "No se pudo activar la cámara",
      e.message || String(e),
      true
    );

    showResult(
      "Error de cámara",
      e.message || "Revisa los permisos de cámara del navegador.",
      "error"
    );

    $("retryBtn").hidden = false;
  }
}

$("retryBtn").addEventListener("click", startCamera);

$("stopBtn").addEventListener("click", async () => {
  if (scanner?.isScanning) {
    await scanner.stop();
  }

  status(
    "Cámara detenida",
    "Puedes volver a iniciarla con Reintentar cámara."
  );

  $("retryBtn").hidden = false;
});

window.addEventListener("load", () => {
  setTimeout(startCamera, 250);
});
