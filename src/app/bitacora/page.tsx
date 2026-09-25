"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import {
  AREAS,
  TURNOS,
  labelArea,
  labelEstado,
  type AreaId,
  type EstadoPendiente,
  type Pendiente,
  type RosterPublico,
  type Turno,
} from "@/lib/types";

const AREA_COLOR: Record<AreaId, string> = {
  rrhh: "var(--color-rrhh)",
  visual: "var(--color-visual)",
  operaciones: "var(--color-operaciones)",
  ventas: "var(--color-ventas)",
  mantenimiento: "var(--color-mantenimiento)",
  otros: "var(--color-otros)",
};

export default function BitacoraPage() {
  const router = useRouter();
  const { loading, session, persona } = useSession();

  const [pendientes, setPendientes] = useState<Pendiente[]>([]);
  const [roster, setRoster] = useState<RosterPublico[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [fArea, setFArea] = useState<"" | AreaId>("");
  const [fEstado, setFEstado] = useState<"" | Exclude<EstadoPendiente, "cerrado">>("");
  const [fBuscar, setFBuscar] = useState("");
  const [showHistorial, setShowHistorial] = useState(false);

  const loadAll = useCallback(async () => {
    const [{ data: pData, error: pErr }, { data: rData, error: rErr }] =
      await Promise.all([
        supabase
          .from("pendientes")
          .select("*")
          .order("created_at", { ascending: false }),
        supabase.rpc("roster_publico"),
      ]);
    if (pErr) {
      setFetchError(pErr.message);
      return;
    }
    if (rErr) {
      setFetchError(rErr.message);
      return;
    }
    setFetchError(null);
    setPendientes((pData as Pendiente[] | null) ?? []);
    setRoster((rData as RosterPublico[] | null) ?? []);
  }, []);

  // Guard + carga inicial
  useEffect(() => {
    if (loading) return;
    if (!session) {
      router.replace("/login");
      return;
    }
    if (persona) loadAll();
  }, [loading, session, persona, router, loadAll]);

  // Suscripción realtime a cambios en pendientes
  useEffect(() => {
    if (!persona) return;
    const channel = supabase
      .channel("pendientes-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pendientes" },
        () => loadAll(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [persona, loadAll]);

  const nombreDe = useMemo(() => {
    const map = new Map<string, string>();
    roster.forEach((p) => map.set(p.id, p.nombre));
    return (id: string | null) => (id ? map.get(id) ?? "—" : "—");
  }, [roster]);

  const filtered = useMemo(() => {
    let list = pendientes.filter((p) =>
      showHistorial ? p.estado === "cerrado" : p.estado !== "cerrado",
    );
    if (fArea) list = list.filter((p) => p.area === fArea);
    if (fEstado && !showHistorial) list = list.filter((p) => p.estado === fEstado);
    if (fBuscar) {
      const q = fBuscar.toLowerCase();
      list = list.filter((p) =>
        (
          p.titulo +
          " " +
          p.descripcion +
          " " +
          nombreDe(p.responsable_id) +
          " " +
          nombreDe(p.asesor_id)
        )
          .toLowerCase()
          .includes(q),
      );
    }
    return list;
  }, [pendientes, showHistorial, fArea, fEstado, fBuscar, nombreDe]);

  if (loading || !persona) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted text-sm">
        Cargando…
      </div>
    );
  }

  const detail = detailId ? pendientes.find((p) => p.id === detailId) ?? null : null;

  return (
    <AppShell persona={persona}>
      <div className="mx-auto max-w-[1100px] px-4 sm:px-8 py-7 w-full">
        <div className="flex justify-between items-start mb-5 flex-wrap gap-3">
          <div>
            <h2 className="text-[17px] font-display font-semibold m-0 mb-1">
              {showHistorial ? "Historial" : "Bitácora de pendientes"}
            </h2>
            <p className="text-muted text-[13px] max-w-xl">
              {showHistorial
                ? "Pendientes cerrados, conservados para seguimiento y trazabilidad."
                : "Tablero activo. Al cerrar un pendiente, pasa al historial para trazabilidad."}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowHistorial((v) => !v)}
              className="px-3 py-2 rounded-md border border-line bg-white text-sm hover:bg-paper transition-colors"
            >
              {showHistorial ? "Ver activos" : "Ver historial"}
            </button>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="px-3 py-2 rounded-md bg-brand text-white text-sm font-semibold hover:bg-brand-light transition-colors"
            >
              + Nuevo pendiente
            </button>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap mb-4">
          <select
            value={fArea}
            onChange={(e) => setFArea(e.target.value as "" | AreaId)}
            className="px-2 py-1.5 border border-line rounded-md bg-white text-sm"
          >
            <option value="">Todas las áreas</option>
            {AREAS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
          <select
            value={showHistorial ? "cerrado" : fEstado}
            onChange={(e) => {
              const v = e.target.value as "" | "abierto" | "progreso" | "cerrado";
              if (v === "cerrado") {
                setShowHistorial(true);
                setFEstado("");
              } else {
                setShowHistorial(false);
                setFEstado(v);
              }
            }}
            className="px-2 py-1.5 border border-line rounded-md bg-white text-sm"
          >
            <option value="">Todos los abiertos</option>
            <option value="abierto">Abierto</option>
            <option value="progreso">En progreso</option>
            <option value="cerrado">Cerrado</option>
          </select>
          <input
            type="text"
            value={fBuscar}
            onChange={(e) => setFBuscar(e.target.value)}
            placeholder="Buscar por texto o persona…"
            className="px-2 py-1.5 border border-line rounded-md bg-white text-sm flex-1 min-w-[200px]"
          />
        </div>

        {fetchError && (
          <div className="bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-sm mb-4">
            {fetchError}
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="bg-panel border border-line rounded-[10px] p-8 text-center text-muted text-sm">
            {showHistorial
              ? "Aún no hay pendientes cerrados."
              : "No hay pendientes activos que coincidan con el filtro."}
          </div>
        ) : (
          <div className="space-y-2.5">
            {filtered.map((p) => (
              <PendienteRow
                key={p.id}
                p={p}
                nombreDe={nombreDe}
                onOpen={() => setDetailId(p.id)}
              />
            ))}
          </div>
        )}
      </div>

      {creating && (
        <NuevoPendienteModal
          persona={persona}
          roster={roster}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            loadAll();
          }}
        />
      )}

      {detail && (
        <DetalleModal
          p={detail}
          nombreDe={nombreDe}
          onClose={() => setDetailId(null)}
          onChanged={loadAll}
        />
      )}
    </AppShell>
  );
}

