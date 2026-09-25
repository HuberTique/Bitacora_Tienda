import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { leerTargetDesdeArchivo } from "@/lib/planeador-excel";
import { leerKpisMensualDesdeArchivo, type PersonaMatch } from "@/lib/kpis-mensual-excel";

// Prueba con el planeador real de la tienda (solo corre si el archivo esta en Descargas).
const archivo = path.join(os.homedir(), "Downloads", "690 Septiembre 2026 Calima planeador test1.xlsx");
const hay = fs.existsSync(archivo);

const roster: PersonaMatch[] = [
  ["yaj", "Yajaira Rodriguez Suarez", "981404", "jefe_tienda"],
  ["joh", "John Ediber Bonilla Moreno", "981730", "subjefe"],
  ["and", "Andrea Carolina Quintana", "980431", "cajero"],
  ["jei", "Jeison Esttiven Martin", "980571", "cajero"],
  ["lis", "Lisseth Dayanna Salazar Sanchez", "981416", "asesor_full"],
  ["ale", "Jose Alexander Aguilar", "981566", "asesor_full"],
  ["yun", "Yunli Meiling Fonseca Ramirez", "981558", "asesor_full"],
  ["mac", "Andres Camilo Macias", "981549", "asesor_part"],
  ["seb", "Johan Sebastian Alvarez Hormanza", "981516", "asesor_part"],
  ["sof", "Sofia Aracely Murcia Espitia", "981429", "asesor_part"],
].map(([id, nombre, codigo, rol]) => ({ id, nombre, cedula: null, codigo, activo: true, rol_jerarquico: rol }));

const buf = () => {
  const b = fs.readFileSync(archivo);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe.skipIf(!hay)("planeador real 690 septiembre 2026", () => {
  it("hoja Target: mes retail 30-ago a 3-oct, 35 dias y presupuesto", async () => {
    const t = await leerTargetDesdeArchivo(buf());
    if ("error" in t) throw new Error(t.error);
    expect(t.inicio).toBe("2026-08-30");
    expect(t.fin).toBe("2026-10-03");
    expect(t.dias).toHaveLength(35);
    expect(t.semanas).toHaveLength(5);
    expect(t.presupuesto).toBeGreaterThan(500_000_000);
    const suma = t.dias.reduce((a, d) => a + (d.target ?? 0), 0);
    expect(Math.abs(suma - t.presupuesto) / t.presupuesto).toBeLessThan(0.01);
  });

  it("Kpis mensual: las filas con nombre correcto se cruzan por CM y jefe/subjefe se omiten", async () => {
    const k = await leerKpisMensualDesdeArchivo(buf(), roster);
    if ("error" in k) throw new Error(k.error);
    const id = (n: string) => k.filas.find((f) => f.nombreExcel === n)?.personaId;
    expect(id("ANDREA")).toBe("and");
    expect(id("JEISON")).toBe("jei");
    expect(id("ALEXANDER")).toBe("ale");
    expect(id("SOFIA")).toBe("sof");
    expect(id("SEBASTIAN")).toBe("seb");
    expect(k.filas.filter((f) => f.omitir)).toHaveLength(2);
  });
});

describe.skipIf(!hay)("planeador real: nombres distintos entre cuadros", () => {
  it("FABIAN (mismo presupuesto que ANDRES del cuadro superior) recibe el CM 981549 y se marca el conflicto", async () => {
    const k = await leerKpisMensualDesdeArchivo(buf(), roster);
    if ("error" in k) throw new Error(k.error);
    const f = k.filas.find((x) => x.nombreExcel === "FABIAN");
    if (!f) return; // el archivo ya fue corregido
    expect(f.cmExcel).toBe("981549");
    expect(f.personaId).toBeNull();
    expect(f.sugeridoId).toBe("mac");
    expect(f.alertas.some((a) => a.nivel === "error")).toBe(true);
  });
});
