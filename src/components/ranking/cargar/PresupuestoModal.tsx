"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { NOMBRES_MES } from "@/lib/horarios";
import { fmtMoney, type RolJerarquico } from "@/lib/types";
import { diasEntre, type MesRetail } from "@/lib/mes-retail";
import { useTienda } from "@/lib/tienda-config";
import { fechasPropuestas, horasTrabajadas, metasDiarias, semanasRetail, variacion } from "@/lib/presupuesto-manual";
import { repartir, type Factores } from "@/lib/reparto";
import type { TargetParsed } from "@/lib/planeador-excel";
import type { KpisMensualParsed } from "@/lib/kpis-mensual-excel";
import type { PreciosLeidos } from "@/lib/precios-excel";
import { Modal, inputCls } from "../ui";
import { tiendaActualId } from "@/lib/planta";

export const ARCHIVO_MANUAL = "Presupuesto manual (provisional)";

/** Lo que trae el planeador de la DSM cuando se sube el Excel. */
export type DatosPlaneador = {
  archivo: string;
  target: TargetParsed | null; // presupuesto de la tienda, fechas y meta por día
  mensual: KpisMensualParsed | null; // horas por persona
  semanal: KpisMensualParsed | null; // KPIs de la semana (opcional)
  precios: PreciosLeidos | null;
};

type PersonaPlanta = { id: string; nombre: string; cargo: string; codigo: string | null; rol_jerarquico: RolJerarquico };
type Origen = "planeador" | "horarios" | "mes anterior" | "a mano" | "sin dato";

const mesAnterior = (anio: number, mes: number) => (mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 });
const num = (s: string): number | null => {
  const v = Number(String(s).replace(/[^0-9.]/g, ""));
  return String(s).trim() && Number.isFinite(v) ? v : null;
};
const esMando = (r: RolJerarquico) => r === "jefe_tienda" || r === "subjefe";
const ETIQUETA: Record<RolJerarquico, string> = {
  jefe_tienda: "Jefe de tienda",
  subjefe: "Subjefe",
  cajero: "Cajero",
  full_time: "Full time",
  part_time: "Part time",
};

/**
 * Presupuesto del mes: con el planeador de la DSM o provisional (a mano). En
 * los dos casos el reparto por persona lo calcula la app con las horas de
 * venta (jefe ¼, subjefe ⅓, cajero ½); la jefatura puede fijar a mano el de
 * alguien. Las metas en unidades salen del precio promedio de cada categoría.
 */
