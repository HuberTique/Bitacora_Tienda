// "Mi ranking" (Huber, 9-oct-2026): lo que ve cada asesor de sí mismo. Fortalezas y oportunidades
// SIEMPRE con datos concretos (cuánto le falta y de qué), su puesto y cuánto le falta para subir,
// y la carrera del trimestre (suma de los puntos de los 3 meses).

import { MAGIA_PUNTOS_MAX, type FilaRanking, type HistorialRanking, type MagiaEvaluacion, type RankingConfig, uptDe } from "./ranking";

const pesos = (v: number) => `$${Math.round(v).toLocaleString("es-CO")}`;
const dec = (v: number, n = 2) => v.toFixed(n).replace(".", ",");
const pct = (v: number) => `${Math.round(v * 100)} %`;

export type Aspecto = { id: string; titulo: string; score: number; texto: string };

/** Cada aspecto medible del mes con su puntaje (100 = al día) y un texto con datos. */
export function aspectosDe(
  f: FilaRanking,
  config: Pick<RankingConfig, "upt_meta">,
  vendeRopa: boolean,
  evaluacion?: Pick<MagiaEvaluacion, "oportunidades"> | null,
): Aspecto[] {
  const out: Aspecto[] = [];
  if (f.cumplimientoFecha != null && f.metaFecha != null && f.ventaAcum != null) {
    const falta = f.metaFecha - f.ventaAcum;
    out.push({
      id: "pesos",
      titulo: "Venta en pesos",
      score: f.cumplimientoFecha * 100,
      texto:
        falta > 0
          ? `Llevas ${pct(f.cumplimientoFecha)} de tu meta a la fecha: te faltan ${pesos(falta)} para estar al día.`
          : `Llevas ${pct(f.cumplimientoFecha)} de tu meta a la fecha (${pesos(-falta)} por encima).`,
    });
  }
  const unidades: [string, string, number | null | undefined, number | null][] = [
    ["pares", "Pares", f.kpi?.pares_venta, f.metaUnidadesFecha.pares],
    ["acc", "Accesorios", f.kpi?.acc_venta, f.metaUnidadesFecha.acc],
    ...(vendeRopa ? ([["ropa", "Ropa", f.kpi?.ropa_venta, f.metaUnidadesFecha.ropa]] as [string, string, number | null | undefined, number | null][]) : []),
  ];
  for (const [id, titulo, venta, meta] of unidades) {
    if (venta == null || meta == null || meta <= 0) continue;
    const falta = Math.ceil(meta - venta);
    const nombre = titulo.toLowerCase();
    out.push({
      id,
      titulo,
      score: (venta / meta) * 100,
      texto:
        falta > 0
          ? `Llevas ${Math.round(venta)} ${nombre} de ${Math.round(meta)} a la fecha: te faltan ${falta} para ir al día.`
          : `Llevas ${Math.round(venta)} ${nombre}, por encima de los ${Math.round(meta)} que debías llevar.`,
    });
  }
  const upt = uptDe(f.kpi);
  if (upt != null && config.upt_meta > 0) {
    const falta = config.upt_meta - upt;
    out.push({
      id: "upt",
      titulo: "UPT",
      score: (upt / config.upt_meta) * 100,
      texto:
        falta > 0
          ? `Tu UPT es ${dec(upt)} y la meta ${dec(config.upt_meta)}: suma ${dec(falta)} artículos por cada venta (ofrece medias, plantillas o un segundo par).`
          : `Tu UPT es ${dec(upt)}, por encima de la meta de ${dec(config.upt_meta)}.`,
    });
  }
  if (f.scores.magia != null) {
    const reclamos = f.faltas?.reclamos ?? 0;
    const promedio = f.magia ? Math.round((Number(f.magia.promedio) / (MAGIA_PUNTOS_MAX / 4)) * 10) / 10 : null;
    const partes = [
      promedio != null ? `Promedio ${dec(promedio, 1)} de 4 en Magia con una sonrisa.` : "",
      reclamos > 0 ? `${reclamos} reclamo(s) de clientes te restan ${Math.round(f.faltas?.penal_magia ?? 0)} puntos.` : "",
      evaluacion?.oportunidades?.trim() ? `A mejorar según tu evaluación: ${evaluacion.oportunidades.trim()}` : "",
    ].filter(Boolean);
    out.push({ id: "magia", titulo: "Servicio (Magia)", score: f.scores.magia, texto: partes.join(" ") });
  }
  if (f.scores.puntualidad != null) {
    const n = f.faltas?.faltas ?? 0;
    out.push({
      id: "puntualidad",
      titulo: "Puntualidad y operación",
      score: f.scores.puntualidad,
      texto:
        n > 0
          ? `${n} registro(s) en Feedbacks (llegadas tarde, ausencias o errores) te restan ${Math.round(f.faltas?.penalizacion ?? 0)} puntos.`
          : "Sin llegadas tarde, ausencias ni errores este mes.",
    });
  }
  return out;
}

