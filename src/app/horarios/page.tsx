"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import {
  DIAS_SEMANA_CORTO,
  NOMBRES_MES,
  esCargoPartTime,
  generarHorarioAutomatico,
  type GridHorario,
  type ResultadoGenerador,
} from "@/lib/horarios";
import type {
  DiaBloqueadoRow,
  DisponibilidadPTRow,
  Horario,
  Persona,
} from "@/lib/types";

export default function HorariosPage() {
  const router = useRouter();
  const { loading, session, persona } = useSession();

  const now = new Date();
  const [anio, setAnio] = useState<number>(now.getFullYear());
  const [mes, setMes] = useState<number>(now.getMonth() + 1);

  const [roster, setRoster] = useState<Persona[]>([]);
  const [disponibilidadPT, setDisponibilidadPT] = useState<DisponibilidadPTRow[]>([]);
  const [diasBloqueados, setDiasBloqueados] = useState<DiaBloqueadoRow[]>([]);
  const [horariosGuardados, setHorariosGuardados] = useState<Horario[]>([]);
  const [resultado, setResultado] = useState<ResultadoGenerador | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setFetchError(null);
    const [rosterRes, dispRes, dbRes, horariosRes] = await Promise.all([
      supabase.from("personal").select("*").eq("activo", true).order("nombre"),
      supabase.from("disponibilidad_pt").select("*"),
      supabase.from("dias_bloqueados").select("*").order("fecha"),
      supabase.from("horarios").select("*").eq("anio", anio).eq("mes", mes),
    ]);
    if (rosterRes.error) return setFetchError(rosterRes.error.message);
    if (dispRes.error) return setFetchError(dispRes.error.message);
    if (dbRes.error) return setFetchError(dbRes.error.message);
    if (horariosRes.error) return setFetchError(horariosRes.error.message);
    setRoster((rosterRes.data as Persona[] | null) ?? []);
    setDisponibilidadPT((dispRes.data as DisponibilidadPTRow[] | null) ?? []);
    setDiasBloqueados((dbRes.data as DiaBloqueadoRow[] | null) ?? []);
    setHorariosGuardados((horariosRes.data as Horario[] | null) ?? []);
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
      requerimientosLibre: [], // Sprint futuro: leer de tabla requerimientos
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
            Generador automático mensual. FT/Cajeros: 42h/semana (3 días de 8h + 2 de 9h,
            2 domingos de descanso al mes, nunca pegados a sábado libre). Jefes/Subjefes:
            mismas 42h pero un domingo va pegado a su sábado anterior. Part-time: 25h/semana
            (tope), énfasis en fines de semana, respeta disponibilidad individual.
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
              <button
                type="button"
                onClick={guardar}
                disabled={saving}
                className="px-3 py-2 rounded-md bg-operaciones text-white text-sm font-semibold hover:bg-operaciones/90 transition-colors disabled:opacity-50"
              >
                {saving ? "Guardando…" : "Guardar en base"}
              </button>
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
  // Ordenar personas: jefatura primero, luego cajeros, luego FT, luego PT.
  const personasOrdenadas = useMemo(() => {
    const orden = (p: Persona) => {
      if (p.rol === "jefatura") return 0;
      const c = (p.cargo || "").toUpperCase();
      if (c.includes("CAJERO")) return 1;
      if (esCargoPartTime(c)) return 3;
      return 2;
    };
    return [...roster].filter((p) => resultado.grid[p.id]).sort((a, b) => {
      const dif = orden(a) - orden(b);
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
