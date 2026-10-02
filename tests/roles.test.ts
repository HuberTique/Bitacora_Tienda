import { describe, expect, it } from "vitest";
import { esMando, rolDeAcceso } from "@/lib/types";

describe("Rol de acceso: jefatura solo para jefe de tienda y subjefes", () => {
  it("jefe de tienda y subjefe entran como jefatura", () => {
    expect(rolDeAcceso("jefe_tienda")).toBe("jefatura");
    expect(rolDeAcceso("subjefe")).toBe("jefatura");
    expect(esMando("jefe_tienda")).toBe(true);
    expect(esMando("subjefe")).toBe(true);
  });

  it("cajeros, full-time y part-time entran como asesor", () => {
    expect(rolDeAcceso("cajero")).toBe("asesor");
    expect(rolDeAcceso("full_time")).toBe("asesor");
    expect(rolDeAcceso("part_time")).toBe("asesor");
    expect(esMando("cajero")).toBe(false);
  });
});
