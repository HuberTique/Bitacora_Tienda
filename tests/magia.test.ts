import { describe, expect, it } from "vitest";
import {
  avanceEnCasilla,
  criteriosMagia,
  cuadranteMagia,
  escalaMagia,
  normalizarFormato,
  promedioDesdeTotal,
  promedioMagia,
  redondear1,
  resumenMesMagia,
  ventanaMagia,
} from "@/lib/magia";

const ev = (s: number, p: number, x: number, t: number, c: number, f: number) => ({
  c_sonrisa: s,
  c_preguntas: p,
  c_experiencia: x,
  c_tecnologias: t,
  c_cierre: c,
  impresion_final: f,
});

describe("Magia con una sonrisa: formatos de tienda", () => {
  it("un formato desconocido o vacío cae en Concept", () => {
    expect(normalizarFormato("outlet")).toBe("outlet");
    expect(normalizarFormato("concept")).toBe("concept");
    expect(normalizarFormato(undefined)).toBe("concept");
    expect(normalizarFormato("otro")).toBe("concept");
  });

  it("ambos formatos tienen las letras M-A-G-I-A sobre las mismas columnas", () => {
    for (const f of ["concept", "outlet"] as const) {
      const c = criteriosMagia(f);
      expect(c.map((x) => x.letra).join("")).toBe("MAGIA");
      expect(c.map((x) => x.key)).toEqual([
        "c_sonrisa",
        "c_preguntas",
        "c_experiencia",
        "c_tecnologias",
        "c_cierre",
      ]);
    }
  });

  it("Concept y Outlet solo difieren en la segunda y tercera letra", () => {
    const c = criteriosMagia("concept");
    const o = criteriosMagia("outlet");
    expect(c[0].texto).toBe(o[0].texto);
    expect(c[3].texto).toBe(o[3].texto);
    expect(c[4].texto).toBe(o[4].texto);
    expect(c[1].texto).toMatch(/preguntas abiertas/i);
    expect(o[1].texto).toMatch(/reposición, etiquetado y limpieza/i);
    expect(c[2].texto).toMatch(/experiencia excepcional/i);
    expect(o[2].texto).toMatch(/promociones actuales/i);
  });

  it("el nivel 4 se llama distinto en cada formato", () => {
    expect(escalaMagia("concept")[3].label).toBe("Cumple expectativa");
    expect(escalaMagia("outlet")[3].label).toBe("Supera expectativa");
    expect(escalaMagia("concept").slice(0, 3)).toEqual(escalaMagia("outlet").slice(0, 3));
  });
});

describe("Magia con una sonrisa: promedio y casilla", () => {
  it("el promedio es la suma dividida entre los 6 ítems", () => {
    expect(promedioMagia(ev(4, 4, 4, 4, 4, 4))).toBe(4);
    expect(promedioMagia(ev(1, 1, 1, 1, 1, 1))).toBe(1);
    expect(promedioMagia(ev(4, 3, 2, 1, 4, 4))).toBe(3); // 18 / 6
    expect(promedioMagia(ev(3, 3, 3, 3, 3, 4))).toBeCloseTo(19 / 6, 10);
  });

  it("los promedios se llevan a un decimal", () => {
    expect(redondear1(14 / 6)).toBe(2.3); // 2,333…
    expect(redondear1(17 / 6)).toBe(2.8); // 2,833…
    expect(redondear1(19 / 6)).toBe(3.2); // 3,166…
    expect(redondear1(2.5)).toBe(2.5);
  });

  it("la casilla es el promedio a un decimal, redondeado al entero más cercano", () => {
    expect(cuadranteMagia(1)).toBe(1);
    expect(cuadranteMagia(1.4)).toBe(1);
    expect(cuadranteMagia(1.5)).toBe(2);
    expect(cuadranteMagia(14 / 6)).toBe(2); // 2,3
    expect(cuadranteMagia(2.5)).toBe(3);
    expect(cuadranteMagia(19 / 6)).toBe(3); // 3,2
    expect(cuadranteMagia(3.5)).toBe(4);
    expect(cuadranteMagia(4)).toBe(4);
  });

  it("la casilla coincide siempre con el decimal que se muestra", () => {
    // 2,46 se muestra como 2,5: debe caer en la casilla 3, no en la 2.
    expect(redondear1(2.46)).toBe(2.5);
    expect(cuadranteMagia(2.46)).toBe(3);
    expect(cuadranteMagia(2.44)).toBe(2);
  });

  it("el avance dentro de la casilla sigue el decimal (tendencia)", () => {
    expect(avanceEnCasilla(2.5)).toBe(0); // recién entra a la casilla 3
    expect(avanceEnCasilla(3)).toBe(0.5); // en la mitad
    expect(avanceEnCasilla(3.4)).toBe(0.9); // a punto de pasar a la 4
    expect(avanceEnCasilla(1)).toBe(0.5); // el mínimo de la escala
    expect(avanceEnCasilla(4)).toBe(0.5); // el máximo de la escala
    // Misma casilla, mejor promedio: queda más arriba y a la derecha.
    expect(avanceEnCasilla(2.3)).toBeGreaterThan(avanceEnCasilla(1.8));
  });

  it("la casilla nunca se sale de 1 a 4", () => {
    expect(cuadranteMagia(0)).toBe(1);
    expect(cuadranteMagia(9)).toBe(4);
  });

  it("el resumen del mes promedia las evaluaciones que haya", () => {
    expect(resumenMesMagia([])).toBeNull();
    const uno = resumenMesMagia([ev(4, 4, 4, 4, 4, 4)]);
    expect(uno).toEqual({ totalPromedio: 24, promedio: 4, cuadrante: 4 });
    // 24 y 12 puntos → promedio del mes 18/24 → 3,0 → casilla 3
    const dos = resumenMesMagia([ev(4, 4, 4, 4, 4, 4), ev(2, 2, 2, 2, 2, 2)]);
    expect(dos?.totalPromedio).toBe(18);
    expect(dos?.promedio).toBe(3);
    expect(dos?.cuadrante).toBe(3);
  });

  it("promedioDesdeTotal lleva un total sobre 24 a la escala 1 a 4", () => {
    expect(promedioDesdeTotal(24)).toBe(4);
    expect(promedioDesdeTotal(6)).toBe(1);
    expect(promedioDesdeTotal(15)).toBe(2.5);
  });
});

