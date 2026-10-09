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
  ymd,
  type MesRetail,
} from "@/lib/mes-retail";
import { cargarEstadoCierres } from "@/lib/cierres-faltantes";
import { cargarCalificaciones, cargarTareaCalificacion, type TareaCalificacion } from "@/lib/calificaciones";
import {
  RANKING_CONFIG_DEFAULT,
  avanceAl,
  calcularRachas,
  calcularRanking,
  compiteEnRanking,
  type AvanceMes,
  type CalificacionVendedor,
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
  type ResumenVentas,
} from "@/lib/ranking";
import { RankingView } from "@/components/ranking/RankingView";
import { KpisView } from "@/components/ranking/KpisView";
import {
  MagiaView,
  pendientesMagia,
  totalPendientesMagia,
  type AvisoMagia,
} from "@/components/ranking/MagiaView";
import { MAGIA_INICIO, mesesAnterioresMagia, ventanaMagia, type VentanaMagia } from "@/lib/magia";
import { MaximizadorView } from "@/components/ranking/MaximizadorView";
import { ResultadosPeriodo } from "@/components/ranking/ResultadosPeriodo";
import { MiRankingView } from "@/components/ranking/MiRankingView";
import { CarreraTrimestre } from "@/components/ranking/CarreraTrimestre";
import { BonosView } from "@/components/ranking/BonosView";
import { HistorialView } from "@/components/ranking/HistorialView";
import { ResumenPeriodo } from "@/components/ranking/ResumenPeriodo";
import { CargarDatos } from "@/components/ranking/cargar/CargarDatos";
import { PresupuestosPanel } from "@/components/PresupuestosPanel";
import { MiPresupuestoPanel } from "@/components/MiPresupuestoPanel";
import { ConfigRankingView } from "@/components/ranking/ConfigRankingView";
import { inputCls } from "@/components/ranking/ui";

