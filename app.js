// URAC · Sistema de disponibilidad
// App web de una sola página. Firebase (plan Spark, sin costo): Authentication + Firestore.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, collection, query, where, onSnapshot, writeBatch,
  serverTimestamp, Timestamp, updateDoc
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from './config.js';
import { NOMBRES, CARGOS, SUGERIDO } from './nomina.js';

// ---------- Constantes ----------
const TZ = 'America/Santiago';
const CORDADA_MIN = 6;
const PLAZO_SNO_H = 4;
const VENCE_PRONTO_MIN = 30;
const FASES = { monitoreo: 'MONITOREO', alerta: 'ALERTA', movilizacion: 'MOVILIZACIÓN' };
const NIVELES = { local: 'Local', regional: 'Regional', sno: 'SNO' };
const ROLES = { rescatista: 'Rescatista', gerencia: 'Gerencia', lider: 'Líder', admin: 'Administrador' };
const H = 3600 * 1000;
const ESCUDO = '<svg width="30" height="34" viewBox="0 0 30 34" aria-hidden="true"><path d="M3 3h24v16c0 7-6 11-12 13C9 30 3 26 3 19z" fill="#0E0E0E" stroke="#F5C400" stroke-width="2.5"/><path d="M9 10l12 14M21 10L9 24" stroke="#F5C400" stroke-width="2.5" stroke-linecap="round"/></svg>';
const CHECK = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l5 5L20 6" fill="none" stroke="#3CCB6B" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const EQUIS = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="#FF8A80" stroke-width="3" stroke-linecap="round"/></svg>';

const $app = document.getElementById('app');
const configurado = !String(firebaseConfig.apiKey).startsWith('PEGAR');

// ---------- Estado ----------
const S = {
  cargando: true, user: null, email: '', perfil: null, sinNomina: false, bootstrapLibre: false,
  tab: 'estado', paso: null, filtro: 'todos',
  llamado: null, miResp: null, respuestas: {}, nomina: [], resumen: null,
  f: { email: '', clave: '', nombre: '', fase: 'alerta', nivel: 'local', desc: '', hora: '',
       nEmail: '', nNombre: '', nCargo: 'Operador de Rescate', nRol: 'rescatista' },
  msg: '', err: '', ocupado: false
};

let app, auth, db;
let subs = { perfil: null, llamados: null, miResp: null, respuestas: null, resumen: null, nomina: null };
let llamadoId = null;

const esLider = () => S.perfil && ['lider', 'admin'].includes(S.perfil.rol);
const esGerencia = () => S.perfil && S.perfil.rol === 'gerencia';

