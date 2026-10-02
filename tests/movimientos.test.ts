import { describe, expect, it } from "vitest";
import { fechaCorta, problemaClave } from "@/lib/ambito";
import { describirHuella, indexarHuellas, type Huella } from "@/lib/huellas";

const huella = (o: Partial<Huella>): Huella => ({
  tabla: "pendientes",
  registro_id: "a",
  accion: "creo",
  persona_nombre: "Ana Pérez",
  persona_codigo: "123",
  tienda_origen: 690,
  creado_at: "2026-10-02T15:00:00Z",
  ...o,
});

describe("huellas de reemplazo", () => {
  it("describe quién, de dónde y cuándo", () => {
    expect(describirHuella(huella({}))).toMatch(/^Lo creó Ana Pérez \(CM 123\), de reemplazo desde la tienda 690, el \d{2}\/10$/);
    expect(describirHuella(huella({ accion: "cambio", persona_codigo: null, tienda_origen: null }))).toMatch(
      /^Lo modificó Ana Pérez, de reemplazo, el /,
    );
  });

  it("agrupa por registro en orden de tiempo e ignora las cargas masivas", () => {
    const m = indexarHuellas([
      huella({ accion: "cambio", creado_at: "2026-10-03T10:00:00Z" }),
      huella({}),
      huella({ registro_id: null, tabla: "horarios" }),
      huella({ registro_id: "b" }),
    ]);
    expect(m.size).toBe(2);
    expect(m.get("pendientes:a")!.map((h) => h.accion)).toEqual(["creo", "cambio"]);
  });
});

describe("clave nueva tras un reintegro", () => {
  it("asesor: PIN de 6 a 8 dígitos", () => {
    expect(problemaClave("asesor", "12345", "12345")).not.toBeNull();
    expect(problemaClave("asesor", "abc123", "abc123")).not.toBeNull();
    expect(problemaClave("asesor", "123456", "123456")).toBeNull();
  });
  it("jefatura: 8 caracteres con letras y números", () => {
    expect(problemaClave("jefatura", "12345678", "12345678")).not.toBeNull();
    expect(problemaClave("jefatura", "abcd1234", "abcd1234")).toBeNull();
  });
  it("las dos claves deben coincidir", () => {
    expect(problemaClave("jefatura", "abcd1234", "abcd1235")).toBe("Las dos claves no coinciden.");
  });
  it("fecha corta", () => {
    expect(fechaCorta("2026-10-09")).toBe("09/10");
    expect(fechaCorta(null)).toBe("");
  });
});
