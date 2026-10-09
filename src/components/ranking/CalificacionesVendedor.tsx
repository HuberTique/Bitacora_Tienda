"use client";

// Reconocimientos del mejor vendedor (Huber, 8-oct-2026): 8 ítems de 1,25 % cada
// uno, con ganadores distintos. Los 5 primeros salen solos de los datos; Puntualidad,
// Trabajo en equipo e Iniciativa los califica la jefatura del día 1 al 5 del mes
// siguiente (Iniciativa, el jefe de tienda). Queda el historial de quién calificó.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { NOMBRES_MES } from "@/lib/horarios";
import type { TareaCalificacion } from "@/lib/calificaciones";
import {
  ITEMS_RECONOCIMIENTO,
  type CalificacionVendedor,
  type FilaRanking,
  type ItemReconocimiento,
  type PersonaRk,
  type ResumenFaltas,
} from "@/lib/ranking";
import { inputCls } from "./ui";

type Historial = {
  id: string;
  item: string;
  accion: "califico" | "cambio" | "quito";
  persona_id: string | null;
  nota: string | null;
  por: string | null;
  at: string;
};

const ACCION: Record<Historial["accion"], string> = { califico: "calificó a", cambio: "cambió a", quito: "quitó a" };

export function CalificacionesVendedor({
  anio,
  mes,
  personas,
  roster,
  filas,
  calificaciones,
  faltas,
  esJefatura,
  esJefeTienda,
  registradoPor,
  tarea,
  valorItem,
  onGuardado,
}: {
  anio: number;
  mes: number;
  personas: PersonaRk[];
  roster: PersonaRk[];
  filas: FilaRanking[];
  calificaciones: CalificacionVendedor[];
  faltas: ResumenFaltas[];
  esJefatura: boolean;
  esJefeTienda: boolean;
  registradoPor: string;
  tarea: TareaCalificacion | null;
  valorItem: number;
  onGuardado: () => void;
}) {
  const nombre = (id: string | null) => roster.find((p) => p.id === id)?.nombre ?? personas.find((p) => p.id === id)?.nombre ?? "—";
  const [borrador, setBorrador] = useState<Record<string, { persona: string; nota: string }>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [historial, setHistorial] = useState<Historial[]>([]);

  useEffect(() => {
    if (!esJefatura) return;
    let vivo = true;
    supabase
      .from("calificaciones_vendedor_historial")
      .select("id, item, accion, persona_id, nota, por, at")
      .eq("anio", anio)
      .eq("mes", mes)
      .order("at", { ascending: false })
      .then(({ data }) => {
        if (vivo) setHistorial((data as Historial[] | null) ?? []);
      });
    return () => {
      vivo = false;
    };
  }, [anio, mes, esJefatura, calificaciones]);

  // Ganador de cada ítem: los automáticos salen del ranking; los manuales, de lo calificado.
  const ganadorDe = (item: ItemReconocimiento) => filas.find((f) => f.reconocimientos.includes(item)) ?? null;
  const calDe = (item: string) => calificaciones.find((c) => c.item === item) ?? null;
  const yaGanaron = new Set(filas.filter((f) => f.reconocimientos.length > 0).map((f) => f.persona.id));
  const faltasDe = new Map(faltas.map((f) => [f.persona_id, f]));
  const esTareaDeEsteMes = !!tarea && tarea.anio === anio && tarea.mes === mes;

  async function calificar(item: string) {
    setMsg(null);
    const b = borrador[item];
    if (!b?.persona) return setMsg("Elige a la persona.");
    const { error } = await supabase.from("calificaciones_vendedor").upsert(
      { anio, mes, item, persona_id: b.persona, nota: b.nota.trim(), calificado_por: registradoPor, calificado_at: new Date().toISOString() },
      { onConflict: "tienda_id,anio,mes,item" },
    );
    if (error) return setMsg(`❌ ${error.message}`);
    setBorrador((x) => ({ ...x, [item]: { persona: "", nota: "" } }));
    onGuardado();
  }

  async function quitar(c: CalificacionVendedor) {
    if (!confirm(`¿Quitar la calificación de ${nombre(c.persona_id)}?`)) return;
    const { error } = await supabase.from("calificaciones_vendedor").delete().eq("id", c.id);
    if (error) return setMsg(`❌ ${error.message}`);
    onGuardado();
  }

  const valor = valorItem.toFixed(2).replace(/\.?0+$/, "").replace(".", ",");
  return (
    <div className="bg-panel border border-line rounded-[10px] p-4" id="calificar">
      <h4 className="text-sm font-semibold">
        Reconocimientos del mejor vendedor · {NOMBRES_MES[mes - 1]} {anio}
      </h4>
      <p className="text-[12px] text-muted mt-1">
        Cada reconocimiento suma <strong>+{valor}</strong> al puntaje del ganador y no se repite persona. Los 5 primeros salen
        solos de los datos (en el día y la semana solo cuentan estos); los 3 últimos los califica la jefatura del día 1 al 5 del
        mes siguiente.
      </p>
      {esJefatura && esTareaDeEsteMes && (
        <div
          className={
            "mt-2 rounded-md px-3 py-2 text-[12.5px] font-semibold border " +
            (tarea!.estado === "abierta" ? "bg-amber-50 border-amber-300 text-[#8A5A16]" : "bg-warn-soft border-warn-border text-warn")
          }
        >
          {tarea!.estado === "abierta"
            ? `⏳ Califica antes del ${tarea!.vence} (${tarea!.diasRestantes === 1 ? "último día" : `quedan ${tarea!.diasRestantes} días`}).`
            : `⛔ Vencida hace ${tarea!.diasDeAtraso} día(s): faltan ${tarea!.faltan} calificación(es).`}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {ITEMS_RECONOCIMIENTO.map((it, n) => {
          const g = ganadorDe(it.id);
          const cal = it.manual ? calDe(it.id) : null;
          const puedeCalificar = esJefatura && it.manual && (it.id !== "iniciativa" || esJefeTienda);
          const b = borrador[it.id] ?? { persona: "", nota: "" };
          return (
            <div key={it.id} className="border border-line rounded-md bg-white px-3 py-2">
              <div className="flex items-start gap-2 flex-wrap">
                <span className="w-5 text-muted text-[12px] pt-0.5">{n + 1}.</span>
                <div className="flex-1 min-w-[180px]">
                  <div className="text-[13px] font-semibold">
                    {it.titulo} {it.manual && <span className="text-[10.5px] font-normal text-muted">(la califica {it.id === "iniciativa" ? "el jefe de tienda" : "la jefatura"})</span>}
                  </div>
                  {!it.manual && <div className="text-[11.5px] text-muted">{it.ayuda}</div>}
                </div>
                <div className="text-[12.5px] text-right">
                  {g ? (
                    <>
                      <div className="font-semibold text-operaciones">🏅 {g.detalleReconocimientos[it.id] && !it.manual ? g.detalleReconocimientos[it.id] : g.persona.nombre}</div>
                      {cal && (
                        <div className="text-[11px] text-muted">
                          {cal.nota ? `"${cal.nota}" · ` : ""}por {nombre(cal.calificado_por)}
                          {esJefatura && (
                            <button type="button" onClick={() => quitar(cal)} className="ml-2 text-warn hover:underline">
                              Quitar
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="text-muted">{it.manual ? "Sin calificar" : "Aún sin datos"}</span>
                  )}
                </div>
              </div>
              {puedeCalificar && !cal && (
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
                  <select
                    value={b.persona}
                    onChange={(e) => setBorrador((x) => ({ ...x, [it.id]: { ...b, persona: e.target.value } }))}
                    className={inputCls}
                  >
                    <option value="">— ¿Quién se lo ganó? —</option>
                    {personas.map((p) => {
                      const f = faltasDe.get(p.id);
                      const llamados = (f?.faltas ?? 0) + (f?.reclamos ?? 0);
                      return (
                        <option key={p.id} value={p.id} disabled={yaGanaron.has(p.id)}>
                          {p.nombre}
                          {yaGanaron.has(p.id) ? " (ya ganó otro reconocimiento)" : ""}
                          {llamados > 0 ? ` ⚠ ${llamados} registro(s) en Feedbacks` : ""}
                        </option>
                      );
                    })}
                  </select>
                  <input
                    value={b.nota}
                    onChange={(e) => setBorrador((x) => ({ ...x, [it.id]: { ...b, nota: e.target.value } }))}
                    placeholder="Por qué (opcional)"
                    className={inputCls}
                  />
                  <button
                    type="button"
                    onClick={() => calificar(it.id)}
                    className="px-4 py-2 bg-brand text-white rounded-md font-semibold text-sm hover:bg-brand-light"
                  >
                    Calificar
                  </button>
                  {b.persona && (faltasDe.get(b.persona)?.faltas ?? 0) + (faltasDe.get(b.persona)?.reclamos ?? 0) > 0 && (
                    <div className="sm:col-span-3 text-[11.5px] text-warn">
                      ⚠ {nombre(b.persona)} tiene registros en Feedbacks este mes (llegadas tarde, faltas o reclamos). Revísalos antes
                      de calificar.
                    </div>
                  )}
                </div>
              )}
              {esJefatura && it.manual && it.id === "iniciativa" && !esJefeTienda && !cal && (
                <div className="mt-1 text-[11px] text-muted">Solo el jefe de tienda (o el jefe encargado) califica la iniciativa.</div>
              )}
            </div>
          );
        })}
      </div>
      {msg && <div className="mt-2 text-xs">{msg}</div>}

      {esJefatura && historial.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[12px] text-brand font-semibold select-none">Historial de calificaciones ({historial.length})</summary>
          <ul className="mt-2 space-y-1 text-[12px]">
            {historial.map((h) => (
              <li key={h.id} className="text-muted">
                {new Date(h.at).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })} · <strong className="text-ink">{nombre(h.por)}</strong>{" "}
                {ACCION[h.accion]} <strong className="text-ink">{nombre(h.persona_id)}</strong> en{" "}
                {ITEMS_RECONOCIMIENTO.find((i) => i.id === h.item)?.titulo ?? h.item}
                {h.nota ? ` ("${h.nota}")` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
