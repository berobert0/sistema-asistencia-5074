'use strict';
// La URL del panel no es necesariamente la URL de una implementación nueva.
// El panel envía ?ticket=...&api=... al abrir este lector.
const PANEL_URL='https://script.google.com/macros/s/AKfycbzk4qk30eq65JoCO8vtTEIJit6sHPMHBEVItWmP-2BAwmw4MS_9MTNnkNC7um9dTfqP/exec';
const params=new URLSearchParams(location.search);
const ticket=(params.get('ticket')||'').trim();
const api=(params.get('api')||'').trim();
const $=id=>document.getElementById(id);
let qr=null, activo=false, ocupado=false, ultimo='';
function apiValida(v){try{const u=new URL(v);return u.protocol==='https:' && u.hostname==='script.google.com' && /^\/macros\/s\/[^/]+\/exec$/.test(u.pathname);}catch{return false;}}
function mostrar(estado,nombre,mensaje,tipo=''){$('estado').textContent=estado;$('nombre').textContent=nombre;$('mensaje').textContent=mensaje;$('resultado').className='card result '+tipo;$('resultIcon').textContent=tipo==='ok'?'✓':tipo==='error'?'!':tipo==='warn'?'⚠':'⌁';}
function listo(){return !!ticket && apiValida(api);}
function acceso(){const ok=listo();$('authBadge').textContent=ok?'Acceso autorizado':'Falta autorización';$('authBadge').className='badge '+(ok?'good':'bad');$('startBtn').disabled=!ok;if(!ok)mostrar('No se registró la asistencia','Conexión pendiente','Abre el panel institucional, inicia sesión y pulsa «Escáner QR». No abras directamente el enlace de GitHub.','warn');else mostrar('Lector autorizado','Listo para escanear','Pulsa «Iniciar cámara» y presenta un carné QR.');}
function consultar(codigo){return new Promise((resolve,reject)=>{
 const callback='qr5074_'+Date.now()+'_'+Math.random().toString(36).slice(2);
 const script=document.createElement('script');let cerrado=false;
 const timer=setTimeout(()=>terminar(new Error('El servidor no respondió en 20 segundos. No se confirmó ningún registro.')),20000);
 function limpiar(){clearTimeout(timer);try{delete window[callback];}catch{window[callback]=undefined;}script.remove();}
 function terminar(err,data){if(cerrado)return;cerrado=true;limpiar();err?reject(err):resolve(data);}
 window[callback]=data=>terminar(null,data);
 script.onerror=()=>terminar(new Error('No se pudo conectar con Apps Script. Comprueba la implementación y los permisos.'));
 const u=new URL(api);u.searchParams.set('accion','registrarQR');u.searchParams.set('ticket',ticket);u.searchParams.set('codigo',codigo);u.searchParams.set('callback',callback);script.src=u.toString();document.body.appendChild(script);
 });}
async function lectura(texto){const codigo=String(texto||'').trim();if(!codigo||ocupado||codigo===ultimo)return;ocupado=true;ultimo=codigo;mostrar('Verificando asistencia','Consultando Google Sheets','Espera la confirmación del servidor…');try{
 const r=await consultar(codigo);const a=r&&r.alumno||{};const nombre=a.APELLIDOS_Y_NOMBRES||'Estudiante';
 if(r&&r.ok===true&&r.saved===true){mostrar('Asistencia registrada',nombre,r.message||'Registro confirmado en Google Sheets.','ok');const foto=String(a.FOTO_URL||'');$('foto').hidden=!/^https:\/\//i.test(foto);if(!$('foto').hidden)$('foto').src=foto;}
 else if(r&&r.duplicate){mostrar('Asistencia duplicada',nombre,r.message||'Ya existe una asistencia hoy; no se creó otra.','warn');}
 else{mostrar('No se registró la asistencia',nombre,(r&&r.message)||'El servidor no confirmó el guardado.','error');}
 }catch(e){mostrar('No se registró la asistencia','Error de conexión',e.message||String(e),'error');}finally{setTimeout(()=>{ocupado=false;ultimo='';},2800);}}
async function iniciar(){if(!listo()){acceso();return;}if(activo)return;try{if(typeof Html5Qrcode==='undefined')throw new Error('No cargó la biblioteca de cámara. Revisa tu conexión.');$('startBtn').disabled=true;$('cameraStatus').textContent='Solicitando permiso para usar la cámara…';qr=qr||new Html5Qrcode('reader');await qr.start({facingMode:'environment'},{fps:10,qrbox:{width:230,height:230}},lectura,()=>{});activo=true;$('stopBtn').disabled=false;$('cameraStatus').textContent='Cámara activa. Coloca el QR dentro del recuadro.';}catch(e){$('startBtn').disabled=false;$('cameraStatus').textContent='No se pudo iniciar la cámara: '+(e.message||e);}}
async function detener(){if(!activo||!qr)return;try{await qr.stop();activo=false;$('stopBtn').disabled=true;$('startBtn').disabled=!listo();$('cameraStatus').textContent='Cámara detenida.';}catch(e){$('cameraStatus').textContent='Error al detener la cámara: '+(e.message||e);}}
$('panelLink').href=PANEL_URL;$('startBtn').addEventListener('click',iniciar);$('stopBtn').addEventListener('click',detener);acceso();