export function PresupuestoModal({
  anio,
  mes,
  mesInfo,
  subidoPor,
  planeador,
  onClose,
  onGuardado,
}: {
  anio: number;
  mes: number;
  mesInfo: MesRetail | null;
  subidoPor: string;
  /** Si viene, es la carga del planeador; si no, presupuesto provisional. */
  planeador?: DatosPlaneador | null;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const tienda = useTienda();
  const vendeRopa = tienda.vende_ropa !== false;
  const factores: Factores = {
    jefe: tienda.factor_jefe ?? 0.25,
    subjefe: tienda.factor_subjefe ?? 1 / 3,
    cajero: tienda.factor_cajero ?? 0.5,
  };
  const pctAcc = tienda.pct_accesorios ?? 8;
  const pctRopa = tienda.pct_ropa ?? 4;
  const target = planeador?.target ?? null;
  const esPlaneador = !!planeador;

  const [planta, setPlanta] = useState<PersonaPlanta[]>([]);
  const [inicio, setInicio] = useState(target?.inicio ?? mesInfo?.inicio ?? "");
  const [fin, setFin] = useState(target?.fin ?? mesInfo?.fin ?? "");
  const [presupuesto, setPresupuesto] = useState(
    target?.presupuesto ? String(Math.round(target.presupuesto)) : mesInfo?.presupuesto ? String(mesInfo.presupuesto) : "",
  );
  const [precioPares, setPrecioPares] = useState(planeador?.precios?.pares ? String(planeador.precios.pares) : "");
  const [precioAcc, setPrecioAcc] = useState(planeador?.precios?.accesorios ? String(planeador.precios.accesorios) : "");
  const [precioRopa, setPrecioRopa] = useState(planeador?.precios?.ropa ? String(planeador.precios.ropa) : "");
  const [anterior, setAnterior] = useState<MesRetail | null>(null);
  const [metasPrevias, setMetasPrevias] = useState<{ fecha: string; meta: number | null }[]>([]);
  const [horasDe, setHorasDe] = useState<Record<string, { horas: string; origen: Origen }>>({});
  const [manual, setManual] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Planta de la tienda (con CM, para cruzar con el planeador) y el mes anterior.
  useEffect(() => {
    let vivo = true;
    const prev = mesAnterior(anio, mes);
    (async () => {
      const tid = await tiendaActualId();
      const [{ data: pers }, { data: ant }] = await Promise.all([
        supabase.from("personal").select("id, nombre, cargo, codigo, rol_jerarquico").eq("activo", true).eq("tienda_id", tid ?? "").order("nombre"),
        supabase.from("meses_retail").select("*").eq("anio", prev.anio).eq("mes", prev.mes).maybeSingle(),
      ]);
      if (!vivo) return;
      setPlanta(((pers as PersonaPlanta[] | null) ?? []).filter((p) => p.rol_jerarquico));
      const a = (ant as MesRetail | null) ?? null;
      setAnterior(a);
      if (!target && !mesInfo) {
        const f = fechasPropuestas(a?.fin ?? null, anio, mes);
        setInicio(f.inicio);
        setFin(f.fin);
      }
      if (a) {
        if (!planeador?.precios?.pares && a.precio_pares) setPrecioPares(String(a.precio_pares));
        if (!planeador?.precios?.accesorios && a.precio_accesorios) setPrecioAcc(String(a.precio_accesorios));
        if (!planeador?.precios?.ropa && a.precio_ropa) setPrecioRopa(String(a.precio_ropa));
        if (!target) {
          const { data: md } = await supabase.from("presupuestos_diarios").select("fecha, meta").gte("fecha", a.inicio).lte("fecha", a.fin);
          if (vivo) setMetasPrevias((md as { fecha: string; meta: number | null }[] | null) ?? []);
        }
      }
      if (vivo) setCargando(false);
    })();
    return () => {
      vivo = false;
    };
  }, [anio, mes, mesInfo, target, planeador]);

  // Horas de cada persona: las del planeador; si no, las de Horarios en el mes
  // retail (descontando el almuerzo); si no, las del mes anterior.
  useEffect(() => {
    if (planta.length === 0 || !inicio || !fin || inicio > fin) return;
    let vivo = true;
    (async () => {
      const desdePlaneador = new Map<string, number>();
      for (const f of planeador?.mensual?.filas ?? []) {
        if (f.horas == null) continue;
        const cm = (f.cmResuelto ?? f.cmExcel ?? "").replace(/\D/g, "");
        const p = (f.personaId && planta.find((x) => x.id === f.personaId)) || (cm && planta.find((x) => (x.codigo ?? "") === cm));
        if (p) desdePlaneador.set(p.id, f.horas);
      }
      const dias = diasEntre(inicio, fin);
      const meses = [...new Set(dias.map((d) => `${d.anio}-${d.mes}`))].map((k) => k.split("-").map(Number));
      const filas: { persona_id: string; anio: number; mes: number; dia: number; horas: number; tipo: string }[] = [];
      for (const [a, m] of meses) {
        const { data } = await supabase.from("horarios").select("persona_id, anio, mes, dia, horas, tipo").eq("anio", a).eq("mes", m);
        filas.push(...((data as typeof filas | null) ?? []));
      }
      const prev = mesAnterior(anio, mes);
      const { data: kp } = await supabase.from("kpis_mensuales").select("persona_id, horas").eq("anio", prev.anio).eq("mes", prev.mes);
      if (!vivo) return;
      const enRango = new Set(dias.map((d) => d.fecha));
      const pad = (n: number) => String(n).padStart(2, "0");
      const deHorarios = new Map<string, number>();
      for (const h of filas) {
        if (h.tipo !== "trabajo" || !enRango.has(`${h.anio}-${pad(h.mes)}-${pad(h.dia)}`)) continue;
        const p = planta.find((x) => x.id === h.persona_id);
        if (!p) continue;
        deHorarios.set(h.persona_id, (deHorarios.get(h.persona_id) ?? 0) + horasTrabajadas(h.horas, p.rol_jerarquico === "part_time"));
      }
      const previas = new Map(((kp as { persona_id: string; horas: number | null }[] | null) ?? []).map((k) => [k.persona_id, k.horas]));
      const nuevo: Record<string, { horas: string; origen: Origen }> = {};
      for (const p of planta) {
        const e = desdePlaneador.get(p.id);
        const h = deHorarios.get(p.id);
        const a = previas.get(p.id);
        nuevo[p.id] =
          e != null && e > 0
            ? { horas: String(e), origen: "planeador" }
            : h != null && h > 0
              ? { horas: String(h), origen: "horarios" }
              : a != null && a > 0
                ? { horas: String(a), origen: "mes anterior" }
                : { horas: "", origen: "sin dato" };
      }
      setHorasDe(nuevo);
    })();
    return () => {
      vivo = false;
    };
  }, [planta, inicio, fin, anio, mes, planeador]);

  const pto = num(presupuesto);
  const metas = {
    precioPares: num(precioPares) ?? 0,
    precioAccesorios: num(precioAcc) ?? 0,
    precioRopa: vendeRopa ? num(precioRopa) : null,
    pctAccesorios: pctAcc,
    pctRopa,
    vendeRopa,
  };
  const calculo = useMemo(
    () =>
      pto && pto > 0
        ? repartir(
            pto,
            planta.map((p) => ({
              persona_id: p.id,
              rol_jerarquico: p.rol_jerarquico,
              horas: num(horasDe[p.id]?.horas ?? "") ?? 0,
              manual: manual[p.id] !== undefined ? num(manual[p.id]) : null,
            })),
            factores,
            metas,
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pto, planta, horasDe, manual, precioPares, precioAcc, precioRopa, vendeRopa, pctAcc, pctRopa, factores.jefe, factores.subjefe, factores.cajero],
  );
  const filaDe = new Map((calculo?.filas ?? []).map((f) => [f.persona_id, f]));
  const equipo = planta.filter((p) => !esMando(p.rol_jerarquico));
  const mandos = planta.filter((p) => esMando(p.rol_jerarquico));
  const sinHoras = planta.filter((p) => manual[p.id] === undefined && !(num(horasDe[p.id]?.horas ?? "") ?? 0));

  const avisoPrecio = (actual: number | null, ant: number | null | undefined) => {
    const v = variacion(actual, ant);
    return v != null && v > 0.3 ? `Difiere ${Math.round(v * 100)} % del mes anterior (${fmtMoney(ant ?? 0)}).` : null;
  };

  async function guardar() {
    setError(null);
    if (!inicio || !fin || inicio > fin) return setError("Revisa las fechas del mes retail.");
    if (!pto || pto <= 0) return setError("Escribe el presupuesto de la tienda.");
    if (!metas.precioPares || !metas.precioAccesorios || (vendeRopa && !metas.precioRopa)) {
      return setError("Escribe el precio promedio de cada categoría.");
    }
    if (!calculo) return;
    if (Math.abs(calculo.sobrante) > 1) {
      return setError(
        calculo.sobrante > 0
          ? `Quedan ${fmtMoney(calculo.sobrante)} sin repartir: revisa las horas.`
          : `Los presupuestos fijados a mano superan el de la tienda en ${fmtMoney(-calculo.sobrante)}.`,
      );
    }
    if (sinHoras.length > 0 && !confirm(`${sinHoras.map((p) => p.nombre).join(", ")} no tiene(n) horas y quedará(n) sin presupuesto. ¿Continuar?`)) return;
    if (mesInfo?.presupuesto && !confirm(`Ya hay un presupuesto de ${NOMBRES_MES[mes - 1]} ${anio}. Este lo reemplaza. ¿Continuar?`)) return;

    setGuardando(true);
    try {
      // Meta de cada día: la del planeador; si es provisional, repartida con el peso de cada día de la semana.
      const metasDia = target
        ? target.dias.filter((d) => d.target != null).map((d) => ({ fecha: d.fecha, meta: Math.round(d.target!) }))
        : metasDiarias(pto, inicio, fin, metasPrevias);
      const ahora = new Date().toISOString();
      const archivo = planeador?.archivo ?? ARCHIVO_MANUAL;

      const { error: e1 } = await supabase.from("meses_retail").upsert({
        anio,
        mes,
        nombre: target?.nombreMes ?? NOMBRES_MES[mes - 1],
        inicio,
        fin,
        presupuesto: pto,
        tienda: target?.tienda ?? tienda.nombre,
        semanas: target?.semanas?.length ? target.semanas : semanasRetail(inicio, fin, metasDia),
        archivo,
        cargado_por: subidoPor,
        cargado_en: ahora,
        fecha_corte: target?.fechaCorte ?? null,
        meta_a_corte: target?.metaACorte ?? null,
        venta_a_corte: target?.ventaACorte ?? null,
        provisional: !esPlaneador,
        precio_pares: metas.precioPares,
        precio_calzado: metas.precioPares,
        precio_accesorios: metas.precioAccesorios,
        precio_ropa: metas.precioRopa,
      });
      if (e1) throw new Error("No se guardó el mes retail: " + e1.message);

      // Solo la meta (y lo del año anterior si viene): la venta de los cierres no se toca.
      const filasDia = metasDia.map((m) => {
        const d = target?.dias.find((x) => x.fecha === m.fecha);
        return {
          fecha: m.fecha,
          meta: m.meta,
          registrado_por: subidoPor,
          ...(d ? { anio_anterior: d.anioAnterior, venta_con_iva: d.ventaConIva } : {}),
        };
      });
      const { error: e2 } = await supabase.from("presupuestos_diarios").upsert(filasDia, { onConflict: "tienda_id,fecha" });
      if (e2) throw new Error("No se guardaron las metas por día: " + e2.message);

      const { error: e3 } = await supabase.from("kpis_mensuales").upsert(
        calculo.filas
          .filter((f) => f.presupuesto > 0 || f.manual)
          .map((f) => ({
            persona_id: f.persona_id,
            anio,
            mes,
            presupuesto: f.presupuesto,
            pares_meta: f.pares_meta,
            acc_meta: f.acc_meta,
            ropa_meta: f.ropa_meta,
            horas: f.horas,
            horas_venta: f.horas_venta,
            presupuesto_manual: f.manual,
            subido_por: subidoPor,
          })),
        { onConflict: "persona_id,anio,mes" },
      );
      if (e3) throw new Error("No se guardó el presupuesto por persona: " + e3.message);

      await supabase.from("presupuestos_uploads").insert({
        anio,
        mes,
        semana_label: null,
        nombre_archivo: archivo,
        subido_por: subidoPor,
        presupuesto_total: pto,
        horas_total: calculo.horasVentaTotal,
        venta_por_hora: calculo.ventaPorHora,
        fecha_corte: target?.fechaCorte ?? null,
      });

      // KPIs de la semana del planeador (vista "Semanal / asesor"), si vienen.
      if (planeador?.semanal && target) {
        const s = planeador.semanal;
        let semana = 1;
        if (s.semanaNumero) {
          if (s.semanaNumero <= target.semanas.length) semana = s.semanaNumero;
          else {
            const c = new Date(target.inicio + "T00:00:00");
            c.setDate(c.getDate() + 1);
            const d = new Date(Date.UTC(c.getFullYear(), c.getMonth(), c.getDate()));
            d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
            const iso = Math.ceil(((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
            semana = Math.min(Math.max(s.semanaNumero - iso + 1, 1), target.semanas.length);
          }
        }
        const label = `Semana ${semana}`;
        const filasSem = s.filas.filter((f) => f.personaId && f.presupuesto != null);
        if (filasSem.length > 0) {
          await supabase.from("presupuestos_semanales").delete().eq("anio", anio).eq("mes", mes).eq("semana_label", label);
          await supabase.from("presupuestos_semanales").insert(
            filasSem.map((f) => ({ persona_id: f.personaId, anio, mes, semana_label: label, meta: f.presupuesto, horas_reportadas: f.horas })),
          );
        }
      }

      // Historial: esta carga queda vigente y las anteriores de presupuesto, como historial.
      await supabase.from("cargas_datos").update({ vigente: false }).eq("anio", anio).eq("mes", mes).eq("tipo", "presupuesto").eq("vigente", true);
      await supabase.from("cargas_datos").insert({
        anio,
        mes,
        tipo: "presupuesto",
        origen: esPlaneador ? "planeador" : "manual",
        archivo,
        cargado_por: subidoPor,
        resumen: {
          presupuesto: pto,
          inicio,
          fin,
          personas: calculo.filas.filter((f) => f.presupuesto > 0).length,
          venta_por_hora: Math.round(calculo.ventaPorHora),
          provisional: !esPlaneador,
        },
      });
      onGuardado();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardando(false);
    }
  }

  const campoPrecio = (label: string, valor: string, set: (v: string) => void, ant: number | null | undefined) => (
    <label className="text-xs text-muted uppercase tracking-wider">
      {label}
      <input inputMode="numeric" value={valor} onChange={(e) => set(e.target.value)} placeholder="$" className={inputCls + " block mt-1 w-full"} />
      <span className="block normal-case tracking-normal text-[11px] text-[#8A5A16] mt-0.5 min-h-[14px]">{avisoPrecio(num(valor), ant) ?? ""}</span>
    </label>
  );

  const filaTabla = (p: PersonaPlanta) => {
    const h = horasDe[p.id];
    const f = filaDe.get(p.id);
    const esManual = manual[p.id] !== undefined;
    return (
      <tr key={p.id} className="border-b border-line/60 last:border-0">
        <td className="px-3 py-1.5">
          {p.nombre}
          <span className="text-muted text-[11px]"> · {ETIQUETA[p.rol_jerarquico]}</span>
        </td>
        <td className="px-2 py-1 text-right">
          <input
            inputMode="numeric"
            value={h?.horas ?? ""}
            onChange={(e) => setHorasDe((d) => ({ ...d, [p.id]: { horas: e.target.value, origen: "a mano" } }))}
            className="w-16 px-2 py-1 border border-line rounded text-right font-mono bg-white"
          />
          <div className="text-[10px] text-muted">{h?.origen ?? "…"}</div>
        </td>
        <td className="px-2 py-1.5 text-right font-mono">{f ? f.horas_venta : "—"}</td>
        <td className="px-2 py-1 text-right">
          <input
            inputMode="numeric"
            value={esManual ? manual[p.id] : f ? String(f.presupuesto) : ""}
            onChange={(e) => setManual((m) => ({ ...m, [p.id]: e.target.value }))}
            className={
              "w-32 px-2 py-1 border rounded text-right font-mono " + (esManual ? "border-amber-400 bg-amber-50" : "border-line bg-white")
            }
            title="Escribe un valor para fijarlo a mano; el resto se reparte entre los demás"
          />
          {esManual && (
            <button
              type="button"
              onClick={() =>
                setManual((m) => {
                  const n = { ...m };
                  delete n[p.id];
                  return n;
                })
              }
              className="block ml-auto text-[10.5px] text-brand hover:underline"
            >
              volver a calcular
            </button>
          )}
        </td>
        <td className="px-2 py-1.5 text-right font-mono">{f?.pares_meta ?? "—"}</td>
        <td className="px-2 py-1.5 text-right font-mono">{f?.acc_meta ?? "—"}</td>
        {vendeRopa && <td className="px-2 py-1.5 text-right font-mono">{f?.ropa_meta ?? "—"}</td>}
      </tr>
    );
  };

  const encabezado = (
    <tr className="text-left text-muted uppercase tracking-wider text-[10.5px] border-b border-line">
      <th className="px-3 py-2">Persona</th>
      <th className="px-2 py-2 text-right">Horas</th>
      <th className="px-2 py-2 text-right">Horas de venta</th>
      <th className="px-2 py-2 text-right">Presupuesto</th>
      <th className="px-2 py-2 text-right">Pares</th>
      <th className="px-2 py-2 text-right">Accesorios</th>
      {vendeRopa && <th className="px-2 py-2 text-right">Ropa</th>}
    </tr>
  );

  return (
    <Modal
      titulo={`${esPlaneador ? "Presupuesto del planeador" : "Presupuesto provisional"} — ${NOMBRES_MES[mes - 1]} ${anio}`}
      onClose={onClose}
      ancho="max-w-5xl"
    >
      <p className="text-[12.5px] text-muted mb-3">
        {esPlaneador ? (
          <>
            Del archivo <strong>{planeador!.archivo}</strong> se toman el presupuesto de la tienda, las fechas del mes
            retail y la meta de cada día. El reparto por persona lo calcula la app con las horas de venta.
          </>
        ) : (
          <>
            Para trabajar mientras llega el planeador de la DSM. Queda marcado como <strong>provisional</strong>; cuando
            llegue el real, súbelo y lo reemplaza.
          </>
        )}{" "}
        Horas de venta: jefe de tienda {Math.round(factores.jefe * 100)} %, subjefe {Math.round(factores.subjefe * 100)} %,
        cajero {Math.round(factores.cajero * 100)} % de sus horas; full time y part time, todas.
      </p>

      {esPlaneador && !target && (
        <div className="mb-3 bg-amber-50 text-[#8A5A16] border border-amber-300 rounded-md px-3 py-2 text-xs">
          No encontré la hoja Target del planeador (presupuesto, fechas y meta por día). Escribe esos datos abajo.
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <label className="text-xs text-muted uppercase tracking-wider">
          Inicio del mes retail
          <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className={inputCls + " block mt-1 w-full"} />
        </label>
        <label className="text-xs text-muted uppercase tracking-wider">
          Cierre del mes retail
          <input type="date" value={fin} onChange={(e) => setFin(e.target.value)} className={inputCls + " block mt-1 w-full"} />
        </label>
        <label className="text-xs text-muted uppercase tracking-wider col-span-2">
          Presupuesto de la tienda
          <input inputMode="numeric" value={presupuesto} onChange={(e) => setPresupuesto(e.target.value)} placeholder="$" className={inputCls + " block mt-1 w-full"} />
        </label>
      </div>

      <div className={"grid gap-3 mb-1 " + (vendeRopa ? "grid-cols-3" : "grid-cols-2")}>
        {campoPrecio("Precio promedio del par", precioPares, setPrecioPares, anterior?.precio_pares ?? anterior?.precio_calzado)}
        {campoPrecio("Precio promedio accesorios", precioAcc, setPrecioAcc, anterior?.precio_accesorios)}
        {vendeRopa && campoPrecio("Precio promedio ropa", precioRopa, setPrecioRopa, anterior?.precio_ropa)}
      </div>
      <p className="text-[11.5px] text-muted mb-3">
        Metas: pares = presupuesto ÷ precio del par · accesorios = presupuesto × {pctAcc} % ÷ precio
        {vendeRopa ? ` · ropa = presupuesto × ${pctRopa} % ÷ precio` : " · esta tienda no vende ropa"}. Los % y los
        factores de horas se cambian en Personal → Datos de la tienda. Para fijar a mano el presupuesto de alguien,
        escríbelo en su casilla.
      </p>

      <div className="bg-panel border border-line rounded-[10px] overflow-x-auto">
        <table className="w-full text-[12.5px] min-w-[760px]">
          <thead>{encabezado}</thead>
          <tbody>{equipo.map(filaTabla)}</tbody>
        </table>
      </div>
      {mandos.length > 0 && (
        <details className="mt-2 bg-panel border border-line rounded-[10px]" open>
          <summary className="cursor-pointer px-3 py-2 text-[12.5px] font-semibold select-none">
            Jefe de tienda y subjefes ({mandos.length}) — llevan presupuesto, no compiten en el ranking
          </summary>
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full text-[12.5px] min-w-[760px]">
              <tbody>{mandos.map(filaTabla)}</tbody>
            </table>
          </div>
        </details>
      )}

      {calculo && (
        <p className={"text-[12px] mt-2 " + (Math.abs(calculo.sobrante) > 1 ? "text-warn" : "text-muted")}>
          {calculo.horasVentaTotal} horas de venta · venta por hora {fmtMoney(Math.round(calculo.ventaPorHora))} · repartido{" "}
          {fmtMoney(calculo.filas.reduce((a, f) => a + f.presupuesto, 0))} de {fmtMoney(pto ?? 0)}
          {Math.abs(calculo.sobrante) > 1 ? ` · diferencia ${fmtMoney(calculo.sobrante)}` : " ✓"}
        </p>
      )}

      {error && <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">{error}</div>}
      <button
        type="button"
        onClick={guardar}
        disabled={guardando || cargando}
        className="mt-4 w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light transition-colors"
      >
        {guardando ? "Guardando…" : esPlaneador ? "Aplicar presupuesto del planeador" : "Guardar presupuesto provisional"}
      </button>
    </Modal>
  );
}