// ---------- Utilidades ----------
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const aFecha = (t) => (t ? (t.toDate ? t.toDate() : new Date(t)) : null);
function hhmm(d) {
  return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
}
function diaClave(d) { return d.toLocaleDateString('es-CL', { timeZone: TZ }); }
function cuando(d) {
  if (!d) return '';
  const hoy = new Date();
  if (diaClave(d) === diaClave(hoy)) return hhmm(d);
  if (diaClave(d) === diaClave(new Date(hoy.getTime() + 24 * H))) return 'mañana ' + hhmm(d);
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', timeZone: TZ }) + ' ' + hhmm(d);
}
function dur(ms) {
  if (ms <= 0) return '0 min';
  const m = Math.round(ms / 60000);
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h} h${r ? ' ' + r + ' min' : ''}` : `${r} min`;
}
function nombreCorto(n) {
  const p = String(n || '').split(' ').filter(Boolean);
  return p.length >= 3 ? `${p[0]} ${p[1]} ${p[2][0]}.` : n;
}
function linkApp() { return location.origin + location.pathname; }
function abrirWhatsApp(texto) { window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank', 'noopener'); }
function errTexto(e) {
  const c = e && e.code ? e.code : '';
  const t = {
    'auth/invalid-credential': 'Correo o contraseña incorrectos.',
    'auth/invalid-email': 'El correo no es válido.',
    'auth/email-already-in-use': 'Ese correo ya tiene cuenta. Usa "Ingresar".',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
    'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos.',
    'auth/network-request-failed': 'Sin conexión. Revisa tu señal.',
    'permission-denied': 'No tienes permiso para esta acción.',
    'unavailable': 'Sin conexión. Se guardará al recuperar señal.'
  };
  return t[c] || (e && e.message) || 'Ocurrió un error.';
}

// Clasifica una respuesta según la hora actual.
function clasificar(r, ahora = Date.now()) {
  if (!r) return 'sr';
  if (r.estado === 'no' || r.e === 'no') return 'no';
  const hasta = aFecha(r.hasta ?? r.h);
  if (!hasta) return 'si';
  const resto = hasta.getTime() - ahora;
  if (resto <= 0) return 'vencida';
  return resto <= VENCE_PRONTO_MIN * 60000 ? 'vence' : 'si';
}

// ---------- Suscripciones ----------
function cortar(nombre) { if (subs[nombre]) { subs[nombre](); subs[nombre] = null; } }
function cortarTodo() { Object.keys(subs).forEach(cortar); llamadoId = null; }

function iniciarSesion() {
  cortarTodo();
  S.perfil = null; S.sinNomina = false; S.llamado = null; S.miResp = null; S.respuestas = {}; S.nomina = []; S.resumen = null;
  let rolActual = null;
  subs.perfil = onSnapshot(doc(db, 'nomina', S.email), async (snap) => {
    S.cargando = false;
    if (!snap.exists()) {
      S.perfil = null; S.sinNomina = true;
      ['llamados', 'miResp', 'respuestas', 'resumen', 'nomina'].forEach(cortar); llamadoId = null;
      try { S.bootstrapLibre = !(await getDoc(doc(db, 'config', 'inicial'))).exists(); } catch (e) { S.bootstrapLibre = false; }
      return render();
    }
    S.sinNomina = false;
    S.perfil = snap.data();
    if (!S.perfil.activo) {
      ['llamados', 'miResp', 'respuestas', 'resumen', 'nomina'].forEach(cortar); llamadoId = null;
      return render();
    }
    if (rolActual !== S.perfil.rol || !subs.llamados) {
      rolActual = S.perfil.rol;
      ['llamados', 'miResp', 'respuestas', 'resumen', 'nomina'].forEach(cortar); llamadoId = null;
      escucharLlamados();
      if (esLider()) escucharNomina();
      if (S.tab !== 'estado' && !tabsDisponibles().some((t) => t.id === S.tab)) S.tab = 'estado';
    }
    render();
  }, (e) => { S.err = errTexto(e); S.cargando = false; render(); });
}

function escucharLlamados() {
  const q = query(collection(db, 'llamados'), where('abierto', '==', true));
  subs.llamados = onSnapshot(q, (qs) => {
    let ultimo = null;
    qs.forEach((d) => {
      const data = { id: d.id, ...d.data() };
      if (!ultimo || (aFecha(data.creadoEn)?.getTime() || 0) > (aFecha(ultimo.creadoEn)?.getTime() || 0)) ultimo = data;
    });
    S.llamado = ultimo;
    const nuevoId = ultimo ? ultimo.id : null;
    if (nuevoId !== llamadoId) {
      llamadoId = nuevoId;
      cortar('miResp'); cortar('respuestas'); cortar('resumen');
      S.miResp = null; S.respuestas = {}; S.resumen = null; S.paso = null;
      if (llamadoId) {
        subs.miResp = onSnapshot(doc(db, 'llamados', llamadoId, 'respuestas', S.email),
          (s) => { S.miResp = s.exists() ? s.data() : null; render(); }, () => {});
        if (esLider()) {
          subs.respuestas = onSnapshot(collection(db, 'llamados', llamadoId, 'respuestas'), (qs2) => {
            const m = {}; qs2.forEach((d) => { m[d.id] = d.data(); }); S.respuestas = m; render();
          }, () => {});
        }
        if (esGerencia() || esLider()) {
          subs.resumen = onSnapshot(doc(db, 'llamados', llamadoId, 'resumen', 'actual'),
            (s) => { S.resumen = s.exists() ? s.data() : null; render(); }, () => {});
        }
      }
    }
    render();
  }, (e) => { S.err = errTexto(e); render(); });
}

function escucharNomina() {
  subs.nomina = onSnapshot(collection(db, 'nomina'), (qs) => {
    const l = []; qs.forEach((d) => l.push({ email: d.id, ...d.data() }));
    l.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    S.nomina = l; render();
  }, () => {});
}

// ---------- Acciones ----------
async function accion(fn) {
  if (S.ocupado) return;
  S.ocupado = true; S.err = ''; S.msg = ''; render();
  try { await fn(); } catch (e) { S.err = errTexto(e); }
  S.ocupado = false; render();
}

async function guardarRespuesta({ estado, hasta = null, eta = null }) {
  const id = S.llamado.id;
  const b = writeBatch(db);
  const hastaTs = hasta ? Timestamp.fromDate(hasta) : null;
  const etaTs = eta ? Timestamp.fromDate(eta) : null;
  b.set(doc(db, 'llamados', id, 'respuestas', S.email), { estado, hasta: hastaTs, eta: etaTs, en: serverTimestamp() });
  b.update(doc(db, 'llamados', id, 'resumen', 'actual'), { ['r.' + auth.currentUser.uid]: { e: estado, h: hastaTs, t: etaTs } });
  await b.commit();
  S.paso = null;
}

function mensajeLlamado(l) {
  const t = aFecha(l.creadoEn) || new Date();
  return `URAC · FASE DE ${FASES[l.fase]} (${NIVELES[l.nivel]}) · ${hhmm(t)}\n${l.descripcion}\nReporta tu disponibilidad aquí: ${linkApp()}`;
}

async function abrirLlamado() {
  const desc = S.f.desc.trim();
  if (!desc) { S.err = 'Escribe una descripción breve.'; return; }
  const ahora = new Date();
  const total = S.nomina.filter((n) => n.activo).length;
  const b = writeBatch(db);
  if (S.llamado) b.update(doc(db, 'llamados', S.llamado.id), { abierto: false, cerradoEn: serverTimestamp(), cerradoPor: S.email });
  const ref = doc(collection(db, 'llamados'));
  const plazo = (S.f.nivel === 'sno' && S.f.fase === 'alerta') ? Timestamp.fromDate(new Date(ahora.getTime() + PLAZO_SNO_H * H)) : null;
  const datos = { abierto: true, fase: S.f.fase, nivel: S.f.nivel, descripcion: desc, total,
    plazoSNO: plazo, creadoEn: serverTimestamp(), creadoPor: S.email };
  b.set(ref, datos);
  b.set(doc(db, 'llamados', ref.id, 'resumen', 'actual'), { r: {} });
  await b.commit();
  S.f.desc = ''; S.tab = 'tablero';
  S.msg = 'Llamado abierto. Compártelo ahora en el grupo de WhatsApp.';
  abrirWhatsApp(mensajeLlamado({ ...datos, creadoEn: ahora }));
}

async function cambiarFase(fase) {
  const l = S.llamado;
  if (!l || l.fase === fase) return;
  if (!confirm(`¿Pasar el llamado a FASE DE ${FASES[fase]}?`)) return;
  const cambios = { fase, faseEn: serverTimestamp() };
  if (fase === 'alerta' && l.nivel === 'sno' && !l.plazoSNO) cambios.plazoSNO = Timestamp.fromDate(new Date(Date.now() + PLAZO_SNO_H * H));
  await updateDoc(doc(db, 'llamados', l.id), cambios);
  S.msg = `Fase cambiada a ${FASES[fase]}. Avisa por radio 5-1 y WhatsApp.`;
  abrirWhatsApp(mensajeLlamado({ ...l, fase }));
}

async function cerrarLlamado() {
  if (!confirm('¿Cerrar el llamado? Los integrantes dejarán de verlo.')) return;
  await updateDoc(doc(db, 'llamados', S.llamado.id), { abierto: false, cerradoEn: serverTimestamp(), cerradoPor: S.email });
  S.msg = 'Llamado cerrado.';
}

async function guardarIntegrante() {
  const email = S.f.nEmail.trim().toLowerCase();
  const nombre = S.f.nNombre.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { S.err = 'Escribe un correo válido.'; return; }
  if (!nombre) { S.err = 'Escribe el nombre.'; return; }
  const b = writeBatch(db);
  b.set(doc(db, 'nomina', email), { nombre, cargo: S.f.nCargo, rol: S.f.nRol, activo: true });
  await b.commit();
  S.msg = `${nombre} agregado. Debe crear su cuenta en la app con ${email}.`;
  S.f.nEmail = ''; S.f.nNombre = ''; S.f.nCargo = 'Operador de Rescate'; S.f.nRol = 'rescatista';
}

async function configurarAdmin() {
  const nombre = S.f.nombre.trim();
  if (!nombre) { S.err = 'Escribe tu nombre.'; return; }
  const b = writeBatch(db);
  b.set(doc(db, 'nomina', S.email), { nombre, cargo: 'Administrador', rol: 'admin', activo: true });
  b.set(doc(db, 'config', 'inicial'), { por: S.email, en: serverTimestamp() });
  await b.commit();
}

// ---------- Vistas ----------
function encabezado() {
  const p = S.perfil;
  return `<header class="top">
    <div class="marca">${ESCUDO}<div><b>URAC</b><small>Disponibilidad</small></div></div>
    ${p ? `<div class="quien">${esc(nombreCorto(p.nombre))}<small>${esc(ROLES[p.rol] || '')}</small></div>` : ''}
  </header>`;
}

function tabsDisponibles() {
  const t = [{ id: 'estado', txt: 'Mi estado' }];
  if (esLider()) t.push({ id: 'tablero', txt: 'Tablero' }, { id: 'nomina', txt: 'Nómina' });
  else if (esGerencia()) t.push({ id: 'resumen', txt: 'Resumen' });
  return t;
}

function pestanas() {
  const t = tabsDisponibles();
  if (t.length < 2) return '';
  return `<nav class="tabs" aria-label="Secciones">${t.map((x) =>
    `<button data-act="tab" data-v="${x.id}" class="${S.tab === x.id ? 'on' : ''}" aria-current="${S.tab === x.id ? 'page' : 'false'}">${x.txt}</button>`).join('')}</nav>`;
}

function banda(l, conPlazo = true) {
  const t = aFecha(l.creadoEn);
  const plazo = aFecha(l.plazoSNO);
  let linea = `Abierto ${t ? hhmm(t) : '…'}`;
  if (conPlazo && plazo && l.fase === 'alerta') {
    const resto = plazo.getTime() - Date.now();
    linea += resto > 0 ? ` · Reporte al SNO en ${dur(resto)} (${hhmm(plazo)})` : ' · Plazo de reporte al SNO cumplido';
  }
  return `<section class="fase fase-${l.fase}">
    <div class="fila"><h2>FASE DE ${FASES[l.fase]}</h2><span class="nivel">${esc(NIVELES[l.nivel].toUpperCase())}</span></div>
    <p>${esc(l.descripcion)}</p>
    <small>${linea}</small>
  </section>`;
}

function avisos() {
  return `${S.err ? `<p class="error" role="alert">${esc(S.err)}</p>` : ''}${S.msg ? `<p class="ok-msg">${esc(S.msg)}</p>` : ''}`;
}

function pie() { return '<footer>Esta app no reemplaza el aviso por radio frecuencia 5-1.</footer>'; }

function vistaSinConfig() {
  return `${encabezado()}<main><h3>Falta conectar la base de datos</h3>
    <p class="suave">Pega el bloque firebaseConfig del proyecto en el archivo config.js.</p></main>`;
}

function vistaLogin() {
  return `${encabezado()}<main>
    <h3>Ingresar</h3>
    <div class="campo"><label for="email">Correo</label><input id="email" type="email" autocomplete="email" inputmode="email" data-bind="email" value="${esc(S.f.email)}"></div>
    <div class="campo"><label for="clave">Contraseña</label><input id="clave" type="password" autocomplete="current-password" data-bind="clave" value="${esc(S.f.clave)}"></div>
    ${avisos()}
    <button class="principal" data-act="ingresar" ${S.ocupado ? 'disabled' : ''}>INGRESAR</button>
    <button class="contorno" data-act="crear" ${S.ocupado ? 'disabled' : ''}>CREAR MI CUENTA</button>
    <button class="enlace" data-act="olvide">Olvidé mi contraseña</button>
    <p class="suave">Usa el mismo correo que entregaste al Líder de la Unidad.</p>
  </main>${pie()}`;
}

function vistaVerificar() {
  return `${encabezado()}<main>
    <h3>Confirma tu correo</h3>
    <p>Te enviamos un enlace a <b>${esc(S.email)}</b>. Ábrelo (revisa también Spam) y luego vuelve aquí.</p>
    ${avisos()}
    <button class="principal" data-act="yaVerifique">YA CONFIRMÉ MI CORREO</button>
    <button class="contorno" data-act="reenviar">REENVIAR CORREO</button>
    <button class="enlace" data-act="salir">Salir</button>
  </main>`;
}

function vistaSinNomina() {
  if (S.bootstrapLibre) {
    return `${encabezado()}<main>
      <h3>Configuración inicial</h3>
      <p>Aún no hay administrador. Si eres quien está instalando el sistema, regístrate como <b>Administrador</b>. Esto solo se puede hacer una vez.</p>
      <div class="campo"><label for="nombre">Tu nombre completo</label><input id="nombre" list="nombres" data-bind="nombre" value="${esc(S.f.nombre)}"></div>
      <datalist id="nombres">${NOMBRES.map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>
      ${avisos()}
      <button class="principal" data-act="configAdmin" ${S.ocupado ? 'disabled' : ''}>SOY EL ADMINISTRADOR</button>
      <button class="enlace" data-act="salir">Salir</button>
    </main>`;
  }
  return `${encabezado()}<main>
    <h3>Correo no registrado</h3>
    <p><b>${esc(S.email)}</b> no está en la nómina URAC. Pide al Líder de la Unidad que te agregue con este correo exacto.</p>
    <button class="enlace" data-act="salir">Salir</button>
  </main>`;
}

function vistaInactivo() {
  return `${encabezado()}<main><h3>Cuenta desactivada</h3>
    <p>Tu ficha está desactivada en la nómina URAC. Consulta con el Líder de la Unidad.</p>
    <button class="enlace" data-act="salir">Salir</button></main>`;
}

// --- Mi estado (todos) ---
function vistaEstado() {
  const l = S.llamado;
  if (!l) {
    return `<main>
      <div class="estado" style="background: var(--panel)"><b style="font-size:32px">SIN LLAMADOS ACTIVOS</b>
      <small>Fase de preparación. Te avisaremos por radio 5-1 y por el grupo de WhatsApp.</small></div>
      ${avisos()}
      ${esLider() ? '<button class="principal" data-act="tab" data-v="abrir">ABRIR LLAMADO</button>' : ''}
      <div class="hueco"></div><button class="enlace" data-act="salir">Cerrar sesión</button>
    </main>`;
  }
  const r = S.miResp;
  let cuerpo = '';
  if (S.paso === 'tiempo') {
    cuerpo = `<h3>¿Hasta cuándo puedes estar disponible?</h3>
      <div class="opciones">
        <button class="opcion" data-act="horas" data-v="2">2 h</button>
        <button class="opcion" data-act="horas" data-v="4">4 h</button>
        <button class="opcion" data-act="horas" data-v="8">8 h</button>
        <button class="opcion" data-act="horas" data-v="24">24 h</button>
        <button class="opcion ancha" data-act="horas" data-v="0">HASTA NUEVO AVISO</button>
      </div>
      <button class="neutro" data-act="paso" data-v="hora">Elegir una hora exacta</button>
      <button class="enlace" data-act="paso" data-v="">Volver</button>`;
  } else if (S.paso === 'hora') {
    cuerpo = `<h3>Disponible hasta las…</h3>
      <div class="campo"><label for="hora">Hora</label><input id="hora" type="time" data-bind="hora" value="${esc(S.f.hora)}"></div>
      <p class="suave">Si la hora ya pasó hoy, se entiende que es mañana.</p>
      <button class="principal" data-act="horaExacta" ${S.ocupado ? 'disabled' : ''}>CONFIRMAR</button>
      <button class="enlace" data-act="paso" data-v="tiempo">Volver</button>`;
  } else if (S.paso === 'eta') {
    cuerpo = etaPregunta();
  } else if (r && S.paso !== 'cambiar') {
    const c = clasificar(r);
    const en = aFecha(r.en);
    if (c === 'no') {
      cuerpo = `<div class="estado no"><b>NO DISPONIBLE</b><small>El Líder verá que no puedes concurrir en este llamado.</small></div>`;
    } else if (c === 'vencida') {
      cuerpo = `<div class="estado" style="background: var(--gris)"><b>DISPONIBILIDAD VENCIDA</b>
        <small>Venció a las ${hhmm(aFecha(r.hasta))}. Actualiza tu estado.</small></div>`;
    } else {
      const hasta = aFecha(r.hasta);
      cuerpo = `<div class="estado si"><b>DISPONIBLE</b>
        <span>${hasta ? 'Hasta ' + cuando(hasta) : 'Hasta nuevo aviso'}</span>
        <small>${hasta ? 'Vence en ' + dur(hasta.getTime() - Date.now()) + ' · luego dejas de contar como disponible' : 'Sigues disponible hasta que cambies tu estado'}</small>
        ${r.eta ? `<small>Llegada estimada al Cuartel: ${hhmm(aFecha(r.eta))}</small>` : ''}</div>`;
      if (l.fase === 'movilizacion' && !r.eta) cuerpo += etaPregunta();
    }
    cuerpo = `<p class="suave">Registrado ${en ? 'a las ' + hhmm(en) : ''}</p>${cuerpo}
      <button class="contorno" data-act="paso" data-v="cambiar">CAMBIAR MI ESTADO</button>`;
  } else {
    cuerpo = `<h3>¿Estás disponible?</h3>
      <button class="gigante si" data-act="disponible" ${S.ocupado ? 'disabled' : ''}>DISPONIBLE</button>
      <button class="gigante no" data-act="noDisponible" ${S.ocupado ? 'disabled' : ''}>NO DISPONIBLE</button>
      ${S.paso === 'cambiar' ? '<button class="enlace" data-act="paso" data-v="">Volver</button>' : ''}`;
  }
  return `${banda(l)}<main>${avisos()}${cuerpo}
    ${l.fase !== 'movilizacion' ? '<p class="suave">Si la fase pasa a Movilización, te pediremos tu hora estimada de llegada al Cuartel General.</p>' : ''}
    <div class="hueco"></div><button class="enlace" data-act="salir">Cerrar sesión</button></main>`;
}

function etaPregunta() {
  return `<div class="caja"><h3>¿En cuánto llegas al Cuartel General?</h3>
    <p class="suave">Plazo máximo del procedimiento: 2 horas desde el aviso.</p>
    <div class="opciones">
      <button class="opcion" data-act="eta" data-v="30">30 min</button>
      <button class="opcion" data-act="eta" data-v="60">1 h</button>
      <button class="opcion" data-act="eta" data-v="90">1 h 30</button>
      <button class="opcion" data-act="eta" data-v="120">2 h</button>
    </div></div>`;
}

// --- Abrir llamado (Líder) ---
function vistaAbrir() {
  const seg = (campo, opciones, clase) => `<div class="tres seg">${Object.entries(opciones).map(([k, v]) =>
    `<button data-act="set" data-k="${campo}" data-v="${k}" class="${S.f[campo] === k ? 'on' : ''} ${clase ? clase + k : ''}" aria-pressed="${S.f[campo] === k}">${v}</button>`).join('')}</div>`;
  const plazo = S.f.nivel === 'sno' && S.f.fase === 'alerta';
  return `<main>
    <h3>Nuevo llamado</h3>
    ${S.llamado ? '<p class="aviso">Hay un llamado abierto. Al abrir uno nuevo, el anterior se cerrará.</p>' : ''}
    <div><label>Fase</label>${seg('fase', FASES, 'f-')}</div>
    <div><label>Nivel</label>${seg('nivel', NIVELES)}</div>
    <div class="campo"><label for="desc">Descripción breve</label>
      <textarea id="desc" rows="3" data-bind="desc" placeholder="Ej.: Búsqueda de persona desaparecida, sector cordillerano.">${esc(S.f.desc)}</textarea></div>
    ${plazo ? `<p class="suave">Se marcará el plazo de ${PLAZO_SNO_H} h para reportar disponibilidad al SNO.</p>` : ''}
    ${avisos()}
    <button class="principal" data-act="abrirLlamado" ${S.ocupado ? 'disabled' : ''}>ABRIR LLAMADO</button>
    <p class="suave">Al abrir, se preparará el mensaje para el grupo de WhatsApp. El aviso por radio 5-1 se mantiene.</p>
    <button class="enlace" data-act="tab" data-v="${S.llamado ? 'tablero' : 'estado'}">Cancelar</button>
  </main>`;
}

// --- Tablero (Líder) ---
function filasTablero() {
  const ahora = Date.now();
  return S.nomina.filter((n) => n.activo).map((n) => {
    const r = S.respuestas[n.email];
    const c = clasificar(r, ahora);
    return { ...n, r, c };
  });
}

function contar(filas) {
  const k = { si: 0, no: 0, sr: 0 };
  filas.forEach((f) => { if (f.c === 'si' || f.c === 'vence') k.si++; else if (f.c === 'no') k.no++; else k.sr++; });
  return k;
}

function cordadaHtml(n) {
  const ok = n >= CORDADA_MIN;
  return `<div class="cordada ${ok ? 'ok' : 'falta'}">${ok ? CHECK : EQUIS}
    <span>${ok ? `Cordada mínima (${CORDADA_MIN}) alcanzada${n > CORDADA_MIN ? ' · ' + n + ' disponibles' : ''}` : `Faltan ${CORDADA_MIN - n} para la cordada mínima (${CORDADA_MIN})`}</span></div>`;
}

function vistaTablero() {
  const l = S.llamado;
  if (!l) return vistaAbrir();
  const filas = filasTablero();
  const k = contar(filas);
  const PILL = { si: ['p-si', 'DISPONIBLE'], vence: ['p-vence', 'VENCE PRONTO'], no: ['p-no', 'NO DISPONIBLE'], sr: ['p-sr', 'SIN RESPUESTA'], vencida: ['p-sr', 'VENCIDA'] };
  const orden = { si: 0, vence: 1, no: 2, vencida: 3, sr: 4 };
  let lista = filas.filter((f) => S.filtro === 'todos'
    || (S.filtro === 'si' && (f.c === 'si' || f.c === 'vence'))
    || (S.filtro === 'no' && f.c === 'no')
    || (S.filtro === 'sr' && (f.c === 'sr' || f.c === 'vencida')));
  lista.sort((a, b) => {
    if (l.fase === 'movilizacion' && a.r?.eta && b.r?.eta) return aFecha(a.r.eta) - aFecha(b.r.eta);
    return orden[a.c] - orden[b.c] || a.nombre.localeCompare(b.nombre, 'es');
  });
  const detalle = (f) => {
    if (!f.r) return '—';
    if (f.c === 'no') return 'resp. ' + (aFecha(f.r.en) ? hhmm(aFecha(f.r.en)) : '');
    const h = aFecha(f.r.hasta);
    let t = f.c === 'vencida' ? 'venció ' + hhmm(h) : (h ? 'hasta ' + cuando(h) : 'hasta nuevo aviso');
    if (f.r.eta) t += ' · llega ' + hhmm(aFecha(f.r.eta));
    return t;
  };
  const sinResp = filas.filter((f) => f.c === 'sr' || f.c === 'vencida');
  const fil = (id, txt) => `<button data-act="filtro" data-v="${id}" class="${S.filtro === id ? 'on' : ''}" aria-pressed="${S.filtro === id}">${txt}</button>`;
  const otrasFases = Object.keys(FASES).filter((f) => f !== l.fase);
  return `${banda(l)}<main>
    ${avisos()}
    <div class="tres">
      <div class="cont si"><b>${k.si}</b><span>Disponibles</span></div>
      <div class="cont no"><b>${k.no}</b><span>No disponibles</span></div>
      <div class="cont gris"><b>${k.sr}</b><span>Sin respuesta</span></div>
    </div>
    ${cordadaHtml(k.si)}
    <div class="filtros" role="group" aria-label="Filtro">${fil('todos', 'Todos ' + filas.length)}${fil('si', 'Disp.')}${fil('no', 'No disp.')}${fil('sr', 'Sin resp.')}</div>
    <ul class="lista">${lista.map((f) => `<li>
      <div><div class="nom">${esc(nombreCorto(f.nombre))}</div><small>${esc(f.cargo)}</small></div>
      <div class="der"><span class="pill ${PILL[f.c][0]}">${PILL[f.c][1]}</span><small>${esc(detalle(f))}</small></div>
    </li>`).join('') || '<li><span class="suave">Nadie en este filtro.</span></li>'}</ul>
    <button class="contorno" data-act="compartir">COMPARTIR LLAMADO (WHATSAPP)</button>
    ${sinResp.length ? `<button class="contorno" data-act="recordar">RECORDAR A LOS ${sinResp.length} SIN RESPUESTA</button>` : ''}
    <label>Cambiar fase</label>
    <div class="dos">${otrasFases.map((f) => `<button class="${f === 'movilizacion' ? 'peligro' : 'neutro'}" data-act="fase" data-v="${f}" ${S.ocupado ? 'disabled' : ''}>PASAR A ${FASES[f]}</button>`).join('')}</div>
    <div class="dos"><button class="neutro" data-act="tab" data-v="abrir">NUEVO LLAMADO</button>
      <button class="neutro" data-act="cerrar" ${S.ocupado ? 'disabled' : ''}>CERRAR LLAMADO</button></div>
  </main>`;
}

// --- Resumen (Gerencia): solo totales ---
function vistaResumen() {
  const l = S.llamado;
  if (!l) return `<main><div class="estado" style="background: var(--panel)"><b style="font-size:32px">SIN LLAMADOS ACTIVOS</b><small>Fase de preparación.</small></div></main>`;
  const entradas = Object.values((S.resumen && S.resumen.r) || {});
  const ahora = Date.now();
  let si = 0, no = 0;
  const vig = { 2: 0, 6: 0, 12: 0 };
  entradas.forEach((e) => {
    const c = clasificar(e, ahora);
    if (c === 'si' || c === 'vence') {
      si++;
      const h = aFecha(e.h);
      [2, 6, 12].forEach((x) => { if (!h || h.getTime() > ahora + x * H) vig[x]++; });
    } else if (c === 'no') no++;
  });
  const total = l.total || entradas.length;
  const sr = Math.max(total - si - no, 0);
  return `${banda(l)}<main>
    <div class="grande si"><b>${si}</b><span>rescatistas disponibles de ${total}</span></div>
    <div class="dos"><div class="cont no"><b>${no}</b><span>No disponibles</span></div>
      <div class="cont gris"><b>${sr}</b><span>Sin respuesta</span></div></div>
    <div class="barra" role="img" aria-label="${si} disponibles, ${no} no disponibles, ${sr} sin respuesta">
      <div style="flex:${si}; background: var(--verde)"></div><div style="flex:${no}; background: var(--rojo)"></div><div style="flex:${sr}; background:#3A3A3A"></div></div>
    ${cordadaHtml(si)}
    <label>Disponibles que siguen vigentes</label>
    <div class="tres">${[2, 6, 12].map((x) => `<div class="cont panel"><b>${vig[x]}</b><span>en ${x} h</span></div>`).join('')}</div>
    <p class="suave">Se actualiza solo. El detalle por nombre lo ve el Líder de la Unidad.</p>
  </main>`;
}

// --- Nómina (Líder/Administrador) ---
function vistaNomina() {
  const activos = S.nomina.filter((n) => n.activo).length;
  return `<main>
    <h3>Agregar integrante</h3>
    <div class="campo"><label for="nNombre">Nombre</label><input id="nNombre" list="nombres" data-bind="nNombre" value="${esc(S.f.nNombre)}"></div>
    <datalist id="nombres">${NOMBRES.filter((n) => !S.nomina.some((x) => x.nombre === n)).map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>
    <div class="campo"><label for="nEmail">Correo (con el que creará su cuenta)</label><input id="nEmail" type="email" inputmode="email" data-bind="nEmail" value="${esc(S.f.nEmail)}"></div>
    <div class="dos">
      <div class="campo"><label for="nCargo">Cargo</label><select id="nCargo" data-bind="nCargo">${CARGOS.map((c) => `<option ${S.f.nCargo === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="campo"><label for="nRol">Perfil en la app</label><select id="nRol" data-bind="nRol">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${S.f.nRol === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    </div>
    ${avisos()}
    <button class="principal" data-act="agregar" ${S.ocupado ? 'disabled' : ''}>AGREGAR</button>
    <h3>Nómina (${activos} activos)</h3>
    <ul class="lista">${S.nomina.map((n) => `<li>
      <div><div class="nom" style="${n.activo ? '' : 'color: var(--texto-suave); text-decoration: line-through'}">${esc(n.nombre)}</div><small>${esc(n.cargo)} · ${esc(n.email)}</small></div>
      <div class="der">
        <label class="suave" for="rol-${esc(n.email)}" style="position:absolute;left:-9999px">Perfil de ${esc(n.nombre)}</label>
        <select id="rol-${esc(n.email)}" data-act-change="rol" data-email="${esc(n.email)}" style="min-height:44px; padding:6px; width:auto">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${n.rol === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button class="enlace" data-act="activo" data-email="${esc(n.email)}">${n.activo ? 'Desactivar' : 'Activar'}</button>
      </div></li>`).join('')}</ul>
  </main>`;
}

// ---------- Render ----------
let renderPendiente = false;
function render() {
  const a = document.activeElement;
  if (a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) && $app.contains(a)) { renderPendiente = true; return; }
  renderPendiente = false;
  let html;
  if (!configurado) html = vistaSinConfig();
  else if (S.cargando) html = `${encabezado()}<main><p class="suave">Cargando…</p></main>`;
  else if (!S.user) html = vistaLogin();
  else if (!S.user.emailVerified) html = vistaVerificar();
  else if (S.sinNomina) html = vistaSinNomina();
  else if (!S.perfil) html = `${encabezado()}<main><p class="suave">Cargando…</p>${avisos()}</main>`;
  else if (!S.perfil.activo) html = vistaInactivo();
  else {
    let vista;
    if (S.tab === 'tablero' && esLider()) vista = vistaTablero();
    else if (S.tab === 'abrir' && esLider()) vista = vistaAbrir();
    else if (S.tab === 'nomina' && esLider()) vista = vistaNomina();
    else if (S.tab === 'resumen' && esGerencia()) vista = vistaResumen();
    else vista = vistaEstado();
    html = encabezado() + pestanas() + vista + (S.tab === 'estado' ? pie() : '');
  }
  $app.innerHTML = html;
}

// ---------- Eventos ----------
$app.addEventListener('input', (e) => {
  const k = e.target.dataset.bind;
  if (k) {
    S.f[k] = e.target.value;
    if (k === 'nNombre' && SUGERIDO[e.target.value]) {
      S.f.nCargo = SUGERIDO[e.target.value].cargo; S.f.nRol = SUGERIDO[e.target.value].rol;
      const c = document.getElementById('nCargo'); const r = document.getElementById('nRol');
      if (c) c.value = S.f.nCargo; if (r) r.value = S.f.nRol;
    }
  }
});
$app.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.bind) S.f[t.dataset.bind] = t.value;
  if (t.dataset.actChange === 'rol') {
    const email = t.dataset.email;
    accion(() => updateDoc(doc(db, 'nomina', email), { rol: t.value }));
  }
});
// Si llegó un cambio mientras se escribía, se dibuja al salir del campo (con margen para no perder un toque).
$app.addEventListener('focusout', () => { setTimeout(() => { if (renderPendiente) render(); }, 350); });

