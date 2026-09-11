"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { NOMBRES_MES } from "@/lib/horarios";
import {
  distribuirMetasDiarias,
  DIAS_CORTOS,
  agruparMetasPorSemana,
  type DistribucionAsesor,
} from "@/lib/presupuestos-calc";
import {
  fmtMoney,
  fmtPct,
  type Horario,
  type Persona,
  type PresupuestoUpload,
} from "@/lib/types";

/**
 * /mi-presupuesto — Vista personal del asesor. Muestra su meta del día,
 * la semana en curso y el mes; comparado con venta acumulada de la tienda
 * (para saber si el equipo va bien globalmente).
 *
 * Cualquier usuario logueado puede entrar; los asesores ven su propia
 * distribución, jefatura ve la misma vista pero con su fila (útil para QA).
 */
export default function MiPresupuestoPage() {
  const router = useRouter();
  const { loading, session, persona } = useSession();

  const now = new Date();
  const [anio, setAnio] = useState<number>(now.getFullYear());
  const [mes, setMes] = useState<number>(now.getMonth() + 1);

  const [horarios, setHorarios] = useState<Horario[]>([]);
  const [ultimoUpload, setUltimoUpload] = useState<PresupuestoUpload | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!persona) return;
    setFetchError(null);
    const [hRes, uRes] = await Promise.all([
      // Solo horarios de la persona
      supabase
        .from("horarios")
        .select("*")
        .eq("anio", anio)
        .eq("mes", mes)
        .eq("persona_id", persona.id),
      // Último upload del mes (para venta/hora)
      supabase
        .from("presupuestos_uploads")
        .select("*")
        .eq("anio", anio)
        .eq("mes", mes)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    if (hRes.error) return setFetchError(hRes.error.message);
    if (uRes.error) return setFetchError(uRes.error.message);
    setHorarios((hRes.data as Horario[] | null) ?? []);
    const list = (uRes.data as PresupuestoUpload[] | null) ?? [];
    setUltimoUpload(list[0] ?? null);
  }, [anio, mes, persona]);

  useEffect(() => {
    if (loading) return;
    if (!session) return router.replace("/login");
    if (persona) loadData();
  }, [loading, session, persona, router, loadData]);

  // Distribución solo del asesor actual
  const distribucion = useMemo<DistribucionAsesor | null>(() => {
    if (!persona) return null;
    const mapa = distribuirMetasDiarias({
      anio,
      mes,
      personal: [persona as Persona],
      horarios,
      ultimoUpload,
    });
    return mapa.get(persona.id) ?? null;
  }, [anio, mes, persona, horarios, ultimoUpload]);

  const semanas = useMemo(() => {
    if (!distribucion) return [];
    return agruparMetasPorSemana(distribucion, anio, mes);
  }, [distribucion, anio, mes]);

  const hoy = new Date();
  const esMesActual = hoy.getFullYear() === anio && hoy.getMonth() + 1 === mes;
  const fechaHoy = hoy.toISOString().slice(0, 10);
  const metaHoy = distribucion?.diaria.get(fechaHoy) ?? null;

  const semanaActual = useMemo(() => {
    if (!esMesActual) return null;
    return semanas.find((s) => fechaHoy >= s.inicio && fechaHoy <= s.fin) ?? null;
  }, [semanas, esMesActual, fechaHoy]);

  const diasDelMes = useMemo(() => {
    const n = new Date(anio, mes, 0).getDate();
    return Array.from({ length: n }, (_, i) => ({
      dia: i + 1,
      weekday: new Date(anio, mes - 1, i + 1).getDay(),
    }));
  }, [anio, mes]);

  if (loading || !persona) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted text-sm">
        Cargando…
      </div>
    );
  }

  const ventaPorHora = ultimoUpload?.venta_por_hora ?? 0;
  const hayDatos = ventaPorHora > 0 && horarios.length > 0;

  return (
    <AppShell persona={persona}>
      <div className="mx-auto max-w-[900px] px-6 py-7 w-full">
        <div className="mb-5">
          <h2 className="text-[17px] font-display font-semibold m-0 mb-1">
            Mi presupuesto
          </h2>
          <p className="text-muted text-[13px]">
            Tu meta del día, de la semana y del mes, calculada sobre tus horas
            asignadas en el horario.
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
          </div>
          {fetchError && (
            <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-sm">
              {fetchError}
            </div>
          )}
        </div>

        {!hayDatos && (
          <div className="bg-panel border border-line rounded-[10px] p-8 text-center text-muted text-sm">
            {ventaPorHora === 0
              ? "Jefatura aún no ha subido el Excel de presupuesto para este mes."
              : "No tienes horarios cargados para este mes."}
          </div>
        )}

        {hayDatos && distribucion && (
          <>
            {/* Meta del día */}
            {esMesActual && (
              <div className="bg-gradient-to-br from-brand/10 to-brand/5 border border-brand/30 rounded-[10px] p-5 mb-4">
                <div className="text-xs text-muted uppercase tracking-wider mb-1">
                  Hoy, {hoy.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" })}
                </div>
                {metaHoy && metaHoy.tipo === "trabajo" && metaHoy.meta > 0 ? (
                  <div>
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <div>
                        <div className="text-2xl font-display font-bold text-brand">
                          {fmtMoney(metaHoy.meta)}
                        </div>
                        <div className="text-xs text-muted">Tu meta de hoy</div>
                      </div>
                      <div className="border-l border-brand/20 pl-3">
                        <div className="text-lg font-display font-semibold">
                          {metaHoy.horas}h
                        </div>
                        <div className="text-xs text-muted">Turno programado</div>
                      </div>
                      <div className="border-l border-brand/20 pl-3">
                        <div className="text-lg font-display font-semibold">
                          {fmtMoney(ventaPorHora)}/h
                        </div>
                        <div className="text-xs text-muted">Venta/hora meta</div>
                      </div>
                    </div>
                  </div>
                ) : metaHoy?.tipo === "libre" ? (
                  <div className="text-lg text-brand font-display font-semibold">
                    Día libre solicitado 🎉
                  </div>
                ) : (
                  <div className="text-lg text-muted font-display">
                    Descanso — sin meta hoy
                  </div>
                )}
              </div>
            )}

            {/* Resumen mes */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <StatCard label="Meta del mes" value={fmtMoney(distribucion.metaMes)} />
              <StatCard label="Horas del mes" value={distribucion.horasMes + " h"} />
              <StatCard label="Días trabajo" value={String(distribucion.diasTrabajo)} />
              <StatCard label="Días descanso" value={String(distribucion.diasDescanso)} />
            </div>

            {/* Semanas */}
            <div className="bg-panel border border-line rounded-[10px] p-4 mb-4">
              <h3 className="font-display font-semibold text-sm mb-3">Por semana</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="pb-2 pr-3 text-xs uppercase tracking-wider text-muted font-semibold">
                      Semana
                    </th>
                    <th className="pb-2 pr-3 text-xs uppercase tracking-wider text-muted font-semibold">
                      Rango
                    </th>
                    <th className="pb-2 pr-3 text-xs uppercase tracking-wider text-muted font-semibold text-right">
                      Horas
                    </th>
                    <th className="pb-2 pr-3 text-xs uppercase tracking-wider text-muted font-semibold text-right">
                      Meta
                    </th>
                    <th className="pb-2 pr-3 text-xs uppercase tracking-wider text-muted font-semibold text-right">
                      % del mes
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {semanas.map((s) => {
                    const pctMes =
                      distribucion.metaMes > 0
                        ? s.metaSemana / distribucion.metaMes
                        : null;
                    const esActual =
                      semanaActual &&
                      semanaActual.inicio === s.inicio &&
                      semanaActual.fin === s.fin;
                    return (
                      <tr
                        key={s.inicio}
                        className={
                          "border-b border-line/60 last:border-0 " +
                          (esActual ? "bg-brand/5 font-semibold" : "")
                        }
                      >
                        <td className="py-2 pr-3">{s.labelSemana}</td>
                        <td className="py-2 pr-3 text-xs text-muted">
                          {s.inicio} → {s.fin}
                          {esActual && (
                            <span className="ml-2 text-brand">· esta semana</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono">
                          {s.horasSemana}h
                        </td>
                        <td className="py-2 pr-3 text-right font-mono">
                          {fmtMoney(s.metaSemana)}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono">
                          {fmtPct(pctMes)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Calendario del mes */}
            <div className="bg-panel border border-line rounded-[10px] p-4">
              <h3 className="font-display font-semibold text-sm mb-3">
                Calendario del mes
              </h3>
              <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted mb-1">
                {["L", "M", "X", "J", "V", "S", "D"].map((d) => (
                  <div key={d} className="py-1">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {(() => {
                  const primerWD = new Date(anio, mes - 1, 1).getDay();
                  const offset = primerWD === 0 ? 6 : primerWD - 1;
                  const celdas: React.ReactNode[] = [];
                  for (let i = 0; i < offset; i++) celdas.push(<div key={"empty-" + i} />);
                  for (const dm of diasDelMes) {
                    const fecha = `${anio}-${String(mes).padStart(2, "0")}-${String(dm.dia).padStart(2, "0")}`;
                    const md = distribucion.diaria.get(fecha);
                    const esHoy = esMesActual && dm.dia === hoy.getDate();
                    let bgClass = "bg-neutral-100/60";
                    let contenidoExtra: React.ReactNode = "·";
                    if (md?.tipo === "trabajo" && md.meta > 0) {
                      bgClass = "bg-brand/10 border-brand/30";
                      const abrev =
                        md.meta >= 1_000_000
                          ? "$" + (md.meta / 1_000_000).toFixed(1) + "M"
                          : "$" + Math.round(md.meta / 1000) + "K";
                      contenidoExtra = (
                        <div className="font-mono text-[9.5px]">{abrev}</div>
                      );
                    } else if (md?.tipo === "libre") {
                      bgClass = "bg-emerald-100";
                      contenidoExtra = <div className="text-[9px]">Libre</div>;
                    } else {
                      contenidoExtra = <div className="text-[9px] text-muted">Desc</div>;
                    }
                    celdas.push(
                      <div
                        key={dm.dia}
                        className={
                          "border rounded p-1 min-h-[46px] " +
                          bgClass +
                          " " +
                          (esHoy ? "ring-2 ring-brand" : "border-line")
                        }
                        title={md ? `${md.horas}h · ${fmtMoney(md.meta)}` : ""}
                      >
                        <div className="text-[10px] font-semibold">{dm.dia}</div>
                        {contenidoExtra}
                      </div>,
                    );
                  }
                  return celdas;
                })()}
              </div>
              <div className="text-[11px] text-muted mt-3 italic">
                Meta calculada como horas de turno × venta/hora del último Excel
                cargado por jefatura ({fmtMoney(ventaPorHora)}/h).
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-panel border border-line rounded-[8px] p-3">
      <div className="text-[10px] text-muted uppercase tracking-wider">{label}</div>
      <div className="text-base font-display font-semibold mt-0.5">{value}</div>
    </div>
  );
}

// Silencia el warning de import no usado (DIAS_CORTOS reservado para próxima iteración)
void DIAS_CORTOS;
