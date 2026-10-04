import { describe, expect, it } from "vitest";
import { leerCelda, parsearGeoVictoria, rolDesdeCargoGeo, type ItemTexto } from "@/lib/geovictoria";

// Imita el texto del PDF de GeoVictoria (posiciones como las del archivo
// real, datos inventados): encabezado, una tabla semanal y una persona que
// sigue en la página 2.
const DIAS = ["Lunes 05", "Martes 06", "Miércoles 07", "Jueves 08", "Viernes 09", "Sábado 10", "Domingo 11"];
const X_DIA = [216, 300, 381, 471, 555, 640, 723];

function encabezado(pagina: number, top: number): ItemTexto[] {
  return [
    { pagina, x: 98, top, ancho: 43, texto: "Colaborador" },
    ...DIAS.map((d, i) => ({ pagina, x: X_DIA[i], top, ancho: 36, texto: d })),
    { pagina, x: 791, top, ancho: 18, texto: "Total" },
  ];
}

function persona(pagina: number, top: number, nombre: string[], cedula: string, cargo: string, celdas: string[][], total: string): ItemTexto[] {
  const items: ItemTexto[] = [];
  const izq = [...nombre, cedula, cargo];
  izq.forEach((t, i) => items.push({ pagina, x: 55.6, top: top + i * 9.8, ancho: 100, texto: t }));
  celdas.forEach((lineas, d) =>
    lineas.forEach((t, i) => items.push({ pagina, x: X_DIA[d] - 6, top: top + i * 9.8, ancho: 43, texto: t })),
  );
  items.push({ pagina, x: 793, top: top + 9.8, ancho: 12, texto: total });
  return items;
}

const TURNO_FT = ["09:30 - 18:30", "(60 min)", "ID: 2"];
const DESCANSO = ["Descanso", "ID: -1"];
const PT = ["17:00 - 21:00", "(0)", "ID: 196"];

const items: ItemTexto[] = [
  { pagina: 1, x: 56, top: 41, ancho: 30, texto: "Empresa" },
  { pagina: 1, x: 141, top: 41, ancho: 85, texto: "EMPRESA DE PRUEBA SAS" },
  { pagina: 1, x: 56, top: 61, ancho: 26, texto: "Periodo" },
  { pagina: 1, x: 141, top: 61, ancho: 82, texto: "05/10/2026 - 11/10/2026" },
  { pagina: 1, x: 56, top: 82, ancho: 22, texto: "Grupo" },
  { pagina: 1, x: 141, top: 82, ancho: 78, texto: "STORE PRUEBA" },
  ...encabezado(1, 112),
  ...persona(1, 129.5, ["ANA MARIA PEREZ GOMEZ"], "1000000001", "ASOCIADO DE VENTAS",
    [TURNO_FT, DESCANSO, ["08:00 - 18:00", "(60 min)", "ID: 227"], DESCANSO, TURNO_FT, ["09:00 - 18:00", "(60 min)", "ID: 81"], ["11:00 - 21:00", "(60 min)", "ID: 67"]], "42h"),
  // Nombre en dos renglones.
  ...persona(1, 169, ["CARLOS ANDRES RAMIREZ", "TORRES"], "1000000002", "PART-TIME",
    [PT, PT, DESCANSO, ["09:00 - 13:00", "(0)", "ID: 119"], PT, ["14:00 - 18:00", "(0)", "ID: 182"], PT], "24h"),
  ...encabezado(2, 41),
  ...persona(2, 56, ["LUISA FERNANDA DIAZ"], "1000000003", "CAJERO",
    [DESCANSO, ["Vacaciones"], ["13:30 - 23:30", "(60 min)", "ID: 233"], TURNO_FT, TURNO_FT, DESCANSO, TURNO_FT], "33h"),
];

describe("horario de GeoVictoria", () => {
  const r = parsearGeoVictoria(items);

  it("lee el período, la tienda y a cada persona por su cédula", () => {
    expect(r.desde).toBe("2026-10-05");
    expect(r.hasta).toBe("2026-10-11");
    expect(r.grupo).toBe("STORE PRUEBA");
    expect(r.filas.map((f) => f.cedula)).toEqual(["1000000001", "1000000002", "1000000003"]);
    expect(r.filas[1].nombre).toBe("CARLOS ANDRES RAMIREZ TORRES");
    expect(r.filas[2].cargo).toBe("CAJERO");
  });

  it("las horas van sin el almuerzo y cuadran con el total del archivo", () => {
    expect(r.filas.map((f) => f.totalCalculado)).toEqual([42, 24, 33]);
    expect(r.avisos).toEqual([]);
    const ana = r.filas[0].turnos;
    expect(ana.find((t) => t.fecha === "2026-10-05")).toMatchObject({ tipo: "trabajo", entrada: "09:30", salida: "18:30", descansoMin: 60, horas: 8 });
    expect(ana.find((t) => t.fecha === "2026-10-06")).toMatchObject({ tipo: "descanso", horas: 0 });
  });

  it("una novedad distinta de descanso queda como día libre con su nota", () => {
    expect(r.filas[2].turnos.find((t) => t.fecha === "2026-10-06")).toMatchObject({ tipo: "libre", nota: "Vacaciones" });
  });

  it("avisa si los turnos no suman lo que dice el archivo", () => {
    const malo = items.map((i) => (i.texto === "33h" ? { ...i, texto: "40h" } : i));
    expect(parsearGeoVictoria(malo).avisos[0]).toContain("40");
  });

  it("rechaza un archivo que no es de GeoVictoria", () => {
    expect(() => parsearGeoVictoria([{ pagina: 1, x: 0, top: 0, ancho: 10, texto: "Hola" }])).toThrow();
  });

  it("celdas: turno que pasa la medianoche y sin almuerzo", () => {
    expect(leerCelda("22:00 - 06:00 (0) ID: 5", "2026-10-05")?.horas).toBe(8);
    expect(leerCelda("17:30 - 21:30 (0)", "2026-10-05")?.horas).toBe(4);
    expect(leerCelda("", "2026-10-05")).toBeNull();
  });

  it("cargo de GeoVictoria → rol de la app", () => {
    expect(["SUB JEFE DE TIENDA", "JEFE DE TIENDA", "CAJERO", "PART-TIME", "ASOCIADO DE VENTAS"].map(rolDesdeCargoGeo)).toEqual([
      "subjefe",
      "jefe_tienda",
      "cajero",
      "part_time",
      "full_time",
    ]);
  });
});
