"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { estiloCumplimiento } from "@/lib/cumplimiento";
import type { MaximizadorItem, MaximizadorRegistro, PersonaRk } from "@/lib/ranking";
import { inputCls } from "./ui";

const hoyStr = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
};

/**
 * Maximizador: quien lidera la operación del turno (realiza la OPM al inicio,
 * impulsa la venta, entrega datos). Jefatura evalúa cada día con un checklist
 * editable; el puntaje promedio del mes alimenta el ranking.
 */
export function MaximizadorView({
  personas,
  items,
  registros,
  anio,
  mes,
  esJefatura,
  evaluadorId,
  onGuardado,
}: {
  personas: PersonaRk[];
  items: MaximizadorItem[];
  registros: MaximizadorRegistro[];
  anio: number;
  mes: number;
  esJefatura: boolean;
  evaluadorId: string;
  onGuardado: () => void;
}) {
  const activos = useMemo(
    () => items.filter((i) => i.activo).sort((a, b) => a.posicion - b.posicion),
    [items],
  );
  const nombreDe = new Map(personas.map((p) => [p.id, p.nombre]));

  const resumen = useMemo(() => {
    const m = new Map<string, { dias: number; suma: number }>();
    registros.forEach((r) => {
      const a = m.get(r.persona_id) ?? { dias: 0, suma: 0 };
      a.dias += 1;
      a.suma += Number(r.puntaje);
      m.set(r.persona_id, a);
    });
    return [...m.entries()]
      .map(([id, a]) => ({ id, dias: a.dias, promedio: a.suma / a.dias }))
      .sort((a, b) => b.promedio - a.promedio);
  }, [registros]);

  return (
    <div className="space-y-4">
      <p className="text-[12.5px] text-muted max-w-2xl">
        El <strong>maximizador</strong> lidera el turno: realiza la OPM al inicio, impulsa la venta y
        entrega datos al equipo. {esJefatura ? "Evalúa cada día con el checklist." : "Aquí ves cómo te ha ido."}
      </p>

      {esJefatura && (
        <FormularioDia
          personas={personas}
          activos={activos}
          registros={registros}
          evaluadorId={evaluadorId}
          onGuardado={onGuardado}
        />
      )}

      <div className="bg-panel border border-line rounded-[10px] p-4">
        <h4 className="text-sm font-semibold mb-2">Resumen del mes ({mes}/{anio})</h4>
        {resumen.length === 0 ? (
          <div className="text-muted text-sm">Aún no hay evaluaciones del maximizador este mes.</div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-muted uppercase tracking-wider text-[10.5px] border-b border-line">
                <th className="py-1.5">Nombre</th>
                <th className="py-1.5 text-center">Días como maximizador</th>
                <th className="py-1.5 text-right">Cumplimiento del checklist</th>
              </tr>
            </thead>
            <tbody>
              {resumen.map((r) => (
                <tr key={r.id} className="border-b border-line/60 last:border-0">
                  <td className="py-1.5">{nombreDe.get(r.id) ?? "—"}</td>
                  <td className="py-1.5 text-center font-mono">{r.dias}</td>
                  <td className={"py-1.5 text-right font-mono font-semibold " + estiloCumplimiento(r.promedio).text}>
                    {Math.round(r.promedio * 100)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {esJefatura && <GestionItems items={items} onGuardado={onGuardado} />}
    </div>
  );
}

function FormularioDia({
  personas,
  activos,
  registros,
  evaluadorId,
  onGuardado,
}: {
  personas: PersonaRk[];
  activos: MaximizadorItem[];
  registros: MaximizadorRegistro[];
  evaluadorId: string;
  onGuardado: () => void;
}) {
  const [fecha, setFecha] = useState(hoyStr());
  const [personaId, setPersonaId] = useState("");
  const [marcas, setMarcas] = useState<Record<string, boolean>>({});
  const [obs, setObs] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Si ya hay evaluación de esa persona ese día, se carga para editarla.
  useEffect(() => {
    const previo = registros.find((r) => r.fecha === fecha && r.persona_id === personaId);
    setMarcas(previo?.items ?? {});
    setObs(previo?.observaciones ?? "");
    setMsg(null);
  }, [fecha, personaId, registros]);

  const cumplidos = activos.filter((i) => marcas[i.id]).length;
  const puntaje = activos.length > 0 ? cumplidos / activos.length : 0;

  async function guardar() {
    if (!personaId) {
      setMsg("Elige quién fue el maximizador.");
      return;
    }
    if (activos.length === 0) {
      setMsg("No hay ítems en el checklist.");
      return;
    }
    setGuardando(true);
    setMsg(null);
    const itemsGuardar: Record<string, boolean> = {};
    activos.forEach((i) => (itemsGuardar[i.id] = !!marcas[i.id]));
    const { error } = await supabase.from("maximizador_registros").upsert(
      {
        fecha,
        persona_id: personaId,
        evaluador_id: evaluadorId,
        items: itemsGuardar,
        puntaje,
        observaciones: obs.trim(),
      },
      { onConflict: "fecha,persona_id" },
    );
    setGuardando(false);
    if (error) {
      setMsg(`❌ ${error.message}`);
      return;
    }
    setMsg("✓ Evaluación guardada.");
    onGuardado();
  }

  return (
    <div className="bg-panel border border-line rounded-[10px] p-4">
      <h4 className="text-sm font-semibold mb-3">Checklist del maximizador</h4>
      <div className="flex gap-3 flex-wrap mb-3">
        <label className="text-[11px] text-muted uppercase tracking-wider">
          Fecha
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className={inputCls + " block mt-1"}
          />
        </label>
        <label className="text-[11px] text-muted uppercase tracking-wider flex-1 min-w-[220px]">
          Maximizador del día
          <select
            value={personaId}
            onChange={(e) => setPersonaId(e.target.value)}
            className={inputCls + " block mt-1 w-full"}
          >
            <option value="">— Elige —</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-1.5">
        {activos.map((i) => (
          <label
            key={i.id}
            className={
              "flex items-start gap-2.5 border rounded-md px-3 py-2 text-[13px] cursor-pointer " +
              (marcas[i.id] ? "border-operaciones/50 bg-operaciones/5" : "border-line bg-white")
            }
          >
            <input
              type="checkbox"
              checked={!!marcas[i.id]}
              onChange={(e) => setMarcas((m) => ({ ...m, [i.id]: e.target.checked }))}
              className="mt-0.5"
            />
            <span>{i.texto}</span>
          </label>
        ))}
        {activos.length === 0 && (
          <div className="text-muted text-sm">Agrega ítems al checklist más abajo.</div>
        )}
      </div>

      <label className="block mt-3 text-[11px] text-muted uppercase tracking-wider">
        Observaciones
        <textarea
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          rows={2}
          className={inputCls + " block w-full mt-1 normal-case tracking-normal"}
        />
      </label>

      <div className="flex items-center justify-between mt-3 gap-3 flex-wrap">
        <div className="text-sm">
          Cumplimiento:{" "}
          <strong className={"font-mono " + estiloCumplimiento(puntaje).text}>
            {cumplidos}/{activos.length} ({Math.round(puntaje * 100)}%)
          </strong>
        </div>
        <button
          type="button"
          onClick={guardar}
          disabled={guardando}
          className="px-4 py-2 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light"
        >
          {guardando ? "Guardando…" : "Guardar evaluación"}
        </button>
      </div>
      {msg && <div className="text-xs mt-2">{msg}</div>}
    </div>
  );
}

function GestionItems({
  items,
  onGuardado,
}: {
  items: MaximizadorItem[];
  onGuardado: () => void;
}) {
  const [nuevo, setNuevo] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function agregar() {
    const t = nuevo.trim();
    if (!t) return;
    setError(null);
    const pos = items.reduce((m, i) => Math.max(m, i.posicion), 0) + 1;
    const { error: err } = await supabase.from("maximizador_items").insert({ texto: t, posicion: pos });
    if (err) return setError(err.message);
    setNuevo("");
    onGuardado();
  }

  async function cambiar(id: string, patch: Partial<Pick<MaximizadorItem, "texto" | "activo">>) {
    setError(null);
    const { error: err } = await supabase.from("maximizador_items").update(patch).eq("id", id);
    if (err) return setError(err.message);
    onGuardado();
  }

  return (
    <details className="bg-panel border border-line rounded-[10px] p-4">
      <summary className="cursor-pointer text-sm font-semibold select-none">
        Editar ítems del checklist
      </summary>
      <p className="text-[12px] text-muted mt-2 mb-3">
        Puedes renombrar, desactivar (deja de contar para nuevas evaluaciones) o agregar ítems para lo
        que también deba cumplir el maximizador.
      </p>
      <div className="space-y-1.5">
        {[...items]
          .sort((a, b) => a.posicion - b.posicion)
          .map((i) => (
            <div key={i.id} className="flex items-center gap-2">
              <input
                defaultValue={i.texto}
                onBlur={(e) => {
                  const t = e.target.value.trim();
                  if (t && t !== i.texto) cambiar(i.id, { texto: t });
                }}
                className={inputCls + " flex-1 py-1.5 " + (i.activo ? "" : "opacity-50")}
              />
              <button
                type="button"
                onClick={() => cambiar(i.id, { activo: !i.activo })}
                className="text-xs px-2 py-1.5 rounded-md border border-line bg-white hover:bg-paper whitespace-nowrap"
              >
                {i.activo ? "Desactivar" : "Activar"}
              </button>
            </div>
          ))}
      </div>
      <div className="flex gap-2 mt-3">
        <input
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          placeholder="Nuevo ítem del checklist…"
          className={inputCls + " flex-1 py-1.5"}
        />
        <button
          type="button"
          onClick={agregar}
          className="px-3 py-1.5 rounded-md bg-brand text-white text-sm font-semibold"
        >
          Agregar
        </button>
      </div>
      {error && <div className="text-xs text-warn mt-2">{error}</div>}
    </details>
  );
}
