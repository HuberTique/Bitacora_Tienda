import { describe, expect, it } from "vitest";
import {
  CONFIG_HORARIOS_DEFAULT,
  finesDeSemanaQuincena,
  generarHorarioAutomatico,
  type ConfigHorarios,
} from "@/lib/horarios";
import { aplicarCambios, problemaConfig, propuestaDesdeLectura } from "@/lib/horarios-reglas-ia";
import type { Persona, RolJerarquico } from "@/lib/types";

const persona = (id: string, rj: RolJerarquico): Persona => ({
  id,
  auth_user_id: null,
  nombre: id,
  codigo: null,
  cedula: id,
  cargo: rj,
  rol: rj === "jefe_tienda" || rj === "subjefe" ? "jefatura" : "asesor",
  rol_jerarquico: rj,
  activo: true,
  motivo_baja: null,
  fecha_baja: null,
  foto_path: null,
  created_at: "",
  updated_at: "",
});

const EQUIPO: Persona[] = [
  persona("jefe", "jefe_tienda"),
  persona("sub1", "subjefe"),
  persona("sub2", "subjefe"),
  persona("cajero", "cajero"),
  persona("ft1", "full_time"),
  persona("ft2", "full_time"),
  persona("ft3", "full_time"),
  persona("pt1", "part_time"),
  persona("pt2", "part_time"),
];
const FT = EQUIPO.filter((p) => p.rol_jerarquico !== "part_time");

function generar(config: Partial<ConfigHorarios>, festivos: string[] = [], anio = 2026, mes = 10) {
  return generarHorarioAutomatico(anio, mes, {
    config: { ...CONFIG_HORARIOS_DEFAULT, ...config },
    personal: EQUIPO,
    disponibilidadPT: [],
    diasBloqueados: [],
    requerimientosLibre: [],
    festivos,
  });
}

const weekday = (dia: number, anio = 2026, mes = 10) => new Date(anio, mes - 1, dia).getDay();

describe("fines de semana de quincena", () => {
  it("octubre 2026: 17-18 (cerca del 15) y 31 (cerca del 30)", () => {
    expect(finesDeSemanaQuincena(2026, 10)).toEqual([17, 18, 31]);
  });
  it("solo devuelve sábados y domingos del mes", () => {
    for (let mes = 1; mes <= 12; mes++) {
      const dias = finesDeSemanaQuincena(2026, mes);
      expect(dias.length).toBeGreaterThanOrEqual(2);
      for (const d of dias) expect([0, 6]).toContain(weekday(d, 2026, mes));
    }
  });
});

