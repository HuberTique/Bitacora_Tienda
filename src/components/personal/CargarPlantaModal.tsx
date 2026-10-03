"use client";

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { downloadBlob } from "@/lib/pdfs";
import { useTienda } from "@/lib/tienda-config";
import { rolDeAcceso, type Persona } from "@/lib/types";
import {
  claveTemporal,
  excelClaves,
  leerPlanta,
  plantillaPlanta,
  validarPlanta,
  type FilaPlanta,
} from "@/lib/planta-excel";

const ETIQUETA_ROL: Record<string, string> = {
  jefe_tienda: "Jefe de tienda",
  subjefe: "Subjefe",
  cajero: "Cajero",
  full_time: "Full time",
  part_time: "Part time",
};

type Creado = { nombre: string; usuario: string; clave: string; rol: string };

async function mensajeDeFuncion(error: unknown, data: unknown): Promise<string> {
  const d = (data as { error?: string } | null)?.error;
  if (d) return d;
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx instanceof Response) {
    try {
      const cuerpo = (await ctx.clone().json()) as { error?: string };
      if (cuerpo?.error) return cuerpo.error;
    } catch {
      /* la respuesta no era JSON */
    }
  }
  return error instanceof Error ? error.message : "No se pudo crear.";
}

/**
 * Personal → Cargar planta desde Excel. El jefe sube su equipo, revisa lo leído
 * y lo aprueba; cada persona queda con una clave temporal que debe cambiar al
 * entrar. Al final se descarga la lista de accesos para entregarlos.
 */
