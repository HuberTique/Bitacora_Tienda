// Lector del horario que descarga GeoVictoria en PDF (semanal o mensual).
//
// El PDF trae arriba "Periodo dd/mm/aaaa - dd/mm/aaaa" y "Grupo" (la tienda), y
// una tabla: Colaborador (nombre, cédula y cargo) | un día por columna
// ("Lunes 05") | Total. Cada celda es un turno "09:30 - 18:30" con su almuerzo
// "(60 min)" o "(0)", "Descanso", u otra novedad; el "ID: n" se ignora.
// El total de GeoVictoria ya viene sin almuerzo (42h, 24h).
//
// Se lee el texto del PDF con su posición (no se usa IA): la parte que extrae
// el texto vive en geovictoria-pdf.ts; aquí solo la lógica, para poder probarla.

export type ItemTexto = {
  pagina: number;
  x: number;
  /** Distancia desde el borde de ARRIBA de la página. */
  top: number;
  ancho: number;
  texto: string;
};

export type TurnoGeo = {
  fecha: string; // YYYY-MM-DD
  tipo: "trabajo" | "descanso" | "libre";
  entrada: string | null; // HH:MM
  salida: string | null;
  descansoMin: number;
  /** Horas trabajadas, ya sin el almuerzo. */
  horas: number;
  /** Texto de la novedad cuando no es turno ni descanso (vacaciones, incapacidad…). */
  nota: string | null;
};

export type FilaGeo = {
  nombre: string;
  cedula: string;
  cargo: string;
  turnos: TurnoGeo[];
  /** Total que trae el archivo (horas), si se pudo leer. */
  totalArchivo: number | null;
  totalCalculado: number;
};

export type HorarioGeo = {
  grupo: string | null;
  desde: string;
  hasta: string;
  filas: FilaGeo[];
  avisos: string[];
};

