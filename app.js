// URAC · Sistema de disponibilidad
// App web de una sola página. Firebase (plan Spark, sin costo): Authentication + Firestore.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, collection, query, where, onSnapshot, writeBatch,
  serverTimestamp, Timestamp, updateDoc, setDoc, getDocs, orderBy
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from './config.js';
import { NOMBRES, CARGOS, SUGERIDO, CATEGORIAS, CATEGORIA_LIBRE, CARGOS_UNICOS, CARGOS_GERENCIA, CARGOS_PUESTO_COMANDO } from './nomina.js';
import { SAN_BERNARDO, obtenerPronostico, buscarLugares, proximas24, proximos5 } from './clima.js';

// ---------- Constantes ----------
const TZ = 'America/Santiago';
const CORDADA_MIN = 6;
const PLAZO_SNO_H = 4;
const VENCE_PRONTO_MIN = 30;
const FASES = { monitoreo: 'MONITOREO', alerta: 'ALERTA', movilizacion: 'MOVILIZACIÓN', desmovilizacion: 'DESMOVILIZACIÓN' };
const FASES_APERTURA = { monitoreo: 'MONITOREO', alerta: 'ALERTA', movilizacion: 'MOVILIZACIÓN' };
const FASES_CLIMA = ['monitoreo', 'alerta', 'movilizacion'];
const NIVELES = { local: 'Local', regional: 'Regional', sno: 'SNO' };
// Perfil en la app que asigna el Líder. "Gerencia" ya no se elige: la da el cargo.
const ROLES = { rescatista: 'Rescatista', lider: 'Líder', admin: 'Administrador' };
const H = 3600 * 1000;
const LOGOS = '<img src="logo.png" alt="Escudo URAC" class="logo"><img src="cbsb.png" alt="Escudo Cuerpo de Bomberos de San Bernardo" class="logo">';
const CAT_NOMBRE = Object.fromEntries(CATEGORIAS.map((c) => [c.id, c.nombre]));
const NOMBRES_CORDADA = ['Alfa', 'Bravo', 'Charlie', 'Delta'];
const CHECK = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l5 5L20 6" fill="none" stroke="#3CCB6B" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const EQUIS = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="#FF8A80" stroke-width="3" stroke-linecap="round"/></svg>';

const $app = document.getElementById('app');
const configurado = !String(firebaseConfig.apiKey).startsWith('PEGAR');

// ---------- Estado ----------
const S = {
  cargando: true, user: null, email: '', perfil: null, sinNomina: false, bootstrapLibre: false,
  tab: 'estado', paso: null, filtro: 'todos',
  llamado: null, miResp: null, respuestas: {}, nomina: [], resumen: null, fotos: {},
  clima: { clave: '', datos: null, err: '', cargando: false, en: 0 }, lugares: [],
  mapa: null, cerrados: [], ultimoCerrado: null, informe: null, manual: { email: '', paso: null },
  imp: null,
  f: { email: '', clave: '', nombre: '', horaManual: '', impTexto: '', fase: 'alerta', nivel: 'local', desc: '', hora: '', lugarQ: '', lugar: null,
       nEmail: '', nNombre: '', nCargo: 'Operador de Rescate', nRol: 'rescatista', nCordada: '' },
  msg: '', err: '', ocupado: false
};

let app, auth, db;
let subs = { perfil: null, miFoto: null, llamados: null, miResp: null, respuestas: null, resumen: null, nomina: null, fotos: null, mapa: null, cerrados: null };
let llamadoId = null;

