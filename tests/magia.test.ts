import { describe, expect, it } from "vitest";
import {
  avanceEnCasilla,
  criteriosMagia,
  cuadranteMagia,
  escalaMagia,
  mesCuentaParaMagia,
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

describe("Magia con una sonrisa: plazo (la de un mes se hace del 1 al 5 del siguiente)", () => {
  const dia = (a: number, m: number, d: number) => new Date(a, m - 1, d, 10, 0, 0);

  it("del 1 al 5 toca evaluar el mes que acaba de cerrar y cuenta los días que quedan", () => {
    expect(ventanaMagia(dia(2026, 10, 1))).toEqual({ estado: "abierta", anio: 2026, mes: 9, diasRestantes: 5 });
    expect(ventanaMagia(dia(2026, 10, 2))).toEqual({ estado: "abierta", anio: 2026, mes: 9, diasRestantes: 4 });
    expect(ventanaMagia(dia(2026, 10, 5))).toEqual({ estado: "abierta", anio: 2026, mes: 9, diasRestantes: 1 });
  });

  it("desde el 6 el plazo está vencido y cuenta los días de atraso", () => {
    expect(ventanaMagia(dia(2026, 10, 6))).toEqual({ estado: "vencida", anio: 2026, mes: 9, diasDeAtraso: 1 });
    expect(ventanaMagia(dia(2026, 10, 31))).toEqual({ estado: "vencida", anio: 2026, mes: 9, diasDeAtraso: 26 });
  });

  it("en enero toca evaluar diciembre del año anterior", () => {
    expect(ventanaMagia(dia(2027, 1, 3))).toEqual({ estado: "abierta", anio: 2026, mes: 12, diasRestantes: 3 });
  });

  it("el conteo empieza en septiembre de 2026: antes no hay aviso", () => {
    expect(ventanaMagia(dia(2026, 9, 2))).toEqual({ estado: "sin_aviso" }); // tocaría agosto
    expect(ventanaMagia(dia(2026, 9, 20))).toEqual({ estado: "sin_aviso" });
    expect(mesCuentaParaMagia(2026, 8)).toBe(false);
    expect(mesCuentaParaMagia(2026, 9)).toBe(true);
    expect(mesCuentaParaMagia(2027, 1)).toBe(true);
  });
});

describe("Magia con una sonrisa: PDF", () => {
  const evaluacion = (mes: number, formato: "concept" | "outlet", extra: Record<string, unknown> = {}) =>
    ({
      id: `e${mes}`,
      persona_id: "p",
      evaluador_id: "j",
      anio: 2026,
      mes,
      numero: 1,
      formato,
      fecha: "2026-10-02",
      ...ev(4, 3, 3, 3, 3, 3),
      fortalezas: "Saluda con energía ✨ y conoce las tecnologías.",
      oportunidades: "Hacer más preguntas abiertas — antes de ofrecer producto.",
      confirmada_at: null,
      comentario_evaluado: "",
      ...extra,
    }) as never;

  it("genera la hoja de la evaluación y la plantilla de resultados", async () => {
    const { construirMagiaPdf } = await import("@/lib/magia-pdf");
    const { PDFDocument } = await import("pdf-lib");
    const datos = { evaluado: "María Fernanda Rodríguez Peña", tienda: "MALL PLAZA NQS", nombreEvaluador: () => "Jefatura" };
    const sola = await construirMagiaPdf({ ...datos, evaluacion: evaluacion(9, "outlet") });
    expect((await PDFDocument.load(sola)).getPageCount()).toBe(2);
    const conHistoria = await construirMagiaPdf({
      ...datos,
      evaluacion: evaluacion(12, "concept", { confirmada_at: "2026-12-04T15:00:00Z", comentario_evaluado: "De acuerdo" }),
      anteriores: [9, 10, 11].map((m) => evaluacion(m, "concept", ev(2, 2, 3, 2, 2, 2))),
    });
    expect((await PDFDocument.load(conHistoria)).getPageCount()).toBe(2);
  });

  it("no falla con textos largos, emoji, mucha historia ni una evaluación sin formato guardado", async () => {
    const { construirMagiaPdf } = await import("@/lib/magia-pdf");
    const largo = "Texto muy largo con emoji 😀 y símbolos ≥ ✓ ".repeat(40);
    const bytes = await construirMagiaPdf({
      evaluado: "Nombre Extremadamente Largo Que No Cabe En La Casilla Del Encabezado Del Documento",
      tienda: "Tienda Con Un Nombre Bastante Más Largo De Lo Normal",
      evaluacion: evaluacion(12, "concept", { formato: undefined, fortalezas: largo, oportunidades: largo }),
      anteriores: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((m) => evaluacion(m, "outlet")),
      nombreEvaluador: () => "",
    });
    expect(bytes.length).toBeGreaterThan(1000);
  });
});

describe("Magia en el ranking", () => {
  it("entra por el promedio de la evaluación (1 a 4, un decimal)", async () => {
    const { calcularRanking, RANKING_CONFIG_DEFAULT } = await import("@/lib/ranking");
    const persona = { id: "a", nombre: "A", cargo: "", rol_jerarquico: "asesor_full", foto_path: null } as never;
    const fila = (puntaje: number) =>
      calcularRanking({
        personas: [persona],
        kpis: [],
        magia: [{ persona_id: "a", promedio: puntaje, evaluaciones: 1 }],
        maximizador: [],
        faltas: [],
        extras: [],
        rachas: new Map(),
        ventas: [],
        avance: null,
        config: RANKING_CONFIG_DEFAULT,
      } as never)[0];
    expect(fila(24).scores.magia).toBe(100); // promedio 4,0
    expect(fila(18).scores.magia).toBe(75); // promedio 3,0
    expect(fila(14).scores.magia).toBeCloseTo(57.5, 10); // 14/6 = 2,33 → 2,3 → 2,3/4
  });
});