const DIAS_SEMANA = /^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s+(\d{1,2})$/i;
const RE_PERIODO = /(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/;
const RE_TURNO = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/;
const RE_DESCANSO_MIN = /\((\d+)\s*(?:min)?\)/i;

const pad = (n: number) => String(n).padStart(2, "0");
const r2 = (n: number) => Math.round(n * 100) / 100;

function fechasEntre(desde: string, hasta: string): string[] {
  const out: string[] = [];
  const d = new Date(desde + "T12:00:00Z");
  const fin = new Date(hasta + "T12:00:00Z");
  while (d <= fin && out.length < 62) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Junta en renglones los fragmentos que están a la misma altura. */
function renglones(items: ItemTexto[]): { pagina: number; top: number; texto: string; items: ItemTexto[] }[] {
  const orden = [...items].sort((a, b) => a.pagina - b.pagina || a.top - b.top || a.x - b.x);
  const out: { pagina: number; top: number; texto: string; items: ItemTexto[] }[] = [];
  for (const it of orden) {
    const u = out[out.length - 1];
    if (u && u.pagina === it.pagina && Math.abs(u.top - it.top) <= 2.5) u.items.push(it);
    else out.push({ pagina: it.pagina, top: it.top, texto: "", items: [it] });
  }
  for (const r of out) r.texto = r.items.sort((a, b) => a.x - b.x).map((i) => i.texto.trim()).join(" ").trim();
  return out;
}

/** Interpreta el contenido de una celda de un día. */
export function leerCelda(texto: string, fecha: string): TurnoGeo | null {
  const t = texto.replace(/ID:\s*-?\d+/gi, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const m = t.match(RE_TURNO);
  if (m) {
    const ini = Number(m[1]) * 60 + Number(m[2]);
    let fin = Number(m[3]) * 60 + Number(m[4]);
    if (fin <= ini) fin += 24 * 60; // turno que pasa la medianoche
    const d = t.match(RE_DESCANSO_MIN);
    const descansoMin = d ? Number(d[1]) : 0;
    return {
      fecha,
      tipo: "trabajo",
      entrada: `${pad(Number(m[1]))}:${m[2]}`,
      salida: `${pad(Number(m[3]))}:${m[4]}`,
      descansoMin,
      horas: r2(Math.max(0, fin - ini - descansoMin) / 60),
      nota: null,
    };
  }
  if (/^descanso$/i.test(t)) return { fecha, tipo: "descanso", entrada: null, salida: null, descansoMin: 0, horas: 0, nota: null };
  return { fecha, tipo: "libre", entrada: null, salida: null, descansoMin: 0, horas: 0, nota: t.slice(0, 80) };
}

export function parsearGeoVictoria(items: ItemTexto[]): HorarioGeo {
  const avisos: string[] = [];
  const limpios = items.filter((i) => i.texto.trim());
  const lineas = renglones(limpios);

  // Período y tienda.
  const lp = lineas.find((l) => RE_PERIODO.test(l.texto));
  if (!lp) throw new Error("No encontré el período (dd/mm/aaaa - dd/mm/aaaa). ¿Es el horario de GeoVictoria?");
  const p = lp.texto.match(RE_PERIODO)!;
  const desde = `${p[3]}-${p[2]}-${p[1]}`;
  const hasta = `${p[6]}-${p[5]}-${p[4]}`;
  if (hasta < desde) throw new Error("El período del archivo está al revés.");
  const fechas = fechasEntre(desde, hasta);
  const fechaDeDia = new Map<number, string>();
  for (const f of fechas) {
    const dia = Number(f.slice(8, 10));
    if (fechaDeDia.has(dia)) throw new Error("El período es de más de un mes; súbelo por partes.");
    fechaDeDia.set(dia, f);
  }
  const lg = lineas.find((l) => /^grupo\b/i.test(l.texto));
  const grupo = lg ? lg.texto.replace(/^grupo\s*/i, "").trim() || null : null;

  // Encabezados de tabla: cada uno define las columnas para lo que va debajo.
  type Col = { centro: number; fecha: string };
  type Encabezado = { pagina: number; top: number; cols: Col[]; total: number | null };
  const encabezados: Encabezado[] = [];
  for (const l of lineas) {
    const cols: Col[] = [];
    let total: number | null = null;
    for (const it of l.items) {
      const m = it.texto.trim().match(DIAS_SEMANA);
      if (m) {
        const f = fechaDeDia.get(Number(m[2]));
        if (f) cols.push({ centro: it.x + it.ancho / 2, fecha: f });
      } else if (/^total$/i.test(it.texto.trim())) total = it.x + it.ancho / 2;
    }
    if (cols.length >= 2) encabezados.push({ pagina: l.pagina, top: l.top, cols: cols.sort((a, b) => a.centro - b.centro), total });
  }
  if (encabezados.length === 0) throw new Error("No encontré las columnas de los días (Lunes 05, Martes 06…).");
  const encabezadoDe = (pagina: number, top: number): Encabezado => {
    let actual = encabezados[0];
    for (const e of encabezados) if (e.pagina < pagina || (e.pagina === pagina && e.top <= top)) actual = e;
    return actual;
  };
  const limiteIzq = (e: Encabezado) => e.cols[0].centro - (e.cols.length > 1 ? (e.cols[1].centro - e.cols[0].centro) / 2 : 40);

  // Columna "Colaborador": nombre (1 o 2 renglones), cédula y cargo.
  type Bloque = { pagina: number; top: number; nombre: string[]; cedula: string; cargo: string };
  const bloques: Bloque[] = [];
  let nombre: { pagina: number; top: number; textos: string[] } | null = null;
  let esperandoCargo: Bloque | null = null;
  for (const l of lineas) {
    const e = encabezadoDe(l.pagina, l.top);
    if (l.top <= e.top + 2 && l.pagina === e.pagina) continue; // encabezado o lo de arriba de la tabla
    const izq = l.items.filter((i) => i.x + i.ancho / 2 < limiteIzq(e)).map((i) => i.texto.trim()).join(" ").trim();
    if (!izq || /^colaborador$/i.test(izq)) continue;
    if (esperandoCargo) {
      esperandoCargo.cargo = izq;
      esperandoCargo = null;
      continue;
    }
    if (/^\d{5,12}$/.test(izq.replace(/[.\s]/g, ""))) {
      if (!nombre) continue;
      const b: Bloque = { pagina: nombre.pagina, top: nombre.top, nombre: nombre.textos, cedula: izq.replace(/\D/g, ""), cargo: "" };
      bloques.push(b);
      esperandoCargo = b;
      nombre = null;
      continue;
    }
    if (nombre && nombre.pagina === l.pagina) nombre.textos.push(izq);
    else nombre = { pagina: l.pagina, top: l.top, textos: [izq] };
  }
  if (bloques.length === 0) throw new Error("No encontré colaboradores con cédula en el archivo.");

  // Cada fragmento pertenece al bloque cuya franja lo contiene (desde un poco
  // antes de su primer renglón hasta el siguiente bloque de la misma página).
  const filas: FilaGeo[] = bloques.map((b, i) => {
    const sig = bloques[i + 1];
    const desdeTop = b.top - 6;
    const hastaTop = sig && sig.pagina === b.pagina ? sig.top - 6 : Infinity;
    const e = encabezadoDe(b.pagina, b.top);
    const enFranja = limpios.filter((it) => it.pagina === b.pagina && it.top >= desdeTop && it.top < hastaTop);
    const limites = e.cols.map((c, k) => {
      const ant = e.cols[k - 1]?.centro;
      const pos = e.cols[k + 1]?.centro;
      const medio = pos != null ? (pos - c.centro) / 2 : ant != null ? (c.centro - ant) / 2 : 40;
      return { ...c, desde: ant != null ? (ant + c.centro) / 2 : c.centro - medio, hasta: pos != null ? (pos + c.centro) / 2 : c.centro + medio };
    });
    const turnos: TurnoGeo[] = [];
    for (const c of limites) {
      const texto = enFranja
        .filter((it) => {
          const cx = it.x + it.ancho / 2;
          return cx >= c.desde && cx < c.hasta;
        })
        .sort((a, z) => a.top - z.top || a.x - z.x)
        .map((it) => it.texto.trim())
        .join(" ");
      const t = leerCelda(texto, c.fecha);
      if (t) turnos.push(t);
    }
    let totalArchivo: number | null = null;
    if (e.total != null) {
      const tx = enFranja
        .filter((it) => Math.abs(it.x + it.ancho / 2 - e.total!) < 15)
        .map((it) => it.texto)
        .join(" ");
      const m = tx.match(/(\d+(?:[.,]\d+)?)\s*h/i);
      if (m) totalArchivo = Number(m[1].replace(",", "."));
    }
    const totalCalculado = r2(turnos.reduce((a, t) => a + t.horas, 0));
    const nombreCompleto = b.nombre.join(" ").replace(/\s+/g, " ").trim();
    if (totalArchivo != null && Math.abs(totalArchivo - totalCalculado) > 0.1) {
      avisos.push(`${nombreCompleto}: el archivo dice ${totalArchivo} h y los turnos suman ${totalCalculado} h.`);
    }
    return { nombre: nombreCompleto, cedula: b.cedula, cargo: b.cargo, turnos, totalArchivo, totalCalculado };
  });

  return { grupo, desde, hasta, filas, avisos };
}

/** Cargo de GeoVictoria → rol jerárquico de la app (para registrar a alguien nuevo). */
export function rolDesdeCargoGeo(cargo: string): "jefe_tienda" | "subjefe" | "cajero" | "full_time" | "part_time" {
  const c = cargo.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  if (/SUB\s*JEFE/.test(c)) return "subjefe";
  if (/JEFE/.test(c)) return "jefe_tienda";
  if (/CAJER/.test(c)) return "cajero";
  if (/PART/.test(c)) return "part_time";
  return "full_time";
}
