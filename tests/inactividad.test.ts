import { describe, expect, it } from "vitest";
import { AVISO_ANTES_MS, LIMITE_INACTIVIDAD_MS, estadoInactividad } from "@/lib/inactividad";

describe("cierre de sesión por inactividad", () => {
  const ahora = 1_000_000_000;
  const min = 60_000;

  it("15 minutos para todos, con aviso un minuto antes", () => {
    expect(LIMITE_INACTIVIDAD_MS).toBe(15 * min);
    expect(AVISO_ANTES_MS).toBe(min);
  });

  it("en uso: no hace nada", () => {
    expect(estadoInactividad(ahora - 5 * min, ahora).accion).toBe("nada");
  });

  it("en el último minuto avisa con el tiempo que queda", () => {
    const e = estadoInactividad(ahora - 14.5 * min, ahora);
    expect(e.accion).toBe("avisar");
    expect(e.restanteMs).toBe(30_000);
  });

  it("a los 15 minutos (o al volver a abrir la app mucho después) cierra", () => {
    expect(estadoInactividad(ahora - 15 * min, ahora).accion).toBe("cerrar");
    expect(estadoInactividad(ahora - 3 * 60 * min, ahora).accion).toBe("cerrar");
  });

  it("sin registro de actividad todavía no cierra", () => {
    expect(estadoInactividad(null, ahora).accion).toBe("nada");
  });
});
