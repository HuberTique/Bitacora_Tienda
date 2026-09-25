"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { NOMBRES_MES } from "@/lib/horarios";
import { useFotos } from "@/lib/fotos";
import { useTienda } from "@/lib/tienda-config";
import {
  cargarMesRetail,
  construirPeriodo,
  mesRetailDeHoy,
  parseYmd,
  ymd,
  type MesRetail,
} from "@/lib/mes-retail";
import {
  RANKING_CONFIG_DEFAULT,
  calcularRachas,
  calcularRanking,
  compiteEnRanking,
  type AvanceMes,
  type HistorialRanking,
  type KpiMensual,
  type MagiaEvaluacion,
  type MaximizadorItem,
  type MaximizadorRegistro,
  type PersonaRk,
  type PuntoExtra,
  type RankingConfig,
  type ResumenFaltas,
  type ResumenMagia,
  type ResumenMaximizador,
  type ResumenSemanal,
  type ResumenVentas,
} from "@/lib/ranking";
import { RankingView } from "@/components/ranking/RankingView";
import { KpisView } from "@/components/ranking/KpisView";
import { MagiaView } from "@/components/ranking/MagiaView";
import { MaximizadorView } from "@/components/ranking/MaximizadorView";
import { SemanalView } from "@/components/ranking/SemanalView";
import { BonosView } from "@/components/ranking/BonosView";
import { HistorialView } from "@/components/ranking/HistorialView";
import { ResumenPeriodo } from "@/components/ranking/ResumenPeriodo";
import { ConsolidadasCard } from "@/components/ranking/ConsolidadasCard";
import { PresupuestosPanel } from "@/components/PresupuestosPanel";
import { MiPresupuestoPanel } from "@/components/MiPresupuestoPanel";
import { ConfigRankingView } from "@/components/ranking/ConfigRankingView";
import { inputCls } from "@/components/ranking/ui";

// Pestañas principales (5, o 4 para los asesores) y sub-vistas dentro de cada una.
type Pestana = "resumen" | "ranking" | "ventas" | "evaluaciones" | "cargar";
type SubRanking = "mes" | "semana" | "historial" | "detalle";
type SubEval = "magia" | "maximizador" | "bonos";

