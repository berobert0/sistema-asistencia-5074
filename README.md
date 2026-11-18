# Escáner QR - I.E. 5074 Alcides Spelucín Vega

Este repositorio contiene el frontend independiente para GitHub Pages. La cámara se ejecuta en una página HTTPS de nivel superior, no dentro del iframe de Apps Script.

## Archivos
- `index.html`: pantalla del escáner.
- `app.js`: cámara, lectura QR y conexión JSONP con Apps Script.
- `style.css`: diseño adaptable.

## IMPORTANTE: conexión segura pendiente
Este paquete no registra asistencias por sí solo. Necesita que el backend Apps Script del sistema 5074 implemente el ticket de escáner limitado y la acción `accion=registrarQR`. El ticket debe ser emitido únicamente después de validar la sesión ADMIN/DOCENTE y debe quedar vinculado a esa sesión. No publiques el escáner hasta que esté instalada esa parte del backend.

En `app.js`, sustituye `PEGAR_AQUI_URL_WEB_APP_EXEC` por la URL `/exec` de tu aplicación web de Apps Script.

## Activar GitHub Pages
1. En el repositorio, pulsa **Add file > Upload files**.
2. Sube `index.html`, `app.js` y `style.css` (en la raíz).
3. Pulsa **Commit changes**.
4. Entra en **Settings > Pages**.
5. En **Build and deployment**, selecciona **Deploy from a branch**.
6. Selecciona `main` y `/ (root)`, y pulsa **Save**.
7. Espera a que GitHub muestre la URL publicada.

## Flujo final esperado
Sistema 5074 (login) -> botón Asistencia QR -> backend crea ticket limitado -> abre GitHub Pages en pestaña nueva con ticket -> cámara se activa -> QR -> Apps Script valida ticket, usuario, estado, sección y estudiante -> registra asistencia en Sheets.

No usar el endpoint antiguo que escribe en Sheets sin validar sesión.


## Prueba de cámara
La página puede iniciar la cámara incluso si se abre directamente, para comprobar que el navegador reconoce el dispositivo. En ese modo solo lee el QR y muestra que falta autorización; NO registra asistencia. Para registrar, abre el escáner desde la sesión autenticada del sistema 5074 para recibir un ticket temporal.


CONEXIÓN: app.js debe tener APPS_SCRIPT_URL configurada con la URL /exec de la implementación de Google Apps Script. El ID de Google Sheets permanece en Code.gs, no se publica en GitHub. El escáner envía los QR al endpoint Apps Script usando un ticket temporal generado después del login.


ACTUALIZACIÓN DE RESULTADOS DEL ESCÁNER
Esta versión muestra el nombre, código, grado, sección, estado y FOTO_URL que devuelve
registrarAsistencia() desde la hoja ALUMNOS. También muestra los datos cuando el backend
detecta un registro duplicado. Si FOTO_URL no es una URL HTTP/HTTPS accesible desde el
navegador, la tarjeta muestra los demás datos y oculta la imagen.