describe("generador con las reglas del correo", () => {
  it("nadie de tiempo completo descansa el lunes después de un domingo libre, en ningún mes", () => {
    for (let mes = 1; mes <= 12; mes++) {
      const r = generar({}, [], 2026, mes);
      for (const p of FT) {
        const dias = r.grid[p.id].dias;
        for (const d of r.dias) {
          if (d.weekday !== 1 || d.dia === 1) continue;
          const lunesLibre = dias[d.dia]?.tipo !== "trabajo";
          const domingoLibre = dias[d.dia - 1]?.tipo !== "trabajo";
          expect(lunesLibre && domingoLibre, `${p.id} ${mes}/${d.dia}`).toBe(false);
        }
      }
    }
  });

  it("el jefe de tienda trabaja a cierre los fines de semana de quincena", () => {
    const r = generar({ jefeCierreQuincena: true });
    for (const d of finesDeSemanaQuincena(2026, 10)) {
      expect(r.grid.jefe.dias[d], `día ${d}`).toEqual({ horas: 10, tipo: "trabajo" });
    }
  });

  it("sin la regla de quincena el jefe no queda obligado", () => {
    const con = generar({ jefeCierreQuincena: true });
    const sin = generar({ jefeCierreQuincena: false });
    const cierres = (g: typeof con) =>
      finesDeSemanaQuincena(2026, 10).filter((d) => g.grid.jefe.dias[d]?.horas === 10).length;
    expect(cierres(con)).toBe(3);
    expect(cierres(sin)).toBeLessThan(3);
  });

  it("con días cortos de lunes a jueves hay más turnos largos de viernes a domingo", () => {
    const largosFinde = (g: ReturnType<typeof generar>) =>
      FT.reduce(
        (n, p) =>
          n + g.dias.filter((d) => [5, 6, 0].includes(d.weekday) && g.grid[p.id].dias[d.dia]?.horas === 10).length,
        0,
      );
    expect(largosFinde(generar({ ftCortosLunJue: true }))).toBeGreaterThan(largosFinde(generar({})));
  });

  it("la preferencia no deja ningún día de semana completa sin un mando a cierre", () => {
    const r = generar({ ftCortosLunJue: true, jefeCierreQuincena: true }, ["2026-10-12"]);
    const mandos = EQUIPO.filter((p) => ["jefe_tienda", "subjefe", "cajero"].includes(p.rol_jerarquico));
    // Semanas completas de octubre 2026: del 5 al 25.
    for (let d = 5; d <= 25; d++) {
      const cierran = mandos.filter((p) => r.grid[p.id].dias[d]?.horas === 10).length;
      expect(cierran, `día ${d}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("las reglas nuevas no cambian las horas de una semana completa", () => {
    const r = generar({ ftCortosLunJue: true });
    for (const p of FT) {
      // Semana del lunes 5 al domingo 11 de octubre de 2026.
      let horas = 0;
      for (let d = 5; d <= 11; d++) horas += r.grid[p.id].dias[d]?.horas ?? 0;
      expect(horas, p.id).toBe(2 * 10 + 3 * 9);
    }
  });
});

describe("propuesta a partir del correo", () => {
  const lectura = {
    resumen: "Correo de la DSM con las reglas de octubre.",
    parametros: {
      pt_dias_semana: 6,
      ft_dias_turno_largo: 2,
      ft_descansos_semana: 2,
      ft_domingos_descanso: null,
      ft_cortos_lun_jue: true,
      jefe_cierre_quincena: true,
    },
    festivos: [
      { fecha: "2026-10-12", nombre: "Día de la Raza" },
      { fecha: "2026-10-12", nombre: "repetido" },
      { fecha: "12 de octubre", nombre: "mal formato" },
      { fecha: "2026-11-02", nombre: "" },
    ],
    tareas: [
      { titulo: "Enviar horarios semanales", descripcion: "Desde Geovictoria", frecuencia: "semanal", dias_semana: [5] },
      { titulo: "Sin días", frecuencia: "semanal", dias_semana: [] },
      { titulo: "Rara", frecuencia: "anual" },
    ],
    otras_reglas: ["Part-time: excepción con horario académico certificado.", "  "],
  };

  it("propone solo lo que cambia y deja aparte lo que ya coincide", () => {
    const p = propuestaDesdeLectura(lectura, { config: CONFIG_HORARIOS_DEFAULT, festivosRegistrados: [] });
    expect(p.cambios.map((c) => c.clave)).toEqual(["ftCortosLunJue", "jefeCierreQuincena"]);
    expect(p.yaCoinciden).toHaveLength(3);
    expect(p.otrasReglas).toEqual(["Part-time: excepción con horario académico certificado."]);
  });

  it("descarta festivos mal formados o repetidos y separa los ya registrados", () => {
    const p = propuestaDesdeLectura(lectura, {
      config: CONFIG_HORARIOS_DEFAULT,
      festivosRegistrados: ["2026-11-02"],
    });
    expect(p.festivos).toEqual([{ fecha: "2026-10-12", nombre: "Día de la Raza", incluir: true }]);
    expect(p.festivosYaRegistrados).toEqual(["2026-11-02"]);
  });

  it("solo acepta tareas con una repetición válida", () => {
    const p = propuestaDesdeLectura(lectura, { config: CONFIG_HORARIOS_DEFAULT, festivosRegistrados: [] });
    expect(p.tareas).toHaveLength(1);
    expect(p.tareas[0]).toMatchObject({ titulo: "Enviar horarios semanales", frecuencia: "semanal", dias_semana: [5] });
  });

  it("ignora valores fuera de rango", () => {
    const p = propuestaDesdeLectura(
      { parametros: { ft_dias_turno_largo: 9, pt_dias_semana: 0, ft_descansos_semana: 2.5 } },
      { config: CONFIG_HORARIOS_DEFAULT, festivosRegistrados: [] },
    );
    expect(p.cambios).toEqual([]);
  });

  it("aplica solo los cambios marcados y valida el resultado", () => {
    const p = propuestaDesdeLectura(lectura, { config: CONFIG_HORARIOS_DEFAULT, festivosRegistrados: [] });
    p.cambios[1].incluir = false;
    const nueva = aplicarCambios(CONFIG_HORARIOS_DEFAULT, p.cambios);
    expect(nueva.ftCortosLunJue).toBe(true);
    expect(nueva.jefeCierreQuincena).toBe(false);
    expect(problemaConfig(nueva)).toBeNull();
    expect(problemaConfig({ ...nueva, ftDiasTurnoLargo: 6, ftDescansosSemana: 2 })).not.toBeNull();
  });
});
