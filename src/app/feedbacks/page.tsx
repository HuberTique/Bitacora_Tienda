"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  matchPersonaPorNombre,
  resizeImage,
  tipoIdPorMinutos,
} from "@/lib/imagenIA";

type DetectedRow = {
  nombreDetectado: string;
  personaId: string; // "" si sin match
  fecha: string;
  minutos: number;
  selected: boolean;
};

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

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [readingImage, setReadingImage] = useState<{ done: number; total: number } | null>(null);
  const [revising, setRevising] = useState<DetectedRow[] | null>(null);
  const [readErrors, setReadErrors] = useState<string[]>([]);

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
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!!readingImage}
              className="px-3 py-2 rounded-md border border-line bg-white text-sm hover:bg-paper disabled:opacity-50 transition-colors"
            >
              {readingImage
                ? `Leyendo ${readingImage.done}/${readingImage.total}…`
                : "📷 Leer desde imagen"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              hidden
              onChange={handleImagenes}
            />
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="px-3 py-2 rounded-md bg-brand text-white text-sm font-semibold hover:bg-brand-light transition-colors"
            >
              + Registrar falta
            </button>
          </div>
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

      {revising && (
        <RevisionModal
          rows={revising}
          setRows={setRevising}
          errors={readErrors}
          roster={roster}
          tipos={tipos}
          registradoPor={persona.id}
          onClose={() => {
            setRevising(null);
            setReadErrors([]);
          }}
          onSaved={() => {
            setRevising(null);
            setReadErrors([]);
            loadAll();
          }}
        />
      )}
    </AppShell>
  );

  async function handleImagenes(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = ""; // permite volver a subir el mismo archivo

    setReadErrors([]);
    setReadingImage({ done: 0, total: files.length });
    const detectados: DetectedRow[] = [];
    const errores: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        let image: { base64: string; mime: string };
        try {
          image = await resizeImage(f);
        } catch {
          // Si el resize falla, no podemos enviar la imagen original sin base64 explícito
          throw new Error("No pude leer el archivo — usa JPG, PNG, WEBP o GIF (no HEIC).");
        }
        const { data, error } = await supabase.functions.invoke("leer-retardos-imagen", {
          body: { image },
        });
        if (error) {
          throw new Error(await extractFunctionErrorMessage(error, data));
        }
        const payload = data as
          | {
              registros?: { nombre: string; fecha: string; minutos: number }[];
              debug?: { raw_preview?: string; stop_reason?: string };
            }
          | null;
        const registros = payload?.registros ?? [];
        if (registros.length === 0 && payload?.debug?.raw_preview) {
          errores.push(
            `${f.name}: la IA no detectó llegadas tarde. Respuesta (stop=${payload.debug.stop_reason}): ${payload.debug.raw_preview}`,
          );
        }
        for (const r of registros) {
          const match = matchPersonaPorNombre(r.nombre, roster);
          detectados.push({
            nombreDetectado: r.nombre,
            personaId: match?.id ?? "",
            fecha: r.fecha || new Date().toISOString().slice(0, 10),
            minutos: r.minutos,
            selected: !!match,
          });
        }
      } catch (err) {
        errores.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
      setReadingImage({ done: i + 1, total: files.length });
    }

    setReadingImage(null);

    if (detectados.length === 0) {
      setReadErrors(
        errores.length > 0
          ? errores
          : ["No se encontraron llegadas tarde en la(s) imagen(es)."],
      );
      // Mostrar el modal aunque no haya filas — para que jefatura vea los errores
      setRevising([]);
      return;
    }

    setReadErrors(errores);
    setRevising(detectados);
  }
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

