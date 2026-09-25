import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { functions: { invoke } } }));

import { leerVentasConsolidadas } from "@/lib/ventas-consolidadas";

async function pdf(paginas: number, vertical = true): Promise<File> {
  const d = await PDFDocument.create();
  for (let i = 0; i < paginas; i++) d.addPage(vertical ? [600, 800] : [800, 600]);
  const bytes = await d.save();
  return new File([bytes as BlobPart], "ventas.pdf", { type: "application/pdf" });
}

const resumen = {
  titulo: "Visión general de ventas",
  tienda: "Tienda: 690 - BOGOTA-CALIMA",
  rango: ["2026-08-30", "2026-09-22"],
  total: { netaRec: 30, netaImp: 1000 },
  filas: [
    { cm: "980431", nombre: "ANDREA", netaRec: 10, netaImp: 400 },
    { cm: "981416", nombre: "LISSETH", netaRec: 12, netaImp: 500 },
    { cm: "9999", nombre: "HOUSE ACCOUNT", netaRec: 3, netaImp: 100 },
  ],
};

function responder(detalle: unknown[] | (() => never)) {
  invoke.mockImplementation(async (...args: unknown[]) => {
    const o = args[1] as { body: { modo: string } };
    if (!o) throw new Error("args=" + JSON.stringify(args).slice(0, 200));
    if (o.body.modo === "resumen") return { data: resumen, error: null };
    if (typeof detalle === "function") detalle();
    return { data: { filas: detalle }, error: null };
  });
}

beforeEach(() => {
  invoke.mockReset();
});

describe("leerVentasConsolidadas", () => {
  it("une resumen y detalle por CM, separa el 9999 y cuadra con el total", async () => {
    responder([
      { cm: "980431", nombre: "ANDREA", tipo: "Footwear", netaRec: 6 },
      { cm: "980431", nombre: "ANDREA", tipo: "Apparel", netaRec: 3 },
      { cm: "980431", nombre: "ANDREA", tipo: "Accessories", netaRec: 1 },
      { cm: "981416", nombre: "LISSETH", tipo: "Footwear", netaRec: 12 },
    ]);
    const r = await leerVentasConsolidadas(await pdf(4));
    expect(r.empleados.map((e) => e.cm)).toEqual(["980431", "981416"]);
    expect(r.ventaEmpleados).toBe(100);
    expect(r.totalNetaImp).toBe(1000);
    expect(r.sumaNetaImp).toBe(1000);
    expect(r.avisos.some((a) => /no cuadra/.test(a))).toBe(false);
    const a = r.empleados[0];
    expect([a.pares, a.ropa, a.acc]).toEqual([6, 3, 1]);
    // Lisseth solo tiene footwear: ropa y accesorios en 0 (hay detalle leido).
    expect([r.empleados[1].pares, r.empleados[1].ropa, r.empleados[1].acc]).toEqual([12, 0, 0]);
    expect(r.rango).toEqual(["2026-08-30", "2026-09-22"]);
  });

  it("encabezado repetido en la hoja siguiente es la misma persona (no duplica, conserva el primero)", async () => {
    responder([
      { cm: "980431", nombre: "ANDREA", tipo: "Footwear", netaRec: 6 },
      { cm: "980431", nombre: "ANDREA CAROL", tipo: "Footwear", netaRec: 99 },
      { cm: "980431", nombre: "ANDREA", tipo: "Apparel", netaRec: 3 },
    ]);
    const r = await leerVentasConsolidadas(await pdf(4));
    expect(r.empleados.filter((e) => e.cm === "980431")).toHaveLength(1);
    expect(r.empleados[0].pares).toBe(6);
  });

  it("si falla el detalle avisa y deja pares/ropa/acc en null", async () => {
    responder(() => {
      throw new Error("timeout");
    });
    const r = await leerVentasConsolidadas(await pdf(4));
    expect(r.empleados[0].pares).toBeNull();
    expect(r.avisos.some((a) => /detalle por tipo/.test(a))).toBe(true);
    expect(r.sinDetalle).toContain("980431");
  });

  it("avisa cuando la suma no cuadra con el total del informe", async () => {
    invoke.mockImplementation(async (_n: string, o: { body: { modo: string } }) =>
      o.body.modo === "resumen"
        ? { data: { ...resumen, total: { netaRec: 1, netaImp: 5000 } }, error: null }
        : { data: { filas: [] }, error: null },
    );
    const r = await leerVentasConsolidadas(await pdf(2));
    expect(r.avisos.some((a) => /no cuadra/.test(a))).toBe(true);
  });

  it("si falla la lectura del primer cuadro lanza error", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(leerVentasConsolidadas(await pdf(2))).rejects.toThrow();
  });

  it("rechaza PDFs de mas de 16 paginas", async () => {
    await expect(leerVentasConsolidadas(await pdf(17))).rejects.toThrow(/16/);
  });

  it("no se cae si la respuesta trae filas indefinidas", async () => {
    invoke.mockImplementation(async (_n: string, o: { body: { modo: string } }) =>
      o.body.modo === "resumen" ? { data: resumen, error: null } : { data: {}, error: null },
    );
    const r = await leerVentasConsolidadas(await pdf(3));
    expect(r.empleados).toHaveLength(2);
  });

  it("gira las paginas verticales 270 grados y no toca las apaisadas", async () => {
    responder([]);
    await leerVentasConsolidadas(await pdf(2, true));
    const enviado = invoke.mock.calls[0][1].body.archivos[0].base64 as string;
    const doc = await PDFDocument.load(Buffer.from(enviado, "base64"));
    expect(doc.getPage(0).getRotation().angle).toBe(270);
    invoke.mockReset();
    responder([]);
    await leerVentasConsolidadas(await pdf(2, false));
    const doc2 = await PDFDocument.load(Buffer.from(invoke.mock.calls[0][1].body.archivos[0].base64, "base64"));
    expect(doc2.getPage(0).getRotation().angle).toBe(0);
  });
});