/** Fortalezas: lo que está al día o mejor (hasta 3); oportunidades: lo que falta (hasta 3, lo más bajo primero). */
export function fortalezasYOportunidades(aspectos: Aspecto[]) {
  const fortalezas = aspectos.filter((a) => a.score >= 100).sort((a, b) => b.score - a.score).slice(0, 3);
  const oportunidades = aspectos.filter((a) => a.score < 100).sort((a, b) => a.score - b.score).slice(0, 3);
  // Si nada está al día, su mejor aspecto igual es su fortaleza.
  if (fortalezas.length === 0 && aspectos.length > 1) {
    const mejor = [...aspectos].sort((a, b) => b.score - a.score)[0];
    return { fortalezas: [mejor], oportunidades: oportunidades.filter((o) => o.id !== mejor.id) };
  }
  return { fortalezas, oportunidades };
}

/** Puesto (1..n) y cuánto le falta para el de arriba / cuánto le lleva al de abajo. */
export function miPosicion(filas: FilaRanking[], personaId: string) {
  const con = filas.filter((f) => f.puntaje != null);
  const i = con.findIndex((f) => f.persona.id === personaId);
  if (i < 0) return null;
  const yo = con[i].puntaje!;
  return {
    puesto: i + 1,
    de: con.length,
    puntaje: yo,
    paraSubir: i > 0 ? con[i - 1].puntaje! - yo : null,
    ventaja: i < con.length - 1 ? yo - con[i + 1].puntaje! : null,
  };
}

// ---------- Trimestre ----------

export const trimestreDe = (mes: number) => Math.ceil(mes / 3);
export const mesesDelTrimestre = (mes: number) => {
  const q = trimestreDe(mes);
  return [3 * q - 2, 3 * q - 1, 3 * q];
};

export type FilaTrimestre = {
  persona_id: string;
  nombre: string;
  porMes: (number | null)[]; // puntaje de cada mes del trimestre
  total: number;
  mejora: number | null; // último mes con dato − el anterior
};

/**
 * Carrera del trimestre: suma de los puntajes de los 3 meses. Los meses ya cerrados salen del
 * historial (lo que guardó la jefatura al cerrar el mes); el mes en curso, del ranking en vivo.
 */
export function carreraTrimestre(
  historial: HistorialRanking[],
  filasActuales: FilaRanking[],
  anio: number,
  mes: number,
): { meses: number[]; filas: FilaTrimestre[]; sinCerrar: number[]; masMejoro: FilaTrimestre | null } {
  const meses = mesesDelTrimestre(mes);
  const sinCerrar = meses.filter((m) => m < mes && !historial.some((h) => h.anio === anio && h.mes === m));
  const porPersona = new Map<string, FilaTrimestre>();
  const fila = (id: string, nombre: string) => {
    if (!porPersona.has(id)) porPersona.set(id, { persona_id: id, nombre, porMes: [null, null, null], total: 0, mejora: null });
    return porPersona.get(id)!;
  };
  meses.forEach((m, k) => {
    if (m === mes) {
      // El mes que se está viendo: en vivo, salvo que ya esté cerrado.
      const cerrado = historial.filter((h) => h.anio === anio && h.mes === m);
      if (cerrado.length > 0) cerrado.forEach((h) => (fila(h.persona_id, h.nombre).porMes[k] = Number(h.puntaje)));
      else filasActuales.forEach((f) => f.puntaje != null && (fila(f.persona.id, f.persona.nombre).porMes[k] = f.puntaje));
    } else if (m < mes) {
      historial.filter((h) => h.anio === anio && h.mes === m).forEach((h) => (fila(h.persona_id, h.nombre).porMes[k] = Number(h.puntaje)));
    }
  });
  const filas = [...porPersona.values()];
  for (const f of filas) {
    f.total = f.porMes.reduce<number>((a, v) => a + (v ?? 0), 0);
    const con = f.porMes.map((v, k) => [v, k] as const).filter(([v]) => v != null);
    f.mejora = con.length >= 2 ? con[con.length - 1][0]! - con[con.length - 2][0]! : null;
  }
  filas.sort((a, b) => b.total - a.total);
  const masMejoro = filas.filter((f) => (f.mejora ?? 0) > 0).sort((a, b) => b.mejora! - a.mejora!)[0] ?? null;
  return { meses, filas, sinCerrar, masMejoro };
}