function Segmentos<T extends string>({
  valor,
  opciones,
  onChange,
}: {
  valor: T;
  opciones: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-line overflow-hidden text-[13px] mb-4 bg-white">
      {opciones.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={
            "px-3.5 py-1.5 font-semibold transition-colors " +
            (valor === o.id ? "bg-brand text-white" : "text-muted hover:bg-paper")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function RankingPage() {
  const router = useRouter();
  const { loading, session, persona } = useSession();
  const esJefatura = persona?.rol === "jefatura";

  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [pestana, setPestana] = useState<Pestana>("resumen");
  const [subRanking, setSubRanking] = useState<SubRanking>("mes");
  const [subEval, setSubEval] = useState<SubEval>("magia");

  const [roster, setRoster] = useState<PersonaRk[]>([]);
  const [kpis, setKpis] = useState<KpiMensual[]>([]);
  const [config, setConfig] = useState<RankingConfig>(RANKING_CONFIG_DEFAULT);
  const [resMagia, setResMagia] = useState<ResumenMagia[]>([]);
  const [resMax, setResMax] = useState<ResumenMaximizador[]>([]);
  const [resFaltas, setResFaltas] = useState<ResumenFaltas[]>([]);
  const [evals, setEvals] = useState<MagiaEvaluacion[]>([]);
  const [items, setItems] = useState<MaximizadorItem[]>([]);
  const [registros, setRegistros] = useState<MaximizadorRegistro[]>([]);
  const [semanal, setSemanal] = useState<ResumenSemanal[]>([]);
  const [historial, setHistorial] = useState<HistorialRanking[]>([]);
  const [extras, setExtras] = useState<PuntoExtra[]>([]);
  const [mesInfo, setMesInfo] = useState<MesRetail | null>(null);
  const [ventasVivas, setVentasVivas] = useState<ResumenVentas[]>([]);
  const [avanceMes, setAvanceMes] = useState<AvanceMes | null>(null);
  const [ventaTienda, setVentaTienda] = useState<number | null>(null);
  const tienda = useTienda();
  const [error, setError] = useState<string | null>(null);

  // Si hoy cae dentro de un mes retail cargado, se abre ese mes (no el calendario).
  useEffect(() => {
    mesRetailDeHoy().then((x) => {
      if (x) {
        setAnio(x.anio);
        setMes(x.mes);
      }
    });
  }, []);

  const cargar = useCallback(async () => {
    setError(null);
    // El "mes" es el mes retail de la compañía (p. ej. 30-ago a 3-oct) si está cargado.
    const mr = await cargarMesRetail(anio, mes);
    setMesInfo(mr);
    const per = construirPeriodo(anio, mes, mr);
    const desde = per.inicio;
    const hasta = per.fin;
    const [rRes, kRes, cRes, mRes, xRes, fRes, eRes, iRes, gRes, sRes, hRes, pRes] = await Promise.all([
      supabase.rpc("roster_publico"),
      supabase.from("kpis_mensuales").select("*").eq("anio", anio).eq("mes", mes),
      supabase.from("ranking_config").select("*").maybeSingle(),
      supabase.rpc("ranking_magia", { p_anio: anio, p_mes: mes }),
      // Por rango de fechas del mes retail; si la migración 0020 aún no está aplicada, por mes calendario.
      supabase.rpc("ranking_maximizador", { p_desde: desde, p_hasta: hasta }).then((res) =>
        res.error ? supabase.rpc("ranking_maximizador", { p_anio: anio, p_mes: mes }) : res,
      ),
      supabase.rpc("ranking_faltas", { p_desde: desde, p_hasta: hasta }).then((res) =>
        res.error ? supabase.rpc("ranking_faltas", { p_anio: anio, p_mes: mes }) : res,
      ),
      supabase.from("magia_evaluaciones").select("*").eq("anio", anio).eq("mes", mes),
      supabase.from("maximizador_items").select("*").order("posicion"),
      supabase
        .from("maximizador_registros")
        .select("*")
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .order("fecha", { ascending: false }),
      supabase.rpc("ranking_semanal", { p_anio: anio, p_mes: mes }),
      supabase.from("ranking_historial").select("*"),
      supabase.from("puntos_extra").select("*").eq("anio", anio).eq("mes", mes).order("created_at", { ascending: false }),
    ]);
    const primero = [rRes, kRes, mRes, xRes, fRes, eRes, iRes, gRes, sRes, hRes, pRes].find((r) => r.error);
    if (primero?.error) setError(primero.error.message);
    setRoster((rRes.data as PersonaRk[] | null) ?? []);
    setKpis((kRes.data as KpiMensual[] | null) ?? []);
    if (cRes.data) setConfig({ ...RANKING_CONFIG_DEFAULT, ...(cRes.data as RankingConfig) });
    // VENTA ACUMULADA = ventas consolidadas (PDF, hasta su fecha de corte) + los cierres del día que se
    // hayan cargado DESPUÉS de esa fecha. Sin consolidadas, todo sale de los cierres del día.
    const kpisBase = (kRes.data as KpiMensual[] | null) ?? [];
    const corteBase = kpisBase.reduce<string | null>(
      (m, k) => (k.corte_ventas && (!m || k.corte_ventas > m) ? k.corte_ventas : m),
      null,
    );
    let desdeExtra = desde;
    if (corteBase) {
      const d = parseYmd(corteBase);
      d.setDate(d.getDate() + 1);
      desdeExtra = ymd(d);
    }
    const [vRes, aRes] = await Promise.all([
      desdeExtra <= hasta
        ? supabase.rpc("ranking_ventas", { p_desde: desdeExtra, p_hasta: hasta })
        : Promise.resolve({ data: [] as ResumenVentas[], error: null }),
      // Con la migración 0023 admite la fecha de corte de las ventas consolidadas; sin ella, solo los cierres.
      supabase.rpc("ranking_avance", { p_desde: desde, p_hasta: hasta, p_corte: corteBase }).then((res) =>
        res.error ? supabase.rpc("ranking_avance", { p_desde: desde, p_hasta: hasta }) : res,
      ),
    ]);
    if (vRes.error) setError(vRes.error.message);
    if (aRes.error) setError(aRes.error.message);
    const extra = (vRes.data as ResumenVentas[] | null) ?? [];
    const acum = new Map<string, ResumenVentas>();
    if (corteBase) {
      for (const k of kpisBase) {
        if (k.acumulado_neto == null) continue;
        acum.set(k.persona_id, {
          persona_id: k.persona_id,
          venta: Number(k.acumulado_neto),
          articulos: Number(k.unidades ?? 0),
          dias: 0,
          ultimo_dia: corteBase,
        });
      }
    }
    for (const x of extra) {
      const p = acum.get(x.persona_id);
      if (p) {
        p.venta += Number(x.venta);
        p.articulos += Number(x.articulos);
        p.dias += x.dias;
        p.ultimo_dia = x.ultimo_dia ?? p.ultimo_dia;
      } else {
        acum.set(x.persona_id, { ...x, venta: Number(x.venta), articulos: Number(x.articulos) });
      }
    }
    setVentasVivas([...acum.values()]);
    // Venta de TODA la tienda (incluye a quienes auditan): el total del reporte + los cierres posteriores;
    // sin reporte consolidado, la suma de los cierres del día.
    const extraTotal = extra.reduce((a, x) => a + Number(x.venta), 0);
    setVentaTienda(
      corteBase
        ? (mr?.ventas_total ?? kpisBase.reduce((a, k) => a + Number(k.acumulado_neto ?? 0), 0)) + extraTotal
        : null,
    );
    const av = (aRes.data as AvanceMes[] | null)?.[0] ?? null;
    setAvanceMes(av);

    // Ranking semanal: la meta de cada persona es su presupuesto del mes repartido según la meta de la
    // semana, y la venta sale de los cierres del día de esa semana.
    const kpisData = (kRes.data as KpiMensual[] | null) ?? [];
    let derivado: ResumenSemanal[] | null = null;
    if (mr && mr.semanas.length > 0 && mr.presupuesto && kpisData.length > 0) {
      const rangos = await Promise.all(
        mr.semanas.map((sm) => supabase.rpc("ranking_ventas", { p_desde: sm.inicio, p_hasta: sm.fin })),
      );
      const acum: ResumenSemanal[] = [];
      mr.semanas.forEach((sm, i) => {
        const ventasSem = (rangos[i].data as ResumenVentas[] | null) ?? [];
        if (ventasSem.length === 0) return; // semana sin cierres cargados
        const parte = sm.target ? sm.target / mr.presupuesto! : 0;
        // Semana en curso: solo cuenta la parte ya transcurrida hasta el último cierre.
        const ultimo = av?.ultimo_cierre;
        const enCurso = !!ultimo && ultimo >= sm.inicio && ultimo < sm.fin;
        const diasSem = 7;
        const diasCerrados = enCurso
          ? Math.round((new Date(ultimo! + "T00:00:00").getTime() - new Date(sm.inicio + "T00:00:00").getTime()) / 86400000) + 1
          : diasSem;
        for (const k of kpisData) {
          if (!k.presupuesto) continue;
          const meta = k.presupuesto * parte * (diasCerrados / diasSem);
          const venta = Number(ventasSem.find((v) => v.persona_id === k.persona_id)?.venta ?? 0);
          acum.push({
            persona_id: k.persona_id,
            semana_label: `Semana ${sm.numero}`,
            meta,
            venta,
            cumplimiento: meta > 0 ? venta / meta : null,
          });
        }
      });
      derivado = acum;
    }
    setSemanal(derivado ?? ((sRes.data as ResumenSemanal[] | null) ?? []));
    setHistorial((hRes.data as HistorialRanking[] | null) ?? []);
    setExtras((pRes.data as PuntoExtra[] | null) ?? []);
    setResMagia((mRes.data as ResumenMagia[] | null) ?? []);
    setResMax((xRes.data as ResumenMaximizador[] | null) ?? []);
    setResFaltas((fRes.data as ResumenFaltas[] | null) ?? []);
    setEvals((eRes.data as MagiaEvaluacion[] | null) ?? []);
    setItems((iRes.data as MaximizadorItem[] | null) ?? []);
    setRegistros((gRes.data as MaximizadorRegistro[] | null) ?? []);
  }, [anio, mes]);

  useEffect(() => {
    if (loading) return;
    if (!session) return router.replace("/login");
    if (persona) cargar();
  }, [loading, session, persona, router, cargar]);

  const compiten = useMemo(() => roster.filter(compiteEnRanking), [roster]);
  // Fracción del presupuesto que ya debía llevarse al último cierre cargado. Si el planeador no trae
  // metas por día, se aproxima con los días cerrados sobre los días del mes.
  const totalDias = construirPeriodo(anio, mes, mesInfo).fechas.length;
  const avance =
    avanceMes?.ultimo_cierre && avanceMes.meta_total > 0
      ? Math.min(1, avanceMes.meta_a_cierre / avanceMes.meta_total)
      : avanceMes?.dias_cerrados && totalDias > 0
        ? Math.min(1, avanceMes.dias_cerrados / totalDias)
        : null;
  const filas = useMemo(
    () =>
      calcularRanking({
        personas: compiten,
        kpis,
        magia: resMagia,
        maximizador: resMax,
        faltas: resFaltas,
        extras,
        rachas: calcularRachas(historial, anio, mes),
        ventas: ventasVivas,
        avance,
        config,
      }),
    [compiten, kpis, resMagia, resMax, resFaltas, extras, historial, anio, mes, avance, ventasVivas, config],
  );
  const fotos = useFotos(roster);

  if (loading || !persona) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted text-sm">
        Cargando…
      </div>
    );
  }

  const pestanas: { id: Pestana; label: string; visible: boolean }[] = [
    { id: "resumen", label: "Resumen", visible: true },
    { id: "ranking", label: "Ranking", visible: true },
    { id: "ventas", label: esJefatura ? "Ventas y metas" : "Mi presupuesto", visible: true },
    { id: "evaluaciones", label: "Evaluaciones", visible: true },
    { id: "cargar", label: "Cargar datos", visible: !!esJefatura },
  ];

  const periodoTxt = mesInfo ? `${mesInfo.inicio} → ${mesInfo.fin}` : "mes calendario";
  const periodo = `${NOMBRES_MES[mes - 1]} ${anio}`;
  const rankingProps = {
    filas,
    kpisTodos: kpis,
    config,
    fotos,
    esJefatura: !!esJefatura,
    onFotoCambio: cargar,
    tienda: tienda.nombre,
    periodo,
  };

  return (
    <AppShell persona={persona}>
      <div className="mx-auto max-w-[1100px] px-4 sm:px-6 py-7 w-full">
        <div className="flex justify-between items-start flex-wrap gap-3 mb-4">
          <div>
            <h2 className="text-[22px] font-display font-bold m-0">Presupuesto y ranking</h2>
            <p className="text-muted text-[13px]">
              {periodo} · {periodoTxt}
            </p>
          </div>
          <div className="flex gap-2">
            <select
              value={mes}
              onChange={(e) => setMes(parseInt(e.target.value, 10))}
              className={inputCls}
              aria-label="Mes"
            >
              {NOMBRES_MES.map((n, i) => (
                <option key={n} value={i + 1}>
                  {n}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={anio}
              onChange={(e) => setAnio(parseInt(e.target.value, 10) || anio)}
              className={inputCls + " w-24"}
              aria-label="Año"
            />
          </div>
        </div>

        <div className="flex gap-1.5 flex-wrap mb-5 border-b border-line">
          {pestanas
            .filter((p) => p.visible)
            .map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPestana(p.id)}
                className={
                  "px-4 py-2.5 text-[14px] font-semibold border-b-[3px] -mb-px transition-colors " +
                  (pestana === p.id
                    ? "border-brand text-brand"
                    : "border-transparent text-muted hover:text-ink")
                }
              >
                {p.label}
              </button>
            ))}
        </div>

        {error && (
          <div className="bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-sm mb-4">
            {error}
          </div>
        )}

        {pestana === "resumen" && (
          <div className="space-y-4">
            <ResumenPeriodo
              ventaTienda={ventaTienda}
              avanceMes={avanceMes}
              mesInfo={mesInfo}
              kpis={kpis}
              roster={roster}
              config={config}
              esJefatura={!!esJefatura}
              onCargar={() => setPestana("cargar")}
            />
            <RankingView
              {...rankingProps}
              secciones={{ tiles: false, premios: true, podio: true, lista: false }}
            />
          </div>
        )}

        {pestana === "ranking" && (
          <>
            <Segmentos
              valor={subRanking}
              onChange={setSubRanking}
              opciones={[
                { id: "mes", label: "Del mes" },
                { id: "semana", label: "Por semana" },
                { id: "historial", label: "Meses anteriores" },
                { id: "detalle", label: "Detalle de KPIs" },
              ]}
            />
            {subRanking === "mes" && (
              <RankingView
                {...rankingProps}
                secciones={{ tiles: false, premios: false, podio: false, lista: true }}
              />
            )}
            {subRanking === "semana" && (
              <SemanalView personas={roster} semanal={semanal} fotos={fotos} />
            )}
            {subRanking === "historial" && (
              <HistorialView
                historial={historial}
                filasActuales={filas}
                anio={anio}
                mes={mes}
                fotos={fotos}
                esJefatura={!!esJefatura}
                onGuardado={cargar}
              />
            )}
            {subRanking === "detalle" && (
              <KpisView
                kpis={kpis}
                roster={roster}
                anio={anio}
                mes={mes}
                esJefatura={false}
                subidoPor={persona.id}
                mesInfo={mesInfo}
                ventasVivas={ventasVivas}
                avanceMes={avanceMes}
                avance={avance}
                onGuardado={cargar}
              />
            )}
          </>
        )}

        {pestana === "ventas" &&
          (esJefatura ? (
            <PresupuestosPanel embedded anio={anio} mes={mes} />
          ) : (
            <MiPresupuestoPanel embedded anio={anio} mes={mes} />
          ))}

        {pestana === "evaluaciones" && (
          <>
            <Segmentos
              valor={subEval}
              onChange={setSubEval}
              opciones={[
                { id: "magia", label: "Magia con una sonrisa" },
                { id: "maximizador", label: "Maximizador" },
                { id: "bonos", label: "Bonos" },
              ]}
            />
            {subEval === "magia" && (
              <MagiaView
                personas={compiten}
                evals={evals}
                anio={anio}
                mes={mes}
                esJefatura={!!esJefatura}
                evaluadorId={persona.id}
                miId={persona.id}
                onGuardado={cargar}
              />
            )}
            {subEval === "maximizador" && (
              <MaximizadorView
                personas={roster}
                items={items}
                registros={registros}
                anio={anio}
                mes={mes}
                esJefatura={!!esJefatura}
                evaluadorId={persona.id}
                onGuardado={cargar}
              />
            )}
            {subEval === "bonos" && (
              <BonosView
                personas={compiten}
                extras={extras}
                config={config}
                anio={anio}
                mes={mes}
                esJefatura={!!esJefatura}
                registradoPor={persona.id}
                onGuardado={cargar}
              />
            )}
          </>
        )}

        {pestana === "cargar" && esJefatura && (
          <div className="space-y-5">
            <ConsolidadasCard
              anio={anio}
              mes={mes}
              mesInfo={mesInfo}
              subidoPor={persona.id}
              onGuardado={cargar}
            />
            <KpisView
              kpis={kpis}
              roster={roster}
              anio={anio}
              mes={mes}
              esJefatura
              subidoPor={persona.id}
              mesInfo={mesInfo}
              ventasVivas={ventasVivas}
              avanceMes={avanceMes}
              avance={avance}
              onGuardado={cargar}
            />
            <details className="bg-panel border border-line rounded-[10px] p-4">
              <summary className="cursor-pointer text-sm font-semibold select-none">
                Configuración del ranking (pesos y bonos)
              </summary>
              <div className="mt-3">
                <ConfigRankingView config={config} onGuardado={cargar} />
              </div>
            </details>
          </div>
        )}
      </div>
    </AppShell>
  );
}
