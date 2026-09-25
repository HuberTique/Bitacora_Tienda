"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { NOMBRES_MES } from "@/lib/horarios";
import {
  distribuirMetasDiarias,
  rankingCumplimiento,
  DIAS_CORTOS,
} from "@/lib/presupuestos-calc";
import { estiloCumplimiento, fmtMoneyCompacto } from "@/lib/cumplimiento";
import { RankingAsesores, type RankingItem } from "@/components/charts/RankingAsesores";
import {
  leerPresupuestoDesdeArchivo,
  unificarPresupuestos,
  type FilaUnificada,
  type KpisSemParsed,
  type TargetParsed,
} from "@/lib/presupuestos-excel";
import { matchPersonaPorNombre } from "@/lib/imagenIA";
import {
  leerVentasPdf,
  matchearEmpleadosConRoster,
  guardarVentasDia,
  type FilaVenta,
  type VentasPdfResponse,
} from "@/lib/ventas-pdf";
import {
  fmtMoney,
  fmtPct,
  MOTIVO_NO_VENTA_LABEL,
  type Horario,
  type MotivoNoVenta,
  type Persona,
  type PersonalCodigoAlterno,
  type PresupuestoDiario,
  type PresupuestoSemanal,
  type PresupuestoUpload,
  type VentaAsesorDia,
} from "@/lib/types";

/**
 * /presupuestos — Sprint 1: skeleton con selector mes/año, selector de
 * pestaña Semanal|Diario, listado vacío y CTA para subir Excel.
 *
 * Próximo sprint: parser Excel "KPIS SEM." + upload.
 */
