"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import {
  DIAS_SEMANA_CORTO,
  NOMBRES_MES,
  generarHorarioAutomatico,
  type GridHorario,
  type ResultadoGenerador,
} from "@/lib/horarios";
import { exportarHorarioExcel } from "@/lib/horarios-excel";
import type {
  DiaBloqueadoRow,
  DisponibilidadPTRow,
  Horario,
  Persona,
  Requerimiento,
} from "@/lib/types";

export default function HorariosPage() {
  const router = useRouter();
  const { loading, session, persona } = useSession();

  const now = new Date();
  const [anio, setAnio] = useState<number>(now.getFullYear());
  const [mes, setMes] = useState<number>(now.getMonth() + 1);

  const [roster, setRoster] = useState<Persona[]>([]);       // solo activos, para generador
  const [rosterAll, setRosterAll] = useState<Persona[]>([]); // activos + inactivos, para export
  const [disponibilidadPT, setDisponibilidadPT] = useState<DisponibilidadPTRow[]>([]);
  const [diasBloqueados, setDiasBloqueados] = useState<DiaBloqueadoRow[]>([]);
  const [horariosGuardados, setHorariosGuardados] = useState<Horario[]>([]);
  const [resultado, setResultado] = useState<ResultadoGenerador | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Contexto: horarios ya guardados de meses adyacentes (para que la
  // generación cross-month respete los bordes).
  const [horariosContexto, setHorariosContexto] = useState<Horario[]>([]);
  // Días libres ya APROBADOS en Requerimientos — el generador los respeta
  // como forzados, igual que un día bloqueado (cierra el pendiente de
  // Fase 2: "Integración con Requerimientos").
  const [diasLibreAprobados, setDiasLibreAprobados] = useState<Requerimiento[]>([]);

  const loadData = useCallback(async () => {
    setFetchError(null);
    // Meses adyacentes para contexto boundary
    const mesPrev = mes === 1 ? 12 : mes - 1;
    const anioPrev = mes === 1 ? anio - 1 : anio;
    const mesSig = mes === 12 ? 1 : mes + 1;
    const anioSig = mes === 12 ? anio + 1 : anio;

    const ultimoDia = new Date(anio, mes, 0).getDate();
    const fechaFinMes = `${anio}-${String(mes).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`;

    const [rosterRes, dispRes, dbRes, horariosRes, ctxPrevRes, ctxSigRes, reqLibreRes] =
      await Promise.all([
        supabase.from("personal").select("*").order("nombre"),
        supabase.from("disponibilidad_pt").select("*"),
        supabase.from("dias_bloqueados").select("*").order("fecha"),
        supabase.from("horarios").select("*").eq("anio", anio).eq("mes", mes),
        supabase.from("horarios").select("*").eq("anio", anioPrev).eq("mes", mesPrev),
        supabase.from("horarios").select("*").eq("anio", anioSig).eq("mes", mesSig),
        supabase
          .from("requerimientos")
          .select("*")
          .eq("tipo", "dia_libre")
          .eq("estado", "aprobado")
          .gte("fecha", `${anio}-${String(mes).padStart(2, "0")}-01`)
          .lte("fecha", fechaFinMes),
      ]);
    if (rosterRes.error) return setFetchError(rosterRes.error.message);
    if (dispRes.error) return setFetchError(dispRes.error.message);
    if (dbRes.error) return setFetchError(dbRes.error.message);
    if (horariosRes.error) return setFetchError(horariosRes.error.message);
    if (reqLibreRes.error) return setFetchError(reqLibreRes.error.message);
    const todos = (rosterRes.data as Persona[] | null) ?? [];
    setRosterAll(todos);
    setRoster(todos.filter((p) => p.activo));
    setDisponibilidadPT((dispRes.data as DisponibilidadPTRow[] | null) ?? []);
    setDiasBloqueados((dbRes.data as DiaBloqueadoRow[] | null) ?? []);
    setHorariosGuardados((horariosRes.data as Horario[] | null) ?? []);
    setDiasLibreAprobados((reqLibreRes.data as Requerimiento[] | null) ?? []);
    // Sin filtrar por fecha exacta: en Sept 2026, sólo importan los últimos
    // días de Ago (28-31) y los primeros de Oct (1-4). Pasamos todo y el
    // generador ignora los que no caen en semanas boundary.
    const prev = (ctxPrevRes.data as Horario[] | null) ?? [];
    const sig = (ctxSigRes.data as Horario[] | null) ?? [];
    setHorariosContexto([...prev, ...sig]);
  }, [anio, mes]);

  useEffect(() => {
    if (loading) return;
    if (!session) return router.replace("/login");
    if (persona && persona.rol !== "jefatura") return router.replace("/bitacora");
    if (persona?.rol === "jefatura") loadData();
  }, [loading, session, persona, router, loadData]);

  // Cuando cambian año/mes, si hay resultado stale lo limpiamos
  useEffect(() => {
    setResultado(null);
    setSaveMsg(null);
  }, [anio, mes]);

  function generar() {
    setSaveMsg(null);
    if (roster.length === 0) {
      setFetchError("No hay personal activo para generar horarios.");
      return;
    }
    const r = generarHorarioAutomatico(anio, mes, {
      personal: roster,
      disponibilidadPT: disponibilidadPT.map((d) => ({
        persona_id: d.persona_id,
        dias_bloqueados: d.dias_bloqueados,
      })),
      diasBloqueados: diasBloqueados.map((b) => ({ fecha: b.fecha, motivo: b.motivo })),
      requerimientosLibre: diasLibreAprobados.map((r) => ({
        persona_id: r.persona_id,
        fecha: r.fecha,
      })),
      horariosContexto: horariosContexto.map((h) => ({
        clave: `${h.anio}-${String(h.mes).padStart(2, "0")}-${String(h.dia).padStart(2, "0")}`,
        persona_id: h.persona_id,
        horas: h.horas,
        tipo: h.tipo,
      })),
    });
    setResultado(r);
  }

  async function guardar() {
    if (!resultado) return;
    setSaving(true);
    setSaveMsg(null);
    // Preparar upsert de todas las celdas
    const rows: Omit<Horario, "id" | "created_at" | "updated_at" | "notas">[] = [];
    for (const [personaId, personaGrid] of Object.entries(resultado.grid)) {
      for (const [dia, celda] of Object.entries(personaGrid.dias)) {
        rows.push({
          persona_id: personaId,
          anio,
          mes,
          dia: parseInt(dia, 10),
          horas: celda.horas,
          tipo: celda.tipo,
        });
      }
    }
    const { error } = await supabase
      .from("horarios")
      .upsert(rows, { onConflict: "persona_id,anio,mes,dia" });
    setSaving(false);
    if (error) {
      setSaveMsg(`❌ Error guardando: ${error.message}`);
      return;
    }
    setSaveMsg(`✓ Guardado ${rows.length} celdas para ${NOMBRES_MES[mes - 1]} ${anio}.`);
    await loadData();
  }

  async function exportarExcel() {
    if (!resultado) return;
    setExporting(true);
    setSaveMsg(null);
    try {
      await exportarHorarioExcel({
        anio,
        mes,
        roster: rosterAll,
        resultado,
        horariosContexto,
      });
      setSaveMsg("✓ Excel descargado. Revisa la plantilla y ajusta manualmente los turnos según dinámica.");
    } catch (err) {
      const detalle = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
      console.error("[Exportar Excel] Error:", err);
      setSaveMsg(`❌ Error exportando: ${err instanceof Error ? err.message : String(err)} — revisa la consola del navegador (F12) para el stack completo.`);
      void detalle;
    } finally {
      setExporting(false);
    }
  }

  function cargarGuardado() {
    setSaveMsg(null);
    if (horariosGuardados.length === 0) {
      setSaveMsg(`No hay horario guardado para ${NOMBRES_MES[mes - 1]} ${anio}.`);
      return;
    }
    // Reconstruir el ResultadoGenerador desde las filas guardadas
    const dias = Array.from({ length: new Date(anio, mes, 0).getDate() }, (_, i) => ({
      dia: i + 1,
      weekday: new Date(anio, mes - 1, i + 1).getDay(),
    }));
    const grid: GridHorario = {};
    for (const h of horariosGuardados) {
      if (!grid[h.persona_id]) grid[h.persona_id] = { dias: {}, total: 0 };
      grid[h.persona_id].dias[h.dia] = { horas: h.horas, tipo: h.tipo };
      grid[h.persona_id].total += h.horas;
    }
    setResultado({ dias, grid });
  }

  if (loading || !persona || persona.rol !== "jefatura") {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted text-sm">
        Cargando…
      </div>
    );
  }

  return (
    <AppShell persona={persona}>
      <div className="mx-auto max-w-full px-4 sm:px-6 py-7 w-full">
        <div className="mb-5">
          <h2 className="text-[17px] font-display font-semibold m-0 mb-1">Horarios</h2>
          <p className="text-muted text-[13px] max-w-3xl">
            Generador automático mensual. Las celdas muestran <strong>horas de turno</strong>
            (incluyen 1h de almuerzo). Reglas por defecto:
          </p>
          <ul className="text-muted text-[12.5px] max-w-3xl mt-2 space-y-0.5 list-disc pl-5">
            <li><strong>FT / Cajeros / Jefes:</strong> 42h trabajadas/semana = 2 días de 10h + 3 de 9h de turno, 2 días de descanso.</li>
            <li><strong>Jefes / Subjefes:</strong> 8 días descanso/mes. Regla mensual: 1 fin de semana completo pegado (sáb+dom) + 1 domingo adicional. Nunca pegar el lunes al fin de semana libre.</li>
            <li><strong>Cajeros:</strong> 2 domingos de descanso al mes. Sábado libre solo si la operación lo permite (ajuste manual).</li>
            <li><strong>FT asesores:</strong> 2 domingos de descanso al mes. Pegar domingo con lunes solo si la operación lo permite (ajuste manual).</li>
            <li><strong>Part-time:</strong> 6 días × 4h = 24h/semana, cierre y refuerzo en fines de semana. Excepción: quienes tengan horario universitario configurado en Disponibilidad PT.</li>
            <li><strong>Días libres:</strong> los aprobados en Requerimientos para este mes se respetan automáticamente como día no trabajado.</li>
          </ul>
          <p className="text-muted text-[12px] max-w-3xl mt-2 italic">
            La operación manda: dinámica comercial, DSM, recepción de mercancía, reuniones y
            parámetros del mes anterior pueden justificar ajustes manuales (próximo sprint
            habilita la edición de celdas).
          </p>
        </div>

        <div className="bg-panel border border-line rounded-[10px] p-4 mb-4">
          <div className="flex gap-3 flex-wrap items-end">
            <div>
              <label className="block text-xs text-muted uppercase tracking-wider mb-1">Mes</label>
              <select
                value={mes}
                onChange={(e) => setMes(parseInt(e.target.value, 10))}
                className="px-3 py-2 border border-line rounded-md bg-white text-sm"
              >
                {NOMBRES_MES.map((n, i) => (
                  <option key={i} value={i + 1}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted uppercase tracking-wider mb-1">Año</label>
              <input
                type="number"
                value={anio}
                onChange={(e) => setAnio(parseInt(e.target.value, 10) || anio)}
                className="w-24 px-3 py-2 border border-line rounded-md bg-white text-sm"
              />
            </div>
            <button
              type="button"
              onClick={generar}
              className="px-3 py-2 rounded-md bg-brand text-white text-sm font-semibold hover:bg-brand-light transition-colors"
            >
              Generar horario
            </button>
            <button
              type="button"
              onClick={cargarGuardado}
              className="px-3 py-2 rounded-md border border-line bg-white text-sm hover:bg-paper transition-colors"
            >
              Cargar guardado ({horariosGuardados.length > 0 ? "existe" : "vacío"})
            </button>
            {resultado && (
              <>
                <button
                  type="button"
                  onClick={guardar}
                  disabled={saving}
                  className="px-3 py-2 rounded-md bg-operaciones text-white text-sm font-semibold hover:bg-operaciones/90 transition-colors disabled:opacity-50"
                >
                  {saving ? "Guardando…" : "Guardar en base"}
                </button>
                <button
                  type="button"
                  onClick={exportarExcel}
                  disabled={exporting}
                  className="px-3 py-2 rounded-md border border-brand text-brand bg-white text-sm font-semibold hover:bg-brand/5 transition-colors disabled:opacity-50"
                  title="Descarga el horario en el formato oficial de la tienda para presentarlo al DSM"
                >
                  {exporting ? "Exportando…" : "📊 Exportar a Excel"}
                </button>
              </>
            )}
          </div>
          {saveMsg && (
            <div className="mt-3 text-xs text-muted">
              {saveMsg}
            </div>
          )}
          {fetchError && (
            <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-sm">
              {fetchError}
            </div>
          )}
        </div>

        {resultado ? (
          <GridHorarioTable resultado={resultado} roster={roster} anio={anio} mes={mes} />
        ) : (
          <div className="bg-panel border border-line rounded-[10px] p-8 text-center text-muted text-sm">
            Selecciona mes/año y presiona <strong>Generar horario</strong> para ver la
            propuesta, o <strong>Cargar guardado</strong> si ya se generó antes.
          </div>
        )}
      </div>
    </AppShell>
  );
}

function GridHorarioTable({
  resultado,
  roster,
  anio,
  mes,
}: {
  resultado: ResultadoGenerador;
  roster: Persona[];
  anio: number;
  mes: number;
}) {
  // Ordenar personas por rol jerárquico (consistente con el exporter Excel).
  const personasOrdenadas = useMemo(() => {
    const ORDEN: Record<Persona["rol_jerarquico"], number> = {
      jefe_tienda: 0,
      subjefe: 1,
      cajero: 2,
      full_time: 3,
      part_time: 4,
    };
    return [...roster].filter((p) => resultado.grid[p.id]).sort((a, b) => {
      const dif = ORDEN[a.rol_jerarquico] - ORDEN[b.rol_jerarquico];
      if (dif !== 0) return dif;
      return a.nombre.localeCompare(b.nombre);
    });
  }, [roster, resultado.grid]);

  const hoy = new Date();
  const esMesActual = hoy.getFullYear() === anio && hoy.getMonth() + 1 === mes;

  return (
    <div className="bg-panel border border-line rounded-[10px] overflow-x-auto">
      <table className="text-xs border-collapse min-w-full">
        <thead className="bg-paper sticky top-0">
          <tr>
            <th className="sticky left-0 bg-paper border-b border-r border-line px-2 py-1.5 text-left font-semibold min-w-[180px] z-10">
              Persona
            </th>
            <th className="border-b border-r border-line px-1 py-1.5 font-semibold text-[10px] text-muted uppercase w-[60px]">
              Cargo
            </th>
            {resultado.dias.map((d) => {
              const esFinde = d.weekday === 0 || d.weekday === 6;
              const esHoy = esMesActual && d.dia === hoy.getDate();
              return (
                <th
                  key={d.dia}
                  className={
                    "border-b border-r border-line px-0.5 py-1 font-semibold w-[28px] " +
                    (esFinde ? "bg-brand/5 " : "") +
                    (esHoy ? "outline outline-2 outline-brand -outline-offset-2 " : "")
                  }
                >
                  <div className="text-[9px] text-muted">{DIAS_SEMANA_CORTO[d.weekday]}</div>
                  <div className="text-[11px]">{d.dia}</div>
                </th>
              );
            })}
            <th className="border-b border-line px-2 py-1.5 font-semibold text-[10px] text-muted uppercase w-[50px]">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {personasOrdenadas.map((p) => {
            const personaGrid = resultado.grid[p.id];
            return (
              <tr key={p.id} className="hover:bg-paper/50">
                <td className="sticky left-0 bg-white border-b border-r border-line px-2 py-1 truncate max-w-[180px]">
                  {p.nombre}
                </td>
                <td className="border-b border-r border-line px-1 py-1 text-[10px] text-muted truncate">
                  {p.cargo}
                </td>
                {resultado.dias.map((d) => {
                  const celda = personaGrid.dias[d.dia];
                  const esFinde = d.weekday === 0 || d.weekday === 6;
                  return (
                    <td
                      key={d.dia}
                      className={
                        "border-b border-r border-line px-0 py-0.5 text-center w-[28px] " +
                        (esFinde ? "bg-brand/5 " : "")
                      }
                      title={celda ? `${celda.tipo}${celda.horas ? " • " + celda.horas + "h" : ""}` : ""}
                    >
                      <CeldaDisplay celda={celda} />
                    </td>
                  );
                })}
                <td className="border-b border-line px-2 py-1 text-center font-mono font-semibold">
                  {personaGrid.total}h
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CeldaDisplay({
  celda,
}: {
  celda: { horas: number; tipo: "trabajo" | "descanso" | "libre" } | undefined;
}) {
  if (!celda) return <span className="text-muted/40">·</span>;
  if (celda.tipo === "trabajo") {
    return <span className="text-ink font-mono">{celda.horas}</span>;
  }
  if (celda.tipo === "libre") {
    return <span className="text-brand text-[10px] font-bold">L</span>;
  }
  return <span className="text-muted text-[10px]">D</span>;
}
