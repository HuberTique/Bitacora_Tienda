import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { claveTemporal, leerPlanta, plantillaPlanta, rolDesdeTexto, validarPlanta } from "@/lib/planta-excel";

const fila = (o: Partial<{ fila: number; nombre: string; codigo: string; cedula: string; cargo: string; rolTexto: string; correo: string }>) => ({
  fila: 2,
  nombre: "Ana Pérez",
  codigo: "981702",
  cedula: "1012345678",
  cargo: "Asesora",
  rolTexto: "Full time",
  correo: "",
  ...o,
});
const sinExistentes = { codigos: new Set<string>(), cedulas: new Set<string>() };

describe("rol escrito en el Excel", () => {
  it("reconoce las formas habituales", () => {
    expect(rolDesdeTexto("Full time")).toBe("full_time");
    expect(rolDesdeTexto("FULL-TIME")).toBe("full_time");
    expect(rolDesdeTexto("Asesor de ventas")).toBe("full_time");
    expect(rolDesdeTexto("part_time")).toBe("part_time");
    expect(rolDesdeTexto("Cajera")).toBe("cajero");
    expect(rolDesdeTexto("Sub Jefe")).toBe("subjefe");
    expect(rolDesdeTexto("Jefe de tienda")).toBe("jefe_tienda");
    expect(rolDesdeTexto("gerente")).toBeNull();
  });
});

describe("validación de la planta", () => {
  it("una fila completa queda lista", () => {
    const [f] = validarPlanta([fila({})], sinExistentes, true);
    expect(f.problemas).toEqual([]);
    expect(f.rol_jerarquico).toBe("full_time");
  });

  it("exige CM numérico y no repetido", () => {
    const r = validarPlanta(
      [fila({ codigo: "" }), fila({ fila: 3, codigo: "12ab" }), fila({ fila: 4, codigo: "777" }), fila({ fila: 5, codigo: "555", cedula: "x1" }), fila({ fila: 6, codigo: "555", cedula: "x2" })],
      { codigos: new Set(["777"]), cedulas: new Set() },
      true,
    );
    expect(r[0].problemas.join()).toMatch(/Falta el ID/);
    expect(r[1].problemas.join()).toMatch(/solo números/);
    expect(r[2].problemas.join()).toMatch(/ya está registrado/);
    expect(r[3].problemas.join()).toMatch(/repetido en el archivo/);
    expect(r[4].problemas.join()).toMatch(/repetido en el archivo/);
  });

  it("el jefe de tienda no se carga por Excel y el subjefe necesita correo", () => {
    const r = validarPlanta(
      [fila({ rolTexto: "Jefe de tienda" }), fila({ fila: 3, codigo: "111", cedula: "1", rolTexto: "Subjefe" }), fila({ fila: 4, codigo: "222", cedula: "2", rolTexto: "Subjefe", correo: "Sub@Empresa.com" })],
      sinExistentes,
      true,
    );
    expect(r[0].problemas.join()).toMatch(/administrador/);
    expect(r[1].problemas.join()).toMatch(/correo/);
    expect(r[2].problemas).toEqual([]);
    expect(r[2].correo).toBe("sub@empresa.com");
  });

  it("un subjefe que carga no puede registrar subjefes", () => {
    const [f] = validarPlanta([fila({ rolTexto: "Subjefe", correo: "a@b.co" })], sinExistentes, false);
    expect(f.problemas.join()).toMatch(/jefe de tienda/);
  });

  it("a un asesor no se le guarda correo", () => {
    const [f] = validarPlanta([fila({ correo: "x@y.co" })], sinExistentes, true);
    expect(f.correo).toBe("");
  });
});

describe("claves temporales", () => {
  it("PIN de 6 dígitos para asesores, sin cero inicial", () => {
    for (let i = 0; i < 50; i++) {
      const c = claveTemporal("full_time");
      expect(c).toMatch(/^[1-9][0-9]{5}$/);
    }
  });
  it("10 caracteres con letras y números para subjefes", () => {
    for (let i = 0; i < 50; i++) {
      const c = claveTemporal("subjefe");
      expect(c).toHaveLength(10);
      expect(c).toMatch(/[A-Za-z]/);
      expect(c).toMatch(/[0-9]/);
    }
  });
});

describe("lectura del Excel", () => {
  it("la plantilla se lee de vuelta (sus dos filas de ejemplo)", async () => {
    const buf = await (await plantillaPlanta()).arrayBuffer();
    const r = await leerPlanta(buf);
    if ("error" in r) throw new Error(r.error);
    expect(r.map((x) => [x.nombre, x.codigo, x.rolTexto])).toEqual([
      ["Ana Pérez Gómez", "981702", "Full time"],
      ["Luis Rojas", "981703", "Subjefe"],
    ]);
  });

  it("encuentra los encabezados aunque haya un título arriba y salta filas vacías", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Hoja1");
    ws.addRow(["Planta tienda 691"]);
    ws.addRow([]);
    ws.addRow(["Nombre", "CM", "Cedula", "Cargo", "Rol"]);
    ws.addRow(["Pedro Gil", 990001, 123, "Cajero", "Cajero"]);
    ws.addRow([]);
    ws.addRow(["Laura Díaz", "990002", "456", "PT", "Part time"]);
    const r = await leerPlanta((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    if ("error" in r) throw new Error(r.error);
    expect(r.map((x) => x.codigo)).toEqual(["990001", "990002"]);
  });

  it("avisa si faltan las columnas obligatorias", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("x").addRow(["Nombre", "Cargo"]);
    const r = await leerPlanta((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    expect("error" in r && r.error).toMatch(/Faltan columnas/);
  });
});
