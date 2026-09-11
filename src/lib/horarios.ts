// Generador automático de horarios — reglas actualizadas por jefatura
// (Sep 2026). Los valores por defecto siguen siendo un punto de partida:
// jefatura ajusta manualmente cuando la operación lo requiere (dinámica
// comercial, DSM, recepción de mercancía, reuniones, universidad de PTs).
//
// FULL-TIME / CAJEROS / JEFE / SUBJEFE: 42h/semana trabajadas, 5 días de
// trabajo y 2 de descanso. Las celdas MUESTRAN horas de turno (9h y 10h
// que incluyen 1h de almuerzo, no horas efectivas de trabajo) porque es
// lo que jefatura necesita ver para asignar horarios de piso.
//   - Patrón semanal: 2 días de 10h de turno + 3 días de 9h de turno.
//   - JEFE / SUBJEFE: 8 días de descanso al mes (2/semana). Regla mensual:
//     1 fin de semana completo pegado (sábado + domingo) + 1 domingo adicional
//     suelto. NUNCA pegar el lunes al fin de semana libre (no 3 días seguidos).
//   - CAJEROS / FT: 2 domingos de descanso al mes. Por default no pegan
//     sábado libre; jefatura puede pegarlo si la operación lo permite.
//   - FT: por default no pegan domingo con lunes; jefatura puede pegarlo
//     si la operación lo permite.
//
// PART-TIME: 6 días/semana × 4h = 24h. Prioriza fin de semana (cierre y
// mayor carga comercial). Respeta la disponibilidad individual (días
// bloqueados por universidad/estudios) configurada en `disponibilidad_pt`.
// Excepción para PTs con horario universitario: los días bloqueados se
// leen de esa configuración (proximamente vía IA que lee el horario oficial).
//
// Todos respetan:
//   - Días libres solicitados en Requerimientos (tipo "dia_libre") — pendiente
//     mientras se implementa ese módulo, hoy va vacío.
//   - Días bloqueados por jefatura (dias_bloqueados) — feriados, inventarios,
//     capacitaciones colectivas.

import { NIVEL_SEGURIDAD, type Persona } from "./types";

// ---------- Tipos ----------

export type DiaCalendario = { dia: number; weekday: number };
export type CeldaHorario = { horas: number; tipo: "trabajo" | "descanso" | "libre" };
export type GridHorario = {
  [personaId: string]: {
    dias: { [dia: number]: CeldaHorario };
    total: number;
  };
};
export type ResultadoGenerador = {
  dias: DiaCalendario[];
  grid: GridHorario;
};

export type DisponibilidadPT = {
  persona_id: string;
  dias_bloqueados: number[]; // 0=domingo, 6=sábado
};

export type DiaBloqueado = {
  fecha: string; // YYYY-MM-DD
  motivo: string;
};

export type RequerimientoDiaLibre = {
  persona_id: string;
  fecha: string; // YYYY-MM-DD
};

// ---------- Helpers puros ----------

export function esCargoPartTime(cargo: string | null | undefined): boolean {
  // Compatibilidad: acepta persona.cargo (string) o persona.rol_jerarquico via el nuevo helper.
  const c = (cargo || "").toUpperCase();
  return c.includes("PART-TIME") || c.includes("PART TIME");
}

export function esPartTime(persona: Persona): boolean {
  return persona.rol_jerarquico === "part_time";
}

export function esJefeOSubjefe(persona: Persona): boolean {
  return persona.rol_jerarquico === "jefe_tienda" || persona.rol_jerarquico === "subjefe";
}

export function esCargoJefeOSubjefe(cargo: string | null | undefined): boolean {
  return (cargo || "").toUpperCase().includes("JEFE");
}

export function diasDelMes(anio: number, mes: number): DiaCalendario[] {
  const n = new Date(anio, mes, 0).getDate();
  const arr: DiaCalendario[] = [];
  for (let d = 1; d <= n; d++) {
    arr.push({ dia: d, weekday: new Date(anio, mes - 1, d).getDay() });
  }
  return arr;
}

/**
 * Un día dentro de una semana calendárica. `clave` es "YYYY-MM-DD" para
 * poder distinguir un día de un mes vs de otro (necesario cuando la semana
 * cruza el fin/inicio de mes). `enMesObjetivo` indica si ese día pertenece
 * al mes que estamos generando; los que no pertenecen se usan como CONTEXTO
 * para calcular patrones semanales correctos pero no se escriben en el grid.
 */