describe("Magia con una sonrisa: ventana de evaluación (del 1 al 5)", () => {
  const dia = (a: number, m: number, d: number) => new Date(a, m - 1, d, 10, 0, 0);

  it("del 1 al 5 está abierta y cuenta los días que quedan, incluido hoy", () => {
    expect(ventanaMagia(dia(2026, 10, 1), 2026, 10)).toEqual({ estado: "abierta", diasRestantes: 5 });
    expect(ventanaMagia(dia(2026, 10, 2), 2026, 10)).toEqual({ estado: "abierta", diasRestantes: 4 });
    expect(ventanaMagia(dia(2026, 10, 5), 2026, 10)).toEqual({ estado: "abierta", diasRestantes: 1 });
  });

  it("desde el 6 está vencida y cuenta los días de atraso", () => {
    expect(ventanaMagia(dia(2026, 10, 6), 2026, 10)).toEqual({ estado: "vencida", diasDeAtraso: 1 });
    expect(ventanaMagia(dia(2026, 10, 31), 2026, 10)).toEqual({ estado: "vencida", diasDeAtraso: 26 });
  });

  it("no aplica al mirar un mes distinto al actual", () => {
    expect(ventanaMagia(dia(2026, 10, 2), 2026, 9)).toEqual({ estado: "otro_mes" });
    expect(ventanaMagia(dia(2026, 10, 2), 2025, 10)).toEqual({ estado: "otro_mes" });
  });
});

describe("Magia con una sonrisa: PDF", () => {
  const evaluacion = (numero: 1 | 2, formato: "concept" | "outlet", extra: Record<string, unknown> = {}) =>
    ({
      id: `e${numero}`,
      persona_id: "p",
      evaluador_id: "j",
      anio: 2026,
      mes: 9,
      numero,
      formato,
      fecha: "2026-09-08",
      ...ev(4, 3, 3, 3, 3, 3),
      fortalezas: "Saluda con energía ✨ y conoce las tecnologías.",
      oportunidades: "Hacer más preguntas abiertas — antes de ofrecer producto.",
      confirmada_at: null,
      comentario_evaluado: "",
      ...extra,
    }) as never;

  it("genera una hoja por evaluación más la plantilla de resultados", async () => {
    const { construirMagiaPdf } = await import("@/lib/magia-pdf");
    const { PDFDocument } = await import("pdf-lib");
    const datos = {
      evaluado: "María Fernanda Rodríguez Peña",
      tienda: "MALL PLAZA NQS",
      anio: 2026,
      mes: 9,
      nombreEvaluador: () => "Jefatura",
    };
    const una = await construirMagiaPdf({ ...datos, evaluaciones: [evaluacion(1, "outlet")] });
    expect((await PDFDocument.load(una)).getPageCount()).toBe(2);
    const dos = await construirMagiaPdf({
      ...datos,
      evaluaciones: [
        evaluacion(2, "concept", { confirmada_at: "2026-09-23T15:00:00Z", comentario_evaluado: "De acuerdo" }),
        evaluacion(1, "concept"),
      ],
    });
    expect((await PDFDocument.load(dos)).getPageCount()).toBe(3);
  });

  it("no falla con textos largos, emoji ni una evaluación sin formato guardado", async () => {
    const { construirMagiaPdf } = await import("@/lib/magia-pdf");
    const largo = "Texto muy largo con emoji 😀 y símbolos ≥ ✓ ".repeat(40);
    const bytes = await construirMagiaPdf({
      evaluado: "Nombre Extremadamente Largo Que No Cabe En La Casilla Del Encabezado Del Documento",
      tienda: "Tienda Con Un Nombre Bastante Más Largo De Lo Normal",
      anio: 2026,
      mes: 12,
      evaluaciones: [evaluacion(1, "concept", { formato: undefined, fortalezas: largo, oportunidades: largo })],
      nombreEvaluador: () => "",
    });
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
