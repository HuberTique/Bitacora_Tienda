"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/auth";
import { ShellCond } from "@/components/ShellCond";
import { MetaPorDia } from "@/components/ranking/MetaPorDia";
import { useTienda } from "@/lib/tienda-config";
import type { Tarifa } from "@/lib/reparto";
import { tiendaActualId } from "@/lib/planta";
import {
  cargarMesRetail,
  construirPeriodo,
  mesRetailDeHoy,
  mesesCalendario,
  ymd,
  type MesRetail,
} from "@/lib/mes-retail";
import { Modal, inputCls } from "@/components/ranking/ui";
import { ArchivosParaLeer } from "@/components/ArchivosParaLeer";
import { NOMBRES_MES } from "@/lib/horarios";
import {
  distribuirMetasDiarias,
  rankingCumplimiento,
} from "@/lib/presupuestos-calc";
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
  resolverFechaInforme,
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
/** Contenido de Presupuestos; `embedded` = se muestra como pestaña de "Presupuesto y ranking". */
export function PresupuestosPanel({
  embedded = false,
  anio: anioProp,
  mes: mesProp,
}: {
  embedded?: boolean;
  /** Si se pasan, el mes lo elige la pantalla contenedora y se ocultan los selectores. */
  anio?: number;
  mes?: number;
}) {
  const router = useRouter();
  const { loading, session, persona } = useSession();

  const now = new Date();
  const [anioLocal, setAnio] = useState<number>(now.getFullYear());
  const [mesLocal, setMes] = useState<number>(now.getMonth() + 1);
  const anio = anioProp ?? anioLocal;
  const mes = mesProp ?? mesLocal;
  const [personal, setPersonal] = useState<Persona[]>([]);
  // Presupuesto del mes de cada persona (el del cuadro) y tienda que se está viendo.
  const [presupuestos, setPresupuestos] = useState<Map<string, number>>(new Map());
  // Venta por hora: horas de venta del mes y tramos guardados (GeoVictoria).
  const [horasVenta, setHorasVenta] = useState<Map<string, number>>(new Map());
  const [tarifas, setTarifas] = useState<Map<string, Tarifa[]>>(new Map());
  const tienda = useTienda();
  const [tiendaId, setTiendaId] = useState<string | null>(null);
  const [uploads, setUploads] = useState<PresupuestoUpload[]>([]);
  const [semanales, setSemanales] = useState<PresupuestoSemanal[]>([]);
  const [diarios, setDiarios] = useState<PresupuestoDiario[]>([]);
  const [horarios, setHorarios] = useState<Horario[]>([]);
  const [retail, setRetail] = useState<MesRetail | null>(null);
  // Periodo del "mes": el mes retail de la compañía si está cargado; si no, el mes calendario.
  const periodo = useMemo(() => construirPeriodo(anio, mes, retail), [anio, mes, retail]);
  const [ventas, setVentas] = useState<VentaAsesorDia[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [ventasDiaOpen, setVentasDiaOpen] = useState(false);
  const [codigosAlternos, setCodigosAlternos] = useState<PersonalCodigoAlterno[]>([]);

  // Corrección manual de un cierre: celda (persona + día) que se está editando.
  const [editarVenta, setEditarVenta] = useState<{ personaId: string; fecha: string } | null>(null);

  async function eliminarCierreDia(fecha: string) {
    const filas = ventas.filter((v) => v.fecha === fecha);
    const total = filas.reduce((a, v) => a + (v.venta ?? 0), 0);
    if (
      !confirm(
        `¿Eliminar TODO el cierre del ${fecha}?\n\nSe borran ${filas.length} registro(s) por asesor (${fmtMoney(total)}). Después puedes volver a subir el PDF o las fotos correctas.`,
      )
    )
      return;
    const { error } = await supabase.from("ventas_asesor_dia").delete().eq("fecha", fecha);
    if (error) {
      alert(error.message);
      return;
    }
    await sincronizarTotalDia(fecha, null);
    loadData();
  }

  // Si hoy cae dentro de un mes retail cargado, se abre ese mes (no el calendario).
  useEffect(() => {
    mesRetailDeHoy().then((x) => {
      if (x && anioProp == null) {
        setAnio(x.anio);
        setMes(x.mes);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = useCallback(async () => {
    setFetchError(null);
    // Mes retail (calendario de la compañía) o, si no está cargado, mes calendario.
    const mr = await cargarMesRetail(anio, mes);
    setRetail(mr);
    const per = construirPeriodo(anio, mes, mr);
    // Los horarios se guardan por mes calendario: un mes retail puede tocar dos.
    const filtroHorarios = mesesCalendario(per)
      .map((m) => `and(anio.eq.${m.anio},mes.eq.${m.mes})`)
      .join(",");
    const [pRes, uRes, sRes, dRes, hRes, cRes, vRes, kRes, tId, tfRes] = await Promise.all([
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
        .gte("fecha", per.inicio)
        .lte("fecha", per.fin)
        .order("fecha"),
      supabase.from("horarios").select("*").or(filtroHorarios),
      supabase
        .from("personal_codigos_alternos")
        .select("*")
        .eq("estado", "aprobado"),
      supabase
        .from("ventas_asesor_dia")
        .select("*")
        .gte("fecha", per.inicio)
        .lte("fecha", per.fin),
      supabase.from("kpis_mensuales").select("persona_id, presupuesto, horas_venta").eq("anio", anio).eq("mes", mes),
      tiendaActualId(),
      supabase.from("tarifas_venta_hora").select("persona_id, desde, venta_hora").eq("anio", anio).eq("mes", mes),
    ]);
    if (pRes.error) return setFetchError(pRes.error.message);
    if (uRes.error) return setFetchError(uRes.error.message);
    if (sRes.error) return setFetchError(sRes.error.message);
    if (dRes.error) return setFetchError(dRes.error.message);
    if (hRes.error) return setFetchError(hRes.error.message);
    if (cRes.error) return setFetchError(cRes.error.message);
    if (vRes.error) return setFetchError(vRes.error.message);
    if (kRes.error) return setFetchError(kRes.error.message);
    setPersonal((pRes.data as Persona[] | null) ?? []);
    setPresupuestos(
      new Map(
        ((kRes.data as { persona_id: string; presupuesto: number | null }[] | null) ?? [])
          .filter((k) => k.presupuesto != null && k.presupuesto > 0)
          .map((k) => [k.persona_id, Number(k.presupuesto)]),
      ),
    );
    setHorasVenta(
      new Map(
        ((kRes.data as { persona_id: string; horas_venta: number | null }[] | null) ?? [])
          .filter((k) => k.horas_venta != null && k.horas_venta > 0)
          .map((k) => [k.persona_id, Number(k.horas_venta)]),
      ),
    );
    // Si la tabla de tramos aún no existe, se calcula sin ellos.
    const tramos = new Map<string, Tarifa[]>();
    for (const r of (tfRes.data as ({ persona_id: string } & Tarifa)[] | null) ?? []) {
      tramos.set(r.persona_id, [...(tramos.get(r.persona_id) ?? []), { desde: r.desde, venta_hora: Number(r.venta_hora) }]);
    }
    setTarifas(tramos);
    setTiendaId(tId);
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

  // Quién aparece: la planta activa de la tienda que se está viendo, más quien
  // tenga presupuesto o ventas aquí este mes (reemplazos, trasladados, bajas).
  const personasDelMes = useMemo(() => {
    const conDatos = new Set<string>([...presupuestos.keys(), ...ventas.map((v) => v.persona_id)]);
    return personal.filter(
      (p) => conDatos.has(p.id) || (p.activo && (!tiendaId || (p as Persona & { tienda_id?: string }).tienda_id === tiendaId)),
    );
  }, [personal, presupuestos, ventas, tiendaId]);

  // Distribución diaria por asesor: presupuesto del mes repartido por su horario + ventas reales.
  const distribucion = useMemo(() => {
    return distribuirMetasDiarias({
      anio,
      mes,
      personal: personasDelMes,
      horarios,
      presupuestos,
      ventas,
      periodo,
      tarifas,
      horasVenta,
      factores: { jefe: tienda.factor_jefe ?? 0.25, subjefe: tienda.factor_subjefe ?? 1 / 3, cajero: tienda.factor_cajero ?? 0.5 },
    });
  }, [anio, mes, personasDelMes, horarios, presupuestos, ventas, periodo, tarifas, horasVenta, tienda.factor_jefe, tienda.factor_subjefe, tienda.factor_cajero]);

  const rankingItems = useMemo<RankingItem[]>(() => {
    // Jefe de tienda y subjefes auditan al equipo: no compiten en el ranking.
    const compiten = [...distribucion.values()].filter(
      (d) =>
        d.persona.rol_jerarquico !== "jefe_tienda" &&
        d.persona.rol_jerarquico !== "subjefe",
    );
    const ordenado = rankingCumplimiento(compiten);
    // Sin metas (falta el Excel de KPIs semanales) el cumplimiento no existe: se
    // ordena por venta registrada para que el ranking igual muestre algo útil.
    if (ordenado.every((d) => d.cumplimientoMes == null)) {
      ordenado.sort((a, b) => b.ventaMes - a.ventaMes);
    }
    return ordenado.map((d) => ({
      personaId: d.persona.id,
      nombre: d.persona.nombre,
      cumplimiento: d.cumplimientoMes,
      venta: d.ventaMes,
      meta: d.metaConVenta,
    }));
  }, [distribucion]);

  // Venta registrada con los cierres del día (PDF / fotos): total y días cerrados.
  const ventasMes = useMemo(() => {
    const porDia = new Map<string, number>();
    let total = 0;
    for (const v of ventas) {
      if (v.fecha < periodo.inicio || v.fecha > periodo.fin) continue;
      porDia.set(v.fecha, (porDia.get(v.fecha) ?? 0) + (v.venta ?? 0));
      total += v.venta ?? 0;
    }
    return { porDia, total, diasCerrados: porDia.size };
  }, [ventas, periodo]);
  const diasConCierre = useMemo(() => new Set(ventasMes.porDia.keys()), [ventasMes]);

  // Equipo (cajeros, full time, part time) y aparte jefe de tienda y subjefes.
  const { equipo, mandos } = useMemo(() => {
    const ORDEN: Record<Persona["rol_jerarquico"], number> = {
      jefe_tienda: 0,
      subjefe: 1,
      cajero: 2,
      full_time: 3,
      part_time: 4,
    };
    const ordenada = [...distribucion.values()].sort((a, b) => {
      const dif = ORDEN[a.persona.rol_jerarquico] - ORDEN[b.persona.rol_jerarquico];
      if (dif !== 0) return dif;
      return a.persona.nombre.localeCompare(b.persona.nombre);
    });
    const esMandoFila = (d: (typeof ordenada)[number]) =>
      d.persona.rol_jerarquico === "jefe_tienda" || d.persona.rol_jerarquico === "subjefe";
    return { equipo: ordenada.filter((d) => !esMandoFila(d)), mandos: ordenada.filter(esMandoFila) };
  }, [distribucion]);

  const hoyStr = ymd(new Date());

  if (loading || !persona || persona.rol !== "jefatura") {
    return (
      <div className={(embedded ? "py-12" : "min-h-screen") + " flex items-center justify-center text-muted text-sm"}>
        Cargando…
      </div>
    );
  }

  return (
    <ShellCond embedded={embedded} persona={persona}>
      <div className={"mx-auto max-w-[1100px] w-full " + (embedded ? "py-2" : "px-6 py-7")}>
        {!embedded && (
        <div className="mb-5">
          <h2 className="text-[17px] font-display font-semibold m-0 mb-1">Presupuestos</h2>
          <p className="text-muted text-[13px] max-w-3xl">
            Cumplimiento del equipo cruzado con horarios. Subes el Excel oficial
            (hoja <strong>&quot;KPIS SEM.&quot;</strong>) por semana y la app calcula
            venta/hora, cumplimiento por asesor y proyección mensual.
          </p>
        </div>
        )}

        <div className="bg-panel border border-line rounded-[10px] p-4 mb-4">
          <div className="flex gap-3 flex-wrap items-end">
            {!embedded && (
              <>
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
              </>
            )}
            {!embedded && (
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="px-3 py-2 rounded-md border border-brand text-brand bg-white text-sm font-semibold hover:bg-brand/5 transition-colors"
            >
              📊 Subir Excel (KPIS SEM.)
            </button>
            )}
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
        {!embedded && (totalMes.meta > 0 || totalDiario.meta > 0 || ventasMes.total > 0) && (
          <div className="bg-gradient-to-br from-brand/5 to-brand/10 border border-brand/20 rounded-[10px] p-5 mb-4">
            <div className="text-xs text-muted uppercase tracking-wider mb-2">
              Resumen mensual — {NOMBRES_MES[mes - 1]} {anio}
              {periodo.esRetail && (
                <span className="normal-case tracking-normal ml-2 text-brand">
                  (mes retail: {periodo.inicio} a {periodo.fin} · {periodo.fechas.length} días)
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-muted">Presupuesto del mes</div>
                <div className="text-lg font-display font-semibold">
                  {Math.max(totalMes.meta, totalDiario.meta) > 0
                    ? fmtMoney(Math.max(totalMes.meta, totalDiario.meta))
                    : "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted">Venta acumulada</div>
                <div className="text-lg font-display font-semibold">
                  {fmtMoney(Math.max(totalMes.venta, totalDiario.venta, ventasMes.total))}
                </div>
                {ventasMes.diasCerrados > 0 && (
                  <div className="text-[10.5px] text-muted">{ventasMes.diasCerrados} día(s) con cierre</div>
                )}
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

        {!embedded && uploads.length > 0 && (
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

        {!embedded && rankingItems.length > 0 && (
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
        <MetaPorDia
          key={periodo.inicio}
          equipo={equipo}
          mandos={mandos}
          periodo={periodo}
          hoy={hoyStr}
          diasConCierre={diasConCierre}
          hayPresupuesto={presupuestos.size > 0}
          onEditarVenta={(personaId, fecha) => setEditarVenta({ personaId, fecha })}
          onEliminarCierre={eliminarCierreDia}
        />
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
      {editarVenta && persona && (
        <EditarVentaModal
          personaNombre={personal.find((p) => p.id === editarVenta.personaId)?.nombre ?? "—"}
          personaId={editarVenta.personaId}
          fecha={editarVenta.fecha}
          existente={
            ventas.find(
              (v) =>
                v.persona_id === editarVenta.personaId &&
                v.fecha ===
                  editarVenta.fecha,
            ) ?? null
          }
          registradoPor={persona.id}
          onClose={() => setEditarVenta(null)}
          onSaved={() => {
            setEditarVenta(null);
            loadData();
          }}
        />
      )}
      {ventasDiaOpen && (
        <RegistrarVentasDiaModal
          periodoInicio={periodo.inicio}
          periodoFin={periodo.fin}
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
    </ShellCond>
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
        .upsert(diarios, { onConflict: "tienda_id,fecha" });
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

export function RegistrarVentasDiaModal({
  personal,
  codigosAlternos,
  horarios,
  personaId,
  anio,
  mes,
  periodoInicio,
  periodoFin,
  onClose,
  onSaved,
}: {
  personal: Persona[];
  codigosAlternos: PersonalCodigoAlterno[];
  horarios: Horario[];
  personaId: string;
  anio: number;
  mes: number;
  periodoInicio: string;
  periodoFin: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Default fecha = hoy si cae dentro del periodo (mes retail), si no el primer día
  const hoyLocal = ymd(new Date());
  const defaultFecha = hoyLocal >= periodoInicio && hoyLocal <= periodoFin ? hoyLocal : periodoInicio;

  const [fecha, setFecha] = useState(defaultFecha);
  const [reading, setReading] = useState(false);
  const [pdfData, setPdfData] = useState<VentasPdfResponse | null>(null);
  const [filas, setFilas] = useState<FilaVenta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [avance, setAvance] = useState<{ hechas: number; total: number } | null>(null);
  // Las hojas del reporte se van sumando (una foto por hoja) y se leen juntas.
  const [archivos, setArchivos] = useState<File[]>([]);
  // Total de la tienda: lo leído, corregible a mano antes de guardar.
  const [totalTienda, setTotalTienda] = useState<number | null>(null);

  const diaDelMes = parseInt(fecha.split("-")[2] ?? "1", 10);
  // El informe puede traer la fecha día-mes o mes-día: se interpreta frente a la elegida.
  const fechaInforme = pdfData ? resolverFechaInforme(pdfData.fecha, fecha) : null;

  async function handleFiles(fs: File[]) {
    setError(null);
    setReading(true);
    setPdfData(null);
    setFilas([]);
    try {
      const res = await leerVentasPdf(fs, (hechas, total) => setAvance({ hechas, total }));
      setPdfData(res);
      setTotalTienda(res.totalVenta != null ? Math.round(res.totalVenta) : null);
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
        fecha,
      });
      setFilas(filasMatch);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReading(false);
      setAvance(null);
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
      if (totalTienda) {
        await supabase.from("presupuestos_diarios").upsert(
          {
            fecha,
            venta: totalTienda,
            registrado_por: personaId,
          },
          { onConflict: "tienda_id,fecha" },
        );
      }
      alert(
        `Guardado: ${result.insertados} filas insertadas${
          result.huerfanos > 0 ? `, ${result.huerfanos} huérfanas pendientes` : ""
        }.${
          result.fusionadas > 0
            ? ` ${result.fusionadas} fila(s) eran de una persona que ya tenía fila ese día y se sumaron en una sola.`
            : ""
        }`,
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
          Sube el PDF de <strong>&quot;Ventas rápidas por empleado&quot;</strong> o
          <strong> fotos</strong> del reporte (una por hoja: si tiene varias, ve sumándolas con
          &quot;Agregar otra foto&quot;; el PDF es lo más preciso). La IA lee los datos y los cruza con la planta.
          Antes de guardar revisa las cifras contra el reporte: <strong>puedes corregir
          cualquier valor</strong> tocándolo, y marca el motivo de quienes no vendieron.
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
          <div className="sm:col-span-2">
            <label className="block text-xs text-muted uppercase tracking-wider mb-1">
              PDF o fotos del reporte
            </label>
            <ArchivosParaLeer
              archivos={archivos}
              onCambio={setArchivos}
              onLeer={() => handleFiles(archivos)}
              leyendo={reading}
              avance={avance}
            />
          </div>
        </div>

        {reading && (
          <div className="text-center py-6 text-muted text-sm">
            📄 Leyendo el reporte con IA…{" "}
            {avance && avance.total > 1 ? `(${avance.hechas} de ${avance.total} partes)` : "(puede tardar unos segundos)"}
          </div>
        )}

        {error && (
          <div className="bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-sm mb-3">
            {error}
          </div>
        )}

        {pdfData && filas.length > 0 && (
          <>
            {/* Aviso de fechas: el informe puede venir día-mes o mes-día; solo se avisa si
                ninguna de las dos lecturas es la fecha elegida. */}
            {fechaInforme?.fecha && !fechaInforme.coincide && (
              <div className="bg-warn-soft border border-warn-border rounded-md p-3 mb-3">
                <div className="text-warn text-sm font-semibold mb-1">⚠ La fecha del informe no es la elegida</div>
                <div className="text-xs text-ink space-y-1">
                  <div>
                    En el informe dice: <strong className="font-mono">{pdfData.fechaTexto ?? pdfData.fecha}</strong>
                  </div>
                  <div>
                    Fecha elegida arriba: <strong className="font-mono">{fecha}</strong>. Al guardar, los datos quedan en esa fecha.
                  </div>
                  <button
                    type="button"
                    onClick={() => setFecha(fechaInforme.fecha!)}
                    className="mt-1 text-xs px-2 py-1 border border-warn text-warn bg-white rounded hover:bg-warn-soft/60"
                  >
                    Usar la fecha del informe ({fechaInforme.fecha})
                  </button>
                </div>
              </div>
            )}

            {/* Cuadre: la suma de los empleados debe ser cercana al total de la tienda */}
            {(() => {
              const suma = filas.reduce(
                (a, f) => a + (f.tipo === "matched" ? (f.ventaAsignada ?? 0) : f.tipo === "huerfano" ? (f.empleadoPdf?.venta ?? 0) : 0),
                0,
              );
              const total = totalTienda;
              if (!total || total <= 0) return null;
              const dif = Math.abs(suma - total) / total;
              if (dif <= 0.02) return null;
              return (
                <div className="bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs mb-3">
                  ⚠ La suma de las ventas por empleado ({fmtMoney(suma)}) no cuadra con el total de la
                  tienda ({fmtMoney(total)}); diferencia de {Math.round(dif * 100)}%. Puede haberse
                  leído mal una cifra o faltar una fila (con fotos es más probable). Corrige las cifras
                  abajo contra el reporte antes de guardar.
                </div>
              );
            })()}

            {/* Resumen */}
            <div className="bg-paper border border-line rounded-md p-3 mb-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div>
                  <div className="text-muted text-xs">Fecha del informe</div>
                  <div className="font-mono">
                    {fechaInforme?.fecha ?? "—"}
                    {fechaInforme && !fechaInforme.coincide && <span className="ml-1 text-warn text-[10px]">≠ elegida</span>}
                  </div>
                </div>
                <div>
                  <div className="text-muted text-xs">Total tienda</div>
                  <CifraEditable valor={totalTienda} leido={pdfData.totalVenta} onCambio={setTotalTienda} />
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
                            <td className="py-1.5 pr-2 text-right">
                              <CifraEditable
                                valor={f.articulosAsignados ?? null}
                                leido={f.empleadoPdf ? Math.round(f.empleadoPdf.articulos * (f.distribucionPct ?? 1)) : null}
                                sinPesos
                                onCambio={(v) => updateFila(realIdx, { articulosAsignados: v ?? 0 })}
                              />
                            </td>
                            <td className="py-1.5 pr-2 text-right">
                              <CifraEditable
                                valor={f.ventaAsignada ?? null}
                                leido={f.empleadoPdf ? f.empleadoPdf.venta * (f.distribucionPct ?? 1) : null}
                                onCambio={(v) => updateFila(realIdx, { ventaAsignada: v ?? 0, ...(v ? { motivo: null } : {}) })}
                              />
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
                            <td className="py-1.5 pr-2 text-right">
                              <CifraEditable
                                valor={f.empleadoPdf?.venta ?? null}
                                leido={f.empleadoPdf?.venta ?? null}
                                onCambio={(v) =>
                                  f.empleadoPdf && updateFila(realIdx, { empleadoPdf: { ...f.empleadoPdf, venta: v ?? 0 } })
                                }
                              />
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
                  automáticamente. Los que dejes sin motivo NO se guardan. Si en
                  el reporte sí aparece con venta (la IA se la saltó), escríbela
                  y pasa a &quot;Con venta&quot;.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-paper border-b border-line text-left">
                        <Th>Persona</Th>
                        <Th className="text-right">¿Vendió?</Th>
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
                            <td className="py-1.5 pr-2 text-right">
                              <CifraEditable
                                valor={null}
                                leido={null}
                                placeholder="venta"
                                onCambio={(v) => {
                                  if (v && v > 0) updateFila(realIdx, { tipo: "matched", ventaAsignada: v, articulosAsignados: 0, motivo: null });
                                }}
                              />
                            </td>
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

/**
 * Cifra que la IA leyó y la jefatura puede corregir: se escribe solo con
 * números (sin puntos) y se muestra con separador de miles. Si quedó distinta
 * de lo leído, se marca como corregida.
 */
function CifraEditable({
  valor,
  leido,
  onCambio,
  sinPesos = false,
  placeholder,
}: {
  valor: number | null;
  leido: number | null;
  onCambio: (v: number | null) => void;
  sinPesos?: boolean;
  placeholder?: string;
}) {
  const fmt = (n: number | null) => (n == null ? "" : Math.round(n).toLocaleString("es-CO"));
  const [texto, setTexto] = useState(fmt(valor));
  const [editando, setEditando] = useState(false);
  const mostrado = editando ? texto : fmt(valor);
  const corregido = valor != null && leido != null && Math.round(valor) !== Math.round(leido);
  return (
    <span className="inline-flex flex-col items-end">
      <span className="inline-flex items-center gap-0.5">
        {!sinPesos && <span className="text-muted">$</span>}
        <input
          type="text"
          inputMode="numeric"
          value={mostrado}
          placeholder={placeholder}
          onFocus={() => {
            setTexto(fmt(valor));
            setEditando(true);
          }}
          onChange={(e) => {
            const digitos = e.target.value.replace(/\D/g, "");
            setTexto(digitos ? Number(digitos).toLocaleString("es-CO") : "");
            onCambio(digitos ? Number(digitos) : null);
          }}
          onBlur={() => setEditando(false)}
          className={
            "font-mono text-right border rounded px-1.5 py-0.5 bg-white " +
            (sinPesos ? "w-14 " : "w-28 ") +
            (corregido ? "border-brand bg-brand/5" : "border-line")
          }
        />
      </span>
      {corregido && (
        <span className="text-[9.5px] text-brand" title={`La IA leyó ${fmt(leido)}`}>
          ✎ corregido (leído {fmt(leido)})
        </span>
      )}
    </span>
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

/**
 * Deja el total de tienda del día (presupuestos_diarios.venta) igual a la suma de
 * las ventas por asesor de esa fecha, para que no quede desfasado después de
 * corregir o eliminar un cierre. Si ya no queda venta, lo limpia.
 */
async function sincronizarTotalDia(fecha: string, registradoPor: string | null) {
  const { data } = await supabase.from("ventas_asesor_dia").select("venta").eq("fecha", fecha);
  const filas = (data as { venta: number | null }[] | null) ?? [];
  if (filas.length === 0) {
    await supabase.from("presupuestos_diarios").update({ venta: null }).eq("fecha", fecha);
    return;
  }
  const total = filas.reduce((a, r) => a + (r.venta ?? 0), 0);
  await supabase
    .from("presupuestos_diarios")
    .upsert({ fecha, venta: total, registrado_por: registradoPor }, { onConflict: "tienda_id,fecha" });
}

function EditarVentaModal({
  personaNombre,
  personaId,
  fecha,
  existente,
  registradoPor,
  onClose,
  onSaved,
}: {
  personaNombre: string;
  personaId: string;
  fecha: string;
  existente: VentaAsesorDia | null;
  registradoPor: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [venta, setVenta] = useState(String(existente?.venta ?? 0));
  const [articulos, setArticulos] = useState(String(existente?.articulos ?? 0));
  const [motivo, setMotivo] = useState<MotivoNoVenta | "">(existente?.motivo_no_venta ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ventaNum = Number(venta.replace(/[^0-9.-]/g, "")) || 0;

  async function guardar() {
    setError(null);
    if (ventaNum < 0) {
      setError("La venta no puede ser negativa.");
      return;
    }
    if (ventaNum === 0 && !motivo) {
      setError("Si la venta es 0, indica el motivo.");
      return;
    }
    setGuardando(true);
    const { error: err } = await supabase.from("ventas_asesor_dia").upsert(
      {
        persona_id: personaId,
        fecha,
        venta: ventaNum,
        articulos: Number(articulos) || 0,
        motivo_no_venta: ventaNum > 0 ? null : motivo || null,
        motivo_detalle: null,
        fuente: "manual",
        registrado_por: registradoPor,
      },
      { onConflict: "persona_id,fecha" },
    );
    if (err) {
      setGuardando(false);
      setError(err.message);
      return;
    }
    await sincronizarTotalDia(fecha, registradoPor);
    setGuardando(false);
    onSaved();
  }

  async function eliminar() {
    if (!confirm(`¿Eliminar el registro de ${personaNombre} del ${fecha}?`)) return;
    setGuardando(true);
    const { error: err } = await supabase
      .from("ventas_asesor_dia")
      .delete()
      .eq("persona_id", personaId)
      .eq("fecha", fecha);
    if (err) {
      setGuardando(false);
      setError(err.message);
      return;
    }
    await sincronizarTotalDia(fecha, registradoPor);
    setGuardando(false);
    onSaved();
  }

  return (
    <Modal titulo={`Corregir venta — ${personaNombre}`} onClose={onClose} ancho="max-w-md">
      <p className="text-[12.5px] text-muted mb-3">
        Fecha: <strong className="font-mono">{fecha}</strong>
        {existente ? " · valor actual: " + fmtMoney(existente.venta) : " · sin registro todavía"}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-[11px] text-muted uppercase tracking-wider">
          Venta ($)
          <input
            inputMode="decimal"
            value={venta}
            onChange={(e) => setVenta(e.target.value)}
            className={inputCls + " block w-full mt-1 font-mono"}
          />
        </label>
        <label className="text-[11px] text-muted uppercase tracking-wider">
          Artículos
          <input
            inputMode="numeric"
            value={articulos}
            onChange={(e) => setArticulos(e.target.value)}
            className={inputCls + " block w-full mt-1 font-mono"}
          />
        </label>
      </div>
      {ventaNum === 0 && (
        <label className="block mt-3 text-[11px] text-muted uppercase tracking-wider">
          Motivo por el que no vendió
          <select
            value={motivo}
            onChange={(e) => setMotivo(e.target.value as MotivoNoVenta | "")}
            className={inputCls + " block w-full mt-1"}
          >
            <option value="">— Elige —</option>
            {(Object.keys(MOTIVO_NO_VENTA_LABEL) as MotivoNoVenta[]).map((m) => (
              <option key={m} value={m}>
                {MOTIVO_NO_VENTA_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">
          {error}
        </div>
      )}
      <div className="flex gap-2 mt-4">
        <button
          type="button"
          onClick={guardar}
          disabled={guardando}
          className="flex-1 py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light"
        >
          {guardando ? "Guardando…" : "Guardar corrección"}
        </button>
        {existente && (
          <button
            type="button"
            onClick={eliminar}
            disabled={guardando}
            className="px-3 py-2.5 border border-warn text-warn rounded-md text-sm font-semibold hover:bg-warn-soft disabled:opacity-50"
          >
            Eliminar
          </button>
        )}
      </div>
    </Modal>
  );
}
