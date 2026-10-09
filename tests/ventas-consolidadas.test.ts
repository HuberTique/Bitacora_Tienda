import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { functions: { invoke } } }));
// Las fotos se preparan con canvas en el navegador: aquí cada foto pasa tal cual.
vi.mock("@/lib/ventas-pdf", () => ({
  fotoCompleta: async (f: File) => ({ base64: f.name, mime: "image/jpeg" }),
}));

import { leerVentasConsolidadas, unirLecturas } from "@/lib/ventas-consolidadas";

async function pdf(paginas: number, vertical = true): Promise<File> {
  const d = await PDFDocument.create();
  for (let i = 0; i < paginas; i++) d.addPage(vertical ? [600, 800] : [800, 600]);
  const bytes = await d.save();
  return new File([bytes as BlobPart], "ventas.pdf", { type: "application/pdf" });
}
const foto = (nombre: string) => new File(["x"], nombre, { type: "image/jpeg" });

const resumen = {
  titulo: "Visión general de ventas",
  tienda: "Tienda: 690 - BOGOTA-CALIMA",
  rango: ["2026-08-30", "2026-09-22"],
  total: { netaRec: 25, netaImp: 1000 },
  filas: [
    { cm: "980431", nombre: "ANDREA", netaRec: 10, netaImp: 400 },
    { cm: "981416", nombre: "LISSETH", netaRec: 12, netaImp: 500 },
    { cm: "9999", nombre: "HOUSE ACCOUNT", netaRec: 3, netaImp: 100 },
  ],
};

function responder(detalle: unknown[] | (() => never)) {
  invoke.mockImplementation(async (...args: unknown[]) => {
    const o = args[1] as { body: { modo: string } };
    if (o.body.modo === "resumen") return { data: resumen, error: null };
    if (typeof detalle === "function") detalle();
    return { data: { filas: detalle }, error: null };
  });
}

beforeEach(() => {
  invoke.mockReset();
});