export function CargarPlantaModal({
  editor,
  existentes,
  onClose,
  onCargada,
}: {
  editor: Persona;
  existentes: Persona[];
  onClose: () => void;
  onCargada: () => void;
}) {
  const tienda = useTienda();
  const input = useRef<HTMLInputElement>(null);
  const [filas, setFilas] = useState<(FilaPlanta & { incluir: boolean })[] | null>(null);
  const [archivo, setArchivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [progreso, setProgreso] = useState<{ hechos: number; total: number } | null>(null);
  const [creados, setCreados] = useState<Creado[] | null>(null);
  const [fallos, setFallos] = useState<string[]>([]);
  const puedeSubjefes = !!editor.es_admin || editor.rol_jerarquico === "jefe_tienda";

  async function elegir(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError(null);
    setLeyendo(true);
    const r = await leerPlanta(await f.arrayBuffer());
    setLeyendo(false);
    if ("error" in r) return setError(r.error);
    const validadas = validarPlanta(
      r,
      {
        codigos: new Set(existentes.map((p) => (p.codigo ?? "").trim()).filter(Boolean)),
        cedulas: new Set(existentes.map((p) => (p.cedula ?? "").trim()).filter(Boolean)),
      },
      puedeSubjefes,
    );
    setArchivo(f.name);
    setFilas(validadas.map((v) => ({ ...v, incluir: v.problemas.length === 0 })));
  }

  async function descargarPlantilla() {
    downloadBlob(await plantillaPlanta(), "Plantilla_planta.xlsx");
  }

  const aprobadas = (filas ?? []).filter((f) => f.incluir && f.problemas.length === 0);

  async function aprobar() {
    if (aprobadas.length === 0) return;
    if (!confirm(`Vas a crear ${aprobadas.length} persona(s) en ${tienda.nombre}. ¿Aprobar la planta?`)) return;
    setError(null);
    setProgreso({ hechos: 0, total: aprobadas.length });
    const ok: Creado[] = [];
    const mal: string[] = [];
    for (let i = 0; i < aprobadas.length; i++) {
      const f = aprobadas[i];
      const rolJ = f.rol_jerarquico!;
      const clave = claveTemporal(rolJ);
      const { data, error: e } = await supabase.functions.invoke("crear-persona", {
        body: {
          nombre: f.nombre,
          codigo: f.codigo,
          cedula: f.cedula,
          cargo: f.cargo || ETIQUETA_ROL[rolJ],
          rol: rolDeAcceso(rolJ),
          rol_jerarquico: rolJ,
          correo: rolJ === "subjefe" ? f.correo : null,
          clave,
        },
      });
      if (e || (data as { error?: string } | null)?.error) {
        mal.push(`Fila ${f.fila} (${f.nombre}): ${await mensajeDeFuncion(e, data)}`);
      } else {
        ok.push({ nombre: f.nombre, usuario: rolJ === "subjefe" ? f.correo : f.codigo, clave, rol: ETIQUETA_ROL[rolJ] });
      }
      setProgreso({ hechos: i + 1, total: aprobadas.length });
    }
    setProgreso(null);
    setCreados(ok);
    setFallos(mal);
  }

  async function descargarAccesos() {
    if (!creados) return;
    downloadBlob(await excelClaves(creados, tienda.nombre), `Accesos_${tienda.nombre.replace(/\s+/g, "_")}.xlsx`);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={creados ? undefined : onClose}>
      <div
        className="bg-panel text-ink rounded-[10px] p-6 w-full max-w-4xl relative shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {!creados && !progreso && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 right-3 text-muted hover:text-ink text-lg leading-none"
            aria-label="Cerrar"
          >
            ✕
          </button>
        )}
        <h3 className="font-display font-semibold text-base mb-1 pr-8">Cargar planta desde Excel — {tienda.nombre}</h3>

        {creados ? (
          <>
            <div className="bg-emerald-50 text-operaciones border border-emerald-200 rounded-md px-3 py-2 text-[13px] mt-2">
              Se crearon {creados.length} persona(s). Descarga la lista de accesos <strong>ahora</strong>: las claves
              temporales no se vuelven a mostrar.
            </div>
            {fallos.length > 0 && (
              <div className="mt-2 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs whitespace-pre-line">
                {`No se pudieron crear ${fallos.length}:\n${fallos.join("\n")}`}
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={descargarAccesos}
                disabled={creados.length === 0}
                className="flex-1 py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50"
              >
                ⬇ Descargar accesos (Excel)
              </button>
              <button
                type="button"
                onClick={() => {
                  if (creados.length > 0 && !confirm("¿Ya descargaste los accesos? Las claves no se vuelven a mostrar.")) return;
                  onCargada();
                }}
                className="px-4 py-2.5 border border-line rounded-md bg-white text-sm"
              >
                Terminar
              </button>
            </div>
          </>
        ) : !filas ? (
          <>
            <p className="text-muted text-[12.5px] mb-3">
              Llena la plantilla con tu equipo (una persona por fila) y súbela. Revisas lo leído y apruebas; a cada persona
              se le genera una clave temporal que cambia en su primer ingreso.
            </p>
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={descargarPlantilla}
                className="px-3 py-2 rounded-md border border-line bg-white text-sm font-semibold hover:bg-paper"
              >
                ⬇ Descargar plantilla
              </button>
              <button
                type="button"
                onClick={() => input.current?.click()}
                disabled={leyendo}
                className="px-3 py-2 rounded-md bg-brand text-white text-sm font-semibold disabled:opacity-50"
              >
                {leyendo ? "Leyendo…" : "Subir Excel"}
              </button>
              <input ref={input} type="file" accept=".xlsx" hidden onChange={elegir} />
            </div>
            {!puedeSubjefes && (
              <p className="text-[11.5px] text-muted mt-2">A los subjefes los registra el jefe de tienda.</p>
            )}
          </>
        ) : (
          <>
            <p className="text-muted text-[12.5px] mb-2">
              {archivo} · {filas.length} persona(s) leída(s). Las filas con problemas no se crean; corrígelas en el Excel y
              vuelve a subirlo, o desmárcalas.
            </p>
            <div className="bg-white border border-line rounded-md overflow-x-auto">
              <table className="w-full text-[12.5px] min-w-[720px]">
                <thead>
                  <tr className="text-left text-muted uppercase tracking-wider text-[10.5px] border-b border-line">
                    <th className="px-2 py-2 w-8" />
                    <th className="px-2 py-2">Nombre</th>
                    <th className="px-2 py-2">CM</th>
                    <th className="px-2 py-2">Cédula</th>
                    <th className="px-2 py-2">Rol</th>
                    <th className="px-2 py-2">Correo</th>
                    <th className="px-2 py-2">Revisión</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, i) => (
                    <tr key={f.fila} className="border-b border-line/60 last:border-0 align-top">
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={f.incluir}
                          disabled={f.problemas.length > 0}
                          onChange={(e) =>
                            setFilas((l) => l!.map((x, j) => (j === i ? { ...x, incluir: e.target.checked } : x)))
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5">{f.nombre || "—"}</td>
                      <td className="px-2 py-1.5 font-mono">{f.codigo || "—"}</td>
                      <td className="px-2 py-1.5 font-mono">{f.cedula || "—"}</td>
                      <td className="px-2 py-1.5">{f.rol_jerarquico ? ETIQUETA_ROL[f.rol_jerarquico] : f.rolTexto || "—"}</td>
                      <td className="px-2 py-1.5">{f.correo || "—"}</td>
                      <td className="px-2 py-1.5">
                        {f.problemas.length === 0 ? (
                          <span className="text-operaciones font-semibold">✓ Lista</span>
                        ) : (
                          <span className="text-warn text-[11.5px]">{f.problemas.join(" ")}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {error && <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">{error}</div>}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setFilas(null)}
                disabled={!!progreso}
                className="px-3 py-2.5 border border-line rounded-md bg-white text-sm disabled:opacity-50"
              >
                ← Subir otro archivo
              </button>
              <button
                type="button"
                onClick={aprobar}
                disabled={!!progreso || aprobadas.length === 0}
                className="flex-1 py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50"
              >
                {progreso
                  ? `Creando ${progreso.hechos} de ${progreso.total}…`
                  : `Aprobar y crear ${aprobadas.length} persona(s)`}
              </button>
            </div>
          </>
        )}
        {error && !filas && (
          <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">{error}</div>
        )}
      </div>
    </div>
  );
}
