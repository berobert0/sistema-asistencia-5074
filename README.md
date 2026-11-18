# Escáner QR 5074 — basado en el código que el usuario confirmó que funciona

## Subir a GitHub Pages
Sube `index.html`, `app.js` y `style.css` a la raíz del repositorio y habilita Pages en `main / (root)`.

## Cámara
Se conserva la llamada de cámara del ejemplo funcional:
`qr.start({ facingMode: "environment" }, { fps: 10, qrbox: 200 }, ...)`

## Alcance de esta versión
Esta entrega comprueba que GitHub Pages pueda abrir la cámara y leer el QR. No escribe en Google Sheets todavía.

## Seguridad
No se reutiliza el endpoint del `apps_script.gs` original para registrar asistencia: ese endpoint acepta `?codigo=` sin sesión, crea el nombre como `Alumno <codigo>` y permite que cualquiera que conozca la URL intente registrar códigos. Tampoco se reutiliza el login `admin/1234` de `panel.html`. La conexión al sistema 5074 debe hacerse con validación de sesión, rol, sección y estudiante en el backend institucional.
