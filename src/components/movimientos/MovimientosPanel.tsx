"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fechaCorta } from "@/lib/ambito";

export type MovimientoTienda = {
  id: string;
  persona_id: string;
  persona_nombre: string;
  persona_cargo: string;
  persona_codigo: string | null;
  tipo: "reemplazo" | "traslado";
  estado: "solicitado" | "activo" | "rechazado" | "terminado" | "completado" | "cancelado";
  vigente: boolean;
  /** true: llega a esta tienda. false: es de esta tienda y está (o va) en otra. */
  entra: boolean;
  desde: string | null;
  hasta: string | null;
  motivo: string;
  solicitado_at: string;
  origen_numero: number;
  origen_nombre: string;
  destino_numero: number;
  destino_nombre: string;
};

const ESTADO: Record<MovimientoTienda["estado"], string> = {
  solicitado: "Solicitado",
  activo: "Activo",
  rechazado: "Rechazado",
  terminado: "Terminado",
  completado: "Trasladado",
  cancelado: "Cancelado",
};

const boton = "px-2.5 py-1.5 rounded-md text-xs font-semibold disabled:opacity-50";

/**
 * Personal → Reemplazos y traslados. La jefatura de la tienda que recibe acepta
 * o rechaza a quien pide entrar y puede terminar un reemplazo; la jefatura de la
 * tienda de origen confirma la baja por traslado.
 */
export function MovimientosPanel({ onCambio }: { onCambio: () => void }) {
  const [lista, setLista] = useState<MovimientoTienda[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [verHistorial, setVerHistorial] = useState(false);

  // Sube cada vez que algo cambia, para volver a leer la lista.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let vivo = true;
    supabase.rpc("movimientos_de_tienda").then(({ data, error: e }) => {
      // Si la función aún no existe (migración sin aplicar) el panel no aparece.
      if (vivo && !e) setLista((data as MovimientoTienda[] | null) ?? []);
    });
    return () => {
      vivo = false;
    };
  }, [version]);

  async function ejecutar(id: string, fn: string, args: Record<string, unknown>, confirmar?: string) {
    if (confirmar && !window.confirm(confirmar)) return;
    setError(null);
    setOcupado(id);
    const { error: e } = await supabase.rpc(fn, args);
    setOcupado(null);
    if (e) return setError(e.message);
    setVersion((v) => v + 1);
    onCambio();
  }

  const abiertos = lista.filter((m) => m.estado === "solicitado" || m.vigente);
  const historial = lista.filter((m) => !(m.estado === "solicitado" || m.vigente));
  if (lista.length === 0) return null;

  return (
    <div className="bg-panel border border-line rounded-[10px] px-4 py-3 mb-4">
      <div className="text-[13px] font-semibold mb-2">Reemplazos y traslados</div>

      {abiertos.length === 0 && (
        <p className="text-muted text-[12.5px]">No hay reemplazos ni traslados abiertos.</p>
      )}

      <div className="space-y-2">
        {abiertos.map((m) => {
          const quien = (
            <>
              <strong>{m.persona_nombre}</strong>
              <span className="text-muted">
                {" "}
                · {m.persona_cargo}
                {m.persona_codigo ? ` · CM ${m.persona_codigo}` : ""}
              </span>
            </>
          );
          const cuando = m.tipo === "reemplazo" ? `reemplazo hasta el ${fechaCorta(m.hasta)}` : "traslado";
          return (
            <div key={m.id} className="border border-line rounded-lg bg-white px-3 py-2.5 text-[13px]">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-[220px]">
                  {m.entra ? (
                    <>
                      {quien}
                      <div className="text-[12.5px]">
                        {m.estado === "solicitado" ? "Pide entrar" : "Está aquí"} por <strong>{cuando}</strong>, desde la
                        tienda {m.origen_numero} · {m.origen_nombre}.
                        {m.estado === "activo" && (
                          <span className="text-red-600">
                            {" "}
                            Lo que registre queda marcado con <strong>*</strong>.
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      {quien}
                      <div className="text-[12.5px]">
                        {m.estado === "solicitado" ? "Pidió" : "Está en"} la tienda {m.destino_numero} · {m.destino_nombre} por{" "}
                        <strong>{cuando}</strong>
                        {m.estado === "solicitado" ? " (falta que esa tienda lo acepte)." : "."}
                        {m.tipo === "traslado" && m.estado === "activo" && (
                          <span className="text-warn">
                            {" "}
                            Esa tienda ya lo aceptó: confirma la baja por traslado para que pase a su planta.
                          </span>
                        )}
                      </div>
                    </>
                  )}
                  {m.motivo && <div className="text-[12px] text-muted mt-0.5">Motivo: {m.motivo}</div>}
                </div>

                <div className="flex gap-2 shrink-0">
                  {m.entra && m.estado === "solicitado" && (
                    <>
                      <button
                        type="button"
                        disabled={ocupado === m.id}
                        onClick={() =>
                          ejecutar(m.id, "resolver_movimiento", { p_id: m.id, p_aceptar: true },
                            `¿Aceptar a ${m.persona_nombre}? Entrará a esta tienda con los mismos permisos que tiene en la suya.`)
                        }
                        className={boton + " bg-operaciones text-white"}
                      >
                        Aceptar
                      </button>
                      <button
                        type="button"
                        disabled={ocupado === m.id}
                        onClick={() => ejecutar(m.id, "resolver_movimiento", { p_id: m.id, p_aceptar: false })}
                        className={boton + " border border-line bg-white"}
                      >
                        Rechazar
                      </button>
                    </>
                  )}
                  {m.entra && m.estado === "activo" && (
                    <button
                      type="button"
                      disabled={ocupado === m.id}
                      onClick={() =>
                        ejecutar(m.id, "terminar_movimiento", { p_id: m.id },
                          `¿Terminar el ${m.tipo} de ${m.persona_nombre}? Dejará de ver esta tienda.`)
                      }
                      className={boton + " border border-line bg-white"}
                    >
                      Terminar
                    </button>
                  )}
                  {!m.entra && m.tipo === "traslado" && m.estado === "activo" && (
                    <button
                      type="button"
                      disabled={ocupado === m.id}
                      onClick={() =>
                        ejecutar(m.id, "dar_baja_persona", { p_persona: m.persona_id, p_concepto: "traslado" },
                          `¿Confirmar la baja por traslado de ${m.persona_nombre}? Pasa a la planta de la tienda ${m.destino_numero} y su información (feedbacks, requerimientos, evaluaciones, pendientes abiertos) la verá esa tienda.`)
                      }
                      className={boton + " bg-warn text-white"}
                    >
                      Confirmar baja por traslado
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="mt-2 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">{error}</div>
      )}

      {historial.length > 0 && (
        <div className="mt-2">
          <button type="button" onClick={() => setVerHistorial((v) => !v)} className="text-[12px] text-brand font-semibold">
            {verHistorial ? "Ocultar historial" : `Ver historial (${historial.length})`}
          </button>
          {verHistorial && (
            <ul className="mt-1.5 text-[12.5px] text-muted space-y-0.5">
              {historial.map((m) => (
                <li key={m.id}>
                  {m.persona_nombre}
                  {m.persona_codigo ? ` (CM ${m.persona_codigo})` : ""} · {m.tipo} {m.entra ? "desde" : "hacia"} la tienda{" "}
                  {m.entra ? m.origen_numero : m.destino_numero}
                  {m.desde ? ` · ${fechaCorta(m.desde)}` : ""}
                  {m.hasta ? ` a ${fechaCorta(m.hasta)}` : ""} · {ESTADO[m.estado === "activo" ? "terminado" : m.estado]}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
