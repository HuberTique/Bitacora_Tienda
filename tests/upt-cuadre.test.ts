import { describe, expect, it } from "vitest";
import { uptCalculado, uptQueNoCuadra } from "@/lib/upt-cuadre";

describe("cuadre del UPT de Xstore con unidades ÷ TRX", () => {
  it("unidades ÷ TRX como el Excel de la tienda", () => {
    expect(uptCalculado(120, 100)).toBe(1.2);
    expect(uptCalculado(120, 0)).toBeNull();
    expect(uptCalculado(null, 100)).toBeNull();
  });

  it("dentro de 0,1 cuadra; más de 0,1 avisa con el valor calculado", () => {
    expect(uptQueNoCuadra(1.2, 125, 100)).toBeNull(); // 1,25
    expect(uptQueNoCuadra(1.2, 141, 100)).toBeCloseTo(1.41);
    expect(uptQueNoCuadra(null, 141, 100)).toBeNull();
  });
});
