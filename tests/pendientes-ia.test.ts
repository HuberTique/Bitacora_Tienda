import { describe, expect, it } from "vitest";
import {
  borradoresDesdeLectura,
  enlazarPersona,
  filaPendiente,
  problemaBorrador,
  turnoPorHora,
} from "@/lib/pendientes-ia";
import type { RosterPublico } from "@/lib/types";

const p = (id: string, nombre: string, rol: "jefatura" | "asesor"): RosterPublico =>
  ({ id, nombre, cargo: "cargo", rol, rol_jerarquico: "full_time", foto_path: null }) as RosterPublico;

const roster = [
  p("j1", "Huber Tique Poloche", "jefatura"),
  p("j2", "Ana Milena Ramos", "jefatura"),
  p("a1", "Andrea Carolina Quintana", "asesor"),
  p("a2", "Andres Camilo Macias", "asesor"),
  p("a3", "Sofía Aracely Murcia Espitia", "asesor"),
];
const opciones = { roster, responsablePorDefecto: "j1", turnoPorDefecto: "Tarde" as const };

describe("Bitácora: enlazar a la persona que menciona el documento", () => {
  it("encuentra el nombre exacto sin importar tildes ni mayúsculas", () => {
    expect(enlazarPersona("SOFIA ARACELY MURCIA ESPITIA", roster)?.id).toBe("a3");
    expect(enlazarPersona("andrea carolina quintana", roster)?.id).toBe("a1");
  });

  it("acepta un nombre parcial si coincide en dos palabras o más", () => {
    expect(enlazarPersona("Quintana, Andrea Carolina", roster)?.id).toBe("a1");
    expect(enlazarPersona("Camilo Macias", roster)?.id).toBe("a2");
  });

  it("no asigna a nadie si solo coincide una palabra, hay empate o no existe", () => {
    expect(enlazarPersona("Andrea", roster)).toBeNull(); // una sola palabra
    expect(enlazarPersona("Pedro Pérez", roster)).toBeNull();
    expect(enlazarPersona("", roster)).toBeNull();
    const repetidos = [p("x1", "Juan Carlos Rojas", "asesor"), p("x2", "Juan Carlos Mora", "asesor")];
    expect(enlazarPersona("Juan Carlos", repetidos)).toBeNull(); // empate: mejor no adivinar
  });
});

describe("Bitácora: borradores a partir de la lectura de la IA", () => {
  it("arma un borrador completo y lo enlaza al asesor mencionado", () => {
    const r = borradoresDesdeLectura(
      {
        contexto: "Correo de la DSM sobre el cambio de vitrina.",
        pendientes: [
          {
            titulo: "Cambiar vitrina principal",
            area: "visual",
            turno: "Mañana",
            fecha_ejecucion: "2026-10-05",
            asesor: "Andrea Carolina Quintana",
            descripcion: "Montar la campaña nueva.",
          },
        ],
      },
      opciones,
    );
    expect(r.contexto).toBe("Correo de la DSM sobre el cambio de vitrina.");
    expect(r.borradores).toEqual([
      {
        incluir: true,
        titulo: "Cambiar vitrina principal",
        area: "visual",
        turno: "Mañana",
        fechaEjecucion: "2026-10-05",
        responsableId: "j1",
        asesorId: "a1",
        descripcion: "Montar la campaña nueva.",
        personaSinEnlazar: null,
      },
    ]);
  });

  it("si la persona mencionada es de jefatura, queda como responsable y no como asesor", () => {
    const r = borradoresDesdeLectura({ pendientes: [{ titulo: "Enviar reporte", asesor: "Ana Milena Ramos" }] }, opciones);
    expect(r.borradores[0].responsableId).toBe("j2");
    expect(r.borradores[0].asesorId).toBe("");
  });

  it("corrige lo que la IA devuelva fuera de las opciones del tablero", () => {
    const r = borradoresDesdeLectura(
      { pendientes: [{ titulo: "Revisar algo", area: "finanzas", turno: "Noche", fecha_ejecucion: "5 de octubre" }] },
      opciones,
    );
    expect(r.borradores[0].area).toBe("otros");
    expect(r.borradores[0].turno).toBe("Tarde"); // el turno por defecto
    expect(r.borradores[0].fechaEjecucion).toBe(""); // fecha inválida: no se inventa
  });

  it("avisa cuando el documento nombra a alguien que no está en el equipo", () => {
    const r = borradoresDesdeLectura({ pendientes: [{ titulo: "Llamar al proveedor", asesor: "Pedro Pérez" }] }, opciones);
    expect(r.borradores[0].asesorId).toBe("");
    expect(r.borradores[0].responsableId).toBe("j1");
    expect(r.borradores[0].personaSinEnlazar).toBe("Pedro Pérez");
  });

  it("descarta entradas sin título y respuestas mal formadas", () => {
    expect(borradoresDesdeLectura({ pendientes: [{ titulo: "  " }, null, "texto", { descripcion: "x" }] }, opciones).borradores).toEqual([]);
    expect(borradoresDesdeLectura({ pendientes: "nada" }, opciones).borradores).toEqual([]);
    expect(borradoresDesdeLectura({}, opciones)).toEqual({ contexto: "", borradores: [], truncado: false });
  });
});

describe("Bitácora: guardar un borrador revisado", () => {
  const base = borradoresDesdeLectura(
    { pendientes: [{ titulo: " Reponer maniquí ", area: "visual", descripcion: "Vitrina 2." }] },
    opciones,
  ).borradores[0];

  it("la fila lleva el origen y, solo si se pide, el contexto", () => {
    const sin = filaPendiente(base, { creadoPor: "j1", origen: "correo.pdf", contexto: null });
    expect(sin).toEqual({
      titulo: "Reponer maniquí",
      area: "visual",
      turno: "Tarde",
      responsable_id: "j1",
      asesor_id: null,
      descripcion: "Vitrina 2.\n\nOrigen: correo.pdf",
      estado: "abierto",
      created_by: "j1",
    });
    const con = filaPendiente({ ...base, fechaEjecucion: "2026-10-05" }, { creadoPor: "j1", origen: "correo.pdf", contexto: "Correo de la DSM." });
    expect(con.descripcion).toBe("Vitrina 2.\n\nContexto: Correo de la DSM.\n\nOrigen: correo.pdf");
    expect(con.fecha_ejecucion).toBe("2026-10-05");
  });

  it("no deja guardar un borrador sin título o sin responsable", () => {
    expect(problemaBorrador(base)).toBeNull();
    expect(problemaBorrador({ ...base, titulo: " " })).toBe("le falta el título");
    expect(problemaBorrador({ ...base, responsableId: "" })).toBe("le falta el responsable");
  });

  it("el turno por defecto sale de la hora", () => {
    expect(turnoPorHora(9)).toBe("Mañana");
    expect(turnoPorHora(12)).toBe("Tarde");
    expect(turnoPorHora(16)).toBe("Tarde");
    expect(turnoPorHora(17)).toBe("Cierre");
  });
});
