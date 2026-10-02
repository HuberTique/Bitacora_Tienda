"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { NOMBRES_MES } from "@/lib/horarios";
import {
  DIAS_SEMANA,
  describirRepeticion,
  fechaDe,
  isoDe,
  ocurrenciasDelMes,
  problemaRepeticion,
  proximaOcurrencia,
  type Frecuencia,
  type TareaRecurrente,
} from "@/lib/recurrentes";
import { AREAS, TURNOS, labelArea, type AreaId, type RosterPublico, type Turno } from "@/lib/types";

const AREA_COLOR: Record<AreaId, string> = {
  rrhh: "var(--color-rrhh)",
  visual: "var(--color-visual)",
  operaciones: "var(--color-operaciones)",
  ventas: "var(--color-ventas)",
  mantenimiento: "var(--color-mantenimiento)",
  otros: "var(--color-otros)",
};

const campo = "w-full px-3 py-2 border border-line rounded-md bg-white text-sm";
const etiqueta = "block text-xs text-muted uppercase tracking-wider mb-1";

function fechaLarga(iso: string): string {
  return fechaDe(iso).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });
}

/**
 * Tareas que se repiten (ej. "verificar caja menor todos los lunes"). Se
 * definen una vez y cada día que toca aparecen solas como pendiente en el
 * tablero, con aviso al responsable. Son solo de jefatura: ningún asesor las
 * ve ni las puede marcar como realizadas, aunque figure como relacionado.
 */