function PendienteRow({
  p,
  nombreDe,
  onOpen,
}: {
  p: Pendiente;
  nombreDe: (id: string | null) => string;
  onOpen: () => void;
}) {
  return (
    <div
      className="bg-panel border border-line rounded-lg p-3.5 border-l-4 cursor-pointer hover:shadow-sm transition-shadow"
      style={{ borderLeftColor: AREA_COLOR[p.area] }}
      onClick={onOpen}
    >
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <AreaBadge area={p.area} />
          <span className="font-semibold text-sm">{p.titulo}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <VencimientoTag p={p} />
          <EstadoTag estado={p.estado} />
        </div>
      </div>
      <div className="text-muted text-xs mt-1.5">
        Responsable: <strong className="text-ink">{nombreDe(p.responsable_id)}</strong>
        {p.asesor_id && (
          <>
            {" "}
            · Asesor: <strong className="text-ink">{nombreDe(p.asesor_id)}</strong>
          </>
        )}{" "}
        · Turno {p.turno} · {fmtDate(p.created_at)} · registrado por{" "}
        {nombreDe(p.created_by)}
        {p.fecha_ejecucion && (
          <>
            {" "}
            · Ejecutar el{" "}
            <strong className="text-ink">
              {fmtDate(p.fecha_ejecucion + "T00:00:00")}
            </strong>
          </>
        )}
      </div>
      {p.descripcion && (
        <div className="mt-2 text-sm text-[#333]">{p.descripcion}</div>
      )}
    </div>
  );
}

function AreaBadge({ area }: { area: AreaId }) {
  return (
    <span
      className="inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full text-white uppercase tracking-wider"
      style={{ background: AREA_COLOR[area] }}
    >
      {labelArea(area)}
    </span>
  );
}

