// Pronóstico del tiempo con Open-Meteo (gratuito, sin clave, uso no comercial).
// Atribución requerida: "Datos del clima: Open-Meteo.com" (CC BY 4.0).
export const SAN_BERNARDO = { nombre: 'San Bernardo', lat: -33.5922, lon: -70.6996 };
const TZ = 'America/Santiago';
const VIGENCIA_MS = 30 * 60 * 1000;
const cache = new Map();

export const WMO = {
  0: 'Despejado', 1: 'Mayormente despejado', 2: 'Parcial nublado', 3: 'Nublado',
  45: 'Niebla', 48: 'Niebla con escarcha',
  51: 'Llovizna débil', 53: 'Llovizna', 55: 'Llovizna intensa', 56: 'Llovizna helada', 57: 'Llovizna helada',
  61: 'Lluvia débil', 63: 'Lluvia', 65: 'Lluvia intensa', 66: 'Lluvia helada', 67: 'Lluvia helada',
  71: 'Nieve débil', 73: 'Nieve', 75: 'Nieve intensa', 77: 'Granizo fino',
  80: 'Chubascos débiles', 81: 'Chubascos', 82: 'Chubascos fuertes', 85: 'Chubascos de nieve', 86: 'Chubascos de nieve',
  95: 'Tormenta eléctrica', 96: 'Tormenta con granizo', 99: 'Tormenta con granizo'
};

export async function obtenerPronostico(lugar) {
  const clave = `${lugar.lat.toFixed(3)},${lugar.lon.toFixed(3)}`;
  const c = cache.get(clave);
  if (c && Date.now() - c.en < VIGENCIA_MS) return c.datos;
  const p = new URLSearchParams({
    latitude: lugar.lat, longitude: lugar.lon, timezone: TZ, forecast_days: '6', wind_speed_unit: 'kmh',
    hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,freezing_level_height',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_gusts_10m_max,uv_index_max'
  });
  const r = await fetch('https://api.open-meteo.com/v1/forecast?' + p.toString());
  if (!r.ok) throw new Error('No se pudo obtener el pronóstico');
  const datos = await r.json();
  cache.set(clave, { en: Date.now(), datos });
  return datos;
}

export async function buscarLugares(texto) {
  const p = new URLSearchParams({ name: texto, count: '6', language: 'es', countryCode: 'CL', format: 'json' });
  const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?' + p.toString());
  if (!r.ok) throw new Error('No se pudo buscar el lugar');
  const j = await r.json();
  return (j.results || []).map((x) => ({
    nombre: [x.name, x.admin2 || x.admin1].filter(Boolean).join(', '),
    lat: x.latitude, lon: x.longitude, altura: x.elevation
  }));
}

// Hora local actual con formato "AAAA-MM-DDTHH" para comparar con las horas del pronóstico.
function horaLocal() {
  return new Date().toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 13).replace(' ', 'T');
}

// Próximas 24 horas, en bloques de 3 horas, más un resumen y alertas.
export function proximas24(d) {
  const h = d.hourly;
  const ahora = horaLocal();
  let i0 = h.time.findIndex((t) => t.slice(0, 13) >= ahora);
  if (i0 < 0) i0 = 0;
  const rango = [];
  for (let i = i0; i < Math.min(i0 + 24, h.time.length); i++) rango.push(i);
  const bloques = rango.filter((_, k) => k % 3 === 0).map((i) => ({
    hora: h.time[i].slice(11, 16), desc: WMO[h.weather_code[i]] || '—', temp: Math.round(h.temperature_2m[i]),
    lluvia: h.precipitation_probability[i] ?? 0, viento: Math.round(h.wind_speed_10m[i]), rafaga: Math.round(h.wind_gusts_10m[i])
  }));
  const val = (arr) => rango.map((i) => arr[i]).filter((v) => v !== null && v !== undefined);
  const temps = val(h.temperature_2m);
  const res = {
    tmin: Math.round(Math.min(...temps)), tmax: Math.round(Math.max(...temps)),
    lluviaMax: Math.max(0, ...val(h.precipitation_probability)),
    mm: Math.round(val(h.precipitation).reduce((a, b) => a + b, 0) * 10) / 10,
    rafagaMax: Math.round(Math.max(0, ...val(h.wind_gusts_10m))),
    isoMin: Math.round(Math.min(...val(h.freezing_level_height)))
  };
  return { bloques, res, alertas: alertas(res.tmin, res.lluviaMax, res.rafagaMax, res.isoMin) };
}

// Próximos 5 días.
export function proximos5(d) {
  const dd = d.daily; const h = d.hourly;
  const dias = [];
  for (let i = 0; i < Math.min(5, dd.time.length); i++) {
    const fecha = dd.time[i];
    const iso = h.time.map((t, k) => (t.startsWith(fecha) ? h.freezing_level_height[k] : null)).filter((v) => v !== null && v !== undefined);
    const dia = {
      fecha, nombre: i === 0 ? 'Hoy' : new Date(fecha + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric' }),
      desc: WMO[dd.weather_code[i]] || '—', tmin: Math.round(dd.temperature_2m_min[i]), tmax: Math.round(dd.temperature_2m_max[i]),
      lluvia: dd.precipitation_probability_max[i] ?? 0, mm: Math.round((dd.precipitation_sum[i] ?? 0) * 10) / 10,
      rafaga: Math.round(dd.wind_gusts_10m_max[i] ?? 0), uv: Math.round(dd.uv_index_max[i] ?? 0),
      isoMin: iso.length ? Math.round(Math.min(...iso)) : null
    };
    dia.alertas = alertas(dia.tmin, dia.lluvia, dia.rafaga, dia.isoMin);
    dias.push(dia);
  }
  return dias;
}

function alertas(tmin, lluvia, rafaga, iso) {
  const a = [];
  if (rafaga >= 50) a.push(`Ráfagas de ${rafaga} km/h`);
  if (lluvia >= 60) a.push('Precipitación probable');
  if (tmin <= 0) a.push('Temperaturas bajo 0 °C');
  if (iso !== null && iso < 2000) a.push(`Isoterma 0° a ${iso} m`);
  return a;
}