export function RecurrentesModal({
  persona,
  roster,
  onClose,
  onChanged,
}: {
  persona: { id: string };
  roster: RosterPublico[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tareas, setTareas] = useState<TareaRecurrente[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<TareaRecurrente | "nueva" | null>(null);

  const hoy = isoDe(new Date());
  const [mesVisto, setMesVisto] = useState(() => {
    const d = new Date();
    return { anio: d.getFullYear(), mes: d.getMonth() + 1 };
  });

  const cargar = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("tareas_recurrentes")
      .select("*")
      .order("activa", { ascending: false })
      .order("titulo");
    if (err) setError(err.message);
    else {
      setError(null);
      setTareas((data as TareaRecurrente[] | null) ?? []);
    }
  }, []);

  useEffect(() => {
    let vivo = true;
    supabase
      .from("tareas_recurrentes")
      .select("*")
      .order("activa", { ascending: false })
      .order("titulo")
      .then(({ data, error: err }) => {
        if (!vivo) return;
        if (err) setError(err.message);
        else setTareas((data as TareaRecurrente[] | null) ?? []);
      });
    return () => {
      vivo = false;
    };
  }, []);

  const nombreDe = (id: string | null) => roster.find((p) => p.id === id)?.nombre ?? "—";

  /** Tras cualquier cambio: recarga, genera lo de hoy si aplica y avisa al tablero. */
  async function trasCambio() {
    await cargar();
    await supabase.rpc("generar_pendientes_recurrentes");
    onChanged();
  }

  async function alternarActiva(t: TareaRecurrente) {
    const { error: err } = await supabase.from("tareas_recurrentes").update({ activa: !t.activa }).eq("id", t.id);
    if (err) setError(err.message);
    else await trasCambio();
  }

  async function eliminar(t: TareaRecurrente) {
    if (
      !confirm(
        `¿Eliminar la tarea recurrente "${t.titulo}"?\n\nDeja de generarse desde hoy. Los pendientes que ya creó se conservan en el tablero y en el historial.`,
      )
    )
      return;
    const { error: err } = await supabase.from("tareas_recurrentes").delete().eq("id", t.id);
    if (err) setError(err.message);
    else await trasCambio();
  }

  const delMes = useMemo(
    () => ocurrenciasDelMes(tareas ?? [], mesVisto.anio, mesVisto.mes),
    [tareas, mesVisto],
  );

  // Cuadrícula del mes, empezando en lunes.
  const celdas = useMemo(() => {
    const primero = new Date(mesVisto.anio, mesVisto.mes - 1, 1);
    const vacias = (primero.getDay() + 6) % 7;
    const dias = new Date(mesVisto.anio, mesVisto.mes, 0).getDate();
    const lista: (string | null)[] = Array.from({ length: vacias }, () => null);
    for (let d = 1; d <= dias; d++) {
      lista.push(`${mesVisto.anio}-${String(mesVisto.mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
    return lista;
  }, [mesVisto]);

  function moverMes(delta: number) {
    setMesVisto((m) => {
      const d = new Date(m.anio, m.mes - 1 + delta, 1);
      return { anio: d.getFullYear(), mes: d.getMonth() + 1 };
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="bg-panel rounded-[10px] p-6 w-full max-w-3xl relative shadow-xl max-h-[90vh] overflow-y-auto"
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

        {editando ? (
          <FormularioRecurrente
            tarea={editando === "nueva" ? null : editando}
            persona={persona}
            roster={roster}
            onCancelar={() => setEditando(null)}
            onGuardado={async () => {
              setEditando(null);
              await trasCambio();
            }}
          />
        ) : (
          <>
            <h3 className="font-display font-semibold text-base mb-1 pr-8">Tareas recurrentes</h3>
            <p className="text-muted text-[12.5px] mb-4">
              Tareas que se repiten, como una reunión de calendario. El día que toca aparecen solas
              en el tablero y le llega un aviso al responsable. Si no se marca como realizada, sigue
              ahí como vencida hasta que jefatura la finalice. Solo jefatura las ve y las marca.
            </p>

            {error && (
              <div className="mb-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">
                {error}
              </div>
            )}

            {/* Calendario del mes */}
            <div className="border border-line rounded-lg bg-white p-3 mb-4">
              <div className="flex items-center justify-between mb-2">
                <button
                  type="button"
                  onClick={() => moverMes(-1)}
                  className="px-2 py-1 border border-line rounded-md text-sm hover:bg-paper"
                  aria-label="Mes anterior"
                >
                  ‹
                </button>
                <div className="font-display font-semibold text-sm capitalize">
                  {NOMBRES_MES[mesVisto.mes - 1]} {mesVisto.anio}
                </div>
                <button
                  type="button"
                  onClick={() => moverMes(1)}
                  className="px-2 py-1 border border-line rounded-md text-sm hover:bg-paper"
                  aria-label="Mes siguiente"
                >
                  ›
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-[10.5px] text-muted uppercase tracking-wider mb-1">
                {DIAS_SEMANA.map((d) => (
                  <div key={d.n}>{d.largo.slice(0, 3)}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {celdas.map((iso, i) => {
                  if (!iso) return <div key={`v${i}`} />;
                  const lista = delMes.get(iso) ?? [];
                  const esHoy = iso === hoy;
                  return (
                    <div
                      key={iso}
                      className={
                        "min-h-[58px] rounded-md border p-1 text-left " +
                        (esHoy ? "border-brand bg-brand/5" : "border-line/70")
                      }
                      title={lista.map((t) => t.titulo).join("\n")}
                    >
                      <div className={"text-[11px] " + (esHoy ? "font-bold text-brand" : "text-muted")}>
                        {Number(iso.slice(8))}
                      </div>
                      {lista.slice(0, 2).map((t) => (
                        <div
                          key={t.id}
                          className="text-[9.5px] leading-tight text-white rounded px-1 py-[1px] mt-0.5 truncate"
                          style={{ background: AREA_COLOR[t.area] }}
                        >
                          {t.titulo}
                        </div>
                      ))}
                      {lista.length > 2 && (
                        <div className="text-[9.5px] text-muted mt-0.5">+{lista.length - 2} más</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] text-muted uppercase tracking-wider">
                {tareas === null ? "Cargando…" : `${tareas.length} ${tareas.length === 1 ? "tarea" : "tareas"}`}
              </div>
              <button
                type="button"
                onClick={() => setEditando("nueva")}
                className="px-3 py-2 rounded-md bg-brand text-white text-sm font-semibold hover:bg-brand-light transition-colors"
              >
                + Nueva tarea recurrente
              </button>
            </div>

            {tareas && tareas.length === 0 && (
              <div className="border border-line rounded-md p-6 text-center text-muted text-sm">
                Aún no hay tareas recurrentes. Crea la primera, por ejemplo “Verificar caja menor” todos
                los lunes.
              </div>
            )}

            <div className="space-y-2">
              {(tareas ?? []).map((t) => {
                const proxima = proximaOcurrencia(t, hoy);
                return (
                  <div
                    key={t.id}
                    className={
                      "border border-line rounded-lg p-3 bg-white border-l-4 " + (t.activa ? "" : "opacity-60")
                    }
                    style={{ borderLeftColor: AREA_COLOR[t.area] }}
                  >
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm">
                          {t.titulo}
                          {!t.activa && (
                            <span className="ml-2 text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-zinc-100 text-muted uppercase tracking-wider">
                              Pausada
                            </span>
                          )}
                        </div>
                        <div className="text-[12.5px] mt-0.5">{describirRepeticion(t)}</div>
                        <div className="text-muted text-xs mt-1">
                          {labelArea(t.area)} · Turno {t.turno} · Responsable:{" "}
                          <strong className="text-ink">{nombreDe(t.responsable_id)}</strong>
                          {t.asesor_id && <> · Asesor: {nombreDe(t.asesor_id)}</>}
                        </div>
                        <div className="text-muted text-xs mt-0.5">
                          {!t.activa
                            ? "No se está generando."
                            : proxima === hoy
                              ? "Toca hoy."
                              : proxima
                                ? `Próxima vez: ${fechaLarga(proxima)}.`
                                : "Ya terminó: no vuelve a tocar."}
                          {t.fecha_fin && ` Termina el ${fechaDe(t.fecha_fin).toLocaleDateString("es-CO")}.`}
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => setEditando(t)}
                          className="text-xs px-2 py-1 border border-line rounded bg-white hover:bg-paper"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => alternarActiva(t)}
                          className="text-xs px-2 py-1 border border-line rounded bg-white hover:bg-paper"
                        >
                          {t.activa ? "Pausar" : "Reanudar"}
                        </button>
                        <button
                          type="button"
                          onClick={() => eliminar(t)}
                          className="text-xs px-2 py-1 border border-warn text-warn rounded bg-white hover:bg-warn-soft"
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FormularioRecurrente({
  tarea,
  persona,
  roster,
  onCancelar,
  onGuardado,
}: {
  tarea: TareaRecurrente | null;
  persona: { id: string };
  roster: RosterPublico[];
  onCancelar: () => void;
  onGuardado: () => void;
}) {
  const jefaturas = roster.filter((p) => p.rol === "jefatura");
  const asesores = roster.filter((p) => p.rol === "asesor");
  const hoy = isoDe(new Date());

  const [titulo, setTitulo] = useState(tarea?.titulo ?? "");
  const [area, setArea] = useState<AreaId>(tarea?.area ?? "operaciones");
  const [turno, setTurno] = useState<Turno>(tarea?.turno ?? "Mañana");
  const [descripcion, setDescripcion] = useState(tarea?.descripcion ?? "");
  const [responsableId, setResponsableId] = useState(
    tarea?.responsable_id ?? (jefaturas.some((j) => j.id === persona.id) ? persona.id : (jefaturas[0]?.id ?? "")),
  );
  const [asesorId, setAsesorId] = useState(tarea?.asesor_id ?? "");
  const [frecuencia, setFrecuencia] = useState<Frecuencia>(tarea?.frecuencia ?? "semanal");
  const [diasSemana, setDiasSemana] = useState<number[]>(tarea?.dias_semana ?? [new Date().getDay()]);
  const [diaMes, setDiaMes] = useState<string>(String(tarea?.dia_mes ?? new Date().getDate()));
  const [hora, setHora] = useState(tarea?.hora ? tarea.hora.slice(0, 5) : "");
  const [fechaInicio, setFechaInicio] = useState(tarea?.fecha_inicio ?? hoy);
  const [fechaFin, setFechaFin] = useState(tarea?.fecha_fin ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const repeticion = {
    frecuencia,
    dias_semana: frecuencia === "semanal" ? diasSemana : [],
    dia_mes: frecuencia === "mensual" ? Number(diaMes) || null : null,
    hora: hora ? `${hora}:00` : null,
    fecha_inicio: fechaInicio,
    fecha_fin: fechaFin || null,
  };
  const proxima = problemaRepeticion(repeticion)
    ? null
    : proximaOcurrencia({ ...repeticion, activa: true }, hoy);

  function alternarDia(n: number) {
    setDiasSemana((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n]));
  }

  async function guardar() {
    setError(null);
    if (!titulo.trim()) {
      setError("Escribe el título de la tarea.");
      return;
    }
    if (!responsableId) {
      setError("Elige un responsable de jefatura.");
      return;
    }
    const problema = problemaRepeticion(repeticion);
    if (problema) {
      setError(problema);
      return;
    }
    setGuardando(true);
    const fila = {
      titulo: titulo.trim(),
      area,
      turno,
      descripcion: descripcion.trim(),
      responsable_id: responsableId,
      asesor_id: asesorId || null,
      ...repeticion,
    };
    const { error: err } = tarea
      ? await supabase.from("tareas_recurrentes").update(fila).eq("id", tarea.id)
      : await supabase.from("tareas_recurrentes").insert({ ...fila, created_by: persona.id });
    setGuardando(false);
    if (err) {
      setError(err.message);
      return;
    }
    onGuardado();
  }

  return (
    <>
      <h3 className="font-display font-semibold text-base mb-4 pr-8">
        {tarea ? "Editar tarea recurrente" : "Nueva tarea recurrente"}
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className={etiqueta}>Título</label>
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ej: Verificar caja menor"
            className={campo}
          />
        </div>

        <div className="col-span-2 border border-line rounded-lg bg-paper p-3">
          <label className={etiqueta}>Se repite</label>
          <div className="inline-flex rounded-md border border-line overflow-hidden text-[13px] bg-white mb-3">
            {(
              [
                ["diaria", "Todos los días"],
                ["semanal", "Cada semana"],
                ["mensual", "Cada mes"],
              ] as const
            ).map(([id, texto]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFrecuencia(id)}
                className={
                  "px-3.5 py-1.5 font-semibold transition-colors " +
                  (frecuencia === id ? "bg-brand text-white" : "text-muted hover:bg-paper")
                }
              >
                {texto}
              </button>
            ))}
          </div>

          {frecuencia === "semanal" && (
            <div className="flex gap-1.5 flex-wrap mb-3">
              {DIAS_SEMANA.map((d) => (
                <button
                  key={d.n}
                  type="button"
                  onClick={() => alternarDia(d.n)}
                  aria-pressed={diasSemana.includes(d.n)}
                  className={
                    "px-2.5 py-1.5 rounded-md border text-[12.5px] font-medium capitalize transition-colors " +
                    (diasSemana.includes(d.n)
                      ? "bg-brand text-white border-brand"
                      : "bg-white border-line hover:bg-paper")
                  }
                >
                  {d.largo}
                </button>
              ))}
            </div>
          )}

          {frecuencia === "mensual" && (
            <div className="flex items-center gap-2 mb-3 text-sm">
              El día
              <input
                type="number"
                min={1}
                max={31}
                value={diaMes}
                onChange={(e) => setDiaMes(e.target.value)}
                className="w-20 px-2 py-1.5 border border-line rounded-md bg-white text-sm"
              />
              de cada mes
              {Number(diaMes) >= 29 && (
                <span className="text-muted text-[12px]">(si el mes es más corto, el último día)</span>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={etiqueta}>Hora (opcional)</label>
              <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className={campo} />
            </div>
            <div>
              <label className={etiqueta}>Empieza</label>
              <input
                type="date"
                value={fechaInicio}
                onChange={(e) => setFechaInicio(e.target.value)}
                className={campo}
              />
            </div>
            <div>
              <label className={etiqueta}>Termina (opcional)</label>
              <input
                type="date"
                value={fechaFin}
                min={fechaInicio}
                onChange={(e) => setFechaFin(e.target.value)}
                className={campo}
              />
            </div>
          </div>
          <p className="text-[12px] text-muted mt-2">
            {problemaRepeticion(repeticion) ?? (
              <>
                <strong className="text-ink">{describirRepeticion(repeticion)}.</strong>{" "}
                {proxima === hoy
                  ? "Toca hoy: aparecerá en el tablero al guardar."
                  : proxima
                    ? `La primera vez será el ${fechaLarga(proxima)}.`
                    : "Con esas fechas no llega a tocar ningún día."}{" "}
                {hora
                  ? "Avisa al empezar el día y recuerda otra vez si a esa hora sigue sin realizar."
                  : "Avisa al empezar el día; si le pones hora, recuerda otra vez a esa hora."}{" "}
                Si queda sin realizar, sigue como vencida y avisa cada día hasta que jefatura la finalice.
              </>
            )}
          </p>
        </div>

        <div>
          <label className={etiqueta}>Área</label>
          <select value={area} onChange={(e) => setArea(e.target.value as AreaId)} className={campo}>
            {AREAS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={etiqueta}>Turno</label>
          <select value={turno} onChange={(e) => setTurno(e.target.value as Turno)} className={campo}>
            {TURNOS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={etiqueta}>Responsable de gestión</label>
          <select value={responsableId} onChange={(e) => setResponsableId(e.target.value)} className={campo}>
            {jefaturas.length === 0 && <option value="">No hay jefatura registrada</option>}
            {jefaturas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={etiqueta}>Asesor relacionado (solo informativo)</label>
          <select value={asesorId} onChange={(e) => setAsesorId(e.target.value)} className={campo}>
            <option value="">— Ninguno —</option>
            {asesores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className={etiqueta}>Descripción</label>
          <textarea
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            rows={3}
            placeholder="Qué hay que revisar o hacer cada vez…"
            className={campo + " resize-y"}
          />
        </div>
      </div>

      {error && (
        <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">
          {error}
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onCancelar}
          disabled={guardando}
          className="px-3 py-2.5 border border-line rounded-md bg-white text-sm hover:bg-paper disabled:opacity-50"
        >
          ← Volver
        </button>
        <button
          type="button"
          onClick={guardar}
          disabled={guardando}
          className="flex-1 py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light transition-colors"
        >
          {guardando ? "Guardando…" : tarea ? "Guardar cambios" : "Crear tarea recurrente"}
        </button>
      </div>
    </>
  );
}