// Pestañas principales (5, o 4 para los asesores) y sub-vistas dentro de cada una.
type Pestana = "resumen" | "ranking" | "ventas" | "evaluaciones" | "cargar";
type SubRanking = "mes" | "mi" | "semana" | "trimestre" | "historial" | "detalle";
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
  const [historial, setHistorial] = useState<HistorialRanking[]>([]);
  const [extras, setExtras] = useState<PuntoExtra[]>([]);
  const [mesInfo, setMesInfo] = useState<MesRetail | null>(null);
  const [ventasVivas, setVentasVivas] = useState<ResumenVentas[]>([]);
  const [avanceMes, setAvanceMes] = useState<AvanceMes | null>(null);
  // Meta de la tienda sumando los días hasta HOY incluido (Huber, 6-oct-2026).
  const [metaHastaHoy, setMetaHastaHoy] = useState<number | null>(null);
  const [cierresFaltan, setCierresFaltan] = useState<string[]>([]);
  // Calificaciones manuales del mes (Puntualidad, Trabajo en equipo, Iniciativa) y la meta de cada día
  // (para medir las unidades a la fecha de corte de la consolidada).
  const [calificaciones, setCalificaciones] = useState<CalificacionVendedor[]>([]);
  const [metasDia, setMetasDia] = useState<{ fecha: string; meta: number | null }[]>([]);
  const [tareaCalificar, setTareaCalificar] = useState<TareaCalificacion | null>(null);
  const tienda = useTienda();
  const [error, setError] = useState<string | null>(null);

  // Si hoy cae dentro de un mes retail cargado, se abre ese mes (no el calendario). Desde la tarea
  // "Calificar al mejor vendedor" (?calificar=1) se abre en Evaluaciones → Bonos, en el mes a calificar.
  useEffect(() => {
    const calificar = new URLSearchParams(window.location.search).has("calificar");
    if (calificar) {
      cargarTareaCalificacion().then((t) => {
        setPestana("evaluaciones");
        setSubEval("bonos");
        if (t) {
          setAnio(t.anio);
          setMes(t.mes);
        }
      });
      return;
    }
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
    const [rRes, kRes, cRes, mRes, xRes, fRes, eRes, iRes, gRes, hRes, pRes] = await Promise.all([
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
      supabase.from("ranking_historial").select("*"),
      supabase.from("puntos_extra").select("*").eq("anio", anio).eq("mes", mes).order("created_at", { ascending: false }),
    ]);
    const primero = [rRes, kRes, mRes, xRes, fRes, eRes, iRes, gRes, hRes, pRes].find((r) => r.error);
    if (primero?.error) setError(primero.error.message);
    setRoster((rRes.data as PersonaRk[] | null) ?? []);
    setKpis((kRes.data as KpiMensual[] | null) ?? []);
    if (cRes.data) setConfig({ ...RANKING_CONFIG_DEFAULT, ...(cRes.data as RankingConfig) });
    // VENTA ACUMULADA = SOLO los cierres del día (Huber, 8-oct-2026). Las ventas consolidadas ya no
    // aportan pesos: solo las unidades por categoría (pares, accesorios, ropa). Si falta un cierre, la
    // venta queda incompleta y Cargar datos / el resumen avisan qué días faltan.
    const [cals, mdRes, tarea] = await Promise.all([
      cargarCalificaciones(anio, mes),
      supabase.from("presupuestos_diarios").select("fecha, meta").gte("fecha", desde).lte("fecha", hasta),
      cargarTareaCalificacion(),
    ]);
    setCalificaciones(cals);
    setMetasDia((mdRes.data as { fecha: string; meta: number | null }[] | null) ?? []);
    setTareaCalificar(tarea);
    const [vRes, aRes, hoyRes, ec] = await Promise.all([
      supabase.rpc("ranking_ventas", { p_desde: desde, p_hasta: hasta }),
      supabase.rpc("ranking_avance", { p_desde: desde, p_hasta: hasta }),
      // Con corte = hoy, la meta suma hasta hoy (o hasta el último cierre si fuera posterior).
      supabase.rpc("ranking_avance", { p_desde: desde, p_hasta: hasta, p_corte: ymd(new Date()) }),
      cargarEstadoCierres(mr),
    ]);
    if (vRes.error) setError(vRes.error.message);
    if (aRes.error) setError(aRes.error.message);
    setVentasVivas(
      ((vRes.data as ResumenVentas[] | null) ?? []).map((x) => ({ ...x, venta: Number(x.venta), articulos: Number(x.articulos) })),
    );
    setCierresFaltan(ec.faltan);
    const av = (aRes.data as AvanceMes[] | null)?.[0] ?? null;
    setAvanceMes(av);
    const hoyAv = (hoyRes.data as AvanceMes[] | null)?.[0] ?? null;
    setMetaHastaHoy(hoyAv ? Number(hoyAv.meta_a_cierre) : null);

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
  // Unidades: se miden contra la meta que debía llevarse a la fecha de corte de la consolidada.
  const corteUnidades = kpis.reduce<string | null>((m, k) => (k.corte_ventas && (!m || k.corte_ventas > m) ? k.corte_ventas : m), null);
  const avanceUnidades = avanceAl(metasDia, corteUnidades);
  const vendeRopa = tienda.vende_ropa !== false;
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
        avanceUnidades,
        vendeRopa,
        calificaciones,
        config,
      }),
    [compiten, kpis, resMagia, resMax, resFaltas, extras, historial, anio, mes, avance, avanceUnidades, vendeRopa, calificaciones, ventasVivas, config],
  );
  const fotos = useFotos(roster);

  // Recordatorio de Magia: la evaluación de cada mes se hace del 1 al 5 de ese
  // mes. Se consulta aparte quién tiene ya la del mes en curso y la de los
  // meses anteriores (pueden no ser el mes que se está mirando). Solo jefatura.
  const [ventanaHoy] = useState<VentanaMagia>(() => ventanaMagia(new Date()));
  const [mesesPrevios] = useState(() => mesesAnterioresMagia(new Date()));
  const [magiaHechas, setMagiaHechas] = useState<{ persona_id: string; anio: number; mes: number }[] | null>(null);
  useEffect(() => {
    if (!esJefatura || ventanaHoy.estado === "sin_aviso") return;
    let vivo = true;
    supabase
      .from("magia_evaluaciones")
      .select("persona_id, anio, mes")
      .gte("anio", MAGIA_INICIO.anio)
      .then(({ data }) => {
        if (vivo) setMagiaHechas((data as { persona_id: string; anio: number; mes: number }[] | null) ?? []);
      });
    return () => {
      vivo = false;
    };
    // `evals` cambia al guardar o borrar una evaluación: se vuelve a contar.
  }, [esJefatura, ventanaHoy, evals]);
  const avisoMagia: AvisoMagia | null = (() => {
    if (!esJefatura || !magiaHechas || compiten.length === 0 || ventanaHoy.estado === "sin_aviso") return null;
    const faltanEn = (a: number, m: number) =>
      pendientesMagia(
        compiten,
        magiaHechas.filter((x) => x.anio === a && x.mes === m).map((x) => x.persona_id),
      );
    return {
      ventana: ventanaHoy,
      pendientes: faltanEn(ventanaHoy.anio, ventanaHoy.mes),
      atrasados: mesesPrevios.map((m) => ({ ...m, pendientes: faltanEn(m.anio, m.mes) })),
    };
  })();

  if (loading || !persona) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted text-sm">
        Cargando…
      </div>
    );
  }

  const magiaPendientes = totalPendientesMagia(avisoMagia);

  // El asesor no ve la tabla completa del mes ni el detalle de KPIs de todos: abre en "Mi ranking".
  const subVista: SubRanking = !esJefatura && (subRanking === "mes" || subRanking === "detalle") ? "mi" : subRanking;

  const pestanas: { id: Pestana; label: string; visible: boolean; aviso?: number }[] = [
    { id: "resumen", label: "Resumen", visible: true },
    { id: "ranking", label: "Ranking", visible: true },
    { id: "ventas", label: esJefatura ? "Ventas y metas" : "Mi presupuesto", visible: true },
    { id: "evaluaciones", label: "Evaluaciones", visible: true, aviso: magiaPendientes + (esJefatura && tareaCalificar ? 1 : 0) },
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

        {/* En una sola fila (se desliza en el celular) para que el podio quepa sin bajar. */}
        <div className="flex gap-1.5 mb-4 border-b border-line overflow-x-auto overflow-y-hidden whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                {!!p.aviso && (
                  <span
                    className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-warn text-white text-[10.5px] font-bold align-middle"
                    title={
                      p.id === "evaluaciones" && esJefatura && tareaCalificar
                        ? `Pendientes: ${magiaPendientes} evaluación(es) Magia y la calificación del mejor vendedor`
                        : `Evaluación Magia: faltan ${p.aviso} evaluaciones por hacer`
                    }
                  >
                    {p.aviso}
                  </span>
                )}
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
            {/* El podio va primero: es lo que se ve al abrir, sin bajar. Las cifras van debajo. */}
            <RankingView
              {...rankingProps}
              secciones={{ tiles: false, premios: false, podio: true, lista: false }}
            />
            <ResumenPeriodo
              cierresFaltan={cierresFaltan}
              avanceMes={avanceMes}
              metaHastaHoy={metaHastaHoy}
              mesInfo={mesInfo}
              kpis={kpis}
              roster={roster}
              config={config}
              esJefatura={!!esJefatura}
              onCargar={() => setPestana("cargar")}
            />
            <RankingView
              {...rankingProps}
              secciones={{ tiles: false, premios: true, podio: false, lista: false }}
            />
          </div>
        )}

        {pestana === "ranking" && (
          <>
            <Segmentos
              valor={subVista}
              onChange={setSubRanking}
              opciones={
                esJefatura
                  ? [
                      { id: "mes", label: "Del mes" },
                      { id: "mi", label: "Tarjeta por persona" },
                      { id: "semana", label: "Día / semana / mes" },
                      { id: "trimestre", label: "Trimestre" },
                      { id: "historial", label: "Meses anteriores" },
                      { id: "detalle", label: "Detalle de KPIs" },
                    ]
                  : [
                      { id: "mi", label: "Mi ranking" },
                      { id: "semana", label: "Día / semana / mes" },
                      { id: "trimestre", label: "Trimestre" },
                      { id: "historial", label: "Meses anteriores" },
                    ]
              }
            />
            {subVista === "mi" && (
              <MiRankingView
                filas={filas}
                personaId={persona.id}
                personas={compiten}
                historial={historial}
                evals={evals}
                config={config}
                vendeRopa={vendeRopa}
                fotos={fotos}
                anio={anio}
                mes={mes}
                esJefatura={!!esJefatura}
              />
            )}
            {subVista === "trimestre" && (
              <CarreraTrimestre historial={historial} filas={filas} anio={anio} mes={mes} fotos={fotos} esJefatura={!!esJefatura} miId={persona.id} />
            )}
            {subVista === "mes" && (
              <RankingView
                {...rankingProps}
                secciones={{ tiles: false, premios: false, podio: false, lista: true }}
              />
            )}
            {subVista === "semana" && (
              <ResultadosPeriodo
                anio={anio}
                mes={mes}
                mesInfo={mesInfo}
                inicioMes={construirPeriodo(anio, mes, mesInfo).inicio}
                finMes={construirPeriodo(anio, mes, mesInfo).fin}
                personas={compiten}
                kpis={kpis}
                metasDia={metasDia}
                config={config}
                vendeRopa={vendeRopa}
                fotos={fotos}
                ultimoCierre={avanceMes?.ultimo_cierre ?? null}
                soloPersonaId={esJefatura ? null : persona.id}
              />
            )}
            {subVista === "historial" && (
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
            {subVista === "detalle" && (
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
            <div className="space-y-5">
              {/* El detalle por persona vive aquí; Cargar datos solo carga. */}
              <KpisView
                kpis={kpis}
                roster={roster}
                anio={anio}
                mes={mes}
                esJefatura
                cuadro
                subidoPor={persona.id}
                mesInfo={mesInfo}
                ventasVivas={ventasVivas}
                avanceMes={avanceMes}
                avance={avance}
                onGuardado={cargar}
              />
              <PresupuestosPanel embedded anio={anio} mes={mes} />
            </div>
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
                { id: "bonos", label: esJefatura && tareaCalificar ? "Bonos y calificaciones ●" : "Bonos y calificaciones" },
              ]}
            />
            {subEval === "magia" && (
              <MagiaView
                personas={compiten}
                roster={roster}
                evals={evals}
                anio={anio}
                mes={mes}
                esJefatura={!!esJefatura}
                evaluadorId={persona.id}
                miId={persona.id}
                puedeEliminarTodas={persona.rol_jerarquico === "jefe_tienda" || !!persona.es_admin}
                aviso={avisoMagia}
                onIrAMes={(a, m) => {
                  setAnio(a);
                  setMes(m);
                }}
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
                roster={roster}
                esJefeTienda={persona.rol_jerarquico === "jefe_tienda" || persona.encargo?.cargo === "jefe_tienda" || !!persona.es_admin}
                filas={filas}
                calificaciones={calificaciones}
                faltas={resFaltas}
                tarea={tareaCalificar}
                onGuardado={cargar}
              />
            )}
          </>
        )}

        {pestana === "cargar" && esJefatura && (
          <div className="space-y-5">
            <CargarDatos anio={anio} mes={mes} mesInfo={mesInfo} subidoPor={persona.id} onGuardado={cargar} />
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