describe("leerVentasConsolidadas (PDF): solo unidades por categoría", () => {
  it("une resumen y detalle por CM, deja fuera la cuenta 9999 y verifica las unidades", async () => {
    responder([
      { cm: "980431", nombre: "ANDREA", tipo: "Footwear", netaRec: 6 },
      { cm: "980431", nombre: "ANDREA", tipo: "Apparel", netaRec: 3 },
      { cm: "980431", nombre: "ANDREA", tipo: "Accessories", netaRec: 1 },
      { cm: "981416", nombre: "LISSETH", tipo: "Footwear", netaRec: 12 },
    ]);
    const r = await leerVentasConsolidadas(await pdf(4));
    expect(r.empleados.map((e) => e.cm)).toEqual(["980431", "981416"]);
    expect(r.totalUnidades).toBe(25);
    expect(r.avisos).toEqual([]);
    const a = r.empleados[0];
    expect([a.unidades, a.pares, a.ropa, a.acc]).toEqual([10, 6, 3, 1]);
    // Lisseth solo tiene footwear: ropa y accesorios en 0 (hay detalle leído).
    expect([r.empleados[1].pares, r.empleados[1].ropa, r.empleados[1].acc]).toEqual([12, 0, 0]);
    expect(r.rango).toEqual(["2026-08-30", "2026-09-22"]);
    expect(r.empleados[0]).not.toHaveProperty("netaImp");
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
    expect(r.avisos.some((a) => /no se pudieron leer/.test(a))).toBe(true);
    expect(r.sinDetalle).toContain("980431");
  });

  it("avisa cuando pares + accesorios + ropa no da las unidades del Resumen", async () => {
    responder([{ cm: "980431", nombre: "ANDREA", tipo: "Footwear", netaRec: 4 }]);
    const r = await leerVentasConsolidadas(await pdf(2));
    expect(r.avisos.some((a) => /no da las unidades/.test(a) && /980431/.test(a))).toBe(true);
  });

  it("avisa cuando las unidades del Resumen no suman el total del informe", async () => {
    invoke.mockImplementation(async (_n: string, o: { body: { modo: string } }) =>
      o.body.modo === "resumen"
        ? { data: { ...resumen, total: { netaRec: 40, netaImp: 5000 } }, error: null }
        : { data: { filas: [] }, error: null },
    );
    const r = await leerVentasConsolidadas(await pdf(2));
    expect(r.avisos.some((a) => /suman 25/.test(a))).toBe(true);
  });

  it("si falla la lectura del primer cuadro lanza error", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(leerVentasConsolidadas(await pdf(2))).rejects.toThrow();
  });

  it("rechaza PDFs de más de 16 páginas", async () => {
    await expect(leerVentasConsolidadas(await pdf(17))).rejects.toThrow(/16/);
  });

  it("un archivo que no es PDF da un mensaje claro", async () => {
    const malo = new File(["<html>no soy un pdf</html>"], "consolidadas.pdf", { type: "application/pdf" });
    await expect(leerVentasConsolidadas(malo)).rejects.toThrow(/no se pudo abrir como PDF/);
  });

  it("no se cae si la respuesta trae filas indefinidas", async () => {
    invoke.mockImplementation(async (_n: string, o: { body: { modo: string } }) =>
      o.body.modo === "resumen" ? { data: resumen, error: null } : { data: {}, error: null },
    );
    const r = await leerVentasConsolidadas(await pdf(3));
    expect(r.empleados).toHaveLength(2);
  });

  it("gira las páginas verticales 270 grados y no toca las apaisadas", async () => {
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

describe("leerVentasConsolidadas (fotos de las hojas)", () => {
  it("cada foto se lee en modo foto y las hojas se unen por CM", async () => {
    const porFoto: Record<string, unknown> = {
      "hoja1.jpg": {
        titulo: "Visión general de ventas",
        tienda: "691 - BOGOTA-CENTRO MAYOR",
        rango: ["2026-10-04", "2026-10-07"],
        resumen: [{ cm: "981001", nombre: "KEVIN", netaRec: 9 }, { cm: "9999", nombre: "HOUSE", netaRec: 2 }],
        filas: [{ cm: "981001", nombre: "KEVIN", tipo: "Footwear", netaRec: 7 }],
      },
      "hoja2.jpg": {
        titulo: null,
        tienda: null,
        rango: null,
        resumen: [],
        filas: [
          { cm: "981001", nombre: "KEVIN", tipo: "Accessories", netaRec: 2 },
          { cm: "981002", nombre: "CELSO", tipo: "Footwear", netaRec: 5 },
        ],
      },
    };
    invoke.mockImplementation(async (_n: string, o: { body: { modo: string; archivos: { base64: string }[] } }) => {
      expect(o.body.modo).toBe("foto");
      return { data: porFoto[o.body.archivos[0].base64], error: null };
    });
    const avance: number[] = [];
    const r = await leerVentasConsolidadas([foto("hoja1.jpg"), foto("hoja2.jpg")], "auto", (h) => avance.push(h));
    expect(r.tienda).toBe("691 - BOGOTA-CENTRO MAYOR");
    expect(r.rango).toEqual(["2026-10-04", "2026-10-07"]);
    expect(r.empleados).toEqual([
      { cm: "981001", nombre: "KEVIN", unidades: 9, pares: 7, ropa: 0, acc: 2 },
      { cm: "981002", nombre: "CELSO", unidades: null, pares: 5, ropa: 0, acc: 0 },
    ]);
    expect(r.avisos).toEqual([]);
    expect(avance.at(-1)).toBe(2);
  });

  it("si una foto falla, se usan las demás y se avisa", async () => {
    invoke.mockImplementation(async (_n: string, o: { body: { archivos: { base64: string }[] } }) =>
      o.body.archivos[0].base64 === "mala.jpg"
        ? { data: null, error: { message: "timeout" } }
        : { data: { resumen: [], filas: [{ cm: "981002", nombre: "CELSO", tipo: "Footwear", netaRec: 5 }] }, error: null },
    );
    const r = await leerVentasConsolidadas([foto("buena.jpg"), foto("mala.jpg")]);
    expect(r.empleados.map((e) => e.cm)).toEqual(["981002"]);
    expect(r.avisos.some((a) => /1 de 2 partes/.test(a))).toBe(true);
  });
});

describe("unirLecturas", () => {
  it("en pedazos que se solapan toma la lectura mayor del Resumen y no repite personas", () => {
    const r = unirLecturas([
      { resumen: [{ cm: "1", nombre: "A", netaRec: 1 }], detalle: [] },
      { resumen: [{ cm: "1", nombre: "A", netaRec: 12 }], detalle: [{ cm: "1", nombre: "A", tipo: "Footwear", netaRec: 12 }] },
    ]);
    expect(r.empleados).toEqual([{ cm: "1", nombre: "A", unidades: 12, pares: 12, ropa: 0, acc: 0 }]);
  });

  it("sin ninguna persona lanza error", () => {
    expect(() => unirLecturas([{ resumen: [{ cm: "9999", nombre: "HOUSE", netaRec: 3 }] }])).toThrow(/No encontré/);
  });
});