const esLider = () => S.perfil && ['lider', 'admin'].includes(S.perfil.rol);
const esGerencia = () => S.perfil && !['lider', 'admin'].includes(S.perfil.rol) && CARGOS_GERENCIA.includes(S.perfil.cargo);
// Etiqueta del perfil que se muestra (Gerencia sale del cargo).
function etiquetaPerfil(p) {
  if (!p) return '';
  if (p.rol === 'lider' || p.rol === 'admin') return ROLES[p.rol];
  return CARGOS_GERENCIA.includes(p.cargo) ? 'Gerencia' : 'Rescatista';
}
// Rol guardado: "gerencia" de versiones anteriores se trata como rescatista.
const rolSel = (r) => (r === 'lider' || r === 'admin') ? r : 'rescatista';
// Cargo de mando ya asignado a otra persona activa.
function cargoOcupado(cargo, emailPropio) {
  if (!CARGOS_UNICOS.includes(cargo)) return null;
  return S.nomina.find((n) => n.activo && n.cargo === cargo && n.email !== emailPropio) || null;
}
// El Administrador gestiona la cuenta y tiene las facultades del Líder, pero no integra la URAC:
// no responde disponibilidad ni cuenta en totales ni cordadas.
const esAdmin = () => S.perfil && S.perfil.rol === 'admin';
// Informe: Líder, Administrador, Jefe de Operaciones y Jefe de Planificación, en cualquier etapa.
const CARGOS_INFORME = ['Jefe de Operaciones', 'Jefe de Planificación'];
const puedeInforme = () => esLider() || (S.perfil && CARGOS_INFORME.includes(S.perfil.cargo));
// Edición de la Nómina: solo el Administrador y el Líder de Unidad (no el Jefe de Operaciones).
const puedeEditarNomina = () => esAdmin() || (esLider() && S.perfil.cargo === 'Líder de Unidad');
const integrantes = () => S.nomina.filter((n) => n.activo && n.rol !== 'admin');

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
  S.perfil = null; S.sinNomina = false; S.llamado = null; S.miResp = null; S.respuestas = {}; S.nomina = []; S.resumen = null; S.fotos = {};
  let rolActual = null;
  subs.miFoto = onSnapshot(doc(db, 'fotos', S.email), (s) => {
    if (s.exists()) S.fotos[S.email] = s.data().img; else delete S.fotos[S.email];
    render();
  }, () => {});
  subs.perfil = onSnapshot(doc(db, 'nomina', S.email), async (snap) => {
    S.cargando = false;
    if (!snap.exists()) {
      S.perfil = null; S.sinNomina = true;
      ['llamados', 'miResp', 'respuestas', 'resumen', 'nomina', 'fotos', 'mapa', 'cerrados'].forEach(cortar); llamadoId = null;
      try { S.bootstrapLibre = !(await getDoc(doc(db, 'config', 'inicial'))).exists(); } catch (e) { S.bootstrapLibre = false; }
      return render();
    }
    S.sinNomina = false;
    S.perfil = snap.data();
    if (!S.perfil.activo) {
      ['llamados', 'miResp', 'respuestas', 'resumen', 'nomina', 'fotos', 'mapa', 'cerrados'].forEach(cortar); llamadoId = null;
      return render();
    }
    if (rolActual !== S.perfil.rol + '|' + S.perfil.cargo || !subs.llamados) {
      rolActual = S.perfil.rol + '|' + S.perfil.cargo;
      ['llamados', 'miResp', 'respuestas', 'resumen', 'nomina', 'fotos', 'mapa', 'cerrados'].forEach(cortar); llamadoId = null;
      escucharLlamados();
      if (esLider()) escucharFotos();
      if (puedeInforme()) { escucharNomina(); escucharCerrados(); }
      if (!tabsDisponibles().some((t) => t.id === S.tab)) S.tab = tabsDisponibles()[0].id;
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
      cortar('miResp'); cortar('respuestas'); cortar('resumen'); cortar('mapa');
      S.miResp = null; S.respuestas = {}; S.resumen = null; S.mapa = null; S.paso = null;
      if (llamadoId) {
        subs.mapa = onSnapshot(doc(db, 'llamados', llamadoId, 'adjuntos', 'mapa'),
          (s) => { S.mapa = s.exists() ? s.data() : null; render(); }, () => {});
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

function escucharCerrados() {
  subs.cerrados = onSnapshot(query(collection(db, 'llamados'), where('abierto', '==', false)), (qs) => {
    const l = []; qs.forEach((d) => l.push({ id: d.id, ...d.data() }));
    l.sort((a, b) => (aFecha(b.cerradoEn)?.getTime() || 0) - (aFecha(a.cerradoEn)?.getTime() || 0));
    S.cerrados = l.slice(0, 15); render();
  }, () => {});
}

function escucharFotos() {
  subs.fotos = onSnapshot(collection(db, 'fotos'), (qs) => {
    const m = {}; qs.forEach((d) => { m[d.id] = d.data().img; });
    S.fotos = m; render();
  }, () => {});
}

// ---------- Clima ----------
function lugarClima() {
  const l = S.llamado;
  return (l && l.lugar && typeof l.lugar.lat === 'number') ? l.lugar : SAN_BERNARDO;
}
function asegurarClima() {
  const lugar = lugarClima();
  const clave = `${lugar.lat},${lugar.lon}`;
  const c = S.clima;
  if (c.cargando) return;
  if (c.clave === clave && (c.datos || c.err) && Date.now() - c.en < 30 * 60000) return;
  S.clima = { clave, datos: c.clave === clave ? c.datos : null, err: '', cargando: true, en: c.en };
  obtenerPronostico(lugar)
    .then((d) => { S.clima = { clave, datos: d, err: '', cargando: false, en: Date.now() }; })
    .catch(() => { S.clima = { clave, datos: null, err: 'No se pudo cargar el pronóstico. Revisa tu conexión.', cargando: false, en: Date.now() }; })
    .finally(render);
}

// ---------- Cordadas ----------
// Se arman solas, de 6 integrantes, en el orden en que se ponen disponibles.
// Si hay integrantes con perfil de cordada, se procura que cada cordada lleve uno de cada perfil;
// los cupos restantes se completan con los siguientes disponibles. La última puede quedar incompleta.
const TAM_CORDADA = 6;
const esPC = (cargo) => CARGOS_PUESTO_COMANDO.includes(cargo);
function armarCordadas(disponibles) {
  // Solo rescatistas: el Puesto de Comando no integra cordadas.
  const pool = disponibles.filter((x) => !esPC(x.cargo)).map((x, i) => ({ ...x, orden: i }));
  const cordadas = [];
  while (pool.length && cordadas.length < NOMBRES_CORDADA.length) {
    const miembros = [];
    CATEGORIAS.forEach((c) => {
      if (miembros.length >= TAM_CORDADA) return;
      const i = pool.findIndex((x) => x.cat === c.id);
      if (i >= 0) miembros.push(pool.splice(i, 1)[0]);
    });
    while (miembros.length < TAM_CORDADA && pool.length) miembros.push(pool.shift());
    miembros.sort((x, y) => x.orden - y.orden);
    cordadas.push({ nombre: NOMBRES_CORDADA[cordadas.length], miembros, completa: miembros.length === TAM_CORDADA });
  }
  return { cordadas, reserva: pool };
}

// ---------- Acciones ----------
async function accion(fn) {
  if (S.ocupado) return;
  S.ocupado = true; S.err = ''; S.msg = ''; render();
  try { await fn(); } catch (e) { S.err = errTexto(e); }
  S.ocupado = false; render();
}

// Registra un movimiento en la bitácora del llamado (base del informe).
function evento(b, id, tipo, fase, detalle) {
  b.set(doc(collection(db, 'llamados', id, 'eventos')), {
    tipo, fase, detalle: String(detalle || '').slice(0, 500), por: S.email, nombre: S.perfil.nombre, en: serverTimestamp()
  });
}

// Clave del integrante en el resumen de Gerencia (derivada del correo, sin símbolos).
const claveResumen = (email) => String(email).toLowerCase().replace(/[^a-z0-9]/g, '_');

// Guarda la disponibilidad. Sin "para", la del propio usuario; con "para" (ficha de la nómina),
// es un ingreso manual del Líder o Administrador en nombre de ese integrante.
async function guardarRespuesta({ estado, hasta = null, para = null }) {
  const id = S.llamado.id;
  const quien = para || { email: S.email, nombre: S.perfil.nombre, cordada: S.perfil.cordada, cargo: S.perfil.cargo };
  const b = writeBatch(db);
  const hastaTs = hasta ? Timestamp.fromDate(hasta) : null;
  const texto = estado === 'no' ? 'NO DISPONIBLE' : 'DISPONIBLE ' + (hasta ? 'hasta ' + cuando(hasta) : 'hasta nuevo aviso');
  b.set(doc(db, 'llamados', id, 'respuestas', quien.email), { estado, hasta: hastaTs, eta: null, en: serverTimestamp() });
  b.update(doc(db, 'llamados', id, 'resumen', 'actual'), { ['r.' + claveResumen(quien.email)]: { e: estado, h: hastaTs, t: null, c: quien.cordada || null, n: quien.nombre, g: quien.cargo || '' } });
  if (para) evento(b, id, 'manual', S.llamado.fase, `${quien.nombre}: ${texto}`);
  else evento(b, id, 'respuesta', S.llamado.fase, texto);
  await b.commit();
  S.paso = null;
  if (para) { S.msg = `Disponibilidad de ${nombreCorto(quien.nombre)} registrada: ${texto}.`; S.manual = { email: '', paso: null }; }
}

function fichaManual() {
  const n = integrantes().find((x) => x.email === S.manual.email);
  if (!n) throw new Error('Elige un integrante.');
  return { email: n.email, nombre: n.nombre, cordada: n.cordada || null, cargo: n.cargo || '' };
}

// Hora exacta elegida en un campo "HH:MM" (si ya pasó hoy, es mañana).
function horaDesde(valor) {
  if (!valor) throw new Error('Elige una hora.');
  const [hh, mm] = valor.split(':').map(Number);
  const d = new Date(); d.setHours(hh, mm, 0, 0);
  if (d.getTime() <= Date.now()) d.setTime(d.getTime() + 24 * H);
  return d;
}

function mensajeLlamado(l, cambioFase = false) {
  const t = cambioFase ? new Date() : (aFecha(l.creadoEn) || new Date());
  const pie = cambioFase
    ? `Si ya reportaste tu disponibilidad, se mantiene. Si no lo has hecho o cambió, actualízala aquí: ${linkApp()}`
    : `Reporta tu disponibilidad aquí: ${linkApp()}`;
  return `URAC · FASE DE ${FASES[l.fase]} (${NIVELES[l.nivel]}) · ${hhmm(t)}\n${l.descripcion}\n${pie}`;
}

async function abrirLlamado() {
  const desc = S.f.desc.trim();
  if (!desc) { S.err = 'Escribe una descripción breve.'; return; }
  const ahora = new Date();
  // Solo puede haber un llamado activo a la vez.
  if (S.llamado) throw new Error('Ya hay un incidente activo. Ciérralo antes de abrir otro.');
  const total = integrantes().length;
  const b = writeBatch(db);
  const ref = doc(collection(db, 'llamados'));
  const plazo = (S.f.nivel === 'sno' && S.f.fase === 'alerta') ? Timestamp.fromDate(new Date(ahora.getTime() + PLAZO_SNO_H * H)) : null;
  const lugar = S.f.lugar || SAN_BERNARDO;
  const datos = { abierto: true, fase: S.f.fase, nivel: S.f.nivel, descripcion: desc, total,
    lugar: { nombre: lugar.nombre, lat: lugar.lat, lon: lugar.lon },
    plazoSNO: plazo, creadoEn: serverTimestamp(), creadoPor: S.email };
  b.set(ref, datos);
  b.set(doc(db, 'llamados', ref.id, 'resumen', 'actual'), { r: {} });
  evento(b, ref.id, 'apertura', S.f.fase, `Nivel ${NIVELES[S.f.nivel]} · ${lugar.nombre} · ${desc}`);
  await b.commit();
  S.f.desc = ''; S.f.lugar = null; S.f.lugarQ = ''; S.lugares = []; S.tab = 'tablero';
  S.msg = 'Incidente abierto. Compártelo ahora en el grupo de WhatsApp.';
  abrirWhatsApp(mensajeLlamado({ ...datos, creadoEn: ahora }));
}

async function cambiarFase(fase) {
  const l = S.llamado;
  if (!l || l.fase === fase) return;
  if (!confirm(`¿Pasar el incidente a FASE DE ${FASES[fase]}?`)) return;
  const cambios = { fase, faseEn: serverTimestamp() };
  if (fase === 'alerta' && l.nivel === 'sno' && !l.plazoSNO) cambios.plazoSNO = Timestamp.fromDate(new Date(Date.now() + PLAZO_SNO_H * H));
  const b = writeBatch(db);
  b.update(doc(db, 'llamados', l.id), cambios);
  evento(b, l.id, 'fase', fase, `De ${FASES[l.fase]} a ${FASES[fase]}`);
  await b.commit();
}

async function cerrarLlamado() {
  if (!confirm('¿Cerrar el incidente? Los integrantes dejarán de verlo.')) return;
  const l = S.llamado;
  const b = writeBatch(db);
  b.update(doc(db, 'llamados', l.id), { abierto: false, cerradoEn: serverTimestamp(), cerradoPor: S.email });
  evento(b, l.id, 'cierre', l.fase, 'Incidente cerrado');
  await b.commit();
  S.ultimoCerrado = l.id; S.tab = 'tablero';
  S.msg = 'Incidente cerrado. Ya puedes generar el informe.';
}

// Imagen georreferencial del lugar (captura de mapa, croquis, etc.). Se reduce para caber en la base de datos.
async function subirMapa(archivo) {
  if (!archivo || !S.llamado) return;
  if (!archivo.type.startsWith('image/')) throw new Error('El archivo debe ser una imagen.');
  const bmp = await createImageBitmap(archivo);
  let escala = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  let url = '';
  for (let intento = 0; intento < 6; intento++) {
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * escala); c.height = Math.round(bmp.height * escala);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    url = c.toDataURL('image/jpeg', 0.72);
    if (url.length < 850000) break;
    escala *= 0.8;
  }
  if (url.length >= 850000) throw new Error('La imagen es demasiado grande. Prueba con una captura más pequeña.');
  const l = S.llamado;
  const b = writeBatch(db);
  b.set(doc(db, 'llamados', l.id, 'adjuntos', 'mapa'), { img: url, por: S.email, nombre: S.perfil.nombre, en: serverTimestamp() });
  evento(b, l.id, 'mapa', l.fase, 'Imagen georreferencial del lugar cargada');
  await b.commit();
  S.msg = 'Imagen del lugar publicada para todos los integrantes.';
}

// Elimina un llamado cerrado y todo su contenido (informe, bitácora, respuestas e imagen). No se puede deshacer.
async function eliminarInforme(id) {
  const c = S.cerrados.find((x) => x.id === id);
  if (!c) return;
  const a = aFecha(c.creadoEn);
  if (!confirm(`¿Eliminar el informe del incidente del ${a ? cuando(a) : ''}?\n\nSe borrará también su bitácora, respuestas e imagen. No se puede deshacer.`)) return;
  const refs = [];
  for (const sub of ['eventos', 'respuestas', 'resumen', 'adjuntos']) {
    const qs = await getDocs(collection(db, 'llamados', id, sub));
    qs.forEach((d) => refs.push(d.ref));
  }
  for (let i = 0; i < refs.length; i += 400) {
    const b = writeBatch(db);
    refs.slice(i, i + 400).forEach((r) => b.delete(r));
    await b.commit();
  }
  const b = writeBatch(db);
  b.delete(doc(db, 'llamados', id));
  await b.commit();
  if (S.ultimoCerrado === id) S.ultimoCerrado = null;
  S.msg = 'Informe eliminado.';
}

async function cargarInforme(id) {
  if (S.tab !== 'informe') S.tabPrevio = S.tab;
  S.informe = { cargando: true };
  S.tab = 'informe'; render();
  const ref = doc(db, 'llamados', id);
  const [ls, evs, rs, ms] = await Promise.all([
    getDoc(ref), getDocs(query(collection(db, 'llamados', id, 'eventos'), orderBy('en'))),
    getDocs(collection(db, 'llamados', id, 'respuestas')), getDoc(doc(db, 'llamados', id, 'adjuntos', 'mapa'))
  ]);
  const respuestas = {}; rs.forEach((d) => { respuestas[d.id] = d.data(); });
  const eventos = []; evs.forEach((d) => eventos.push(d.data()));
  S.informe = { cargando: false, l: { id, ...ls.data() }, eventos, respuestas, mapa: ms.exists() ? ms.data() : null, generado: new Date() };
}

// ---------- Importar nómina (pegar lista: Nombres;Apellidos;Correo, una persona por línea) ----------
function tituloNombre(t) {
  return String(t || '').trim().replace(/\s+/g, ' ').toLowerCase().split(' ')
    .map((w) => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
}
function claveNombre(n) {
  const t = String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/\s+/).filter(Boolean);
  return t.length >= 3 ? `${t[0]} ${t.slice(-2).join(' ')}` : t.join(' ');
}
function revisarImportacion() {
  const lineas = S.f.impTexto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lineas.length) throw new Error('Pega la lista primero.');
  const vistos = new Set();
  S.imp = lineas.map((l) => {
    const partes = l.split(/\t|;/).map((x) => x.trim());
    if (partes.length < 3) return { linea: l, estado: 'error', motivo: 'Faltan datos (se esperan Nombres;Apellidos;Correo)' };
    const nombre = tituloNombre(partes[0] + ' ' + partes[1]);
    const email = partes[2].toLowerCase();
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return { linea: l, nombre, email, estado: 'error', motivo: 'Correo no válido (revisa tildes o espacios)' };
    if (vistos.has(email)) return { linea: l, nombre, email, estado: 'error', motivo: 'Correo repetido en la lista' };
    vistos.add(email);
    if (S.nomina.some((n) => n.email === email)) return { nombre, email, estado: 'mismo' };
    const previo = S.nomina.find((n) => claveNombre(n.nombre) === claveNombre(nombre));
    if (previo) return { nombre, email, estado: 'otroCorreo', previo: previo.email, previoNombre: previo.nombre };
    return { nombre, email, estado: 'nuevo' };
  });
}
async function importarNuevos() {
  const nuevos = (S.imp || []).filter((x) => x.estado === 'nuevo');
  if (!nuevos.length) throw new Error('No hay integrantes nuevos para agregar.');
  for (let i = 0; i < nuevos.length; i += 400) {
    const b = writeBatch(db);
    nuevos.slice(i, i + 400).forEach((x) => b.set(doc(db, 'nomina', x.email), { nombre: x.nombre, cargo: 'Operador de Rescate', rol: 'rescatista', cordada: null, activo: true }));
    await b.commit();
  }
  nuevos.forEach((x) => { x.estado = 'agregado'; });
  S.msg = `${nuevos.length} integrante(s) agregados como Rescatista · Operador de Rescate.`;
}
// Cambia el correo de un integrante que ya existía, manteniendo su nombre, función, perfil y foto.
async function cambiarCorreo(idx) {
  const x = S.imp[idx];
  const n = S.nomina.find((m) => m.email === x.previo);
  if (!n) throw new Error('No se encontró la ficha anterior.');
  if (!confirm(`¿Cambiar el correo de ${n.nombre}?\n\n${n.email}  →  ${x.email}\n\nSe mantienen su función, perfil y foto. Deberá crear su cuenta con el correo nuevo.`)) return;
  const b = writeBatch(db);
  b.set(doc(db, 'nomina', x.email), { nombre: n.nombre, cargo: n.cargo, rol: rolSel(n.rol), cordada: n.cordada || null, activo: true });
  b.delete(doc(db, 'nomina', n.email));
  if (S.fotos[n.email]) { b.set(doc(db, 'fotos', x.email), { img: S.fotos[n.email] }); b.delete(doc(db, 'fotos', n.email)); }
  await b.commit();
  x.estado = 'cambiado';
  S.msg = `Correo de ${n.nombre} actualizado.`;
}
function vistaImportar() {
  const I = S.imp;
  const ETQ = { nuevo: ['p-si', 'NUEVO'], mismo: ['p-sr', 'YA ESTÁ'], otroCorreo: ['p-vence', 'OTRO CORREO'], error: ['p-no', 'REVISAR'], agregado: ['p-si', 'AGREGADO'], cambiado: ['p-si', 'ACTUALIZADO'] };
  const n = I ? I.filter((x) => x.estado === 'nuevo').length : 0;
  const lista = I ? `<ul class="lista">${I.map((x, i) => `<li>
      <div><div class="nom">${esc(x.nombre || x.linea)}</div><small>${esc(x.email || '')}${x.motivo ? ' · ' + esc(x.motivo) : ''}${x.estado === 'otroCorreo' ? ` · En la nómina como ${esc(x.previoNombre)} (${esc(x.previo)})` : ''}</small></div>
      <div class="der"><span class="pill ${ETQ[x.estado][0]}">${ETQ[x.estado][1]}</span>
      ${x.estado === 'otroCorreo' ? `<button class="editar" data-act="impCambiar" data-v="${i}">USAR ESTE CORREO</button>` : ''}</div></li>`).join('')}</ul>
    ${n ? `<button class="principal" data-act="impAgregar" ${S.ocupado ? 'disabled' : ''}>AGREGAR ${n} NUEVO(S)</button>` : ''}` : '';
  return `<details class="importar" ${I ? 'open' : ''}><summary>IMPORTAR LISTA DE INTEGRANTES</summary>
    <p class="suave">Pega una persona por línea: <b>Nombres;Apellidos;Correo</b>. Se agregan como Rescatista, función Operador de Rescate y sin perfil de cordada. Los que ya están no se modifican.</p>
    <div class="campo"><label for="impTexto">Lista</label><textarea id="impTexto" rows="6" data-bind="impTexto">${esc(S.f.impTexto)}</textarea></div>
    <button class="neutro" data-act="impRevisar" ${S.ocupado ? 'disabled' : ''}>REVISAR LISTA</button>
    ${lista}
  </details>`;
}

async function guardarIntegrante() {
  const email = S.f.nEmail.trim().toLowerCase();
  const nombre = S.f.nNombre.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { S.err = 'Escribe un correo válido.'; return; }
  if (!nombre) { S.err = 'Escribe el nombre.'; return; }
  const ocupado = cargoOcupado(S.f.nCargo, email);
  if (ocupado) { S.err = `La función ${S.f.nCargo} ya la tiene ${ocupado.nombre}. Cámbiale la función primero.`; return; }
  const b = writeBatch(db);
  b.set(doc(db, 'nomina', email), { nombre, cargo: S.f.nCargo, rol: S.f.nRol, cordada: S.f.nCordada || null, activo: true });
  await b.commit();
  S.msg = `${nombre} agregado. Debe crear su cuenta en la app con ${email}.`;
  S.f.nEmail = ''; S.f.nNombre = ''; S.f.nCargo = 'Operador de Rescate'; S.f.nRol = 'rescatista'; S.f.nCordada = '';
}

// Reduce la foto a 240×240 (recorte centrado) para guardarla liviana en la base de datos.
async function subirFoto(email, archivo) {
  if (!archivo) return;
  if (!archivo.type.startsWith('image/')) throw new Error('El archivo debe ser una imagen.');
  const bmp = await createImageBitmap(archivo);
  const lado = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas'); c.width = 240; c.height = 240;
  c.getContext('2d').drawImage(bmp, (bmp.width - lado) / 2, (bmp.height - lado) / 2, lado, lado, 0, 0, 240, 240);
  let url = c.toDataURL('image/jpeg', 0.8);
  if (url.length > 150000) url = c.toDataURL('image/jpeg', 0.6);
  await setDoc(doc(db, 'fotos', email), { img: url });
  S.msg = 'Foto guardada.';
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
function iniciales(n) { return String(n || '?').split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase(); }
function avatar(email, nombre, px) {
  const src = S.fotos[email];
  const st = `width:${px}px;height:${px}px`;
  return src ? `<img class="foto" src="${esc(src)}" alt="" style="${st}">`
    : `<span class="foto ini" style="${st};font-size:${Math.round(px * 0.4)}px" aria-hidden="true">${esc(iniciales(nombre))}</span>`;
}
function encabezado() {
  const p = S.perfil;
  return `<header class="top">
    <div class="marca">${LOGOS}</div>
    ${S.user ? `<div class="quien">${p ? `${esc(nombreCorto(p.nombre))}<small>${esc(etiquetaPerfil(p))}</small>` : ''}
      <button class="salir" data-act="salir">Cerrar sesión</button></div>` : ''}
  </header>`;
}

function tabsDisponibles() {
  if (esAdmin()) return [{ id: 'tablero', txt: 'Panel' }, { id: 'nomina', txt: 'Nómina' }];
  if (esLider() && !puedeEditarNomina()) return [{ id: 'estado', txt: 'Mi estado' }, { id: 'tablero', txt: 'Panel' }];
  const t = [{ id: 'estado', txt: 'Mi estado' }];
  if (esLider()) t.push({ id: 'tablero', txt: 'Panel' }, { id: 'nomina', txt: 'Nómina' });
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

function pie() { return ''; }

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
function ficha() {
  const p = S.perfil;
  return `<div class="ficha">${avatar(S.email, p.nombre, 72)}
    <div class="ficha-txt"><b>${esc(p.nombre)}</b><small>${esc(p.cargo)}</small>
    <span class="chip">${p.cordada ? 'Perfil de cordada: ' + esc(CAT_NOMBRE[p.cordada] || p.cordada) : 'Sin perfil de cordada asignado'}</span></div></div>`;
}

function vistaClima() {
  asegurarClima();
  const l = S.llamado;
  const lugar = lugarClima();
  const local = !l || l.nivel === 'local';
  const c = S.clima;
  let cuerpo = '';
  if (c.err && !c.datos) cuerpo = `<p class="error">${esc(c.err)}</p>`;
  else if (!c.datos) cuerpo = '<p class="suave">Cargando pronóstico…</p>';
  else if (local) {
    const p = proximas24(c.datos);
    cuerpo = `<p class="clima-res">Mín <b>${p.res.tmin}°</b> · Máx <b>${p.res.tmax}°</b> · Lluvia hasta <b>${p.res.lluviaMax}%</b>${p.res.mm ? ` (${p.res.mm} mm)` : ''} · Ráfagas hasta <b>${p.res.rafagaMax} km/h</b> · Isoterma 0° desde <b>${p.res.isoMin} m</b></p>
      ${p.alertas.length ? `<div class="alertas">${p.alertas.map((a) => `<span class="pill p-vence">${esc(a)}</span>`).join('')}</div>` : ''}
      <div class="horas">${p.bloques.map((b) => `<div class="hb"><small>${b.hora}</small><b>${b.temp}°</b><span>${esc(b.desc)}</span><small>Lluvia ${b.lluvia}%</small><small>Viento ${b.viento}/${b.rafaga}</small></div>`).join('')}</div>
      <p class="suave" style="font-size:12px">Viento: promedio/ráfaga en km/h.</p>`;
  } else {
    const dias = proximos5(c.datos);
    cuerpo = `<ul class="dias">${dias.map((d) => `<li>
      <div class="d1"><b>${esc(d.nombre)}</b><span>${esc(d.desc)}</span></div>
      <div class="d2"><b>${d.tmin}° / ${d.tmax}°</b><small>Lluvia ${d.lluvia}%${d.mm ? ' · ' + d.mm + ' mm' : ''}</small><small>Ráfagas ${d.rafaga} km/h${d.isoMin !== null ? ' · Iso 0° ' + d.isoMin + ' m' : ''} · UV ${d.uv}</small>
      ${d.alertas.length ? `<span class="pill p-vence">${esc(d.alertas[0])}</span>` : ''}</div></li>`).join('')}</ul>`;
  }
  return `<section class="clima">
    <div class="clima-top"><h3>${local ? 'Clima · próximas 24 h' : 'Clima · próximos 5 días'}</h3><small>${esc(lugar.nombre)}</small></div>
    ${cuerpo}
    <small class="suave" style="font-size:12px">Pronóstico: <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo.com</a>${c.en ? ' · actualizado ' + hhmm(new Date(c.en)) : ''}</small>
  </section>`;
}

// Clima (solo en Monitoreo, Alerta y Movilización) e imagen georreferencial del lugar.
function terreno(l) {
  const clima = FASES_CLIMA.includes(l.fase) ? vistaClima() : '';
  const lugar = l.lugar && typeof l.lugar.lat === 'number' ? l.lugar : null;
  const enlaceMapa = lugar ? `<a href="https://www.google.com/maps?q=${lugar.lat},${lugar.lon}" target="_blank" rel="noopener">Ver ${esc(lugar.nombre)} en el mapa</a>` : '';
  const m = S.mapa;
  let mapa = '';
  if (m || esLider()) {
    mapa = `<section class="clima">
      <div class="clima-top"><h3>Lugar de operación</h3>${lugar ? `<small>${esc(lugar.nombre)}</small>` : ''}</div>
      ${m ? `<img class="mapa-img" src="${esc(m.img)}" alt="Imagen georreferencial del lugar de operación">
        <small class="suave" style="font-size:12px">Cargada por ${esc(nombreCorto(m.nombre))}${aFecha(m.en) ? ' · ' + cuando(aFecha(m.en)) : ''}</small>`
        : '<p class="suave">Aún no hay imagen del lugar.</p>'}
      ${enlaceMapa}
      ${esLider() ? `<label class="boton-archivo">${m ? 'CAMBIAR IMAGEN DEL LUGAR' : 'AGREGAR IMAGEN DEL LUGAR'}<input type="file" accept="image/*" data-mapa="1" class="oculto"></label>` : ''}
    </section>`;
  } else if (enlaceMapa) {
    mapa = `<p>${enlaceMapa}</p>`;
  }
  return clima + mapa;
}

function vistaEstado() {
  const l = S.llamado;
  if (!l) {
    return `<main>
      ${ficha()}
      ${avisos()}
      ${esLider() ? '<button class="principal" data-act="tab" data-v="abrir">ABRIR INCIDENTE</button>' : ''}
      <div class="hueco"></div>
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
  } else if (r && S.paso !== 'cambiar') {
    const c = clasificar(r);
    const en = aFecha(r.en);
    if (c === 'no') {
      cuerpo = `<div class="estado no"><b>NO DISPONIBLE</b><small>El Líder verá que no puedes concurrir en este incidente.</small></div>`;
    } else if (c === 'vencida') {
      cuerpo = `<div class="estado" style="background: var(--gris)"><b>DISPONIBILIDAD VENCIDA</b>
        <small>Venció a las ${hhmm(aFecha(r.hasta))}. Actualiza tu estado.</small></div>`;
    } else {
      const hasta = aFecha(r.hasta);
      cuerpo = `<div class="estado si"><b>DISPONIBLE</b>
        <span>${hasta ? 'Hasta ' + cuando(hasta) : 'Hasta nuevo aviso'}</span>
        <small>${hasta ? 'Vence en ' + dur(hasta.getTime() - Date.now()) + ' · luego dejas de contar como disponible' : 'Sigues disponible hasta que cambies tu estado'}</small></div>`;
    }
    cuerpo = `<p class="suave">Registrado ${en ? 'a las ' + hhmm(en) : ''} · se mantiene aunque cambie la fase</p>${cuerpo}
      <button class="contorno" data-act="paso" data-v="cambiar">CAMBIAR MI ESTADO</button>`;
  } else {
    cuerpo = `<h3>¿Estás disponible?</h3>
      <button class="gigante si" data-act="disponible" ${S.ocupado ? 'disabled' : ''}>DISPONIBLE</button>
      <button class="gigante no" data-act="noDisponible" ${S.ocupado ? 'disabled' : ''}>NO DISPONIBLE</button>
      ${S.paso === 'cambiar' ? '<button class="enlace" data-act="paso" data-v="">Volver</button>' : ''}`;
  }
  return `${banda(l)}<main>${ficha()}${avisos()}${cuerpo}
    ${terreno(l)}
    <div class="hueco"></div></main>`;
}

// --- Abrir llamado (Líder) ---
function vistaAbrir() {
  if (S.llamado) return vistaTablero();
  const seg = (campo, opciones, clase) => `<div class="tres seg">${Object.entries(opciones).map(([k, v]) =>
    `<button data-act="set" data-k="${campo}" data-v="${k}" class="${S.f[campo] === k ? 'on' : ''} ${clase ? clase + k : ''}" aria-pressed="${S.f[campo] === k}">${v}</button>`).join('')}</div>`;
  const plazo = S.f.nivel === 'sno' && S.f.fase === 'alerta';
  return `<main>
    <h3>Abrir incidente</h3>
    <div><label>Fase</label>${seg('fase', FASES_APERTURA, 'f-')}</div>
    <div><label>Nivel</label>${seg('nivel', NIVELES)}</div>
    <div class="campo"><label for="desc">Descripción breve</label>
      <textarea id="desc" rows="3" data-bind="desc" placeholder="Ej.: Búsqueda de persona desaparecida, sector cordillerano.">${esc(S.f.desc)}</textarea></div>
    <div class="campo"><label for="lugarQ">Lugar del incidente (para el pronóstico)</label>
      <div class="fila-input"><input id="lugarQ" data-bind="lugarQ" value="${esc(S.f.lugarQ)}" placeholder="Ej.: Cerro Chena, San José de Maipo">
      <button class="neutro" style="width:auto;padding:0 16px" data-act="buscarLugar" ${S.ocupado ? 'disabled' : ''}>Buscar</button></div>
      <p class="suave" style="margin-top:6px">Seleccionado: <b>${esc((S.f.lugar || SAN_BERNARDO).nombre)}</b></p>
      ${S.lugares.map((x, i) => `<button class="opcion-lugar" data-act="elegirLugar" data-v="${i}">${esc(x.nombre)}${x.altura ? ' · ' + Math.round(x.altura) + ' m' : ''}</button>`).join('')}
    </div>
    <p class="suave">Activación Local: clima de 24 h. Regional o SNO: clima de 5 días.</p>
    ${plazo ? `<p class="suave">Se marcará el plazo de ${PLAZO_SNO_H} h para reportar disponibilidad al SNO.</p>` : ''}
    ${avisos()}
    <button class="principal" data-act="abrirLlamado" ${S.ocupado ? 'disabled' : ''}>ABRIR INCIDENTE</button>
    <button class="enlace" data-act="tab" data-v="tablero">Cancelar</button>
  </main>`;
}

// --- Tablero (Líder) ---
function filasTablero() {
  const ahora = Date.now();
  return integrantes().map((n) => {
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

// Puesto de Comando: Líder de Unidad, jefes y LUMED, con su estado.
function puestoComandoHtml(miembros, conFoto) {
  const EST = { si: ['p-si', 'DISPONIBLE'], vence: ['p-vence', 'VENCE PRONTO'], no: ['p-no', 'NO DISPONIBLE'], sr: ['p-sr', 'SIN RESPUESTA'], vencida: ['p-sr', 'VENCIDA'] };
  const disp = miembros.filter((m) => m.c === 'si' || m.c === 'vence').length;
  const filas = CARGOS_PUESTO_COMANDO.map((cargo) => {
    const m = miembros.find((x) => x.cargo === cargo);
    if (!m) return `<li><span class="cat">${esc(cargo)}</span><span class="suave">${conFoto ? 'Sin asignar' : 'Sin respuesta'}</span></li>`;
    const est = EST[m.c] || EST.sr;
    return `<li><span class="cat">${esc(cargo)}</span><span class="per">${conFoto ? avatar(m.email, m.nombre, 28) : ''}<span>${esc(nombreCorto(m.nombre))}</span>
      <span class="pill ${est[0]}">${est[1]}</span></span></li>`;
  }).join('');
  return `<div class="cordada-box pc"><div class="cb-top"><b>GERENCIA</b><span class="pill ${disp ? 'p-si' : 'p-sr'}">${disp}/${CARGOS_PUESTO_COMANDO.length}</span></div>
    <ul class="puestos">${filas}</ul></div>`;
}

function cordadasHtml(res, conNombres) {
  const cajas = res.cordadas.map((c) => {
    const n = c.miembros.length;
    const cab = `<div class="cb-top"><b>CORDADA ${c.nombre.toUpperCase()}</b><span class="pill ${c.completa ? 'p-si' : 'p-vence'}">${n}/${TAM_CORDADA}</span></div>`;
    const estado = c.completa ? '' : `<small class="suave">Faltan ${TAM_CORDADA - n} para completarla.</small>`;
    if (!conNombres) return `<div class="cordada-box">${cab}${estado || '<small>Completa</small>'}</div>`;
    return `<div class="cordada-box">${cab}
      <ol class="miembros-cordada">${c.miembros.map((m) => `<li><span class="per">${avatar(m.email, m.nombre, 28)}<span>${esc(nombreCorto(m.nombre))}</span></span>${m.cat ? `<small class="suave">${esc(CAT_NOMBRE[m.cat] || '')}</small>` : ''}</li>`).join('')}</ol>
      ${estado}</div>`;
  }).join('');
  const reserva = res.reserva.length ? `<p class="suave">En reserva: ${conNombres ? esc(res.reserva.map((x) => nombreCorto(x.nombre)).join(', ')) : res.reserva.length}</p>` : '';
  return `<label>Cordadas (se arman solas según disponibilidad)</label>${cajas || '<p class="suave">Aún no hay disponibles para armar una cordada.</p>'}${reserva}`;
}

// Tablero sin llamado activo: abrir llamado e informes de llamados cerrados.
function listaInformes() {
  return S.cerrados.map((c) => {
    const a = aFecha(c.creadoEn); const z = aFecha(c.cerradoEn);
    const nuevo = c.id === S.ultimoCerrado;
    return `<li class="${nuevo ? 'destacado' : ''}"><div><div class="nom">${a ? cuando(a) : ''} · ${esc(NIVELES[c.nivel] || '')}</div>
      <small>${esc(c.descripcion || '')}${a && z ? ' · duró ' + dur(z - a) : ''}</small></div>
      <div class="acciones-inf"><button class="${nuevo ? 'principal' : 'contorno'} chico" data-act="informe" data-v="${c.id}">INFORME</button>
      ${esLider() ? `<button class="eliminar" data-act="eliminarInforme" data-v="${c.id}" aria-label="Eliminar informe">ELIMINAR</button>` : ''}</div></li>`;
  }).join('');
}

function vistaInicioLider() {
  const filas = listaInformes();
  return `<main>
    ${avisos()}
    <button class="principal" data-act="tab" data-v="abrir">ABRIR INCIDENTE</button>
    ${S.cerrados.length ? `<h3>Informes de incidentes</h3><ul class="lista informes">${filas}</ul>` : ''}
  </main>`;
}

function vistaTablero() {
  const l = S.llamado;
  if (!l) return vistaInicioLider();
  const filas = filasTablero();
  const k = contar(filas);
  const PILL = { si: ['p-si', 'DISPONIBLE'], vence: ['p-vence', 'VENCE PRONTO'], no: ['p-no', 'NO DISPONIBLE'], sr: ['p-sr', 'SIN RESPUESTA'], vencida: ['p-sr', 'VENCIDA'] };
  const orden = { si: 0, vence: 1, no: 2, vencida: 3, sr: 4 };
  let lista = filas.filter((f) => S.filtro === 'todos'
    || (S.filtro === 'si' && (f.c === 'si' || f.c === 'vence'))
    || (S.filtro === 'no' && f.c === 'no')
    || (S.filtro === 'sr' && (f.c === 'sr' || f.c === 'vencida')));
  lista.sort((a, b) => orden[a.c] - orden[b.c] || a.nombre.localeCompare(b.nombre, 'es'));
  const detalle = (f) => {
    if (!f.r) return '—';
    if (f.c === 'no') return 'resp. ' + (aFecha(f.r.en) ? hhmm(aFecha(f.r.en)) : '');
    const h = aFecha(f.r.hasta);
    return f.c === 'vencida' ? 'venció ' + hhmm(h) : (h ? 'hasta ' + cuando(h) : 'hasta nuevo aviso');
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
    ${puestoComandoHtml(filas.filter((f) => esPC(f.cargo)).map((f) => ({ email: f.email, nombre: f.nombre, cargo: f.cargo, c: f.c, hasta: f.r && aFecha(f.r.hasta) })), true)}
    ${cordadasHtml(armarCordadas(filas.filter((f) => f.c === 'si' || f.c === 'vence')
        .sort((a, b) => (aFecha(a.r.en)?.getTime() || 0) - (aFecha(b.r.en)?.getTime() || 0))
        .map((f) => ({ email: f.email, nombre: f.nombre, cat: f.cordada || null, cargo: f.cargo }))), true)}
    <div class="filtros" role="group" aria-label="Filtro">${fil('todos', 'Todos ' + filas.length)}${fil('si', 'Disp.')}${fil('no', 'No disp.')}${fil('sr', 'Sin resp.')}</div>
    <ul class="lista">${lista.map((f) => `<li>
      <div class="con-foto">${avatar(f.email, f.nombre, 36)}<div><div class="nom">${esc(nombreCorto(f.nombre))}</div><small>${esc(f.cordada ? CAT_NOMBRE[f.cordada] || f.cargo : f.cargo)}</small></div></div>
      <div class="der"><span class="pill ${PILL[f.c][0]}">${PILL[f.c][1]}</span><small>${esc(detalle(f))}</small>
        <button class="editar" data-act="manualPara" data-v="${esc(f.email)}" aria-expanded="${S.manual.email === f.email}" aria-label="Ingresar o editar disponibilidad de ${esc(f.nombre)}">${S.manual.email === f.email ? 'CERRAR' : 'EDITAR'}</button></div>
    </li>${S.manual.email === f.email ? `<li class="editor-fila">${editorManual(f)}</li>` : ''}`).join('') || '<li><span class="suave">Nadie en este filtro.</span></li>'}</ul>
    <div class="dos discretos"><button class="discreto" data-act="compartir">Compartir incidente (WhatsApp)</button>
    ${sinResp.length ? `<button class="discreto" data-act="recordar">Recordar a sin respuesta (${sinResp.length})</button>` : ''}</div>
    ${terreno(l)}
    <label>Cambiar fase</label>
    <div class="dos">${otrasFases.map((f) => `<button class="${f === 'movilizacion' ? 'peligro' : 'neutro'}" data-act="fase" data-v="${f}" ${S.ocupado ? 'disabled' : ''}>PASAR A ${FASES[f]}</button>`).join('')}</div>
    <button class="${l.fase === 'desmovilizacion' ? 'principal' : 'neutro'}" data-act="cerrar" ${S.ocupado ? 'disabled' : ''}>CERRAR INCIDENTE</button>
    <button class="contorno" data-act="informe" data-v="${l.id}">GENERAR INFORME (A LA FECHA)</button>
  </main>`;
}

// Ingreso manual (Líder/Administrador), dentro de la fila del integrante: las mismas opciones que tiene cada operador.
function editorManual(sel) {
  const M = S.manual;
  const r = sel.r; const h = r && aFecha(r.hasta);
  const actual = !r ? 'Sin respuesta' : sel.c === 'no' ? 'No disponible'
    : sel.c === 'vencida' ? 'Disponibilidad vencida' : 'Disponible ' + (h ? 'hasta ' + cuando(h) : 'hasta nuevo aviso');
  if (M.paso === 'tiempo') {
    return `<div class="manual">
      <p class="suave">¿Hasta cuándo está disponible ${esc(nombreCorto(sel.nombre))}?</p>
      <div class="opciones">
        <button class="opcion" data-act="mHoras" data-v="2">2 h</button>
        <button class="opcion" data-act="mHoras" data-v="4">4 h</button>
        <button class="opcion" data-act="mHoras" data-v="8">8 h</button>
        <button class="opcion" data-act="mHoras" data-v="24">24 h</button>
        <button class="opcion ancha" data-act="mHoras" data-v="0">HASTA NUEVO AVISO</button>
      </div>
      <div class="fila-input"><label for="horaManual" class="oculto">Hora exacta</label><input id="horaManual" type="time" data-bind="horaManual" value="${esc(S.f.horaManual)}">
        <button class="neutro" style="width:auto;padding:0 16px" data-act="mHoraExacta" ${S.ocupado ? 'disabled' : ''}>HASTA ESA HORA</button></div>
      <button class="enlace" data-act="mPaso" data-v="">Volver</button>
    </div>`;
  }
  return `<div class="manual">
    <p class="suave">Ingreso manual · Estado actual: <b>${esc(actual)}</b></p>
    <div class="dos"><button class="si grande-btn" data-act="mPaso" data-v="tiempo">DISPONIBLE</button>
      <button class="no grande-btn" data-act="mNo" ${S.ocupado ? 'disabled' : ''}>NO DISPONIBLE</button></div>
  </div>`;
}

// --- Resumen (Gerencia): solo totales ---
function vistaResumen() {
  const l = S.llamado;
  if (!l) return puedeInforme() && S.cerrados.length ? `<main><h3>Informes de incidentes</h3><ul class="lista informes">${listaInformes()}</ul></main>` : '<main></main>';
  const entradas = Object.values((S.resumen && S.resumen.r) || {});
  const ahora = Date.now();
  let si = 0, no = 0;
  const vig = { 2: 0, 6: 0, 12: 0 };
  const disp = [];
  entradas.forEach((e) => {
    const c = clasificar(e, ahora);
    if (c === 'si' || c === 'vence') {
      si++; disp.push({ cat: e.c || null, nombre: e.n || 'Integrante', hasta: aFecha(e.h), cargo: e.g || '' });
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
    ${puestoComandoHtml(entradas.filter((e) => esPC(e.g)).map((e) => ({ nombre: e.n || '', cargo: e.g, c: clasificar(e, ahora) })), false)}
    ${cordadasHtml(armarCordadas(disp), true)}
    <label>Disponibles que siguen vigentes</label>
    <div class="tres">${[2, 6, 12].map((x) => `<div class="cont panel"><b>${vig[x]}</b><span>en ${x} h</span></div>`).join('')}</div>
    ${puedeInforme() ? `<button class="contorno" data-act="informe" data-v="${l.id}">GENERAR INFORME (A LA FECHA)</button>` : ''}
    <label>Integrantes disponibles</label>
    <ul class="lista">${disp.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map((d) => `<li>
      <div><div class="nom">${esc(nombreCorto(d.nombre))}</div><small>${esc(d.cat ? CAT_NOMBRE[d.cat] || d.cat : 'Sin perfil de cordada')}</small></div>
      <div class="der"><span class="pill p-si">DISPONIBLE</span><small>${d.hasta ? 'hasta ' + esc(cuando(d.hasta)) : 'hasta nuevo aviso'}</small></div></li>`).join('') || '<li><span class="suave">Aún no hay disponibles.</span></li>'}</ul>
  </main>`;
}

// --- Nómina (Líder/Administrador) ---
function vistaNomina() {
  const activos = integrantes().length;
  const opcCordada = (sel) => `<option value="">Sin asignar</option>${CATEGORIAS.map((c) => `<option value="${c.id}" ${sel === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}`;
  const sinPerfil = integrantes().filter((n) => !n.cordada).length;
  return `<main>
    ${avisos()}
    ${esAdmin() ? vistaImportar() : ''}
    <h3>Agregar integrante</h3>
    <div class="campo"><label for="nNombre">Nombre</label><input id="nNombre" list="nombres" data-bind="nNombre" value="${esc(S.f.nNombre)}"></div>
    <datalist id="nombres">${NOMBRES.filter((n) => !S.nomina.some((x) => x.nombre === n)).map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>
    <div class="campo"><label for="nEmail">Correo (con el que creará su cuenta)</label><input id="nEmail" type="email" inputmode="email" data-bind="nEmail" value="${esc(S.f.nEmail)}"></div>
    <div class="dos">
      <div class="campo"><label for="nCargo">Función</label><select id="nCargo" data-bind="nCargo">${CARGOS.map((c) => `<option ${S.f.nCargo === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="campo"><label for="nRol">Perfil en la app</label><select id="nRol" data-bind="nRol">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${S.f.nRol === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    </div>
    <p class="suave">El acceso de Gerencia se asigna solo según la función (jefes, Líder Alfa, Líder Bravo y LUMED). Las funciones de mando no se pueden repetir.</p>
    <div class="campo"><label for="nCordada">Perfil de cordada</label><select id="nCordada" data-bind="nCordada">${opcCordada(S.f.nCordada)}</select></div>
    <button class="principal" data-act="agregar" ${S.ocupado ? 'disabled' : ''}>AGREGAR</button>
    <h3>Nómina URAC (${activos} activos)</h3>
    ${sinPerfil ? `<p class="aviso">${sinPerfil} integrante(s) activos sin perfil de cordada: igual entran a las cordadas por orden de disponibilidad.</p>` : ''}
    <ul class="miembros">${S.nomina.map((n, i) => `<li class="miembro">
      <div class="m-top">${avatar(n.email, n.nombre, 52)}
        <div><div class="nom" style="${n.activo ? '' : 'color: var(--texto-suave); text-decoration: line-through'}">${esc(n.nombre)}</div><small>${esc(n.cargo)} · ${esc(etiquetaPerfil(n))} · ${esc(n.email)}</small></div></div>
      <div class="dos">
        <div class="campo"><label for="car-${i}">Función</label><select id="car-${i}" data-act-change="cargo" data-email="${esc(n.email)}">${(CARGOS.includes(n.cargo) ? CARGOS : [n.cargo, ...CARGOS]).map((c) => `<option ${n.cargo === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <button class="neutro" style="align-self:end" data-act="editarNombre" data-email="${esc(n.email)}">EDITAR NOMBRE</button>
      </div>
      <div class="dos">
        <div class="campo"><label for="rol-${i}">Perfil en la app</label><select id="rol-${i}" data-act-change="rol" data-email="${esc(n.email)}">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${rolSel(n.rol) === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        ${n.rol === 'admin' ? '<p class="suave">Administrador del sistema: no integra la URAC ni cuenta en cordadas.</p>'
          : `<div class="campo"><label for="cor-${i}">Perfil de cordada</label><select id="cor-${i}" data-act-change="cordada" data-email="${esc(n.email)}">${opcCordada(n.cordada || '')}</select></div>`}
      </div>
      <div class="dos">
        <label class="boton-archivo">${S.fotos[n.email] ? 'CAMBIAR FOTO' : 'AGREGAR FOTO'}<input type="file" accept="image/*" data-foto="${esc(n.email)}" class="oculto"></label>
        ${n.email === S.email ? '<span></span>' : `<button class="eliminar" style="min-height:50px" data-act="eliminarUsuario" data-email="${esc(n.email)}">ELIMINAR</button>`}
      </div></li>`).join('')}</ul>
  </main>`;
}

// --- Informe del llamado (Líder/Administrador) ---
function describirEvento(e) {
  const quien = esc(e.nombre || e.por || '');
  switch (e.tipo) {
    case 'apertura': return `<b>Apertura en FASE DE ${esc(FASES[e.fase] || e.fase)}</b> por ${quien}. ${esc(e.detalle)}`;
    case 'fase': return `<b>Cambio de fase</b> (${esc(e.detalle)}) por ${quien}`;
    case 'respuesta': return `${quien}: <b>${esc(e.detalle)}</b>`;
    case 'manual': return `<b>Ingreso manual</b> por ${quien} · ${esc(e.detalle)}`;
    case 'mapa': return `${esc(e.detalle)} por ${quien}`;
    case 'cierre': return `<b>${esc(e.detalle)}</b> por ${quien}`;
    default: return `${esc(e.detalle)} · ${quien}`;
  }
}

function vistaInforme() {
  const I = S.informe;
  if (!I || I.cargando) return '<main><p class="suave">Preparando informe…</p></main>';
  const l = I.l;
  const ini = aFecha(l.creadoEn); const fin = aFecha(l.cerradoEn);
  const corte = fin ? fin.getTime() : Date.now();
  const fecha = (d) => d ? d.toLocaleString('es-CL', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
  const nombreDe = (email) => (S.nomina.find((n) => n.email === email) || {}).nombre || email;
  // Fases y su duración, desde la bitácora.
  const hitos = I.eventos.filter((e) => e.tipo === 'apertura' || e.tipo === 'fase').map((e) => ({ fase: e.fase, en: aFecha(e.en) }));
  if (!hitos.length && ini) hitos.push({ fase: l.fase, en: ini });
  const fases = hitos.map((h, i) => {
    const hasta = i + 1 < hitos.length ? hitos[i + 1].en : (fin || new Date(corte));
    return `<tr><td>${esc(FASES[h.fase] || h.fase)}</td><td>${fecha(h.en)}</td><td>${hasta && hasta !== fin && i + 1 < hitos.length ? fecha(hasta) : (fin ? fecha(fin) : 'En curso')}</td></tr>`;
  }).join('');
  // Disponibilidad al cierre.
  const filas = integrantes().map((n) => ({ ...n, r: I.respuestas[n.email], c: clasificar(I.respuestas[n.email], corte) }));
  const k = contar(filas);
  const EST = { si: 'Disponible', vence: 'Disponible', no: 'No disponible', sr: 'Sin respuesta', vencida: 'Disponibilidad vencida' };
  const disponibles = filas.filter((f) => f.c === 'si' || f.c === 'vence')
    .sort((a, b) => (aFecha(a.r.en)?.getTime() || 0) - (aFecha(b.r.en)?.getTime() || 0))
    .map((f) => ({ email: f.email, nombre: f.nombre, cat: f.cordada || null, cargo: f.cargo }));
  const cord = armarCordadas(disponibles);
  const tablaPC = CARGOS_PUESTO_COMANDO.map((cargo) => {
    const f = filas.find((x) => x.cargo === cargo);
    return `<tr><td>${esc(cargo)}</td><td>${f ? esc(f.nombre) : '—'}</td><td>${f ? EST[f.c] : 'Sin asignar'}</td></tr>`;
  }).join('');
  const tablaCordadas = cord.cordadas.map((c) => `<p><b>Cordada ${c.nombre}</b> (${c.miembros.length}/${TAM_CORDADA})</p>
    <table><tr><th>N°</th><th>Integrante</th><th>Perfil de cordada</th></tr>${c.miembros.map((m, i) => `<tr><td>${i + 1}</td><td>${esc(m.nombre)}</td><td>${esc(m.cat ? CAT_NOMBRE[m.cat] || '' : '—')}</td></tr>`).join('')}</table>`).join('')
    || '<p>No hubo disponibles suficientes para armar una cordada.</p>';
  const orden = { si: 0, vence: 0, no: 1, vencida: 2, sr: 3 };
  const tablaPersonal = filas.sort((a, b) => orden[a.c] - orden[b.c] || a.nombre.localeCompare(b.nombre, 'es')).map((f) => {
    const h = f.r && aFecha(f.r.hasta);
    return `<tr><td>${esc(f.nombre)}</td><td>${esc(f.cordada ? CAT_NOMBRE[f.cordada] : '—')}</td><td>${EST[f.c]}${(f.c === 'si' || f.c === 'vence') ? (h ? ' hasta ' + esc(cuando(h)) : ' (hasta nuevo aviso)') : ''}</td><td>${f.r && aFecha(f.r.en) ? hhmm(aFecha(f.r.en)) : '—'}</td></tr>`;
  }).join('');
  const bitacora = I.eventos.map((e) => `<tr><td>${fecha(aFecha(e.en))}</td><td>${esc(FASES[e.fase] || '')}</td><td>${describirEvento(e)}</td></tr>`).join('')
    || '<tr><td colspan="3">Este incidente no tiene bitácora registrada.</td></tr>';
  return `<main>
    <div class="no-print dos"><button class="principal" data-act="imprimir">IMPRIMIR / GUARDAR PDF</button><button class="neutro" data-act="tab" data-v="${esc(S.tabPrevio || 'tablero')}">VOLVER</button></div>
    <article class="informe">
      <div class="inf-logos">${LOGOS}</div>
      <h1>Informe de incidente · URAC${fin ? '' : ' (preliminar)'}</h1>
      <p class="inf-sub">Unidad de Rescate Agreste Chena · Cuerpo de Bomberos de San Bernardo</p>
      <table class="datos">
        <tr><th>Nivel de activación</th><td>${esc(NIVELES[l.nivel] || l.nivel)}</td></tr>
        <tr><th>Descripción</th><td>${esc(l.descripcion)}</td></tr>
        <tr><th>Lugar</th><td>${l.lugar ? `${esc(l.lugar.nombre)} (${Number(l.lugar.lat).toFixed(4)}, ${Number(l.lugar.lon).toFixed(4)})` : '—'}</td></tr>
        <tr><th>Apertura</th><td>${fecha(ini)} · ${esc(nombreDe(l.creadoPor))}</td></tr>
        <tr><th>Cierre</th><td>${fin ? fecha(fin) + ' · ' + esc(nombreDe(l.cerradoPor)) : 'En curso · FASE DE ' + esc(FASES[l.fase] || l.fase)}</td></tr>
      </table>
      <h2>Fases</h2>
      <table><tr><th>Fase</th><th>Inicio</th><th>Término</th></tr>${fases}</table>
      <h2>Disponibilidad ${fin ? 'al cierre' : 'al momento del informe'}</h2>
      <p>Disponibles: <b>${k.si}</b> · No disponibles: <b>${k.no}</b> · Sin respuesta o vencida: <b>${k.sr}</b> · Total integrantes: <b>${filas.length}</b></p>
      <table><tr><th>Integrante</th><th>Perfil de cordada</th><th>Estado</th><th>Resp.</th></tr>${tablaPersonal}</table>
      <h2>Gerencia</h2>
      <table><tr><th>Función</th><th>Integrante</th><th>Estado</th></tr>${tablaPC}</table>
      <h2>Cordadas ${fin ? 'al cierre' : 'al momento del informe'}</h2>
      ${tablaCordadas}
      ${I.mapa ? `<h2>Imagen del lugar</h2><img class="mapa-img" src="${esc(I.mapa.img)}" alt="Imagen georreferencial del lugar">` : ''}
      <h2>Bitácora de movimientos</h2>
      <table><tr><th>Fecha y hora</th><th>Fase</th><th>Movimiento</th></tr>${bitacora}</table>
      <p class="inf-pie">Generado el ${fecha(I.generado)} por ${esc(S.perfil.nombre)}. Documento de apoyo para la Reunión Posterior al Incidente y el Informe Final del Incidente.</p>
    </article>
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
    if ((S.tab === 'tablero' || (S.tab === 'estado' && esAdmin())) && esLider()) vista = vistaTablero();
    else if (S.tab === 'informe' && puedeInforme()) vista = vistaInforme();
    else if (S.tab === 'abrir' && esLider()) vista = vistaAbrir();
    else if (S.tab === 'nomina' && puedeEditarNomina()) vista = vistaNomina();
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
  if (t.dataset.actChange === 'manualPara') { S.manual = { email: t.value, paso: null }; S.err = ''; S.msg = ''; t.blur(); render(); }
  if (t.dataset.actChange === 'cargo') {
    const email = t.dataset.email;
    const ocupado = cargoOcupado(t.value, email);
    if (ocupado) {
      S.err = `La función ${t.value} ya la tiene ${ocupado.nombre}. Cámbiale la función primero.`;
      t.blur(); render();
    } else {
      accion(async () => { await updateDoc(doc(db, 'nomina', email), { cargo: t.value }); S.msg = 'Función actualizada.'; });
    }
  }
  if (t.dataset.actChange === 'cordada') {
    const email = t.dataset.email;
    accion(() => updateDoc(doc(db, 'nomina', email), { cordada: t.value || null }));
  }
  if (t.dataset.mapa) {
    const archivo = t.files && t.files[0];
    t.blur();
    accion(() => subirMapa(archivo));
  }
  if (t.dataset.foto) {
    const email = t.dataset.foto; const archivo = t.files && t.files[0];
    t.blur();
    accion(() => subirFoto(email, archivo));
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
      await guardarRespuesta({ estado: 'si', hasta: h ? new Date(Date.now() + h * H) : null });
    }); break;
    case 'horaExacta': accion(() => guardarRespuesta({ estado: 'si', hasta: horaDesde(S.f.hora) })); break;
    case 'manualPara': S.manual = { email: S.manual.email === v ? '' : v, paso: null }; S.err = ''; S.msg = ''; render(); break;
    case 'mPaso': S.manual.paso = v || null; render(); break;
    case 'mNo': accion(() => guardarRespuesta({ estado: 'no', para: fichaManual() })); break;
    case 'mHoras': accion(() => { const h = Number(v); return guardarRespuesta({ estado: 'si', hasta: h ? new Date(Date.now() + h * H) : null, para: fichaManual() }); }); break;
    case 'mHoraExacta': accion(() => guardarRespuesta({ estado: 'si', hasta: horaDesde(S.f.horaManual), para: fichaManual() })); break;
    case 'informe': accion(async () => {
      try { await cargarInforme(v); } catch (err) { S.informe = null; S.tab = S.tabPrevio || 'estado'; throw err; }
    }); break;
    case 'imprimir': window.print(); break;
    case 'eliminarInforme': accion(() => eliminarInforme(v)); break;
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
    case 'buscarLugar': accion(async () => {
      const q = S.f.lugarQ.trim();
      if (q.length < 3) throw new Error('Escribe al menos 3 letras del lugar.');
      S.lugares = await buscarLugares(q);
      if (!S.lugares.length) S.err = 'No se encontró ese lugar. Prueba con otro nombre o la comuna.';
    }); break;
    case 'elegirLugar': S.f.lugar = S.lugares[Number(v)]; S.lugares = []; S.f.lugarQ = ''; render(); break;
    case 'editarNombre': {
      const n = S.nomina.find((x) => x.email === b.dataset.email);
      if (!n) break;
      const nuevo = (prompt('Nombre completo del integrante:', n.nombre) || '').trim();
      if (nuevo && nuevo !== n.nombre) {
        if (nuevo.length < 2 || nuevo.length > 100) { S.err = 'El nombre debe tener entre 2 y 100 caracteres.'; render(); break; }
        accion(async () => { await updateDoc(doc(db, 'nomina', n.email), { nombre: nuevo }); S.msg = 'Nombre actualizado.'; });
      }
      break;
    }
    case 'impRevisar': if (esAdmin()) accion(async () => revisarImportacion()); break;
    case 'impAgregar': if (esAdmin()) accion(importarNuevos); break;
    case 'impCambiar': if (esAdmin()) accion(() => cambiarCorreo(Number(v))); break;
    case 'eliminarUsuario': {
      const n = S.nomina.find((x) => x.email === b.dataset.email);
      if (!n || n.email === S.email) break;
      if (!confirm(`¿Eliminar a ${n.nombre} de la nómina URAC?\n\nYa no podrá ingresar a la app. Sus respuestas en informes anteriores se mantienen. No se puede deshacer.`)) break;
      accion(async () => {
        const b2 = writeBatch(db);
        b2.delete(doc(db, 'nomina', n.email));
        if (S.fotos[n.email]) b2.delete(doc(db, 'fotos', n.email));
        await b2.commit();
        S.msg = `${n.nombre} fue eliminado de la nómina.`;
      });
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