export type DiaCompleto = {
  clave: string;
  dia: number;
  anio: number;
  mes: number;
  weekday: number;
  enMesObjetivo: boolean;
};

/**
 * Devuelve todas las semanas L-D COMPLETAS que tocan el mes objetivo. Esto
 * incluye los días del mes anterior con los que arranca la primera semana
 * y los días del mes siguiente con los que termina la última. Así los
 * cálculos de patrones semanales (2×10 + 3×9, 6 días PT, etc.) siempre se
 * aplican sobre 7 días reales y no sobre semanas parciales.
 */
export function computarSemanasCompletas(
  anio: number,
  mes: number,
): DiaCompleto[][] {
  const primerDiaMes = new Date(anio, mes - 1, 1);
  const primerWeekday = primerDiaMes.getDay(); // 0=Dom, 1=Lun, ..., 6=Sab
  // Retroceder hasta el lunes de esa semana
  const diasHastaLunes = primerWeekday === 0 ? 6 : primerWeekday - 1;
  const inicio = new Date(primerDiaMes);
  inicio.setDate(inicio.getDate() - diasHastaLunes);

  const ultimoDiaMes = new Date(anio, mes, 0);
  const ultimoWeekday = ultimoDiaMes.getDay();
  // Avanzar hasta el domingo de esa semana
  const diasHastaDomingo = ultimoWeekday === 0 ? 0 : 7 - ultimoWeekday;
  const fin = new Date(ultimoDiaMes);
  fin.setDate(fin.getDate() + diasHastaDomingo);

  const semanas: DiaCompleto[][] = [];
  const cursor = new Date(inicio);
  while (cursor <= fin) {
    const semana: DiaCompleto[] = [];
    for (let i = 0; i < 7; i++) {
      const y = cursor.getFullYear();
      const m = cursor.getMonth() + 1;
      const d = cursor.getDate();
      semana.push({
        clave: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
        dia: d,
        anio: y,
        mes: m,
        weekday: cursor.getDay(),
        enMesObjetivo: y === anio && m === mes,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    semanas.push(semana);
  }
  return semanas;
}

function agruparPorSemana(dias: DiaCalendario[]): number[][] {
  const semanas: number[][] = [];
  let actual: number[] = [];
  dias.forEach(({ dia, weekday }) => {
    actual.push(dia);
    if (weekday === 0) {
      semanas.push(actual);
      actual = [];
    }
  });
  if (actual.length) semanas.push(actual);
  return semanas;
}

/**
 * Reparte 2 días de 10h + 3 días de 9h de turno por semana completa (horas
 * incluyen 1h de almuerzo cada una → 42h efectivas de trabajo). Para semanas
 * parciales (inicio/fin de mes) escala proporcionalmente 2:3.
 */
function patronHorasFT(numTrabajo: number): number[] {
  if (numTrabajo <= 0) return [];
  const num10h = Math.round((numTrabajo * 2) / 5);
  const num9h = numTrabajo - num10h;
  return [...Array(num9h).fill(9), ...Array(num10h).fill(10)];
}

/**
 * Elige los 2 domingos de descanso del mes para una persona FT. Jefes/subjefes:
 * uno de esos domingos va pegado a su sábado anterior. Cajeros y demás FT:
 * los 2 domingos NUNCA van pegados a un sábado libre.
 */
function elegirDomingosDescanso(
  domingos: number[],
  idxFT: number,
  esJefeOSubjefe: boolean,
): { domUnicos: number[]; sabadoPegado: number | null } {
  const misDomingos: number[] = [];
  if (domingos.length > 0) misDomingos.push(domingos[idxFT % domingos.length]);
  if (domingos.length > 1) misDomingos.push(domingos[(idxFT + 2) % domingos.length]);
  const domUnicos = [...new Set(misDomingos)];
  let sabadoPegado: number | null = null;
  if (esJefeOSubjefe && domUnicos.length > 0) {
    const candidato = domUnicos[0] - 1;
    if (candidato >= 1) sabadoPegado = candidato;
  }
  return { domUnicos, sabadoPegado };
}

// ---------- Generador ----------

/**
 * Contexto opcional de horarios ya guardados en meses adyacentes. Se usa
 * para que la generación mes-a-mes no ignore lo que ya está fijo en las
 * semanas cruzadas: la primera semana de septiembre puede contener días de
 * agosto ya asignados; la última puede contener días de octubre. Al no
 * pisarlos, evitamos conflictos en producción cuando jefatura genera un
 * mes tras otro.
 */
export type CeldaContexto = {
  clave: string;         // "YYYY-MM-DD"
  persona_id: string;
  horas: number;
  tipo: "trabajo" | "descanso" | "libre";
};

export type OpcionesGenerador = {
  personal: Persona[];             // roster activo
  disponibilidadPT: DisponibilidadPT[];
  diasBloqueados: DiaBloqueado[];   // días bloqueados por jefatura (feriados, etc.)
  requerimientosLibre: RequerimientoDiaLibre[]; // días libres solicitados
  horariosContexto?: CeldaContexto[]; // días ya guardados de meses adyacentes
};

export function generarHorarioAutomatico(
  anio: number,
  mes: number,
  opts: OpcionesGenerador,
): ResultadoGenerador {
  const dias = diasDelMes(anio, mes);
  const semanasCompletas = computarSemanasCompletas(anio, mes);
  const domingosDelMes = dias.filter((d) => d.weekday === 0).map((d) => d.dia);
  const grid: GridHorario = {};
  let idxFT = 0;
  let idxPT = 0;

  // Índice rápido: contexto de horarios de meses adyacentes por clave+persona.
  // Formato de clave: "personaId|YYYY-MM-DD".
  const contextoMap = new Map<string, CeldaContexto>();
  (opts.horariosContexto ?? []).forEach((c) => {
    contextoMap.set(`${c.persona_id}|${c.clave}`, c);
  });

  // Días libres solicitados por persona para este mes
  const prefijoMes = `${anio}-${String(mes).padStart(2, "0")}-`;
  const librePorPersona = new Map<string, Set<number>>();
  opts.requerimientosLibre.forEach((r) => {
    if (!r.fecha.startsWith(prefijoMes)) return;
    const dia = parseInt(r.fecha.split("-")[2], 10);
    if (!librePorPersona.has(r.persona_id)) librePorPersona.set(r.persona_id, new Set());
    librePorPersona.get(r.persona_id)!.add(dia);
  });

  // Días bloqueados por jefatura → aplican a todos
  const bloqueadosTienda = new Set<number>();
  opts.diasBloqueados.forEach((b) => {
    if (b.fecha.startsWith(prefijoMes)) {
      bloqueadosTienda.add(parseInt(b.fecha.split("-")[2], 10));
    }
  });

  // Índice rápido de disponibilidad PT
  const disponibilidadMap = new Map<string, number[]>();
  opts.disponibilidadPT.forEach((d) => disponibilidadMap.set(d.persona_id, d.dias_bloqueados));

  for (const p of opts.personal) {
    const dayMap: { [dia: number]: CeldaHorario } = {};
    const diasLibreForzados = librePorPersona.get(p.id) ?? new Set<number>();

    if (!esPartTime(p)) {
      // ===== FT / CAJEROS / JEFE / SUBJEFE =====
      // Se itera SEMANAS COMPLETAS L-D (7 días). Los días fuera del mes
      // objetivo se usan para calcular el patrón semanal correctamente
      // (2×10 + 3×9 sobre 5 días trabajados) pero NO se escriben en el
      // grid — solo los `enMesObjetivo`. Si un día fuera del mes ya está
      // asignado por contexto (mes previo/siguiente ya guardado), se
      // respeta y cuenta hacia la quota semanal.
      const esJefeOSub = esJefeOSubjefe(p);
      const { domUnicos, sabadoPegado } = elegirDomingosDescanso(
        domingosDelMes,
        idxFT,
        esJefeOSub,
      );

      semanasCompletas.forEach((semana, si) => {
        // Contexto: días de esta semana que están en un mes adyacente Y
        // ya tienen horario guardado en la base. Se usan para ajustar
        // la quota de descansos/trabajos de esta semana (evita que al
        // regenerar septiembre ignoremos que ago 31 ya se le asignó
        // trabajo o descanso a la persona el mes pasado).
        const contextoEnSemana = semana
          .filter((d) => !d.enMesObjetivo)
          .map((d) => contextoMap.get(`${p.id}|${d.clave}`))
          .filter((c): c is CeldaContexto => c !== undefined);
        const descansosContexto = contextoEnSemana.filter(
          (c) => c.tipo === "descanso" || c.tipo === "libre",
        ).length;
        const trabajosContexto = contextoEnSemana.filter(
          (c) => c.tipo === "trabajo",
        ).length;

        // Días fijados por reglas de mes: solo dentro del mes objetivo.
        const forzadosLibre = semana.filter(
          (d) => d.enMesObjetivo && diasLibreForzados.has(d.dia),
        );
        const forzadosBloqueoTienda = semana.filter(
          (d) => d.enMesObjetivo && bloqueadosTienda.has(d.dia),
        );
        const forzadosDomingo = semana.filter(
          (d) => d.enMesObjetivo && domUnicos.includes(d.dia),
        );
        const forzadosSabado = semana.filter(
          (d) => d.enMesObjetivo && d.dia === sabadoPegado,
        );
        const yaForzadosClaves = new Set(
          [
            ...forzadosLibre,
            ...forzadosBloqueoTienda,
            ...forzadosDomingo,
            ...forzadosSabado,
          ].map((d) => d.clave),
        );
        const domingoSuelto =
          forzadosDomingo.length > 0 && forzadosSabado.length === 0;

        // Candidatos a descanso extra: L-V del mes objetivo no forzados.
        const restantes = semana.filter(
          (d) =>
            d.enMesObjetivo &&
            !yaForzadosClaves.has(d.clave) &&
            ![0, 6].includes(d.weekday),
        );

        // Quota semanal:
        //   - Semana casi completa (5-7 días en el mes): 2 descansos por
        //     persona (regla normal), MENOS los descansos ya asignados en
        //     los días de esta semana que caen en el mes adyacente
        //     (contexto). Ejemplo: si sept arranca en martes 1, la semana
        //     incluye lunes 31 de ago; si ago 31 ya se guardó como
        //     "descanso" para esta persona, sept sólo debe asignarle
        //     1 descanso adicional (no 2).
        //   - Semana boundary parcial (1-4 días en el mes) sin contexto:
        //     distribución probabilística ~20% de los FTs descansan.
        //   - Semana boundary parcial CON contexto: si ya hay descansos
        //     en el contexto, respetamos y no forzamos más; si hay
        //     trabajos, no metemos descanso donde el contexto ya llenó.
        const enMesCount = semana.filter((d) => d.enMesObjetivo).length;
        let quotaDescansos: number;
        if (enMesCount >= 5) {
          quotaDescansos = Math.max(0, 2 - descansosContexto);
        } else {
          // Semana parcial. Si ya hay descansos en contexto, no metemos
          // más. Si hay solo trabajos en contexto, aplicamos la lógica
          // probabilística (1/5 FTs descansan) sobre los días en mes.
          if (descansosContexto > 0) {
            quotaDescansos = 0;
          } else {
            const hash = (idxFT + si + anio * 12 + mes) % 5;
            quotaDescansos = hash === 0 ? 1 : 0;
          }
        }
        const descansosNecesarios = Math.max(0, quotaDescansos - yaForzadosClaves.size);
        void trabajosContexto; // reserved para ajustar shifts en semanas boundary

        const elegidosDescanso: DiaCompleto[] = [];
        if (descansosNecesarios > 0 && restantes.length > 0) {
          const offset = (idxFT + si) % restantes.length;
          const ordenRotado = [
            ...restantes.slice(offset),
            ...restantes.slice(0, offset),
          ];
          for (const d of ordenRotado) {
            if (elegidosDescanso.length >= descansosNecesarios) break;
            if (domingoSuelto && d.weekday === 6) continue;
            // Regla: no pegar lunes a un fin de semana libre
            const esLunesTrasLibre =
              d.weekday === 1 &&
              (forzadosLibre.some((x) => x.dia === d.dia - 1) ||
                forzadosDomingo.some((x) => x.dia === d.dia - 1) ||
                elegidosDescanso.some((x) => x.dia === d.dia - 1));
            if (esLunesTrasLibre) continue;
            elegidosDescanso.push(d);
          }
          if (elegidosDescanso.length < descansosNecesarios) {
            for (const d of ordenRotado) {
              if (elegidosDescanso.length >= descansosNecesarios) break;
              if (!elegidosDescanso.some((x) => x.clave === d.clave)) {
                elegidosDescanso.push(d);
              }
            }
          }
        }

        const descansoClaves = new Set([
          ...yaForzadosClaves,
          ...elegidosDescanso.map((d) => d.clave),
        ]);

        // Días de trabajo = días del mes objetivo NO descanso.
        // Los días fuera del mes objetivo no cuentan hacia el patrón
        // porque son "propiedad" de otro mes.
        const diasTrabajo = semana.filter(
          (d) => d.enMesObjetivo && !descansoClaves.has(d.clave),
        );
        const patronHoras = patronHorasFT(diasTrabajo.length);
        const offsetPatron = patronHoras.length
          ? (idxFT + si) % patronHoras.length
          : 0;
        const patronRotado = [
          ...patronHoras.slice(offsetPatron),
          ...patronHoras.slice(0, offsetPatron),
        ];
        diasTrabajo.forEach((d, i) => {
          dayMap[d.dia] = { horas: patronRotado[i], tipo: "trabajo" };
        });
        elegidosDescanso.forEach((d) => {
          dayMap[d.dia] = { horas: 0, tipo: "descanso" };
        });
        forzadosLibre.forEach((d) => {
          dayMap[d.dia] = { horas: 0, tipo: "libre" };
        });
        forzadosBloqueoTienda.forEach((d) => {
          dayMap[d.dia] = { horas: 0, tipo: "descanso" };
        });
        forzadosDomingo.forEach((d) => {
          if (!dayMap[d.dia]) dayMap[d.dia] = { horas: 0, tipo: "descanso" };
        });
        forzadosSabado.forEach((d) => {
          if (!dayMap[d.dia]) dayMap[d.dia] = { horas: 0, tipo: "descanso" };
        });
      });
      idxFT++;
    } else {
      // ===== PART-TIME =====
      // Objetivo: 6 días × 4h = 24h/semana. Descanso ROTA entre PTs para
      // que no todos descansen el mismo día (jefatura reportó que todos
      // los PTs quedaban descansando viernes). Cada PT descansa un día
      // entre semana rotado por índice (L-M-X-J-V) + no trabaja los
      // domingos si la rotación así cae. Fin de semana siempre trabaja
      // por regla comercial (cierre y venta alta).
      const HORAS_PT = 4;
      const DIAS_OBJETIVO = 6;
      const bloqueadosPersona = disponibilidadMap.get(p.id) ?? [];
      // Weekday de descanso preferido, rotando entre PTs (0..4 →
      // Lunes..Viernes). Con 5 PTs, cada uno descansa un weekday distinto;
      // con más de 5, ciclan por igual.
      const WEEKDAYS_ENTRE_SEMANA = [1, 2, 3, 4, 5];
      const weekdayDescansoPreferido =
        WEEKDAYS_ENTRE_SEMANA[idxPT % WEEKDAYS_ENTRE_SEMANA.length];

      semanasCompletas.forEach((semana) => {
        // Solo procesamos días del mes objetivo (los adyacentes son de otro
        // mes). Pero iteramos la semana completa para razonar sobre 7 días.
        const enMes = semana.filter((d) => d.enMesObjetivo);

        const forzadosLibreClaves = new Set(
          enMes.filter((d) => diasLibreForzados.has(d.dia)).map((d) => d.clave),
        );
        const forzadosBloqueoClaves = new Set(
          enMes.filter((d) => bloqueadosTienda.has(d.dia)).map((d) => d.clave),
        );

        const disponibles = enMes.filter(
          (d) =>
            !forzadosLibreClaves.has(d.clave) &&
            !forzadosBloqueoClaves.has(d.clave) &&
            !bloqueadosPersona.includes(d.weekday),
        );

        // Fines de semana del mes: siempre trabajan (regla comercial)
        const finde = disponibles.filter(
          (d) => d.weekday === 0 || d.weekday === 6,
        );
        const entreSemana = disponibles.filter(
          (d) => d.weekday !== 0 && d.weekday !== 6,
        );

        // Ordena entre-semana: días distintos al preferido de descanso
        // van primero, así el último en entrar cae en el día preferido y
        // no se agrega (si ya llegamos a la quota).
        const entreSemanaOrdenado = [...entreSemana].sort((a, b) => {
          const priA = a.weekday === weekdayDescansoPreferido ? 1 : 0;
          const priB = b.weekday === weekdayDescansoPreferido ? 1 : 0;
          if (priA !== priB) return priA - priB;
          return a.dia - b.dia;
        });

        const trabajaClaves = new Set<string>();
        finde.forEach((d) => trabajaClaves.add(d.clave));
        const esBoundaryPT = enMes.length < 5;
        for (const d of entreSemanaOrdenado) {
          if (trabajaClaves.size >= DIAS_OBJETIVO) break;
          // Boundary week: respetar el día preferido de descanso incluso
          // si no llegamos a la quota (los otros días de la semana caen
          // en el mes adyacente y allí se completa). Sin este ajuste,
          // todos los PTs quedaban trabajando el único día boundary.
          if (esBoundaryPT && d.weekday === weekdayDescansoPreferido) continue;
          trabajaClaves.add(d.clave);
        }

        enMes.forEach((d) => {
          if (forzadosLibreClaves.has(d.clave)) {
            dayMap[d.dia] = { horas: 0, tipo: "libre" };
          } else if (trabajaClaves.has(d.clave)) {
            dayMap[d.dia] = { horas: HORAS_PT, tipo: "trabajo" };
          } else {
            dayMap[d.dia] = { horas: 0, tipo: "descanso" };
          }
        });
      });
      idxPT++;
    }

    const total = Object.values(dayMap).reduce((s, d) => s + d.horas, 0);
    grid[p.id] = { dias: dayMap, total };
  }

  // ================================================================
  // Post-pass D: reasignar shifts 9 vs 10 por semana respetando nivel
  // de seguridad y regla de cierre (Opción X: prioriza cierre).
  //
  // Los shifts 9 (apertura) y 10 (cierre) ya se asignaron en el bloque
  // FT arriba con un patrón fijo por persona (2×10 + 3×9 rotado). Ese
  // patrón mantiene la quota semanal correcta pero ignora cobertura por
  // día. Este post-pass RESPETA la quota (misma cantidad de 10s por
  // persona) pero elige QUÉ días son 10 basado en el nivel de seguridad.
  //
  // Los PT no participan (shift 4h siempre, van al cierre por default en
  // el exporter). Los días de descanso/libre tampoco se tocan.
  // ================================================================
  for (const semana of semanasCompletas) {
    // Pasamos solo los días del mes objetivo — los adyacentes no se
    // reasignan aquí (son propiedad de otro mes).
    const diasDelMesEnSemana = semana
      .filter((d) => d.enMesObjetivo)
      .map((d) => d.dia);
    if (diasDelMesEnSemana.length > 0) {
      reasignarShiftsSemana(grid, diasDelMesEnSemana, opts.personal);
    }
  }

  return { dias, grid };
}

/**
 * Reasigna qué días de la semana son shift 10 (cierre) vs shift 9 (apertura)
 * para cada persona FT, respetando su quota semanal pero optimizando la
 * cobertura por nivel de seguridad. Orden de asignación: nivel DESC (jefes
 * eligen primero sus 2 días de cierre, tomando los días donde la cobertura
 * de nivel-alto sea más débil). Los FT no-nivel-alto llenan el resto,
 * priorizando días que ya tienen nivel-alto en cierre.
 *
 * Opción X (prioriza cierre): si un día queda con menos de 2 nivel-alto en
 * cierre, intenta hacer swap tomando de la apertura del mismo día. Si no
 * hay swap posible, se acepta y jefatura ajusta manualmente.
 */
function reasignarShiftsSemana(
  grid: GridHorario,
  semana: number[],
  personal: Persona[],
) {
  // BOUNDARY / partial week: menos de 5 días del mes en esta semana.
  // No usamos quota semanal (esos días se compensan en el mes adyacente);
  // en su lugar, distribuimos POR DÍA — top 2 nivel = apertura, resto =
  // cierre — para que cada día quede con cobertura real de venta.
  const esParcial = semana.length < 5;
  if (esParcial) {
    for (const dia of semana) {
      const queTrabajan = personal
        .filter((p) => !esPartTime(p) && grid[p.id]?.dias[dia]?.tipo === "trabajo")
        .map((p) => ({ p, nivel: NIVEL_SEGURIDAD[p.rol_jerarquico] }))
        .sort((a, b) => {
          if (b.nivel !== a.nivel) return b.nivel - a.nivel;
          return a.p.nombre.localeCompare(b.p.nombre);
        });
      // Rule: top 2 → apertura (shift 9), resto → cierre (shift 10).
      // Si sólo hay 1 persona → cierre (cubre más horas de venta).
      // Excepción: si hay 2 personas, 1 abre y 1 cierra.
      queTrabajan.forEach((entry, idx) => {
        let shift: number;
        if (queTrabajan.length === 1) shift = 10;
        else if (queTrabajan.length === 2) shift = idx === 0 ? 9 : 10;
        else shift = idx < 2 ? 9 : 10;
        grid[entry.p.id].dias[dia] = { horas: shift, tipo: "trabajo" };
      });
    }
    // Recalcular totales
    for (const p of personal) {
      if (esPartTime(p)) continue;
      const dias = grid[p.id]?.dias;
      if (!dias) continue;
      grid[p.id].total = Object.values(dias).reduce((s, c) => s + c.horas, 0);
    }
    return;
  }

  type PersonaEnSemana = {
    persona: Persona;
    nivel: number;
    workDays: number[];
    quota10: number;
  };
  const enSemana: PersonaEnSemana[] = [];

  for (const p of personal) {
    if (esPartTime(p)) continue;
    const dias = grid[p.id]?.dias ?? {};
    const workDays = semana.filter((d) => dias[d]?.tipo === "trabajo");
    if (workDays.length === 0) continue;
    // Quota10 = número de 10s en el patrón para esta cantidad de días trabajados
    const patron = patronHorasFT(workDays.length);
    const quota10 = patron.filter((h) => h === 10).length;
    enSemana.push({
      persona: p,
      nivel: NIVEL_SEGURIDAD[p.rol_jerarquico],
      workDays,
      quota10,
    });
  }

  // Orden: nivel DESC (jefes primero), luego nombre para estabilidad
  enSemana.sort((a, b) => {
    if (b.nivel !== a.nivel) return b.nivel - a.nivel;
    return a.persona.nombre.localeCompare(b.persona.nombre);
  });

  // Track cobertura nivel-alto (nivel >= 4) por día en cierre
  const cierresNivelAlto = new Map<number, number>();
  semana.forEach((d) => cierresNivelAlto.set(d, 0));
  // Track cierres totales por día (para spread de FT)
  const cierresTotales = new Map<number, number>();
  semana.forEach((d) => cierresTotales.set(d, 0));

  for (const p of enSemana) {
    let chosenCierre: number[];
    if (p.nivel >= 4) {
      // Nivel alto: sus días de cierre van donde la cobertura nivel-alto sea más débil
      chosenCierre = [...p.workDays]
        .sort((a, b) => {
          const ca = cierresNivelAlto.get(a) ?? 0;
          const cb = cierresNivelAlto.get(b) ?? 0;
          if (ca !== cb) return ca - cb;
          // Desempate: prefiere días con menos cierres totales (spread)
          return (cierresTotales.get(a) ?? 0) - (cierresTotales.get(b) ?? 0);
        })
        .slice(0, p.quota10);
    } else {
      // Nivel bajo (FT): prefiere días que YA tienen nivel-alto en cierre
      // (para no dejar días con FT solo cerrando).
      const conCobertura = p.workDays.filter(
        (d) => (cierresNivelAlto.get(d) ?? 0) >= 1,
      );
      const sinCobertura = p.workDays.filter(
        (d) => (cierresNivelAlto.get(d) ?? 0) === 0,
      );
      // Dentro de cada grupo, prefiere días con menos cierres totales
      const sortByCierresTotales = (a: number, b: number) =>
        (cierresTotales.get(a) ?? 0) - (cierresTotales.get(b) ?? 0);
      chosenCierre = [
        ...conCobertura.sort(sortByCierresTotales),
        ...sinCobertura.sort(sortByCierresTotales),
      ].slice(0, p.quota10);
    }

    const chosenSet = new Set(chosenCierre);
    for (const d of p.workDays) {
      if (chosenSet.has(d)) {
        grid[p.persona.id].dias[d] = { horas: 10, tipo: "trabajo" };
        cierresTotales.set(d, (cierresTotales.get(d) ?? 0) + 1);
        if (p.nivel >= 4) {
          cierresNivelAlto.set(d, (cierresNivelAlto.get(d) ?? 0) + 1);
        }
      } else {
        grid[p.persona.id].dias[d] = { horas: 9, tipo: "trabajo" };
      }
    }
  }

  // Recalcular total por persona (los shifts pueden haber cambiado el mix)
  for (const p of enSemana) {
    const dias = grid[p.persona.id].dias;
    grid[p.persona.id].total = Object.values(dias).reduce(
      (s, celda) => s + celda.horas,
      0,
    );
  }
}

// ---------- Helpers de display ----------

export const NOMBRES_MES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export const DIAS_SEMANA_CORTO = ["D", "L", "M", "X", "J", "V", "S"];