function EstadoTag({ estado }: { estado: EstadoPendiente }) {
  const cls =
    estado === "cerrado"
      ? "bg-emerald-50 text-operaciones"
      : estado === "progreso"
        ? "bg-amber-50 text-[#B4772B]"
        : "bg-zinc-100 text-muted";
  return (
    <span
      className={
        "inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider " +
        cls
      }
    >
      {labelEstado(estado)}
    </span>
  );
}

function parseFechaLocal(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function hoyLocalStr(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

// Estado de vencimiento de un pendiente según su fecha de ejecución.
// Los cerrados no muestran alerta (ya se ejecutaron).
function vencimiento(p: Pendiente): { texto: string; cls: string } | null {
  if (!p.fecha_ejecucion || p.estado === "cerrado") return null;
  const dias = Math.round(
    (parseFechaLocal(p.fecha_ejecucion).getTime() -
      parseFechaLocal(hoyLocalStr()).getTime()) /
      86400000,
  );
  if (dias < 0) {
    return {
      texto: `Vencido hace ${-dias} ${-dias === 1 ? "día" : "días"}`,
      cls: "bg-warn text-white",
    };
  }
  if (dias === 0) return { texto: "Vence hoy", cls: "bg-amber-100 text-[#B4772B]" };
  if (dias === 1) return { texto: "Vence mañana", cls: "bg-amber-50 text-[#B4772B]" };
  return { texto: `Vence en ${dias} días`, cls: "bg-zinc-100 text-muted" };
}

function VencimientoTag({ p }: { p: Pendiente }) {
  const v = vencimiento(p);
  if (!v) return null;
  return (
    <span
      className={
        "inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full " + v.cls
      }
    >
      {v.texto}
    </span>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ---------- Modales ----------

function ModalWrap({
  children,
  onClose,
  title,
  wide,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className={
          "bg-panel rounded-[10px] p-6 w-full relative shadow-xl max-h-[90vh] overflow-y-auto " +
          (wide ? "max-w-xl" : "max-w-md")
        }
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

function NuevoPendienteModal({
  persona,
  roster,
  onClose,
  onSaved,
}: {
  persona: { id: string; rol: "jefatura" | "asesor" };
  roster: RosterPublico[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const jefaturas = roster.filter((p) => p.rol === "jefatura");
  const asesores = roster.filter((p) => p.rol === "asesor");

  const [titulo, setTitulo] = useState("");
  const [area, setArea] = useState<AreaId>("operaciones");
  const [turno, setTurno] = useState<Turno>("Mañana");
  const [responsableId, setResponsableId] = useState<string>(
    jefaturas[0]?.id ?? "",
  );
  const [asesorId, setAsesorId] = useState<string>("");
  const [descripcion, setDescripcion] = useState("");
  const [fechaEjecucion, setFechaEjecucion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    if (!titulo.trim()) {
      setError("Escribe un título.");
      return;
    }
    if (!responsableId) {
      setError("Elige un responsable de jefatura.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("pendientes").insert({
      titulo: titulo.trim(),
      area,
      turno,
      responsable_id: responsableId,
      asesor_id: asesorId || null,
      descripcion: descripcion.trim(),
      estado: "abierto",
      created_by: persona.id,
      ...(fechaEjecucion ? { fecha_ejecucion: fechaEjecucion } : {}),
    });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    onSaved();
  }

  return (
    <ModalWrap title="Nuevo pendiente" onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Título" full>
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ej: Reponer maniquí vitrina 2"
            className="w-full px-3 py-2 border border-line rounded-md bg-white text-sm"
          />
        </Field>
        <Field label="Área">
          <select
            value={area}
            onChange={(e) => setArea(e.target.value as AreaId)}
            className="w-full px-3 py-2 border border-line rounded-md bg-white text-sm"
          >
            {AREAS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Turno">
          <select
            value={turno}
            onChange={(e) => setTurno(e.target.value as Turno)}
            className="w-full px-3 py-2 border border-line rounded-md bg-white text-sm"
          >
            {TURNOS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Fecha de ejecución" full>
          <input
            type="date"
            value={fechaEjecucion}
            min={hoyLocalStr()}
            onChange={(e) => setFechaEjecucion(e.target.value)}
            className="w-full px-3 py-2 border border-line rounded-md bg-white text-sm"
          />
        </Field>
        <Field label="Responsable de gestión" full>
          <select
            value={responsableId}
            onChange={(e) => setResponsableId(e.target.value)}
            className="w-full px-3 py-2 border border-line rounded-md bg-white text-sm"
          >
            {jefaturas.length === 0 && (
              <option value="">No hay jefatura registrada.</option>
            )}
            {jefaturas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre} — {p.cargo}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Asesor relacionado (opcional)" full>
          <select
            value={asesorId}
            onChange={(e) => setAsesorId(e.target.value)}
            className="w-full px-3 py-2 border border-line rounded-md bg-white text-sm"
          >
            <option value="">— Ninguno —</option>
            {asesores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre} — {p.cargo}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Descripción" full>
          <textarea
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Detalle del pendiente…"
            rows={4}
            className="w-full px-3 py-2 border border-line rounded-md bg-white text-sm resize-y"
          />
        </Field>
      </div>
      {error && (
        <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="mt-4 w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light transition-colors"
      >
        {saving ? "Guardando…" : "Guardar pendiente"}
      </button>
    </ModalWrap>
  );
}

function DetalleModal({
  p,
  nombreDe,
  onClose,
  onChanged,
}: {
  p: Pendiente;
  nombreDe: (id: string | null) => string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function updateEstado(nuevo: EstadoPendiente) {
    setError(null);
    setSaving(true);
    const patch: {
      estado: EstadoPendiente;
      closed_at: string | null;
      closed_by: string | null;
    } = {
      estado: nuevo,
      closed_at: nuevo === "cerrado" ? new Date().toISOString() : null,
      closed_by: null,
    };
    if (nuevo === "cerrado") {
      const { data: session } = await supabase.auth.getSession();
      const { data: me } = await supabase
        .from("personal")
        .select("id")
        .eq("auth_user_id", session.session?.user.id ?? "")
        .maybeSingle();
      patch.closed_by = (me as { id: string } | null)?.id ?? null;
    }
    const { error } = await supabase
      .from("pendientes")
      .update(patch)
      .eq("id", p.id);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    onChanged();
    onClose();
  }

  return (
    <ModalWrap title={p.titulo} onClose={onClose} wide>
      <div className="flex flex-wrap gap-2 mb-3">
        <AreaBadge area={p.area} />
        <EstadoTag estado={p.estado} />
        <VencimientoTag p={p} />
      </div>
      <KV k="Responsable" v={nombreDe(p.responsable_id)} />
      {p.fecha_ejecucion && (
        <KV k="Fecha de ejecución" v={fmtDate(p.fecha_ejecucion + "T00:00:00")} />
      )}
      {p.asesor_id && <KV k="Asesor relacionado" v={nombreDe(p.asesor_id)} />}
      <KV k="Turno / fecha" v={`${p.turno} · ${fmtDate(p.created_at)}`} />
      <KV k="Registrado por" v={nombreDe(p.created_by)} />
      {p.closed_at && (
        <KV k="Cerrado" v={`${fmtDate(p.closed_at)} por ${nombreDe(p.closed_by)}`} />
      )}

      {p.descripcion && (
        <p className="mt-3 text-sm whitespace-pre-wrap">{p.descripcion}</p>
      )}

      {error && (
        <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">
          {error}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {p.estado === "abierto" && (
          <button
            type="button"
            onClick={() => updateEstado("progreso")}
            disabled={saving}
            className="px-3 py-2 border border-line rounded-md bg-white text-sm hover:bg-paper disabled:opacity-50"
          >
            Marcar en progreso
          </button>
        )}
        {p.estado !== "cerrado" && (
          <button
            type="button"
            onClick={() => updateEstado("cerrado")}
            disabled={saving}
            className="px-3 py-2 bg-operaciones text-white rounded-md text-sm font-semibold disabled:opacity-50"
          >
            Cerrar pendiente
          </button>
        )}
        {p.estado === "cerrado" && (
          <button
            type="button"
            onClick={() => updateEstado("abierto")}
            disabled={saving}
            className="px-3 py-2 border border-line rounded-md bg-white text-sm hover:bg-paper disabled:opacity-50"
          >
            Reabrir
          </button>
        )}
      </div>
    </ModalWrap>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 py-1 text-sm border-b border-line/60">
      <span className="text-muted text-xs uppercase tracking-wider pt-0.5">{k}</span>
      <span className="font-medium">{v}</span>
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

