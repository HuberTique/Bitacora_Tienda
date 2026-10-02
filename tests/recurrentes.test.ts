import { describe, expect, it } from "vitest";
import {
  describirRepeticion,
  horaLegible,
  ocurreEn,
  ocurrenciasDelMes,
  problemaRepeticion,
  proximaOcurrencia,
  type Repeticion,
} from "@/lib/recurrentes";

const rep = (o: Partial<Repeticion>): Repeticion => ({
  frecuencia: "semanal",
  dias_semana: [],
  dia_mes: null,
  fecha_inicio: "2026-09-01",
  fecha_fin: null,
  activa: true,
  ...o,
});

// Octubre de 2026: el 1 es jueves; los lunes son 5, 12, 19 y 26.
const lunes = rep({ dias_semana: [1] });

describe("Tareas recurrentes: cuándo toca", () => {
  it("semanal: caja menor todos los lunes", () => {
    expect(ocurreEn(lunes, "2026-10-05")).toBe(true);
    expect(ocurreEn(lunes, "2026-10-12")).toBe(true);
    expect(ocurreEn(lunes, "2026-10-06")).toBe(false); // martes
    expect(ocurreEn(lunes, "2026-10-02")).toBe(false); // viernes
  });

  it("semanal con varios días", () => {
    const lmv = rep({ dias_semana: [1, 3, 5] });
    expect(["2026-10-05", "2026-10-07", "2026-10-09"].every((d) => ocurreEn(lmv, d))).toBe(true);
    expect(ocurreEn(lmv, "2026-10-06")).toBe(false);
    expect(ocurreEn(rep({ dias_semana: [0] }), "2026-10-04")).toBe(true); // domingo
  });

  it("diaria: todos los días dentro del rango", () => {
    const diaria = rep({ frecuencia: "diaria" });
    expect(ocurreEn(diaria, "2026-10-03")).toBe(true);
    expect(ocurreEn(diaria, "2026-10-04")).toBe(true);
  });

  it("mensual: el día indicado, o el último si el mes es más corto", () => {
    const dia15 = rep({ frecuencia: "mensual", dia_mes: 15 });
    expect(ocurreEn(dia15, "2026-10-15")).toBe(true);
    expect(ocurreEn(dia15, "2026-10-16")).toBe(false);
    const dia31 = rep({ frecuencia: "mensual", dia_mes: 31, fecha_inicio: "2026-01-01" });
    expect(ocurreEn(dia31, "2026-10-31")).toBe(true);
    expect(ocurreEn(dia31, "2026-11-30")).toBe(true); // noviembre tiene 30
    expect(ocurreEn(dia31, "2026-11-29")).toBe(false);
    expect(ocurreEn(dia31, "2027-02-28")).toBe(true); // febrero
    expect(ocurreEn(dia31, "2028-02-29")).toBe(true); // bisiesto
  });

  it("respeta el inicio, el fin y si está pausada", () => {
    const acotada = rep({ dias_semana: [1], fecha_inicio: "2026-10-06", fecha_fin: "2026-10-19" });
    expect(ocurreEn(acotada, "2026-10-05")).toBe(false); // antes de empezar
    expect(ocurreEn(acotada, "2026-10-12")).toBe(true);
    expect(ocurreEn(acotada, "2026-10-19")).toBe(true); // el día de fin cuenta
    expect(ocurreEn(acotada, "2026-10-26")).toBe(false); // después del fin
    expect(ocurreEn(rep({ dias_semana: [1], activa: false }), "2026-10-05")).toBe(false);
  });
});

describe("Tareas recurrentes: próxima fecha y calendario", () => {
  it("próxima ocurrencia desde hoy, incluido hoy", () => {
    expect(proximaOcurrencia(lunes, "2026-10-02")).toBe("2026-10-05");
    expect(proximaOcurrencia(lunes, "2026-10-05")).toBe("2026-10-05");
    expect(proximaOcurrencia(rep({ frecuencia: "mensual", dia_mes: 1 }), "2026-10-02")).toBe("2026-11-01");
    expect(proximaOcurrencia(rep({ dias_semana: [1], fecha_inicio: "2026-11-10" }), "2026-10-02")).toBe("2026-11-16");
  });

  it("no hay próxima fecha si ya terminó o está pausada", () => {
    expect(proximaOcurrencia(rep({ dias_semana: [1], fecha_fin: "2026-10-04" }), "2026-10-02")).toBeNull();
    expect(proximaOcurrencia(rep({ dias_semana: [1], activa: false }), "2026-10-02")).toBeNull();
  });

  it("calendario del mes: qué tareas tocan cada día", () => {
    const tareas = [
      { ...lunes, titulo: "Caja menor" },
      { ...rep({ frecuencia: "mensual", dia_mes: 5 }), titulo: "Inventario" },
    ];
    const mes = ocurrenciasDelMes(tareas, 2026, 10);
    expect([...mes.keys()]).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
    expect(mes.get("2026-10-05")?.map((t) => t.titulo)).toEqual(["Caja menor", "Inventario"]);
    expect(mes.get("2026-10-12")?.map((t) => t.titulo)).toEqual(["Caja menor"]);
  });
});

describe("Tareas recurrentes: textos y validación", () => {
  it("describe la repetición en palabras", () => {
    expect(describirRepeticion({ frecuencia: "semanal", dias_semana: [1], dia_mes: null, hora: null })).toBe("Todos los lunes");
    expect(describirRepeticion({ frecuencia: "semanal", dias_semana: [6], dia_mes: null, hora: null })).toBe("Todos los sábados");
    expect(describirRepeticion({ frecuencia: "semanal", dias_semana: [5, 1, 3], dia_mes: null, hora: null })).toBe(
      "Cada lunes, miércoles y viernes",
    );
    expect(describirRepeticion({ frecuencia: "diaria", dias_semana: [], dia_mes: null, hora: "09:30:00" })).toBe(
      "Todos los días, 9:30 a. m.",
    );
    expect(describirRepeticion({ frecuencia: "mensual", dia_mes: 15, dias_semana: [], hora: null })).toBe("El día 15 de cada mes");
    expect(describirRepeticion({ frecuencia: "mensual", dia_mes: 31, dias_semana: [], hora: null })).toBe(
      "El día 31 de cada mes (o el último)",
    );
  });

  it("muestra la hora en formato de 12 horas", () => {
    expect(horaLegible("00:05:00")).toBe("12:05 a. m.");
    expect(horaLegible("12:00:00")).toBe("12:00 p. m.");
    expect(horaLegible("15:00")).toBe("3:00 p. m.");
    expect(horaLegible(null)).toBe("");
  });

  it("no deja guardar una repetición incompleta", () => {
    const base = { frecuencia: "semanal" as const, dias_semana: [1], dia_mes: null, fecha_inicio: "2026-10-01", fecha_fin: null };
    expect(problemaRepeticion(base)).toBeNull();
    expect(problemaRepeticion({ ...base, dias_semana: [] })).toMatch(/día de la semana/);
    expect(problemaRepeticion({ ...base, frecuencia: "mensual" })).toMatch(/día del mes/);
    expect(problemaRepeticion({ ...base, fecha_fin: "2026-09-30" })).toMatch(/anterior al inicio/);
  });
});
