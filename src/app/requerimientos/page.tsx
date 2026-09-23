"use client";

import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { crearNotificacion } from "@/lib/notificaciones";
import { NOMBRES_MES } from "@/lib/horarios";
import {
  TIPOS_REQUERIMIENTO,
  labelTipoRequerimiento,
  labelEstadoRequerimiento,
  type DiaBloqueadoRow,
  type EstadoRequerimiento,
  type Persona,
  type Requerimiento,
  type RosterPublico,
  type TipoRequerimiento,
} from "@/lib/types";

const BUCKET = "requerimientos-evidencias";

// Colores por tipo — chips del calendario y badges del modal.
const COLOR_TIPO: Record<TipoRequerimiento, { bg: string; text: string; border: string }> = {
  dia_libre: { bg: "bg-brand/10", text: "text-brand", border: "border-brand/30" },
  salida_temprano: { bg: "bg-ventas/10", text: "text-ventas", border: "border-ventas/30" },
  permiso: { bg: "bg-operaciones/10", text: "text-operaciones", border: "border-operaciones/30" },
  otro: { bg: "bg-neutral-100", text: "text-muted", border: "border-line" },
};

const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function RequerimientosPage() {
  return (
    <Suspense fallback={null}>
      <RequerimientosContent />
    </Suspense>
  );
}

function RequerimientosContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loading, session, persona } = useSession();

  const now = new Date();
  const [anio, setAnio] = useState(now.getFullYear());
  const [mes, setMes] = useState(now.getMonth() + 1);

  const [personal, setPersonal] = useState<RosterPublico[]>([]);
  const [requerimientos, setRequerimientos] = useState<Requerimiento[]>([]);
  const [diasBloqueados, setDiasBloqueados] = useState<DiaBloqueadoRow[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fechaAbierta, setFechaAbierta] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!persona) return;
    setFetchError(null);
    const prefijo = `${anio}-${String(mes).padStart(2, "0")}`;
    const ultimoDia = new Date(anio, mes, 0).getDate();
    const fechaFin = `${prefijo}-${String(ultimoDia).padStart(2, "0")}`;
    const [pRes, rRes, bRes] = await Promise.all([
      // roster_publico() es SECURITY DEFINER — devuelve el roster completo
      // aunque quien llama sea un asesor (RLS de `personal` restringe a un
      // asesor a solo su propia fila; sin esto, "Aprobado por [jefatura]"
      // nunca resolvería el nombre para un asesor).
      supabase.rpc("roster_publico"),
      supabase
        .from("requerimientos")
        .select("*")
        .gte("fecha", `${prefijo}-01`)
        .lte("fecha", fechaFin),
      supabase
        .from("dias_bloqueados")
        .select("*")
        .gte("fecha", `${prefijo}-01`)
        .lte("fecha", fechaFin),
    ]);
    if (pRes.error) return setFetchError(pRes.error.message);
    if (rRes.error) return setFetchError(rRes.error.message);
    if (bRes.error) return setFetchError(bRes.error.message);
    setPersonal(((pRes.data as RosterPublico[] | null) ?? []).sort((a, b) => a.nombre.localeCompare(b.nombre)));
    setRequerimientos((rRes.data as Requerimiento[] | null) ?? []);
    setDiasBloqueados((bRes.data as DiaBloqueadoRow[] | null) ?? []);
  }, [anio, mes, persona]);

  useEffect(() => {
    if (loading) return;
    if (!session) return router.replace("/login");
    if (persona) loadData();
  }, [loading, session, persona, router, loadData]);

  // Realtime — si otra persona (jefatura revisando, o un compañero
  // solicitando) toca la tabla, todos ven el cambio sin refrescar.
  useEffect(() => {
    if (!persona) return;
    const channel = supabase
      .channel("requerimientos-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "requerimientos" },
        () => loadData(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [persona, loadData]);

  // Si llegamos desde una notificación con ?fecha=YYYY-MM-DD, saltar al
  // mes correspondiente y abrir ese día directamente.
  useEffect(() => {
    const fechaParam = searchParams.get("fecha");
    if (!fechaParam || !/^\d{4}-\d{2}-\d{2}$/.test(fechaParam)) return;
    const [y, m] = fechaParam.split("-").map(Number);
    setAnio(y);
    setMes(m);
    setFechaAbierta(fechaParam);
  }, [searchParams]);

  const personaDe = useMemo(() => {
    const map = new Map<string, RosterPublico>();
    personal.forEach((p) => map.set(p.id, p));
    return (id: string) => map.get(id);
  }, [personal]);

  const bloqueadoDe = useMemo(() => {
    const map = new Map<string, DiaBloqueadoRow>();
    diasBloqueados.forEach((b) => map.set(b.fecha, b));
    return (fecha: string) => map.get(fecha);
  }, [diasBloqueados]);

  const reqsDelDia = useCallback(
    (fecha: string) => requerimientos.filter((r) => r.fecha === fecha),
    [requerimientos],
  );

  const diasDelMes = useMemo(() => {
    const n = new Date(anio, mes, 0).getDate();
    return Array.from({ length: n }, (_, i) => i + 1);
  }, [anio, mes]);

  const offsetInicio = useMemo(() => {
    const wd = new Date(anio, mes - 1, 1).getDay(); // 0=Dom
    return wd === 0 ? 6 : wd - 1; // que la semana arranque en Lunes
  }, [anio, mes]);

  function navegar(delta: number) {
    let m = mes + delta;
    let a = anio;
    if (m < 1) {
      m = 12;
      a--;
    } else if (m > 12) {
      m = 1;
      a++;
    }
    setMes(m);
    setAnio(a);
  }

  if (loading || !persona) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted text-sm">
        Cargando…
      </div>
    );
  }

  const hoy = todayStr();

  return (
    <AppShell persona={persona}>
      <div className="mx-auto max-w-[1000px] px-6 py-7 w-full">
        <div className="mb-5">
          <h2 className="text-[17px] font-display font-semibold m-0 mb-1">Requerimientos</h2>
          <p className="text-muted text-[13px] max-w-2xl">
            {persona.rol === "jefatura"
              ? "Calendario de requerimientos de todo el equipo (días libres, salidas temprano, permisos). Sirve de referencia al generar los horarios."
              : "Registra aquí tus requerimientos (día libre, salida temprano, permisos) para que jefatura los tenga en cuenta al armar el horario."}
          </p>
        </div>

        <div className="bg-panel border border-line rounded-[10px] p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navegar(-1)}
                className="w-8 h-8 rounded-md border border-line bg-white hover:bg-paper text-sm"
              >
                ‹
              </button>
              <h3 className="font-display font-semibold text-sm min-w-[160px] text-center">
                {NOMBRES_MES[mes - 1]} {anio}
              </h3>
              <button
                type="button"
                onClick={() => navegar(1)}
                className="w-8 h-8 rounded-md border border-line bg-white hover:bg-paper text-sm"
              >
                ›
              </button>
            </div>
            <div className="flex gap-3 flex-wrap text-[11px] text-muted">
              {TIPOS_REQUERIMIENTO.map((t) => (
                <span key={t.id} className="flex items-center gap-1.5">
                  <span className={`inline-block w-2.5 h-2.5 rounded-full ${COLOR_TIPO[t.id].bg} border ${COLOR_TIPO[t.id].border}`} />
                  {t.label}
                </span>
              ))}
            </div>
          </div>

          {fetchError && (
            <div className="mb-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-sm">
              {fetchError}
            </div>
          )}

          <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted mb-1">
            {DIAS_SEMANA.map((d) => (
              <div key={d} className="py-1 font-semibold">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: offsetInicio }, (_, i) => (
              <div key={"empty-" + i} />
            ))}
            {diasDelMes.map((d) => {
              const fecha = `${anio}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
              const bloqueado = bloqueadoDe(fecha);
              const reqsRaw = reqsDelDia(fecha);
              const reqs =
                persona.rol === "jefatura"
                  ? reqsRaw
                  : reqsRaw.filter((r) => r.persona_id === persona.id);
              const visibles = reqs.slice(0, 3);
              const extra = reqs.length - visibles.length;
              const esHoy = fecha === hoy;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setFechaAbierta(fecha)}
                  className={
                    "text-left border rounded-md p-1.5 min-h-[72px] transition-colors hover:border-brand/50 " +
                    (bloqueado ? "bg-warn-soft/60 border-warn-border " : "bg-white border-line ") +
                    (esHoy ? "ring-2 ring-brand" : "")
                  }
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold">{d}</span>
                    {bloqueado && (
                      <span className="text-[8.5px] text-warn font-semibold uppercase">
                        Bloqueado
                      </span>
                    )}
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {visibles.map((r) => {
                      // Un rechazo siempre se resalta en rojo, sin importar
                      // el color de su tipo — así salta a la vista incluso
                      // en la miniatura del calendario y el asesor entra a
                      // ver el motivo.
                      const rechazado = r.estado === "rechazado";
                      return (
                        <div
                          key={r.id}
                          className={
                            "text-[9px] px-1 py-0.5 rounded truncate font-medium " +
                            (rechazado
                              ? "bg-warn text-white"
                              : `${COLOR_TIPO[r.tipo].bg} ${COLOR_TIPO[r.tipo].text}`)
                          }
                        >
                          {rechazado ? "⚠ " : ""}
                          {persona.rol === "jefatura"
                            ? `${personaDe(r.persona_id)?.nombre.split(" ")[0] ?? "—"}: `
                            : ""}
                          {labelTipoRequerimiento(r.tipo)}
                          {rechazado ? " rechazado" : ""}
                        </div>
                      );
                    })}
                    {extra > 0 && (
                      <div className="text-[9px] text-muted">+{extra} más</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {fechaAbierta && (
        <DiaModal
          fecha={fechaAbierta}
          persona={persona}
          personal={personal}
          bloqueado={bloqueadoDe(fechaAbierta) ?? null}
          requerimientos={reqsDelDia(fechaAbierta)}
          onClose={() => {
            setFechaAbierta(null);
            // Limpia el query param para que un refresh no reabra el modal.
            router.replace("/requerimientos");
          }}
          onChanged={loadData}
        />
      )}
    </AppShell>
  );
}

// ---------- Modal de día ----------

function DiaModal({
  fecha,
  persona,
  personal,
  bloqueado,
  requerimientos,
  onClose,
  onChanged,
}: {
  fecha: string;
  persona: Persona;
  personal: RosterPublico[];
  bloqueado: DiaBloqueadoRow | null;
  requerimientos: Requerimiento[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const esJefatura = persona.rol === "jefatura";
  const [personaId, setPersonaId] = useState(persona.id);
  const [tipo, setTipo] = useState<TipoRequerimiento>("dia_libre");
  const [detalle, setDetalle] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toggleBloqueoBusy, setToggleBloqueoBusy] = useState(false);
  const [rechazandoId, setRechazandoId] = useState<string | null>(null);
  const [motivoRechazoInput, setMotivoRechazoInput] = useState("");
  // Colapsado por defecto: separa a propósito "revisar/aprobar lo que ya
  // existe" (siempre visible arriba) de "registrar algo nuevo" (acción
  // aparte, que hay que abrir a propósito) — jefatura confundía ambas
  // cosas al estar todo junto en el mismo modal.
  const [mostrarFormulario, setMostrarFormulario] = useState(false);

  const fechaFmt = new Date(fecha + "T00:00:00").toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const reqsOrdenados = [...requerimientos].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );

  const personaDe = (id: string) => personal.find((p) => p.id === id);

  async function toggleBloqueo() {
    setToggleBloqueoBusy(true);
    if (bloqueado) {
      await supabase.from("dias_bloqueados").delete().eq("id", bloqueado.id);
    } else {
      const motivo = prompt("Motivo del bloqueo (opcional):") || "";
      await supabase.from("dias_bloqueados").insert({
        fecha,
        motivo,
        creado_por: persona.id,
      });
    }
    setToggleBloqueoBusy(false);
    onChanged();
  }

  async function guardar() {
    setError(null);
    if (bloqueado) {
      setError("Este día está bloqueado por jefatura. Desbloquéalo antes de agregar.");
      return;
    }
    setSaving(true);

    const estadoInicial: EstadoRequerimiento = esJefatura ? "aprobado" : "pendiente";
    const insertPayload: Record<string, unknown> = {
      fecha,
      persona_id: esJefatura ? personaId : persona.id,
      tipo,
      detalle: detalle.trim(),
      estado: estadoInicial,
      registrado_por: persona.id,
    };
    if (esJefatura) {
      insertPayload.revisado_por = persona.id;
      insertPayload.fecha_revision = new Date().toISOString();
    }

    const { data: inserted, error: insErr } = await supabase
      .from("requerimientos")
      .insert(insertPayload)
      .select()
      .single();
    if (insErr || !inserted) {
      setError(insErr?.message ?? "No se pudo guardar el requerimiento.");
      setSaving(false);
      return;
    }
    const nuevoId = (inserted as { id: string }).id;

    // Subir evidencia si hay archivo — path prefijado por persona_id para
    // que las policies de Storage puedan validar dueño sin otra tabla.
    if (archivo) {
      const dueño = esJefatura ? personaId : persona.id;
      const path = `${dueño}/${nuevoId}-${archivo.name}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, archivo, { upsert: false });
      if (!upErr) {
        await supabase
          .from("requerimientos")
          .update({ evidencia_path: path, evidencia_nombre: archivo.name })
          .eq("id", nuevoId);
      }
    }

    // Notificar
    const targetPersona = esJefatura ? personaId : persona.id;
    if (!esJefatura) {
      await crearNotificacion({
        tipo: "requerimiento_nuevo",
        destinatarioJefatura: true,
        mensaje: `${persona.nombre} solicitó "${labelTipoRequerimiento(tipo)}" para el ${fechaFmt}.`,
        refFecha: fecha,
        refTabla: "requerimientos",
        refId: nuevoId,
      });
    } else if (targetPersona !== persona.id) {
      await crearNotificacion({
        tipo: "requerimiento_aprobado",
        destinatarioPersonaId: targetPersona,
        mensaje: `Jefatura registró "${labelTipoRequerimiento(tipo)}" para ti el ${fechaFmt}.`,
        refFecha: fecha,
        refTabla: "requerimientos",
        refId: nuevoId,
      });
    }

    setSaving(false);
    setDetalle("");
    setArchivo(null);
    setMostrarFormulario(false);
    onChanged();
  }

  async function aprobar(r: Requerimiento) {
    await supabase
      .from("requerimientos")
      .update({ estado: "aprobado", revisado_por: persona.id, fecha_revision: new Date().toISOString() })
      .eq("id", r.id);
    await crearNotificacion({
      tipo: "requerimiento_aprobado",
      destinatarioPersonaId: r.persona_id,
      mensaje: `Tu requerimiento de "${labelTipoRequerimiento(r.tipo)}" para el ${fechaFmt} fue aprobado por ${persona.nombre}.`,
      refFecha: fecha,
      refTabla: "requerimientos",
      refId: r.id,
    });
    onChanged();
  }

  async function confirmarRechazo(r: Requerimiento, motivo: string) {
    await supabase
      .from("requerimientos")
      .update({
        estado: "rechazado",
        motivo_rechazo: motivo.trim(),
        revisado_por: persona.id,
        fecha_revision: new Date().toISOString(),
      })
      .eq("id", r.id);
    await crearNotificacion({
      tipo: "requerimiento_rechazado",
      destinatarioPersonaId: r.persona_id,
      mensaje: `Tu requerimiento de "${labelTipoRequerimiento(r.tipo)}" para el ${fechaFmt} fue rechazado por ${persona.nombre}. Motivo: ${motivo.trim()}`,
      refFecha: fecha,
      refTabla: "requerimientos",
      refId: r.id,
    });
    setRechazandoId(null);
    setMotivoRechazoInput("");
    onChanged();
  }

  async function eliminar(r: Requerimiento) {
    if (!confirm("¿Eliminar este requerimiento?")) return;
    if (r.evidencia_path) {
      await supabase.storage.from(BUCKET).remove([r.evidencia_path]);
    }
    await supabase.from("requerimientos").delete().eq("id", r.id);
    onChanged();
  }

  async function descargarEvidencia(r: Requerimiento) {
    if (!r.evidencia_path) return;
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(r.evidencia_path, 60);
    if (error || !data) {
      alert("No se pudo generar el enlace de descarga.");
      return;
    }
    window.open(data.signedUrl, "_blank");
  }

  const puedeAgregar = !bloqueado;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-panel rounded-[10px] p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto relative shadow-xl"
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
        <h3 className="font-display font-semibold text-base mb-1 pr-8 capitalize">
          {fechaFmt}
        </h3>

        {bloqueado && (
          <div className="bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs mb-3">
            Día bloqueado por jefatura{bloqueado.motivo ? `: ${bloqueado.motivo}` : "."}
          </div>
        )}

        {esJefatura && (
          <button
            type="button"
            onClick={toggleBloqueo}
            disabled={toggleBloqueoBusy}
            className="text-xs px-3 py-1.5 rounded-md border border-line bg-white hover:bg-paper mb-3 disabled:opacity-50"
          >
            {toggleBloqueoBusy
              ? "Guardando…"
              : bloqueado
              ? "Desbloquear este día"
              : "Bloquear este día"}
          </button>
        )}

        <div className="bg-paper border border-line rounded-md p-3 mb-4">
          <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-2.5">
            {esJefatura ? "Por revisar — solicitudes de tu equipo" : "Tus requerimientos este día"}
          </div>
          <div className="space-y-2.5">
          {reqsOrdenados.length === 0 ? (
            <div className="text-center py-4 text-muted text-sm">
              Sin requerimientos registrados para este día.
            </div>
          ) : (
            reqsOrdenados.map((r) => {
              const p = personaDe(r.persona_id);
              const puedeRevisar = esJefatura && r.persona_id !== persona.id && r.estado === "pendiente";
              const puedeEliminar =
                esJefatura || (r.registrado_por === persona.id && r.estado === "pendiente");
              return (
                <div key={r.id} className="border border-line rounded-md p-3 bg-white">
                  <div className="flex items-center justify-between flex-wrap gap-1.5">
                    <span
                      className={
                        "text-[10.5px] font-semibold px-2 py-0.5 rounded-full border " +
                        COLOR_TIPO[r.tipo].bg +
                        " " +
                        COLOR_TIPO[r.tipo].text +
                        " " +
                        COLOR_TIPO[r.tipo].border
                      }
                    >
                      {labelTipoRequerimiento(r.tipo)}
                    </span>
                    <span
                      className={
                        "text-[10px] font-semibold px-2 py-0.5 rounded-full " +
                        (r.estado === "aprobado"
                          ? "bg-operaciones/10 text-operaciones"
                          : r.estado === "rechazado"
                          ? "bg-warn-soft text-warn"
                          : "bg-ventas/10 text-ventas")
                      }
                    >
                      {labelEstadoRequerimiento(r.estado)}
                    </span>
                  </div>
                  <div className="text-sm font-semibold mt-1.5">{p?.nombre ?? "—"}</div>
                  {r.detalle && <div className="text-[12.5px] text-muted mt-0.5">{r.detalle}</div>}
                  {r.estado === "rechazado" && r.motivo_rechazo && (
                    <div className="mt-2 bg-warn-soft border border-warn-border rounded-md px-2.5 py-2">
                      <div className="text-[10px] font-semibold text-warn uppercase tracking-wider">
                        ⚠ Motivo del rechazo
                      </div>
                      <div className="text-[12.5px] text-warn mt-0.5">{r.motivo_rechazo}</div>
                    </div>
                  )}
                  {r.evidencia_path && (
                    <button
                      type="button"
                      onClick={() => descargarEvidencia(r)}
                      className="text-[11px] text-brand hover:underline mt-1.5 inline-block"
                    >
                      📎 {r.evidencia_nombre ?? "Descargar evidencia"}
                    </button>
                  )}
                  <div className="text-[10.5px] text-muted mt-2">
                    Registrado por{" "}
                    <strong>{personaDe(r.registrado_por)?.nombre ?? "—"}</strong>
                    {r.revisado_por && (
                      <>
                        {" "}
                        · {r.estado === "aprobado" ? "Aprobado" : "Rechazado"} por{" "}
                        <strong>{personaDe(r.revisado_por)?.nombre ?? "—"}</strong>
                      </>
                    )}
                  </div>
                  {rechazandoId === r.id ? (
                    <div className="mt-2 bg-warn-soft border border-warn-border rounded-md p-2.5">
                      <label className="block text-[10.5px] font-semibold text-warn mb-1">
                        Motivo del rechazo (obligatorio — el asesor lo verá)
                      </label>
                      <textarea
                        value={motivoRechazoInput}
                        onChange={(e) => setMotivoRechazoInput(e.target.value)}
                        rows={2}
                        placeholder="Ej: ya hay 2 personas con día libre esa fecha…"
                        className="w-full px-2 py-1.5 border border-warn-border rounded-md bg-white text-[12.5px] resize-none"
                        autoFocus
                      />
                      <div className="flex gap-1.5 mt-1.5">
                        <button
                          type="button"
                          onClick={() => confirmarRechazo(r, motivoRechazoInput)}
                          disabled={!motivoRechazoInput.trim()}
                          className="text-[11px] px-2.5 py-1 rounded bg-warn text-white disabled:opacity-40"
                        >
                          Confirmar rechazo
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRechazandoId(null);
                            setMotivoRechazoInput("");
                          }}
                          className="text-[11px] px-2.5 py-1 rounded border border-line bg-white hover:bg-paper"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    (puedeRevisar || puedeEliminar) && (
                      <div className="flex gap-1.5 mt-2">
                        {puedeRevisar && (
                          <>
                            <button
                              type="button"
                              onClick={() => aprobar(r)}
                              className="text-[11px] px-2 py-1 rounded border border-operaciones/40 text-operaciones bg-operaciones/5 hover:bg-operaciones/10"
                            >
                              Aprobar
                            </button>
                            <button
                              type="button"
                              onClick={() => setRechazandoId(r.id)}
                              className="text-[11px] px-2 py-1 rounded border border-warn-border text-warn bg-warn-soft hover:bg-warn-soft/80"
                            >
                              Rechazar
                            </button>
                          </>
                        )}
                        {puedeEliminar && (
                          <button
                            type="button"
                            onClick={() => eliminar(r)}
                            className="text-[11px] px-2 py-1 rounded border border-line text-muted hover:bg-paper ml-auto"
                          >
                            Eliminar
                          </button>
                        )}
                      </div>
                    )
                  )}
                </div>
              );
            })
          )}
          </div>
        </div>

        {puedeAgregar ? (
          <div>
            {!mostrarFormulario ? (
              <button
                type="button"
                onClick={() => setMostrarFormulario(true)}
                className="w-full py-2.5 rounded-md border border-dashed border-brand/40 text-brand text-sm font-semibold hover:bg-brand/5 transition-colors"
              >
                + Registrar un requerimiento{esJefatura ? " (para ti o para un asesor)" : ""}
              </button>
            ) : (
            <div className="border border-brand/30 bg-brand/5 rounded-md p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-semibold text-brand uppercase tracking-wider">
                Registrar un requerimiento nuevo
              </div>
              <button
                type="button"
                onClick={() => setMostrarFormulario(false)}
                className="text-[11px] text-muted hover:text-ink"
              >
                Cancelar
              </button>
            </div>
            <div className="space-y-2.5">
              {esJefatura && (
                <div>
                  <label className="block text-[11px] text-muted mb-1">Persona</label>
                  <select
                    value={personaId}
                    onChange={(e) => setPersonaId(e.target.value)}
                    className="w-full px-3 py-2 border border-line rounded-md bg-white text-sm"
                  >
                    {personal.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-[11px] text-muted mb-1">Tipo</label>
                <select
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as TipoRequerimiento)}
                  className="w-full px-3 py-2 border border-line rounded-md bg-white text-sm"
                >
                  {TIPOS_REQUERIMIENTO.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-muted mb-1">Detalle (opcional)</label>
                <textarea
                  value={detalle}
                  onChange={(e) => setDetalle(e.target.value)}
                  placeholder="Ej: salida a las 5pm por cita médica…"
                  rows={2}
                  className="w-full px-3 py-2 border border-line rounded-md bg-white text-sm resize-none"
                />
              </div>
              <div>
                <label className="block text-[11px] text-muted mb-1">
                  Anexo (opcional) — certificado, constancia
                </label>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
                  className="block w-full text-xs border border-line rounded-md p-2 bg-white"
                />
              </div>
            </div>
            {error && (
              <div className="mt-2.5 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">
                {error}
              </div>
            )}
            <button
              type="button"
              onClick={guardar}
              disabled={saving}
              className="mt-3 w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light transition-colors"
            >
              {saving ? "Guardando…" : "Guardar requerimiento"}
            </button>
            </div>
            )}
          </div>
        ) : (
          !esJefatura && (
            <div className="text-center py-3 text-muted text-sm border-t border-line mt-4">
              Jefatura bloqueó este día — no se pueden agregar nuevos requerimientos.
            </div>
          )
        )}
      </div>
    </div>
  );
}