export default function PresupuestosPage() {
  const router = useRouter();
  const { loading, session, persona } = useSession();

  const now = new Date();
  const [anio, setAnio] = useState<number>(now.getFullYear());
  const [mes, setMes] = useState<number>(now.getMonth() + 1);
  const [vista, setVista] = useState<"semanal" | "diario" | "distribucion">(
    "distribucion",
  );

  const [personal, setPersonal] = useState<Persona[]>([]);
  const [uploads, setUploads] = useState<PresupuestoUpload[]>([]);
  const [semanales, setSemanales] = useState<PresupuestoSemanal[]>([]);
  const [diarios, setDiarios] = useState<PresupuestoDiario[]>([]);
  const [horarios, setHorarios] = useState<Horario[]>([]);
  const [ventas, setVentas] = useState<VentaAsesorDia[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [ventasDiaOpen, setVentasDiaOpen] = useState(false);
  const [codigosAlternos, setCodigosAlternos] = useState<PersonalCodigoAlterno[]>([]);

  const loadData = useCallback(async () => {
    setFetchError(null);
    const prefijoFecha = `${anio}-${String(mes).padStart(2, "0")}`;
    // Último día real del mes (feb=28/29, sep=30, dic=31, etc.).
    const ultimoDia = new Date(anio, mes, 0).getDate();
    const fechaFin = `${prefijoFecha}-${String(ultimoDia).padStart(2, "0")}`;
    const [pRes, uRes, sRes, dRes, hRes, cRes, vRes] = await Promise.all([
      supabase.from("personal").select("*").order("nombre"),
      supabase
        .from("presupuestos_uploads")
        .select("*")
        .eq("anio", anio)
        .eq("mes", mes)
        .order("created_at", { ascending: false }),
      supabase
        .from("presupuestos_semanales")
        .select("*")
        .eq("anio", anio)
        .eq("mes", mes),
      supabase
        .from("presupuestos_diarios")
        .select("*")
        .gte("fecha", `${prefijoFecha}-01`)
        .lte("fecha", fechaFin)
        .order("fecha"),
      supabase
        .from("horarios")
        .select("*")
        .eq("anio", anio)
        .eq("mes", mes),
      supabase
        .from("personal_codigos_alternos")
        .select("*")
        .eq("estado", "aprobado"),
      supabase
        .from("ventas_asesor_dia")
        .select("*")
        .gte("fecha", `${prefijoFecha}-01`)
        .lte("fecha", fechaFin),
    ]);
    if (pRes.error) return setFetchError(pRes.error.message);
    if (uRes.error) return setFetchError(uRes.error.message);
    if (sRes.error) return setFetchError(sRes.error.message);
    if (dRes.error) return setFetchError(dRes.error.message);
    if (hRes.error) return setFetchError(hRes.error.message);
    if (cRes.error) return setFetchError(cRes.error.message);
    if (vRes.error) return setFetchError(vRes.error.message);
    setPersonal((pRes.data as Persona[] | null) ?? []);
    setUploads((uRes.data as PresupuestoUpload[] | null) ?? []);
    setSemanales((sRes.data as PresupuestoSemanal[] | null) ?? []);
    setDiarios((dRes.data as PresupuestoDiario[] | null) ?? []);
    setHorarios((hRes.data as Horario[] | null) ?? []);
    setCodigosAlternos((cRes.data as PersonalCodigoAlterno[] | null) ?? []);
    setVentas((vRes.data as VentaAsesorDia[] | null) ?? []);
  }, [anio, mes]);

  useEffect(() => {
    if (loading) return;
    if (!session) return router.replace("/login");
    if (persona && persona.rol !== "jefatura") return router.replace("/bitacora");
    if (persona?.rol === "jefatura") loadData();
  }, [loading, session, persona, router, loadData]);

  // Agregación: por persona sumar meta/venta del mes
  const resumenPorPersona = useMemo(() => {
    const map = new Map<string, {
      persona: Persona;
      meta: number;
      venta: number;
      horas: number;
      semanas: number;
    }>();
    for (const s of semanales) {
      const p = personal.find((x) => x.id === s.persona_id);
      if (!p) continue;
      if (!map.has(p.id)) {
        map.set(p.id, { persona: p, meta: 0, venta: 0, horas: 0, semanas: 0 });
      }
      const acc = map.get(p.id)!;
      acc.meta += s.meta ?? 0;
      acc.venta += s.venta ?? 0;
      acc.horas += s.horas_reportadas ?? 0;
      acc.semanas += 1;
    }
    return [...map.values()].sort((a, b) => b.meta - a.meta);
  }, [semanales, personal]);

  const totalMes = useMemo(() => {
    return resumenPorPersona.reduce(
      (acc, r) => {
        acc.meta += r.meta;
        acc.venta += r.venta;
        acc.horas += r.horas;
        return acc;
      },
      { meta: 0, venta: 0, horas: 0 },
    );
  }, [resumenPorPersona]);

  const totalDiario = useMemo(() => {
    return diarios.reduce(
      (acc, d) => {
        acc.meta += d.meta ?? 0;
        acc.venta += d.venta ?? 0;
        return acc;
      },
      { meta: 0, venta: 0 },
    );
  }, [diarios]);

  // Distribución diaria por asesor (cruce horarios + venta/hora del último upload + ventas reales)
  const distribucion = useMemo(() => {
    return distribuirMetasDiarias({
      anio,
      mes,
      personal: personal.filter((p) => p.activo),
      horarios,
      ultimoUpload: uploads[0] ?? null,
      ventas,
    });
  }, [anio, mes, personal, horarios, uploads, ventas]);

  const rankingItems = useMemo<RankingItem[]>(() => {
    // Jefe de tienda y subjefes auditan al equipo: no compiten en el ranking.
    const compiten = [...distribucion.values()].filter(
      (d) =>
        d.persona.rol_jerarquico !== "jefe_tienda" &&
        d.persona.rol_jerarquico !== "subjefe",
    );
    const ordenado = rankingCumplimiento(compiten);
    return ordenado.map((d) => ({
      personaId: d.persona.id,
      nombre: d.persona.nombre,
      cumplimiento: d.cumplimientoMes,
      venta: d.ventaMes,
      meta: d.metaConVenta,
    }));
  }, [distribucion]);

  const diasDelMes = useMemo(() => {
    const n = new Date(anio, mes, 0).getDate();
    return Array.from({ length: n }, (_, i) => ({
      dia: i + 1,
      weekday: new Date(anio, mes - 1, i + 1).getDay(),
    }));
  }, [anio, mes]);

  const distribucionOrdenada = useMemo(() => {
    const ORDEN: Record<Persona["rol_jerarquico"], number> = {
      jefe_tienda: 0,
      subjefe: 1,
      cajero: 2,
      full_time: 3,
      part_time: 4,
    };
    return [...distribucion.values()].sort((a, b) => {
      const dif = ORDEN[a.persona.rol_jerarquico] - ORDEN[b.persona.rol_jerarquico];
      if (dif !== 0) return dif;
      return a.persona.nombre.localeCompare(b.persona.nombre);
    });
  }, [distribucion]);

  const hoy = new Date();
  const esMesActual = hoy.getFullYear() === anio && hoy.getMonth() + 1 === mes;

  if (loading || !persona || persona.rol !== "jefatura") {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted text-sm">
        Cargando…
      </div>
    );
  }

  return (
    <AppShell persona={persona}>
      <div className="mx-auto max-w-[1100px] px-6 py-7 w-full">
        <div className="mb-5">
          <h2 className="text-[17px] font-display font-semibold m-0 mb-1">Presupuestos</h2>
          <p className="text-muted text-[13px] max-w-3xl">
            Cumplimiento del equipo cruzado con horarios. Subes el Excel oficial
            (hoja <strong>&quot;KPIS SEM.&quot;</strong>) por semana y la app calcula
            venta/hora, cumplimiento por asesor y proyección mensual.
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
            <div>
              <label className="block text-xs text-muted uppercase tracking-wider mb-1">Vista</label>
              <div className="inline-flex rounded-md border border-line overflow-hidden text-sm">
                {(
                  [
                    { v: "distribucion", label: "Diario / asesor" },
                    { v: "semanal", label: "Semanal / asesor" },
                    { v: "diario", label: "Diario / tienda" },
                  ] as const
                ).map(({ v, label }) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVista(v)}
                    className={
                      "px-3 py-2 " +
                      (vista === v
                        ? "bg-brand text-white font-semibold"
                        : "bg-white text-ink hover:bg-paper")
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="px-3 py-2 rounded-md border border-brand text-brand bg-white text-sm font-semibold hover:bg-brand/5 transition-colors"
            >
              📊 Subir Excel (KPIS SEM.)
            </button>
            <button
              type="button"
              onClick={() => setVentasDiaOpen(true)}
              className="px-3 py-2 rounded-md bg-operaciones text-white text-sm font-semibold hover:bg-operaciones/90 transition-colors"
            >
              📄 Registrar cierre del día (PDF)
            </button>
          </div>
          {fetchError && (
            <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-sm">
              {fetchError}
            </div>
          )}
        </div>

        {/* Card grande de presupuesto mensual */}
        {(totalMes.meta > 0 || totalDiario.meta > 0) && (
          <div className="bg-gradient-to-br from-brand/5 to-brand/10 border border-brand/20 rounded-[10px] p-5 mb-4">
            <div className="text-xs text-muted uppercase tracking-wider mb-2">
              Resumen mensual — {NOMBRES_MES[mes - 1]} {anio}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-muted">Presupuesto del mes</div>
                <div className="text-lg font-display font-semibold">
                  {fmtMoney(Math.max(totalMes.meta, totalDiario.meta))}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted">Venta acumulada</div>
                <div className="text-lg font-display font-semibold">
                  {fmtMoney(Math.max(totalMes.venta, totalDiario.venta))}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted">Cumplimiento</div>
                <div className="text-lg font-display font-semibold">
                  {fmtPct(
                    (() => {
                      const meta = Math.max(totalMes.meta, totalDiario.meta);
                      const venta = Math.max(totalMes.venta, totalDiario.venta);
                      return meta > 0 ? venta / meta : null;
                    })(),
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted">Horas del mes</div>
                <div className="text-lg font-display font-semibold">
                  {totalMes.horas > 0 ? totalMes.horas + " h" : "—"}
                </div>
              </div>
            </div>
          </div>
        )}

        {uploads.length > 0 && (
          <div className="bg-panel border border-line rounded-[10px] p-4 mb-4">
            <div className="text-xs text-muted uppercase tracking-wider mb-2">Último upload</div>
            {uploads.slice(0, 1).map((u) => (
              <div key={u.id} className="flex flex-wrap gap-4 text-sm">
                <div>
                  <div className="text-muted text-xs">Archivo</div>
                  <div className="font-mono">{u.nombre_archivo || "—"}</div>
                </div>
                <div>
                  <div className="text-muted text-xs">Semana</div>
                  <div>{u.semana_label || "—"}</div>
                </div>
                <div>
                  <div className="text-muted text-xs">Presupuesto total</div>
                  <div>{fmtMoney(u.presupuesto_total)}</div>
                </div>
                <div>
                  <div className="text-muted text-xs">Venta/hora</div>
                  <div>{fmtMoney(u.venta_por_hora)}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {vista === "distribucion" ? (
          <>
            {rankingItems.length > 0 && (
              <div className="bg-panel border border-line rounded-[10px] p-4 mb-4">
                <h3 className="font-display font-semibold text-sm mb-0.5">
                  🏆 Ranking de cumplimiento — {NOMBRES_MES[mes - 1]} {anio}
                </h3>
                <p className="text-muted text-[11.5px] mb-3">
                  Venta acumulada vs. meta de los días ya cerrados por cada asesor.
                </p>
                <RankingAsesores items={rankingItems} />
              </div>
            )}
          <div className="bg-panel border border-line rounded-[10px] p-4">
            <div className="flex justify-between mb-3 flex-wrap gap-2">
              <div>
                <h3 className="font-display font-semibold text-sm">
                  Meta diaria por asesor — {NOMBRES_MES[mes - 1]} {anio}
                </h3>
                <p className="text-muted text-[11.5px] mt-0.5">
                  meta = horas del turno × venta/hora del último upload
                  {uploads[0]?.venta_por_hora ? (
                    <>
                      {" "}
                      (<strong>{fmtMoney(uploads[0].venta_por_hora)}/h</strong>)
                    </>
                  ) : (
                    <> — sube el Excel oficial para calcular</>
                  )}
                </p>
              </div>
            </div>
            {distribucionOrdenada.length === 0 || !uploads[0]?.venta_por_hora ? (
              <div className="text-center py-10 text-muted text-sm">
                {!uploads[0]?.venta_por_hora
                  ? "Sube el Excel de la semana para calcular la distribución."
                  : "No hay personal activo con horarios cargados."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="text-xs border-collapse min-w-full">
                  <thead className="bg-paper sticky top-0 z-10">
                    <tr>
                      <th className="sticky left-0 bg-paper border-b border-r border-line px-2 py-1.5 text-left font-semibold min-w-[180px] z-20">
                        Asesor
                      </th>
                      {diasDelMes.map((d) => {
                        const esFinde = d.weekday === 0 || d.weekday === 6;
                        const esHoy = esMesActual && d.dia === hoy.getDate();
                        return (
                          <th
                            key={d.dia}
                            className={
                              "border-b border-r border-line px-0.5 py-1 font-semibold min-w-[46px] " +
                              (esFinde ? "bg-brand/5 " : "") +
                              (esHoy ? "outline outline-2 outline-brand -outline-offset-2 " : "")
                            }
                          >
                            <div className="text-[9px] text-muted">
                              {DIAS_CORTOS[d.weekday]}
                            </div>
                            <div className="text-[11px]">{d.dia}</div>
                          </th>
                        );
                      })}
                      <th className="border-b border-line px-2 py-1.5 font-semibold text-[10px] text-muted uppercase min-w-[90px]">
                        Meta mes
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {distribucionOrdenada.map((d) => (
                      <tr key={d.persona.id} className="hover:bg-paper/50">
                        <td className="sticky left-0 bg-white border-b border-r border-line px-2 py-1 z-10">
                          <div className="text-sm truncate max-w-[170px]">
                            {d.persona.nombre}
                          </div>
                          <div className="text-[10px] text-muted">
                            {d.horasMes}h · {d.diasTrabajo} días
                          </div>
                        </td>
                        {diasDelMes.map((diaM) => {
                          const fecha = `${anio}-${String(mes).padStart(2, "0")}-${String(diaM.dia).padStart(2, "0")}`;
                          const md = d.diaria.get(fecha);
                          const esFinde = diaM.weekday === 0 || diaM.weekday === 6;
                          const esHoy = esMesActual && diaM.dia === hoy.getDate();
                          if (!md || md.tipo !== "trabajo" || md.meta === 0) {
                            return (
                              <td
                                key={diaM.dia}
                                className={
                                  "border-b border-r border-line px-0.5 py-1 text-center text-[10px] text-muted/50 " +
                                  (esFinde ? "bg-brand/5 " : "bg-neutral-100/60 ") +
                                  (esHoy ? "outline outline-2 outline-brand -outline-offset-2 " : "")
                                }
                                title={md?.tipo === "libre" ? "Libre" : "Descanso"}
                              >
                                {md?.tipo === "libre" ? "L" : "·"}
                              </td>
                            );
                          }
                          // Con venta registrada: coloreado por cumplimiento y muestra %.
                          // Sin venta aún: neutro, muestra la meta en pesos compactos.
                          const tieneVenta = md.venta != null;
                          const estilo = tieneVenta ? estiloCumplimiento(md.cumplimiento) : null;
                          const contenido = tieneVenta
                            ? `${Math.round((md.cumplimiento ?? 0) * 100)}%`
                            : fmtMoneyCompacto(md.meta);
                          const tooltip = tieneVenta
                            ? `${md.horas}h · meta ${fmtMoney(md.meta)} · venta ${fmtMoney(md.venta)}`
                            : `${md.horas}h · meta ${fmtMoney(md.meta)} · sin cierre registrado`;
                          return (
                            <td
                              key={diaM.dia}
                              className={
                                "relative border-b border-r border-line px-0.5 py-1 text-center font-mono text-[10px] transition-colors " +
                                (tieneVenta
                                  ? `${estilo!.bg} ${estilo!.text} font-bold`
                                  : esFinde
                                  ? "bg-brand/5 "
                                  : "") +
                                (esHoy ? " outline outline-2 outline-brand -outline-offset-2" : "")
                              }
                              title={tooltip}
                            >
                              {tieneVenta && estilo!.emoji && (
                                <span className="absolute top-0 right-0 text-[8px] leading-none" aria-hidden>
                                  {estilo!.emoji}
                                </span>
                              )}
                              {contenido}
                            </td>
                          );
                        })}
                        <td className="border-b border-line px-2 py-1 text-right font-mono font-semibold">
                          {fmtMoney(d.metaMes)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-paper font-semibold">
                      <td className="sticky left-0 bg-paper border-b border-r border-line px-2 py-1.5 text-xs uppercase tracking-wider z-10">
                        Total tienda
                      </td>
                      {diasDelMes.map((diaM) => {
                        const fecha = `${anio}-${String(mes).padStart(2, "0")}-${String(diaM.dia).padStart(2, "0")}`;
                        const totalDia = distribucionOrdenada.reduce(
                          (acc, d) => acc + (d.diaria.get(fecha)?.meta ?? 0),
                          0,
                        );
                        const esFinde = diaM.weekday === 0 || diaM.weekday === 6;
                        const abrev =
                          totalDia >= 1_000_000
                            ? "$" + (totalDia / 1_000_000).toFixed(1) + "M"
                            : totalDia > 0
                            ? "$" + Math.round(totalDia / 1000) + "K"
                            : "—";
                        return (
                          <td
                            key={diaM.dia}
                            className={
                              "border-b border-r border-line px-0.5 py-1 text-center font-mono text-[10px] " +
                              (esFinde ? "bg-brand/10 " : "bg-paper")
                            }
                            title={fmtMoney(totalDia)}
                          >
                            {abrev}
                          </td>
                        );
                      })}
                      <td className="border-b border-line px-2 py-1.5 text-right font-mono">
                        {fmtMoney(
                          distribucionOrdenada.reduce((a, d) => a + d.metaMes, 0),
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <div className="text-[10.5px] text-muted mt-2 italic">
                  Meta por día = horas de turno del asesor × venta/hora
                  ({fmtMoney(uploads[0]?.venta_por_hora)}). Se recalcula
                  automáticamente si cambian horarios o hay nuevo upload.
                </div>
              </div>
            )}
          </div>
          </>
        ) : vista === "semanal" ? (
          <div className="bg-panel border border-line rounded-[10px] p-4">
            <div className="flex justify-between mb-3">
              <h3 className="font-display font-semibold text-sm">
                Cumplimiento por asesor — {NOMBRES_MES[mes - 1]} {anio}
              </h3>
              <div className="text-xs text-muted">
                Meta {fmtMoney(totalMes.meta)} · Venta {fmtMoney(totalMes.venta)} ·{" "}
                <strong>
                  Cumpl. {fmtPct(totalMes.meta > 0 ? totalMes.venta / totalMes.meta : null)}
                </strong>
              </div>
            </div>
            {resumenPorPersona.length === 0 ? (
              <div className="text-center py-10 text-muted text-sm">
                No hay presupuestos cargados para {NOMBRES_MES[mes - 1]} {anio}.<br />
                Sube el Excel oficial cuando lo tengas listo.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead>
                    <tr className="border-b border-line text-left">
                      <Th>Asesor</Th>
                      <Th>Cargo</Th>
                      <Th>Semanas</Th>
                      <Th className="text-right">Meta mes</Th>
                      <Th className="text-right">Venta mes</Th>
                      <Th className="text-right">Horas</Th>
                      <Th className="text-right">Cumpl.</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumenPorPersona.map((r) => {
                      const cumpl = r.meta > 0 ? r.venta / r.meta : null;
                      return (
                        <tr key={r.persona.id} className="border-b border-line/60 last:border-0">
                          <td className="py-2 pr-3">{r.persona.nombre}</td>
                          <td className="py-2 pr-3 text-xs text-muted">{r.persona.cargo}</td>
                          <td className="py-2 pr-3">{r.semanas}</td>
                          <td className="py-2 pr-3 text-right font-mono">{fmtMoney(r.meta)}</td>
                          <td className="py-2 pr-3 text-right font-mono">{fmtMoney(r.venta)}</td>
                          <td className="py-2 pr-3 text-right font-mono">{r.horas}h</td>
                          <td className="py-2 pr-3 text-right font-mono font-semibold">
                            {fmtPct(cumpl)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-panel border border-line rounded-[10px] p-4">
            <div className="flex justify-between mb-3">
              <h3 className="font-display font-semibold text-sm">
                Presupuesto diario — {NOMBRES_MES[mes - 1]} {anio}
              </h3>
              <div className="text-xs text-muted">
                Meta {fmtMoney(totalDiario.meta)} · Venta {fmtMoney(totalDiario.venta)} ·{" "}
                <strong>
                  Cumpl. {fmtPct(totalDiario.meta > 0 ? totalDiario.venta / totalDiario.meta : null)}
                </strong>
              </div>
            </div>
            {diarios.length === 0 ? (
              <div className="text-center py-10 text-muted text-sm">
                No hay registros diarios para {NOMBRES_MES[mes - 1]} {anio}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead>
                    <tr className="border-b border-line text-left">
                      <Th>Fecha</Th>
                      <Th className="text-right">Meta</Th>
                      <Th className="text-right">Venta</Th>
                      <Th className="text-right">Cumpl.</Th>
                      <Th className="text-right">% Acc.</Th>
                      <Th className="text-right">% Ropa</Th>
                      <Th>Responsable</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {diarios.map((d) => {
                      const cumpl = d.meta && d.meta > 0 && d.venta != null ? d.venta / d.meta : null;
                      const resp = personal.find((p) => p.id === d.responsable_id);
                      return (
                        <tr key={d.id} className="border-b border-line/60 last:border-0">
                          <td className="py-2 pr-3 font-mono text-xs">{d.fecha}</td>
                          <td className="py-2 pr-3 text-right font-mono">{fmtMoney(d.meta)}</td>
                          <td className="py-2 pr-3 text-right font-mono">{fmtMoney(d.venta)}</td>
                          <td className="py-2 pr-3 text-right font-mono font-semibold">
                            {fmtPct(cumpl)}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono">
                            {fmtPct(d.accesorios_pct)}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono">{fmtPct(d.ropa_pct)}</td>
                          <td className="py-2 pr-3 text-xs">{resp?.nombre ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {uploadOpen && (
        <UploadModal
          anio={anio}
          mes={mes}
          personal={personal}
          personaId={persona.id}
          onClose={() => setUploadOpen(false)}
          onSaved={() => {
            setUploadOpen(false);
            loadData();
          }}
        />
      )}
      {ventasDiaOpen && (
        <RegistrarVentasDiaModal
          personal={personal}
          codigosAlternos={codigosAlternos}
          horarios={horarios}
          personaId={persona.id}
          anio={anio}
          mes={mes}
          onClose={() => setVentasDiaOpen(false)}
          onSaved={() => {
            setVentasDiaOpen(false);
            loadData();
          }}
        />
      )}
    </AppShell>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={
        "pb-2 pr-3 font-semibold text-xs uppercase tracking-wider text-muted " + className
      }
    >
      {children}
    </th>
  );
}

// ---------- Upload Modal ----------

function UploadModal({
  anio,
  mes,
  personal,
  personaId,
  onClose,
  onSaved,
}: {
  anio: number;
  mes: number;
  personal: Persona[];
  personaId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<KpisSemParsed | null>(null);
  const [targetParsed, setTargetParsed] = useState<TargetParsed | null>(null);
  const [unified, setUnified] = useState<FilaUnificada[]>([]);
  const [hojaKpisUsada, setHojaKpisUsada] = useState<string | null>(null);
  const [hojaTargetUsada, setHojaTargetUsada] = useState<string | null>(null);
  const [hojasDisponibles, setHojasDisponibles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleFile(f: File) {
    setError(null);
    setFile(f);
    setParsing(true);
    try {
      const res = await leerPresupuestoDesdeArchivo(f);
      setHojaKpisUsada(res.kpis.hojaUsada);
      setHojaTargetUsada(res.target.hojaUsada);
      setHojasDisponibles(res.hojasDisponibles);
      if (!res.kpis.hojaUsada && !res.target.hojaUsada) {
        setError(
          `No encontré hojas "KPI SEM" ni "Target". Hojas del archivo: ${res.hojasDisponibles.join(", ")}`,
        );
        setParsed(null);
        setTargetParsed(null);
        return;
      }
      if (res.kpis.hojaUsada && !res.kpis.parsed) {
        setError(
          `Hoja "${res.kpis.hojaUsada}" encontrada pero no pude extraer datos. ¿Estructura correcta?`,
        );
      }
      setParsed(res.kpis.parsed);
      setTargetParsed(res.target.parsed);
      if (res.kpis.parsed) {
        setUnified(unificarPresupuestos(res.kpis.parsed, personal));
      } else {
        setUnified([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setParsed(null);
      setTargetParsed(null);
    } finally {
      setParsing(false);
    }
  }

  function reassignPersona(idx: number, nuevoId: string) {
    setUnified((prev) => {
      const copia = [...prev];
      if (nuevoId === "") {
        copia[idx] = { ...copia[idx], personaId: null, personaNombre: null };
      } else {
        const p = personal.find((x) => x.id === nuevoId);
        copia[idx] = {
          ...copia[idx],
          personaId: nuevoId,
          personaNombre: p?.nombre ?? null,
        };
      }
      return copia;
    });
  }

  async function guardar() {
    if (!parsed && !targetParsed) return;
    setError(null);
    setSaving(true);

    const semanaLabel = parsed?.semanaLabel || `${NOMBRES_MES[mes - 1]} ${anio}`;
    // 1) Crear el upload row (metadata general del archivo)
    const { data: uploadRow, error: upErr } = await supabase
      .from("presupuestos_uploads")
      .insert({
        anio,
        mes,
        semana_label: semanaLabel,
        nombre_archivo: file?.name ?? null,
        subido_por: personaId,
        presupuesto_total: targetParsed?.totalMes ?? parsed?.presupuestoSemanaTotal ?? null,
        horas_total: parsed?.horasLaboradasTotal ?? null,
        venta_por_hora: parsed?.ventaPorHora ?? null,
      })
      .select()
      .single();
    if (upErr || !uploadRow) {
      setError(`Error creando upload: ${upErr?.message ?? "desconocido"}`);
      setSaving(false);
      return;
    }

    // 2) Semanales (por asesor) — solo si hay parseo KPIS SEM.
    if (parsed) {
      // Solo filas con AL MENOS meta o venta legibles. Un nombre matcheado
      // con meta=null y venta=null (fórmulas de Excel sin caché — el archivo
      // no se recalculó antes de exportar) no aporta nada guardado y antes
      // se colaba silenciosamente como fila vacía en presupuestos_semanales.
      const semanales = unified
        .filter((f) => f.personaId != null && (f.meta != null || f.venta != null))
        .map((f) => ({
          upload_id: (uploadRow as { id: string }).id,
          persona_id: f.personaId!,
          anio,
          mes,
          semana_label: semanaLabel,
          meta: f.meta,
          venta: f.venta,
          cumplimiento:
            f.meta != null && f.meta > 0 && f.venta != null ? f.venta / f.meta : null,
          horas_reportadas: f.horasReportadas,
        }));
      if (semanales.length > 0) {
        const { error: sErr } = await supabase
          .from("presupuestos_semanales")
          .insert(semanales);
        if (sErr) {
          setError(`Error insertando semanales: ${sErr.message}`);
          setSaving(false);
          return;
        }
      }
    }

    // 3) Diarios (por fecha) — solo si hay parseo Target. Upsert por fecha
    //    para permitir re-cargar el archivo con datos actualizados.
    if (targetParsed && targetParsed.filas.length > 0) {
      const diarios = targetParsed.filas.map((f) => ({
        fecha: f.fecha,
        meta: f.target,
        venta: f.ventaNeta,
        registrado_por: personaId,
      }));
      const { error: dErr } = await supabase
        .from("presupuestos_diarios")
        .upsert(diarios, { onConflict: "fecha" });
      if (dErr) {
        setError(`Error insertando diarios: ${dErr.message}`);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    onSaved();
  }

  const conMatch = unified.filter((f) => f.personaId != null).length;
  const sinMatch = unified.length - conMatch;
  // Match pero sin ningún número legible — probable fórmula de Excel sin
  // recalcular antes de exportar. Estas filas NO se guardan (ver guardar()).
  const sinDatos = unified.filter(
    (f) => f.personaId != null && f.meta == null && f.venta == null,
  ).length;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-panel rounded-[10px] p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-xl relative"
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
        <h3 className="font-display font-semibold text-base mb-3 pr-8">
          Subir Excel de Presupuesto — {NOMBRES_MES[mes - 1]} {anio}
        </h3>
        <p className="text-muted text-[12.5px] mb-4">
          Selecciona el archivo Excel oficial con la hoja <strong>&quot;KPIS SEM.&quot;</strong>.
          La app extrae metas y ventas por asesor, matchea con el roster de Personal y
          te muestra la vista previa antes de guardar.
        </p>

        <div className="mb-4">
          <input
            type="file"
            accept=".xlsx,.xlsm"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
            className="block w-full text-sm border border-line rounded-md p-2 bg-white"
          />
        </div>

        {parsing && (
          <div className="text-center py-6 text-muted text-sm">Leyendo archivo…</div>
        )}

        {error && (
          <div className="bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-sm mb-3">
            {error}
          </div>
        )}

        {(parsed || targetParsed) && (
          <>
            <div className="bg-paper border border-line rounded-md p-3 mb-3 text-sm space-y-2">
              {parsed && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-1">
                    Hoja {hojaKpisUsada} — Semanal por asesor
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <div className="text-muted text-xs">Semana</div>
                      <div>{parsed.semanaLabel || "—"}</div>
                    </div>
                    <div>
                      <div className="text-muted text-xs">Presupuesto semanal</div>
                      <div>{fmtMoney(parsed.presupuestoSemanaTotal)}</div>
                    </div>
                    <div>
                      <div className="text-muted text-xs">Horas laboradas</div>
                      <div>{parsed.horasLaboradasTotal ?? "—"} h</div>
                    </div>
                    <div>
                      <div className="text-muted text-xs">Venta/hora</div>
                      <div>{fmtMoney(parsed.ventaPorHora)}</div>
                    </div>
                  </div>
                  <div className="text-xs text-muted mt-2">
                    Personas detectadas: <strong>{unified.length}</strong> · Con match:{" "}
                    <strong className="text-operaciones">{conMatch}</strong> · Sin match:{" "}
                    <strong className={sinMatch > 0 ? "text-warn" : ""}>{sinMatch}</strong>
                    {sinDatos > 0 && (
                      <>
                        {" "}
                        · Sin números legibles:{" "}
                        <strong className="text-warn">{sinDatos}</strong>
                      </>
                    )}
                  </div>
                  {sinDatos > 0 && (
                    <div className="bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs mt-2">
                      ⚠ {sinDatos} {sinDatos === 1 ? "persona tiene" : "personas tienen"} nombre
                      detectado pero SIN meta ni venta legible (probable fórmula de Excel sin
                      recalcular antes de exportar el archivo). {sinDatos === 1 ? "Esa fila" : "Esas filas"}{" "}
                      no se guardará{sinDatos === 1 ? "" : "n"} — revisa la tabla abajo (columnas
                      Meta/Venta en &quot;—&quot;) y, si hace falta, abre el Excel original, presiona
                      recalcular (Ctrl+Alt+F9) y guárdalo antes de volver a subirlo.
                    </div>
                  )}
                </div>
              )}
              {targetParsed && (
                <div className={parsed ? "pt-2 border-t border-line/60" : ""}>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-1">
                    Hoja {hojaTargetUsada} — Meta diaria del mes
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <div className="text-muted text-xs">Días detectados</div>
                      <div>{targetParsed.filas.length}</div>
                    </div>
                    <div>
                      <div className="text-muted text-xs">Presupuesto mensual</div>
                      <div className="font-semibold">{fmtMoney(targetParsed.totalMes)}</div>
                    </div>
                    <div>
                      <div className="text-muted text-xs">Venta acumulada</div>
                      <div>{fmtMoney(targetParsed.ventaAcumulada)}</div>
                    </div>
                    <div>
                      <div className="text-muted text-xs">Cumpl. mes</div>
                      <div className="font-semibold">
                        {fmtPct(
                          targetParsed.totalMes && targetParsed.totalMes > 0 && targetParsed.ventaAcumulada != null
                            ? targetParsed.ventaAcumulada / targetParsed.totalMes
                            : null,
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {hojasDisponibles.length > 0 && (
                <div className="text-[11px] text-muted pt-1">
                  Hojas del archivo: <span className="font-mono">{hojasDisponibles.join(", ")}</span>
                </div>
              )}
            </div>

            {parsed && (
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-xs min-w-[900px]">
                <thead className="bg-paper">
                  <tr className="border-b border-line">
                    <Th>Nombre (Excel)</Th>
                    <Th>Cargo</Th>
                    <Th>Match a Personal</Th>
                    <Th className="text-right">Meta</Th>
                    <Th className="text-right">Venta</Th>
                    <Th className="text-right">Horas</Th>
                  </tr>
                </thead>
                <tbody>
                  {unified.map((f, idx) => {
                    const sinDatosFila =
                      f.personaId != null && f.meta == null && f.venta == null;
                    return (
                      <tr
                        key={idx}
                        className={
                          "border-b border-line/60 last:border-0 " +
                          (sinDatosFila ? "bg-warn-soft/60" : "")
                        }
                        title={sinDatosFila ? "Sin números legibles — no se guardará esta fila" : ""}
                      >
                        <td className="py-1.5 pr-2">
                          {f.nombreExcel}
                          {sinDatosFila && <span className="ml-1 text-warn">⚠</span>}
                        </td>
                        <td className="py-1.5 pr-2 text-muted">{f.cargoExcel}</td>
                        <td className="py-1.5 pr-2">
                          <select
                            value={f.personaId ?? ""}
                            onChange={(e) => reassignPersona(idx, e.target.value)}
                            className={
                              "text-xs border rounded px-1 py-0.5 bg-white " +
                              (f.personaId ? "border-line" : "border-warn text-warn")
                            }
                          >
                            <option value="">— sin match —</option>
                            {personal
                              .filter((p) => p.activo)
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.nombre}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td
                          className={
                            "py-1.5 pr-2 text-right font-mono " +
                            (sinDatosFila ? "text-warn" : "")
                          }
                        >
                          {fmtMoney(f.meta)}
                        </td>
                        <td
                          className={
                            "py-1.5 pr-2 text-right font-mono " +
                            (sinDatosFila ? "text-warn" : "")
                          }
                        >
                          {fmtMoney(f.venta)}
                        </td>
                        <td className="py-1.5 pr-2 text-right font-mono">
                          {f.horasReportadas ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-md border border-line bg-white text-sm hover:bg-paper"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={guardar}
                disabled={saving || (conMatch === 0 && !targetParsed)}
                className="px-4 py-2 rounded-md bg-brand text-white text-sm font-semibold hover:bg-brand-light disabled:opacity-50"
                title={
                  conMatch === 0 && !targetParsed
                    ? "Debe haber al menos 1 persona matcheada o datos de Target"
                    : ""
                }
              >
                {saving
                  ? "Guardando…"
                  : `Guardar (${conMatch - sinDatos} asesores + ${targetParsed?.filas.length ?? 0} días)`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Silenciar el warning de import no usado (helper reservado para features futuros)
void matchPersonaPorNombre;

// ============================================================
// Modal Registrar cierre del día (PDF ventas)
// ============================================================

function RegistrarVentasDiaModal({
  personal,
  codigosAlternos,
  horarios,
  personaId,
  anio,
  mes,
  onClose,
  onSaved,
}: {
  personal: Persona[];
  codigosAlternos: PersonalCodigoAlterno[];
  horarios: Horario[];
  personaId: string;
  anio: number;
  mes: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Default fecha = hoy si estamos en el mes actual, si no el 1 del mes
  const hoy = new Date();
  const defaultFecha = (() => {
    if (hoy.getFullYear() === anio && hoy.getMonth() + 1 === mes) {
      return hoy.toISOString().slice(0, 10);
    }
    return `${anio}-${String(mes).padStart(2, "0")}-01`;
  })();

  const [fecha, setFecha] = useState(defaultFecha);
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [pdfData, setPdfData] = useState<VentasPdfResponse | null>(null);
  const [filas, setFilas] = useState<FilaVenta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const diaDelMes = parseInt(fecha.split("-")[2] ?? "1", 10);

  async function handleFile(f: File) {
    setError(null);
    setFile(f);
    setReading(true);
    setPdfData(null);
    setFilas([]);
    try {
      const res = await leerVentasPdf(f);
      setPdfData(res);
      // NO auto-copiamos la fecha del PDF. Si el OCR se equivoca leyendo
      // la fecha, no queremos guardar los datos en el día equivocado.
      // El banner de discrepancia (más abajo) muestra ambas y jefatura
      // elige la correcta.
      const filasMatch = matchearEmpleadosConRoster({
        empleadosPdf: res.empleados,
        personal,
        codigosAlternos,
        horarios,
        diaDelMes,
      });
      setFilas(filasMatch);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReading(false);
    }
  }

  function updateFila(idx: number, changes: Partial<FilaVenta>) {
    setFilas((prev) => {
      const copia = [...prev];
      copia[idx] = { ...copia[idx], ...changes };
      return copia;
    });
  }

  async function guardar() {
    setError(null);
    setSaving(true);
    try {
      const result = await guardarVentasDia({
        fecha,
        filas,
        registradoPorId: personaId,
      });
      // También actualizar presupuestos_diarios con el total de venta bruta
      if (pdfData?.totalVenta) {
        await supabase.from("presupuestos_diarios").upsert(
          {
            fecha,
            venta: pdfData.totalVenta,
            registrado_por: personaId,
          },
          { onConflict: "fecha" },
        );
      }
      alert(
        `Guardado: ${result.insertados} filas insertadas${
          result.huerfanos > 0 ? `, ${result.huerfanos} huérfanas pendientes` : ""
        }.`,
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const matched = filas.filter((f) => f.tipo === "matched");
  const huerfanos = filas.filter((f) => f.tipo === "huerfano");
  const ausentes = filas.filter((f) => f.tipo === "ausente");
  const ausentesSinMotivo = ausentes.filter((f) => !f.motivo);

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-panel rounded-[10px] p-6 max-w-5xl w-full max-h-[92vh] overflow-y-auto shadow-xl relative"
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
        <h3 className="font-display font-semibold text-base mb-1 pr-8">
          Registrar cierre del día
        </h3>
        <p className="text-muted text-[12.5px] mb-4">
          Sube el PDF de <strong>&quot;Ventas rápidas por empleado&quot;</strong> que
          genera el sistema de la tienda al cierre. La IA lee los datos y
          matchea con el roster. Antes de guardar, revisa quiénes NO vendieron
          y marca el motivo.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-xs text-muted uppercase tracking-wider mb-1">
              Fecha del cierre
            </label>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="w-full px-3 py-2 border border-line rounded-md bg-white text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-muted uppercase tracking-wider mb-1">
              PDF de ventas
            </label>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
              className="block w-full text-sm border border-line rounded-md p-2 bg-white"
            />
          </div>
        </div>

        {reading && (
          <div className="text-center py-6 text-muted text-sm">
            📄 Leyendo PDF con IA… (puede tardar unos segundos)
          </div>
        )}

        {error && (
          <div className="bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-sm mb-3">
            {error}
          </div>
        )}

        {pdfData && filas.length > 0 && (
          <>
            {/* Aviso de discrepancia de fechas */}
            {pdfData.fecha && pdfData.fecha !== fecha && (
              <div className="bg-warn-soft border border-warn-border rounded-md p-3 mb-3">
                <div className="text-warn text-sm font-semibold mb-1">
                  ⚠ Las fechas no coinciden
                </div>
                <div className="text-xs text-ink space-y-1">
                  <div>
                    Fecha en el PDF: <strong className="font-mono">{pdfData.fecha}</strong>
                  </div>
                  <div>
                    Fecha seleccionada arriba: <strong className="font-mono">{fecha}</strong>
                  </div>
                  <div className="mt-2 text-muted">
                    Al guardar, los datos se registrarán en{" "}
                    <strong className="font-mono">{fecha}</strong>. Si el PDF
                    tiene la fecha correcta y la seleccionada está mal, cambia
                    el selector arriba.
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => setFecha(pdfData.fecha!)}
                      className="text-xs px-2 py-1 border border-warn text-warn bg-white rounded hover:bg-warn-soft/60"
                    >
                      Usar fecha del PDF ({pdfData.fecha})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        // no-op — solo cierra el aviso implícitamente si acepta;
                        // como el banner sigue si no coinciden, mostramos "OK, entiendo"
                        // para que jefatura confirme visualmente.
                      }}
                      disabled
                      title="Los datos ya se guardarán con la fecha seleccionada arriba"
                      className="text-xs px-2 py-1 border border-line bg-white rounded opacity-50 cursor-not-allowed"
                    >
                      Mantener seleccionada ({fecha})
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Resumen */}
            <div className="bg-paper border border-line rounded-md p-3 mb-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div>
                  <div className="text-muted text-xs">Fecha detectada</div>
                  <div className="font-mono">
                    {pdfData.fecha ?? "—"}
                    {pdfData.fecha && pdfData.fecha !== fecha && (
                      <span className="ml-1 text-warn text-[10px]">≠ selec.</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-muted text-xs">Total tienda</div>
                  <div className="font-semibold">{fmtMoney(pdfData.totalVenta)}</div>
                </div>
                <div>
                  <div className="text-muted text-xs">Artículos</div>
                  <div>{pdfData.totalArticulos ?? "—"}</div>
                </div>
                <div>
                  <div className="text-muted text-xs">Empleados en PDF</div>
                  <div>{pdfData.empleados.length}</div>
                </div>
              </div>
              <div className="text-xs text-muted mt-2 flex gap-3 flex-wrap">
                <span>
                  Matcheados:{" "}
                  <strong className="text-operaciones">{matched.length}</strong>
                </span>
                {huerfanos.length > 0 && (
                  <span>
                    Huérfanos:{" "}
                    <strong className="text-warn">{huerfanos.length}</strong>
                  </span>
                )}
                <span>
                  Ausentes del PDF (roster activo):{" "}
                  <strong className={ausentesSinMotivo.length > 0 ? "text-warn" : ""}>
                    {ausentes.length}
                  </strong>
                </span>
                {ausentesSinMotivo.length > 0 && (
                  <span className="text-warn">
                    ⚠ {ausentesSinMotivo.length} sin motivo asignado
                  </span>
                )}
              </div>
            </div>

            {/* Matcheados */}
            {matched.length > 0 && (
              <div className="mb-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
                  Con venta ({matched.length})
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-paper border-b border-line text-left">
                        <Th>Persona</Th>
                        <Th className="text-right">Artículos</Th>
                        <Th className="text-right">Venta</Th>
                        <Th>Notas</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {matched.map((f, idx) => {
                        const realIdx = filas.indexOf(f);
                        return (
                          <tr
                            key={realIdx}
                            className="border-b border-line/60 last:border-0"
                          >
                            <td className="py-1.5 pr-2">
                              <div>{f.personaNombre}</div>
                              {f.compartido && (
                                <div className="text-[10px] text-brand">
                                  Código compartido — {Math.round((f.distribucionPct ?? 1) * 100)}%
                                </div>
                              )}
                              <div className="text-[10px] text-muted font-mono">
                                Cod PDF: {f.empleadoPdf?.codigo}
                              </div>
                            </td>
                            <td className="py-1.5 pr-2 text-right font-mono">
                              {f.articulosAsignados ?? "—"}
                            </td>
                            <td className="py-1.5 pr-2 text-right font-mono">
                              {fmtMoney(f.ventaAsignada)}
                            </td>
                            <td className="py-1.5 pr-2 text-[11px]">
                              {(f.ventaAsignada ?? 0) === 0 && (
                                <select
                                  value={f.motivo ?? "solo_operacion"}
                                  onChange={(e) =>
                                    updateFila(realIdx, {
                                      motivo: e.target.value as MotivoNoVenta,
                                    })
                                  }
                                  className="text-[10px] border border-line rounded px-1 py-0.5 bg-white"
                                >
                                  {motivosVisibles().map((m) => (
                                    <option key={m} value={m}>
                                      {MOTIVO_NO_VENTA_LABEL[m]}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Huérfanos */}
            {huerfanos.length > 0 && (
              <div className="mb-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-warn mb-2">
                  ⚠ Huérfanos ({huerfanos.length}) — código no encontrado en Personal
                </h4>
                <p className="text-[11px] text-muted mb-2">
                  Reasigna manualmente al asesor real o descarta si es venta de
                  otra tienda. Los que dejes sin asignar NO se guardan.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-warn-soft border-b border-warn-border text-left">
                        <Th>Nombre PDF</Th>
                        <Th>Código</Th>
                        <Th className="text-right">Venta</Th>
                        <Th>Asignar a</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {huerfanos.map((f) => {
                        const realIdx = filas.indexOf(f);
                        return (
                          <tr
                            key={realIdx}
                            className="border-b border-line/60 last:border-0"
                          >
                            <td className="py-1.5 pr-2">{f.empleadoPdf?.nombre}</td>
                            <td className="py-1.5 pr-2 font-mono">
                              {f.empleadoPdf?.codigo}
                            </td>
                            <td className="py-1.5 pr-2 text-right font-mono">
                              {fmtMoney(f.empleadoPdf?.venta)}
                            </td>
                            <td className="py-1.5 pr-2">
                              <select
                                value={f.personaId ?? ""}
                                onChange={(e) => {
                                  const id = e.target.value;
                                  const p = personal.find((x) => x.id === id);
                                  updateFila(realIdx, {
                                    personaId: id || null,
                                    personaNombre: p?.nombre ?? null,
                                    tipo: id ? "matched" : "huerfano",
                                    ventaAsignada: f.empleadoPdf?.venta ?? 0,
                                    articulosAsignados: f.empleadoPdf?.articulos ?? 0,
                                  });
                                }}
                                className="text-[10px] border border-line rounded px-1 py-0.5 bg-white"
                              >
                                <option value="">— sin asignar —</option>
                                {personal
                                  .filter((p) => p.activo)
                                  .map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.nombre}
                                    </option>
                                  ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Ausentes */}
            {ausentes.length > 0 && (
              <div className="mb-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
                  Ausentes del PDF ({ausentes.length}) — asigna motivo
                </h4>
                <p className="text-[11px] text-muted mb-2">
                  Personas activas que no aparecieron en el PDF de ventas. Si
                  el horario dice descanso o libre solicitado, se preselecciona
                  automáticamente. Los que dejes sin motivo NO se guardan.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-paper border-b border-line text-left">
                        <Th>Persona</Th>
                        <Th>Motivo</Th>
                        <Th>Detalle (si &quot;Otro&quot;)</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {ausentes.map((f) => {
                        const realIdx = filas.indexOf(f);
                        return (
                          <tr
                            key={realIdx}
                            className="border-b border-line/60 last:border-0"
                          >
                            <td className="py-1.5 pr-2">{f.personaNombre}</td>
                            <td className="py-1.5 pr-2">
                              <select
                                value={f.motivo ?? ""}
                                onChange={(e) =>
                                  updateFila(realIdx, {
                                    motivo:
                                      (e.target.value as MotivoNoVenta) || null,
                                  })
                                }
                                className={
                                  "text-[10px] border rounded px-1 py-0.5 bg-white " +
                                  (f.motivo ? "border-line" : "border-warn text-warn")
                                }
                              >
                                <option value="">— elige motivo —</option>
                                {motivosVisibles().map((m) => (
                                  <option key={m} value={m}>
                                    {MOTIVO_NO_VENTA_LABEL[m]}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="py-1.5 pr-2">
                              {f.motivo === "otro" && (
                                <input
                                  type="text"
                                  value={f.motivoDetalle}
                                  onChange={(e) =>
                                    updateFila(realIdx, { motivoDetalle: e.target.value })
                                  }
                                  placeholder="Especifica…"
                                  className="text-[10px] border border-line rounded px-1 py-0.5 bg-white w-full max-w-[200px]"
                                />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-line">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-md border border-line bg-white text-sm hover:bg-paper"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={guardar}
                disabled={saving || filas.length === 0}
                className="px-4 py-2 rounded-md bg-brand text-white text-sm font-semibold hover:bg-brand-light disabled:opacity-50"
              >
                {saving
                  ? "Guardando…"
                  : `Guardar cierre del ${fecha}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function motivosVisibles(): MotivoNoVenta[] {
  return [
    "solo_operacion",
    "descanso",
    "libre_solicitado",
    "incapacidad",
    "calamidad",
    "no_fue",
    "codigo_temporal_dsm",
    "codigo_mal_digitado",
    "venta_otra_tienda",
    "otro",
  ];
}
