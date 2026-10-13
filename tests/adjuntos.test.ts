import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { normalizarUrl, similitudTitulos } from "@/lib/adjuntos";

describe("enlaces de los pendientes", () => {
  it("acepta direcciones web y les pone https:// si falta", () => {
    expect(normalizarUrl("https://forms.office.com/r/abc")).toBe("https://forms.office.com/r/abc");
    expect(normalizarUrl("forms.office.com/r/abc")).toBe("https://forms.office.com/r/abc");
    expect(normalizarUrl("  http://intranet.skechers.co/x ")).toBe("http://intranet.skechers.co/x");
  });
  it("rechaza lo que no es una página web", () => {
    expect(normalizarUrl("javascript:alert(1)")).toBeNull();
    expect(normalizarUrl("mailto:a@b.co")).toBeNull();
    expect(normalizarUrl("hola")).toBeNull();
    expect(normalizarUrl("")).toBeNull();
  });
});

describe("pendiente parecido a uno anterior", () => {
  it("mismo trámite con otra fecha o número: parecido", () => {
    expect(similitudTitulos("Recibir embarque del centro de distribución", "Recibir embarque del CD 321676")).toBeGreaterThanOrEqual(0.6);
    expect(similitudTitulos("Subir inventario mensual a Okta", "Subir el inventario mensual")).toBeGreaterThanOrEqual(0.6);
  });
  it("tareas distintas: no", () => {
    expect(similitudTitulos("Reponer maniquí vitrina 2", "Recibir embarque del centro de distribución")).toBe(0);
    expect(similitudTitulos("", "Recibir embarque")).toBe(0);
  });
});