function RevisionModal({
  rows,
  setRows,
  errors,
  roster,
  tipos,
  registradoPor,
  onClose,
  onSaved,
}: {
  rows: DetectedRow[];
  setRows: (r: DetectedRow[]) => void;
  errors: string[];
  roster: RosterPublico[];
  tipos: FaltaConfig[];
  registradoPor: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  function updateRow(i: number, patch: Partial<DetectedRow>) {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function save() {
    setError(null);
    const seleccionadas = rows.filter((r) => r.selected && r.personaId && r.fecha && r.minutos > 0);
    if (seleccionadas.length === 0) {
      setError("Selecciona al menos una fila con persona, fecha y minutos válidos.");
      return;
    }

    setSaving(true);
    setProgress({ done: 0, total: seleccionadas.length });
    let ok = 0;
    const fallos: string[] = [];

    for (let i = 0; i < seleccionadas.length; i++) {
      const r = seleccionadas[i];
      const tipoId = tipoIdPorMinutos(r.minutos, tipos);
      if (!tipoId) {
        fallos.push(`${r.nombreDetectado}: no encontré un tipo de falta para ${r.minutos} min.`);
        setProgress({ done: i + 1, total: seleccionadas.length });
        continue;
      }

      const { data: rpcData, error: rpcErr } = await supabase.rpc("compute_ocurrencia", {
        p_persona_id: r.personaId,
        p_tipo_id: tipoId,
        p_fecha: r.fecha,
      });
      if (rpcErr) {
        fallos.push(`${r.nombreDetectado}: escalación falló (${rpcErr.message}).`);
        setProgress({ done: i + 1, total: seleccionadas.length });
        continue;
      }
      const row = (rpcData as { ocurrencia: number; accion: string }[] | null)?.[0];
      if (!row) {
        fallos.push(`${r.nombreDetectado}: escalación devolvió vacío.`);
        setProgress({ done: i + 1, total: seleccionadas.length });
        continue;
      }

      const { error: insErr } = await supabase.from("retardos").insert({
        persona_id: r.personaId,
        tipo_id: tipoId,
        fecha: r.fecha,
        minutos: r.minutos,
        observacion: "Registrado automáticamente desde imagen (control de horario).",
        ocurrencia: row.ocurrencia,
        accion: row.accion,
        estado: "pendiente",
        registrado_por: registradoPor,
      });
      if (insErr) {
        fallos.push(`${r.nombreDetectado}: insert falló (${insErr.message}).`);
      } else {
        ok++;
      }
      setProgress({ done: i + 1, total: seleccionadas.length });
    }

    setSaving(false);
    setProgress(null);

    if (fallos.length > 0) {
      setError(`Registradas ${ok}. ${fallos.length} con problemas:\n${fallos.join("\n")}`);
      return;
    }
    onSaved();
  }

  return (
    <Modal onClose={onClose} title="Revisar llegadas tarde detectadas">
      {errors.length > 0 && (
        <div className="mb-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs whitespace-pre-line">
          {errors.join("\n")}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-muted text-sm">No se encontraron llegadas tarde para revisar.</p>
      ) : (
        <>
          <p className="text-muted text-[12.5px] mb-3">
            Revisa que cada persona esté bien asignada antes de registrar. Las filas
            sin coincidencia automática vienen desmarcadas — corrígelas y márcalas si
            quieres incluirlas.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="text-left border-b border-line">
                  <th className="pb-2 pr-2 w-[30px]"></th>
                  <th className="pb-2 pr-2 font-semibold text-[11px] uppercase tracking-wider text-muted">
                    Detectado
                  </th>
                  <th className="pb-2 pr-2 font-semibold text-[11px] uppercase tracking-wider text-muted">
                    Persona
                  </th>
                  <th className="pb-2 pr-2 font-semibold text-[11px] uppercase tracking-wider text-muted">
                    Fecha
                  </th>
                  <th className="pb-2 font-semibold text-[11px] uppercase tracking-wider text-muted">
                    Min.
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-line/60 last:border-0">
                    <td className="py-2 pr-2">
                      <input
                        type="checkbox"
                        checked={r.selected}
                        onChange={(e) => updateRow(i, { selected: e.target.checked })}
                      />
                    </td>
                    <td className="py-2 pr-2 text-[11.5px] text-muted">
                      {r.nombreDetectado || "—"}
                      {!r.personaId && (
                        <span className="text-warn ml-1">(sin match)</span>
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      <select
                        value={r.personaId}
                        onChange={(e) => updateRow(i, { personaId: e.target.value })}
                        className="w-full px-2 py-1 border border-line rounded bg-white text-xs"
                      >
                        <option value="">— selecciona —</option>
                        {roster.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nombre}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="date"
                        value={r.fecha}
                        onChange={(e) => updateRow(i, { fecha: e.target.value })}
                        className="px-2 py-1 border border-line rounded bg-white text-xs"
                      />
                    </td>
                    <td className="py-2">
                      <input
                        type="number"
                        min={1}
                        value={r.minutos}
                        onChange={(e) => updateRow(i, { minutos: parseInt(e.target.value) || 0 })}
                        className="w-16 px-2 py-1 border border-line rounded bg-white text-xs"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && (
            <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs whitespace-pre-line">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="mt-4 w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light transition-colors"
          >
            {progress
              ? `Registrando ${progress.done}/${progress.total}…`
              : saving
                ? "Registrando…"
                : "Registrar seleccionados"}
          </button>
        </>
      )}
    </Modal>
  );
}

/**
 * Extrae el mensaje de error real de una respuesta non-2xx de una Edge Function.
 * El cliente de Supabase envuelve el error como FunctionsHttpError con
 * `error.message` genérico ("Edge Function returned a non-2xx status code")
 * y el body real dentro de `error.context` (Response) — hay que leerlo aparte.
 */
async function extractFunctionErrorMessage(
  error: unknown,
  data: unknown,
): Promise<string> {
  const dataErr = (data as { error?: string } | null)?.error;
  if (dataErr) return dataErr;

  const ctx = (error as { context?: unknown }).context;
  if (ctx instanceof Response) {
    try {
      const body = await ctx.clone().json();
      const msg = (body as { error?: string } | null)?.error;
      if (msg) return msg;
    } catch {
      try {
        const txt = (await ctx.clone().text()).trim();
        if (txt) return txt.slice(0, 500);
      } catch {
        /* ignore */
      }
    }
  }
  return (error as { message?: string })?.message ?? "Error desconocido.";
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
