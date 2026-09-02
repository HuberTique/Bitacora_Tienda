"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import {
  ESTADOS_RETARDO,
  labelEstadoRetardo,
  type EstadoRetardo,
  type FaltaConfig,
  type Retardo,
  type RosterPublico,
} from "@/lib/types";

export default function FeedbacksPage() {
  const router = useRouter();
  const { loading, session, persona } = useSession();

  const [retardos, setRetardos] = useState<Retardo[]>([]);
  const [tipos, setTipos] = useState<FaltaConfig[]>([]);
  const [roster, setRoster] = useState<RosterPublico[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [fPersona, setFPersona] = useState<string>("");
  const [fTipo, setFTipo] = useState<string>("");
  const [fEstado, setFEstado] = useState<"" | EstadoRetardo>("");

  const loadAll = useCallback(async () => {
    const [rRes, tRes, pRes] = await Promise.all([
      supabase.from("retardos").select("*").order("fecha", { ascending: false }),
      supabase.from("faltas_config").select("*").order("posicion"),
      supabase.rpc("roster_publico"),
    ]);
    if (rRes.error) return setFetchError(rRes.error.message);
    if (tRes.error) return setFetchError(tRes.error.message);
    if (pRes.error) return setFetchError(pRes.error.message);
    setFetchError(null);
    setRetardos((rRes.data as Retardo[] | null) ?? []);
    setTipos((tRes.data as FaltaConfig[] | null) ?? []);
    setRoster((pRes.data as RosterPublico[] | null) ?? []);
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!session) return router.replace("/login");
    if (persona && persona.rol !== "jefatura") return router.replace("/bitacora");
    if (persona?.rol === "jefatura") loadAll();
  }, [loading, session, persona, router, loadAll]);

  useEffect(() => {
    if (!persona || persona.rol !== "jefatura") return;
    const ch = supabase
      .channel("retardos-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "retardos" }, () => loadAll())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [persona, loadAll]);

  const nombreDe = useMemo(() => {
    const m = new Map<string, string>();
    roster.forEach((p) => m.set(p.id, p.nombre));
    return (id: string) => m.get(id) ?? "—";
  }, [roster]);

  const nombreTipo = useMemo(() => {
    const m = new Map<string, string>();
    tipos.forEach((t) => m.set(t.tipo_id, t.nombre));
    return (id: string) => m.get(id) ?? id;
  }, [tipos]);

  const filtered = useMemo(() => {
    return retardos.filter(
      (r) =>
        (!fPersona || r.persona_id === fPersona) &&
        (!fTipo || r.tipo_id === fTipo) &&
        (!fEstado || r.estado === fEstado),
    );
  }, [retardos, fPersona, fTipo, fEstado]);

  if (loading || !persona || persona.rol !== "jefatura") {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted text-sm">
        Cargando…
      </div>
    );
  }

  async function toggleEstado(r: Retardo) {
    const nuevo: EstadoRetardo = r.estado === "pendiente" ? "realizada" : "pendiente";
    const { error } = await supabase.from("retardos").update({ estado: nuevo }).eq("id", r.id);
    if (error) {
      alert(error.message);
      return;
    }
    loadAll();
  }

  async function eliminar(r: Retardo) {
    if (
      !confirm(
        `¿Eliminar el registro de "${nombreTipo(r.tipo_id)}" para ${nombreDe(r.persona_id)}?\n\n` +
          `Esto puede recalcular la escalación de faltas posteriores del mismo tipo.`,
      )
    )
      return;
    const { error } = await supabase.from("retardos").delete().eq("id", r.id);
    if (error) {
      alert(error.message);
      return;
    }
    loadAll();
  }

  return (
    <AppShell persona={persona}>
      <div className="mx-auto max-w-[1100px] px-4 sm:px-8 py-7 w-full">
        <div className="flex justify-between items-start mb-5 flex-wrap gap-3">
          <div>
            <h2 className="text-[17px] font-display font-semibold m-0 mb-1">Feedbacks</h2>
            <p className="text-muted text-[13px] max-w-2xl">
              Faltas registradas según la matriz vigente. La ocurrencia y acción sugerida
              se calculan automáticamente contra los previos vigentes (últimos 4 meses).
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="px-3 py-2 rounded-md bg-brand text-white text-sm font-semibold hover:bg-brand-light transition-colors"
          >
            + Registrar falta
          </button>
        </div>

        <div className="flex gap-2 flex-wrap mb-4">
          <select
            value={fPersona}
            onChange={(e) => setFPersona(e.target.value)}
            className="px-2 py-1.5 border border-line rounded-md bg-white text-sm"
          >
            <option value="">Todas las personas</option>
            {roster.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
          <select
            value={fTipo}
            onChange={(e) => setFTipo(e.target.value)}
            className="px-2 py-1.5 border border-line rounded-md bg-white text-sm"
          >
            <option value="">Todos los tipos</option>
            {tipos.map((t) => (
              <option key={t.tipo_id} value={t.tipo_id}>
                {t.nombre}
              </option>
            ))}
          </select>
          <select
            value={fEstado}
            onChange={(e) => setFEstado(e.target.value as "" | EstadoRetardo)}
            className="px-2 py-1.5 border border-line rounded-md bg-white text-sm"
          >
            <option value="">Todos los estados</option>
            {ESTADOS_RETARDO.map((e) => (
              <option key={e} value={e}>
                {labelEstadoRetardo(e)}
              </option>
            ))}
          </select>
        </div>

        {fetchError && (
          <div className="bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-sm mb-4">
            {fetchError}
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="bg-panel border border-line rounded-[10px] p-8 text-center text-muted text-sm">
            No hay faltas registradas que coincidan con el filtro.
          </div>
        ) : (
          <div className="bg-panel border border-line rounded-[10px] p-5 overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="text-left border-b border-line">
                  <Th>Persona</Th>
                  <Th>Tipo de falta</Th>
                  <Th>Fecha</Th>
                  <Th>Min.</Th>
                  <Th>Ocurr.</Th>
                  <Th>Acción sugerida</Th>
                  <Th>Estado</Th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-line/60 last:border-0 align-top">
                    <td className="py-3 pr-3">{nombreDe(r.persona_id)}</td>
                    <td className="py-3 pr-3">
                      {nombreTipo(r.tipo_id)}
                      {r.observacion && (
                        <div className="text-muted text-[11px] mt-0.5 line-clamp-2">
                          {r.observacion}
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-3 whitespace-nowrap">{fmtDate(r.fecha)}</td>
                    <td className="py-3 pr-3 font-mono text-xs">{r.minutos ?? "—"}</td>
                    <td className="py-3 pr-3 font-mono text-xs">{r.ocurrencia}</td>
                    <td className="py-3 pr-3">
                      <span className="text-xs font-semibold text-brand">{r.accion}</span>
                    </td>
                    <td className="py-3 pr-3">
                      <EstadoTag estado={r.estado} />
                    </td>
                    <td className="py-3 text-right whitespace-nowrap space-x-1">
                      <button
                        type="button"
                        onClick={() => toggleEstado(r)}
                        className="text-xs px-2 py-1 border border-line rounded bg-white hover:bg-paper"
                      >
                        {r.estado === "pendiente" ? "Marcar realizada" : "Reabrir"}
                      </button>
                      <button
                        type="button"
                        onClick={() => eliminar(r)}
                        className="text-xs px-2 py-1 border border-warn text-warn rounded bg-white hover:bg-warn-soft"
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && (
        <NuevoRetardoModal
          persona={persona}
          roster={roster.filter((p) => p.rol === "asesor" || p.rol === "jefatura")}
          tipos={tipos}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            loadAll();
          }}
        />
      )}
    </AppShell>
  );
}

// ---------- Helpers ----------

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="pb-2 pr-3 font-semibold text-xs uppercase tracking-wider text-muted">
      {children}
    </th>
  );
}

function EstadoTag({ estado }: { estado: EstadoRetardo }) {
  const cls =
    estado === "realizada"
      ? "bg-emerald-50 text-operaciones"
      : "bg-amber-50 text-[#B4772B]";
  return (
    <span
      className={
        "inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider " +
        cls
      }
    >
      {labelEstadoRetardo(estado)}
    </span>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

function NuevoRetardoModal({
  persona,
  roster,
  tipos,
  onClose,
  onSaved,
}: {
  persona: { id: string };
  roster: RosterPublico[];
  tipos: FaltaConfig[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [personaId, setPersonaId] = useState<string>(roster[0]?.id ?? "");
  const [tipoId, setTipoId] = useState<string>(tipos[0]?.tipo_id ?? "");
  const [fecha, setFecha] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [minutos, setMinutos] = useState<string>("10");
  const [obs, setObs] = useState("");
  const [preview, setPreview] = useState<{ ocurrencia: number; accion: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tipo = tipos.find((t) => t.tipo_id === tipoId);

  // Preview escalation whenever (persona, tipo, fecha) change
  useEffect(() => {
    if (!personaId || !tipoId || !fecha) {
      setPreview(null);
      return;
    }
    let alive = true;
    supabase
      .rpc("compute_ocurrencia", { p_persona_id: personaId, p_tipo_id: tipoId, p_fecha: fecha })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          setPreview(null);
          setError(error.message);
          return;
        }
        const row = (data as { ocurrencia: number; accion: string }[] | null)?.[0] ?? null;
        setPreview(row);
        setError(null);
      });
    return () => {
      alive = false;
    };
  }, [personaId, tipoId, fecha]);

  async function save() {
    setError(null);
    if (!personaId || !tipoId || !fecha || !preview) {
      setError("Completa persona, tipo y fecha.");
      return;
    }
    if (tipo?.requiere_minutos && (!minutos || Number.isNaN(Number(minutos)))) {
      setError("Este tipo requiere minutos.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("retardos").insert({
      persona_id: personaId,
      tipo_id: tipoId,
      fecha,
      minutos: tipo?.requiere_minutos ? Number(minutos) : null,
      observacion: obs.trim(),
      ocurrencia: preview.ocurrencia,
      accion: preview.accion,
      estado: "pendiente",
      registrado_por: persona.id,
    });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    onSaved();
  }

  return (
    <Modal onClose={onClose} title="Registrar falta">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Persona" full>
          <select
            value={personaId}
            onChange={(e) => setPersonaId(e.target.value)}
            className="w-full px-3 py-2 border border-line rounded-md bg-white text-sm"
          >
            {roster.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre} — {p.cargo}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tipo de falta" full>
          <select
            value={tipoId}
            onChange={(e) => setTipoId(e.target.value)}
            className="w-full px-3 py-2 border border-line rounded-md bg-white text-sm"
          >
            {tipos.map((t) => (
              <option key={t.tipo_id} value={t.tipo_id}>
                {t.nombre}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Fecha">
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="w-full px-3 py-2 border border-line rounded-md bg-white text-sm"
          />
        </Field>
        {tipo?.requiere_minutos && (
          <Field label="Minutos tarde">
            <input
              type="number"
              min={1}
              value={minutos}
              onChange={(e) => setMinutos(e.target.value)}
              className="w-full px-3 py-2 border border-line rounded-md bg-white text-sm"
            />
          </Field>
        )}
        <Field label="Contexto de la situación (opcional)" full>
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={3}
            placeholder="Detalle para redactar el feedback formal..."
            className="w-full px-3 py-2 border border-line rounded-md bg-white text-sm resize-y"
          />
        </Field>
      </div>

      {preview && (
        <div className="mt-4 bg-brand/5 border border-brand/20 rounded-md px-3 py-2 text-sm">
          <div className="text-[11px] uppercase tracking-wider text-muted">
            Escalación calculada
          </div>
          <div className="mt-0.5">
            Ocurrencia <strong>#{preview.ocurrencia}</strong> en los últimos 4 meses ·
            acción sugerida: <strong className="text-brand">{preview.accion}</strong>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={save}
        disabled={saving || !preview}
        className="mt-4 w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light transition-colors"
      >
        {saving ? "Registrando…" : "Registrar"}
      </button>
    </Modal>
  );
}

function Modal({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-panel rounded-[10px] p-6 max-w-xl w-full relative shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 text-muted hover:text-ink text-lg leading-none"
          aria-label="Cerrar"
        >
          ✕
        </button>
        <h3 className="font-display font-semibold text-base mb-4 pr-8">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <label className="block text-xs text-muted uppercase tracking-wider mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