$app.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const act = b.dataset.act; const v = b.dataset.v;
  switch (act) {
    case 'tab': S.tab = v; S.err = ''; S.msg = ''; render(); break;
    case 'set': S.f[b.dataset.k] = v; render(); break;
    case 'paso': S.paso = v || null; S.err = ''; render(); break;
    case 'filtro': S.filtro = v; render(); break;
    case 'ingresar': accion(() => signInWithEmailAndPassword(auth, S.f.email.trim().toLowerCase(), S.f.clave)); break;
    case 'crear': accion(async () => {
      const c = await createUserWithEmailAndPassword(auth, S.f.email.trim().toLowerCase(), S.f.clave);
      await sendEmailVerification(c.user);
    }); break;
    case 'olvide': accion(async () => {
      if (!S.f.email.trim()) throw new Error('Escribe tu correo arriba y vuelve a tocar "Olvidé mi contraseña".');
      await sendPasswordResetEmail(auth, S.f.email.trim().toLowerCase());
      S.msg = 'Te enviamos un correo para crear una nueva contraseña.';
    }); break;
    case 'reenviar': accion(async () => { await sendEmailVerification(auth.currentUser); S.msg = 'Correo reenviado.'; }); break;
    case 'yaVerifique': accion(async () => {
      await auth.currentUser.reload(); await auth.currentUser.getIdToken(true);
      S.user = auth.currentUser;
      if (S.user.emailVerified) { S.cargando = true; iniciarSesion(); } else S.err = 'Aún no aparece confirmado. Abre el enlace del correo e inténtalo de nuevo.';
    }); break;
    case 'salir': cortarTodo(); signOut(auth); break;
    case 'configAdmin': accion(configurarAdmin); break;
    case 'disponible': S.paso = 'tiempo'; render(); break;
    case 'noDisponible': accion(() => guardarRespuesta({ estado: 'no' })); break;
    case 'horas': accion(async () => {
      const h = Number(v);
      await guardarRespuesta({ estado: 'si', hasta: h ? new Date(Date.now() + h * H) : null, eta: S.miResp?.eta ? aFecha(S.miResp.eta) : null });
    }); break;
    case 'horaExacta': accion(async () => {
      if (!S.f.hora) throw new Error('Elige una hora.');
      const [hh, mm] = S.f.hora.split(':').map(Number);
      const d = new Date(); d.setHours(hh, mm, 0, 0);
      if (d.getTime() <= Date.now()) d.setTime(d.getTime() + 24 * H);
      await guardarRespuesta({ estado: 'si', hasta: d, eta: S.miResp?.eta ? aFecha(S.miResp.eta) : null });
    }); break;
    case 'eta': accion(async () => {
      const r = S.miResp;
      await guardarRespuesta({ estado: 'si', hasta: aFecha(r?.hasta), eta: new Date(Date.now() + Number(v) * 60000) });
    }); break;
    case 'abrirLlamado': accion(abrirLlamado); break;
    case 'fase': accion(() => cambiarFase(v)); break;
    case 'cerrar': accion(cerrarLlamado); break;
    case 'compartir': abrirWhatsApp(mensajeLlamado(S.llamado)); break;
    case 'recordar': {
      const faltan = filasTablero().filter((f) => f.c === 'sr' || f.c === 'vencida').map((f) => nombreCorto(f.nombre));
      abrirWhatsApp(`URAC · Recordatorio FASE DE ${FASES[S.llamado.fase]}: falta reportar disponibilidad de ${faltan.join(', ')}.\nResponder aquí: ${linkApp()}`);
      break;
    }
    case 'agregar': accion(guardarIntegrante); break;
    case 'activo': {
      const n = S.nomina.find((x) => x.email === b.dataset.email);
      if (n) accion(() => updateDoc(doc(db, 'nomina', n.email), { activo: !n.activo }));
      break;
    }
  }
});

// Refresca cuentas regresivas y vencimientos cada 30 s.
setInterval(() => { if (S.user && S.perfil) render(); }, 30000);

// ---------- Inicio ----------
if (!configurado) {
  S.cargando = false; render();
} else {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  auth.languageCode = 'es';
  db = getFirestore(app);
  onAuthStateChanged(auth, (user) => {
    cortarTodo();
    S.user = user; S.err = ''; S.msg = ''; S.tab = 'estado'; S.paso = null;
    if (!user) { S.cargando = false; S.perfil = null; return render(); }
    S.email = (user.email || '').toLowerCase();
    if (!user.emailVerified) { S.cargando = false; return render(); }
    S.cargando = true; render();
    iniciarSesion();
  });
}
