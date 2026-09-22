"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { NOMBRES_MES } from "@/lib/horarios";
import {
  distribuirMetasDiarias,
  agruparMetasPorSemana,
  type DistribucionAsesor,
} from "@/lib/presupuestos-calc";
import { estiloCumplimiento, fmtMoneyCompacto } from "@/lib/cumplimiento";
import { Gauge } from "@/components/charts/Gauge";
import { BarrasSemana, type DiaBarra } from "@/components/charts/BarrasSemana";
import {
  fmtMoney,
  fmtPct,
  type Horario,
  type Persona,
  type PresupuestoUpload,
  type VentaAsesorDia,
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
  const [ventas, setVentas] = useState<VentaAsesorDia[]>([]);
  const [ultimoUpload, setUltimoUpload] = useState<PresupuestoUpload | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!persona) return;
    setFetchError(null);
    const prefijoFecha = `${anio}-${String(mes).padStart(2, "0")}`;
    const ultimoDia = new Date(anio, mes, 0).getDate();
    const fechaFin = `${prefijoFecha}-${String(ultimoDia).padStart(2, "0")}`;
    const [hRes, uRes, vRes] = await Promise.all([
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
      // Ventas reales registradas (cierres de día) de la persona en el mes
      supabase
        .from("ventas_asesor_dia")
        .select("*")
        .eq("persona_id", persona.id)
        .gte("fecha", `${prefijoFecha}-01`)
        .lte("fecha", fechaFin),
    ]);
    if (hRes.error) return setFetchError(hRes.error.message);
    if (uRes.error) return setFetchError(uRes.error.message);
    if (vRes.error) return setFetchError(vRes.error.message);
    setHorarios((hRes.data as Horario[] | null) ?? []);
    const list = (uRes.data as PresupuestoUpload[] | null) ?? [];
    setUltimoUpload(list[0] ?? null);
    setVentas((vRes.data as VentaAsesorDia[] | null) ?? []);
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
      ventas,
    });
    return mapa.get(persona.id) ?? null;
  }, [anio, mes, persona, horarios, ultimoUpload, ventas]);

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

  // Días de la semana en curso (o de la última semana con datos si no es
  // el mes actual) para las barras meta-vs-venta.
  const DIAS_ABREV = ["D", "L", "M", "X", "J", "V", "S"];
  const diasBarraSemana = useMemo<DiaBarra[]>(() => {
    if (!distribucion) return [];
    const semanaRef = semanaActual ?? semanas[semanas.length - 1];
    if (!semanaRef) return [];
    const out: DiaBarra[] = [];
    const cursor = new Date(semanaRef.inicio + "T00:00:00");
    const fin = new Date(semanaRef.fin + "T00:00:00");
    while (cursor <= fin) {
      const fecha = cursor.toISOString().slice(0, 10);
      const md = distribucion.diaria.get(fecha);
      out.push({
        key: fecha,
        labelCorto: `${DIAS_ABREV[cursor.getDay()]} ${cursor.getDate()}`,
        meta: md?.meta ?? 0,
        venta: md?.venta ?? null,
        cumplimiento: md?.cumplimiento ?? null,
        esHoy: esMesActual && fecha === fechaHoy,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }, [distribucion, semanaActual, semanas, esMesActual, fechaHoy]);

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
            {/* Meta / cumplimiento del día */}
            {esMesActual && (
              <div className="bg-gradient-to-br from-brand/10 to-brand/5 border border-brand/30 rounded-[10px] p-5 mb-4">
                <div className="text-xs text-muted uppercase tracking-wider mb-1">
                  Hoy, {hoy.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" })}
                </div>
                {metaHoy && metaHoy.tipo === "trabajo" && metaHoy.meta > 0 ? (
                  <div className="flex items-center gap-5 flex-wrap">
                    {metaHoy.venta != null && (
                      <Gauge pct={metaHoy.cumplimiento} size={108} strokeWidth={10} />
                    )}
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <div>
                        <div className="text-2xl font-display font-bold text-brand">
                          {fmtMoney(metaHoy.meta)}
                        </div>
                        <div className="text-xs text-muted">Tu meta de hoy</div>
                      </div>
                      {metaHoy.venta != null && (
                        <div className="border-l border-brand/20 pl-3">
                          <div
                            className="text-2xl font-display font-bold"
                            style={{ color: estiloCumplimiento(metaHoy.cumplimiento).hex }}
                          >
                            {fmtMoney(metaHoy.venta)}
                          </div>
                          <div className="text-xs text-muted">Tu venta de hoy</div>
                        </div>
                      )}
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
                    {metaHoy.venta == null && (
                      <div className="text-xs text-muted italic">
                        Jefatura aún no registra el cierre de hoy.
                      </div>
                    )}
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

            {/* Cumplimiento del mes — gauge grande + stats */}
            <div className="bg-panel border border-line rounded-[10px] p-5 mb-4 flex items-center gap-6 flex-wrap">
              <Gauge
                pct={distribucion.cumplimientoMes}
                size={140}
                strokeWidth={13}
                label="Cumplimiento del mes"
                sublabel={
                  distribucion.diasConVenta > 0
                    ? `${distribucion.diasConVenta} días cerrados`
                    : "esperando el primer cierre"
                }
              />
              <div className="grid grid-cols-2 gap-3 flex-1 min-w-[220px]">
                <StatCard label="Meta del mes" value={fmtMoney(distribucion.metaMes)} />
                <StatCard
                  label="Venta acumulada"
                  value={distribucion.diasConVenta > 0 ? fmtMoney(distribucion.ventaMes) : "—"}
                />
                <StatCard label="Horas del mes" value={distribucion.horasMes + " h"} />
                <StatCard label="Días trabajo" value={String(distribucion.diasTrabajo)} />
              </div>
            </div>

            {/* Barras de la semana en curso */}
            {diasBarraSemana.length > 0 && (
              <div className="bg-panel border border-line rounded-[10px] p-4 mb-4">
                <h3 className="font-display font-semibold text-sm mb-1">
                  {semanaActual ? "Esta semana" : "Última semana con datos"} — meta vs. venta
                </h3>
                <p className="text-[11px] text-muted mb-2">
                  La línea punteada es tu meta del día; la barra de color es lo que vendiste.
                </p>
                <BarrasSemana dias={diasBarraSemana} />
              </div>
            )}

            {/* Semanas */}
            <div className="bg-panel border border-line rounded-[10px] p-4 mb-4">
              <h3 className="font-display font-semibold text-sm mb-3">Por semana</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
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
                        Venta
                      </th>
                      <th className="pb-2 pr-3 text-xs uppercase tracking-wider text-muted font-semibold text-right">
                        Cumpl.
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {semanas.map((s) => {
                      const esActual =
                        semanaActual &&
                        semanaActual.inicio === s.inicio &&
                        semanaActual.fin === s.fin;
                      const estilo = estiloCumplimiento(s.cumplimientoSemana);
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
                            {s.cumplimientoSemana != null ? fmtMoney(s.ventaSemana) : "—"}
                          </td>
                          <td
                            className={"py-2 pr-3 text-right font-mono font-semibold " + estilo.text}
                          >
                            {fmtPct(s.cumplimientoSemana)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
                    let borderClass = "border-line";
                    let contenidoExtra: React.ReactNode = "·";
                    let badge: React.ReactNode = null;

                    if (md?.tipo === "trabajo" && md.meta > 0) {
                      if (md.venta != null) {
                        const estilo = estiloCumplimiento(md.cumplimiento);
                        bgClass = estilo.bg;
                        borderClass = estilo.border;
                        contenidoExtra = (
                          <div className={"font-mono text-[9.5px] font-bold " + estilo.text}>
                            {Math.round((md.cumplimiento ?? 0) * 100)}%
                          </div>
                        );
                        if (estilo.emoji) badge = estilo.emoji;
                      } else {
                        bgClass = "bg-brand/10";
                        borderClass = "border-brand/30";
                        contenidoExtra = (
                          <div className="font-mono text-[9.5px]">{fmtMoneyCompacto(md.meta)}</div>
                        );
                      }
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
                          "relative border rounded p-1 min-h-[46px] transition-transform duration-150 hover:scale-[1.08] hover:z-10 hover:shadow-md " +
                          bgClass +
                          " " +
                          (esHoy ? "ring-2 ring-brand " : "") +
                          borderClass
                        }
                        title={
                          md
                            ? md.venta != null
                              ? `${md.horas}h · meta ${fmtMoney(md.meta)} · venta ${fmtMoney(md.venta)}`
                              : `${md.horas}h · meta ${fmtMoney(md.meta)}`
                            : ""
                        }
                      >
                        {badge && (
                          <span className="absolute -top-1 -right-1 text-[10px]" aria-hidden>
                            {badge}
                          </span>
                        )}
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
