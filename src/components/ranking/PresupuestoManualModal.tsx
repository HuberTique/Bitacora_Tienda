"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { NOMBRES_MES } from "@/lib/horarios";
import { fmtMoney } from "@/lib/types";
import type { PersonaRk } from "@/lib/ranking";
import { diasEntre, type MesRetail } from "@/lib/mes-retail";
import { useTienda } from "@/lib/tienda-config";
import {
  calcularMetas,
  fechasPropuestas,
  horasTrabajadas,
  metasDiarias,
  problemaMezcla,
  semanasRetail,
  variacion,
} from "@/lib/presupuesto-manual";
import { Modal, inputCls } from "./ui";

export const ARCHIVO_MANUAL = "Presupuesto manual (provisional)";

type Origen = "horarios" | "mes anterior" | "manual" | "sin dato";

const mesAnterior = (anio: number, mes: number) => (mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 });
const num = (s: string): number | null => {
  const v = Number(s.replace(/[^0-9.]/g, ""));
  return s.trim() && Number.isFinite(v) ? v : null;
};

/**
 * Presupuesto manual provisional: para cuando termina el mes retail y aún no
 * llega el planeador. La jefatura escribe el presupuesto de la tienda y los
 * precios promedio; el reparto por asesor sale de sus horas y las metas en
 * unidades de la mezcla de la tienda.
 */
export function PresupuestoManualModal({
  anio,
  mes,
  roster,
  mesInfo,
  subidoPor,
  onClose,
  onGuardado,
}: {
  anio: number;
  mes: number;
  roster: PersonaRk[];
  mesInfo: MesRetail | null;
  subidoPor: string;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const tienda = useTienda();
  const vendeRopa = tienda.vende_ropa !== false;
  const mezcla = {
    calzado: tienda.mezcla_calzado ?? NaN,
    accesorios: tienda.mezcla_accesorios ?? NaN,
    ropa: vendeRopa ? (tienda.mezcla_ropa ?? NaN) : 0,
  };
  const errMezcla = problemaMezcla(mezcla, vendeRopa);
  // Jefe de tienda y subjefes no llevan presupuesto: auditan.
  const asesores = useMemo(
    () =>
      roster
        .filter((p) => p.rol_jerarquico !== "jefe_tienda" && p.rol_jerarquico !== "subjefe")
        .sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [roster],
  );

  const [inicio, setInicio] = useState(mesInfo?.inicio ?? "");
  const [fin, setFin] = useState(mesInfo?.fin ?? "");
  const [presupuesto, setPresupuesto] = useState(mesInfo?.presupuesto ? String(mesInfo.presupuesto) : "");
  const [precioCalzado, setPrecioCalzado] = useState("");
  const [precioAcc, setPrecioAcc] = useState("");
  const [precioRopa, setPrecioRopa] = useState("");
  const [anterior, setAnterior] = useState<MesRetail | null>(null);
  const [metasPrevias, setMetasPrevias] = useState<{ fecha: string; meta: number | null }[]>([]);
  const [horasDe, setHorasDe] = useState<Record<string, { horas: string; origen: Origen }>>({});
  const [horasLeidas, setHorasLeidas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mes anterior: fechas, precios y metas por día (para repartir con el mismo peso por día de la semana).
  useEffect(() => {
    let vivo = true;
    const prev = mesAnterior(anio, mes);
    (async () => {
      const { data } = await supabase.from("meses_retail").select("*").eq("anio", prev.anio).eq("mes", prev.mes).maybeSingle();
      const ant = (data as MesRetail | null) ?? null;
      if (!vivo) return;
      setAnterior(ant);
      if (!mesInfo) {
        const f = fechasPropuestas(ant?.fin ?? null, anio, mes);
        setInicio(f.inicio);
        setFin(f.fin);
      }
      if (ant) {
        setPrecioCalzado(ant.precio_calzado ? String(ant.precio_calzado) : "");
        setPrecioAcc(ant.precio_accesorios ? String(ant.precio_accesorios) : "");
        setPrecioRopa(ant.precio_ropa ? String(ant.precio_ropa) : "");
        const { data: md } = await supabase
          .from("presupuestos_diarios")
          .select("fecha, meta")
          .gte("fecha", ant.inicio)
          .lte("fecha", ant.fin);
        if (vivo) setMetasPrevias((md as { fecha: string; meta: number | null }[] | null) ?? []);
      }
      if (vivo) setCargando(false);
    })();
    return () => {
      vivo = false;
    };
  }, [anio, mes, mesInfo]);

  // Horas de cada asesor dentro del mes retail, según los horarios guardados; si
  // no hay, las del mes anterior. Se recalculan al cambiar las fechas.
  useEffect(() => {
    if (!inicio || !fin || inicio > fin) return;
    let vivo = true;
    (async () => {
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
      const total = new Map<string, number>();
      for (const h of filas) {
        if (h.tipo !== "trabajo" || !enRango.has(`${h.anio}-${pad(h.mes)}-${pad(h.dia)}`)) continue;
        const p = asesores.find((x) => x.id === h.persona_id);
        if (!p) continue;
        total.set(h.persona_id, (total.get(h.persona_id) ?? 0) + horasTrabajadas(h.horas, p.rol_jerarquico === "part_time"));
      }
      const previas = new Map(((kp as { persona_id: string; horas: number | null }[] | null) ?? []).map((k) => [k.persona_id, k.horas]));
      const nuevo: Record<string, { horas: string; origen: Origen }> = {};
      for (const p of asesores) {
        const h = total.get(p.id);
        const ant = previas.get(p.id);
        nuevo[p.id] =
          h != null && h > 0
            ? { horas: String(h), origen: "horarios" }
            : ant != null && ant > 0
              ? { horas: String(ant), origen: "mes anterior" }
              : { horas: "", origen: "sin dato" };
      }
      setHorasDe(nuevo);
      setHorasLeidas(true);
    })();
    return () => {
      vivo = false;
    };
  }, [inicio, fin, anio, mes, asesores]);

  const pto = num(presupuesto);
  const precios = { calzado: num(precioCalzado) ?? 0, accesorios: num(precioAcc) ?? 0, ropa: vendeRopa ? num(precioRopa) : null };
  const filasHoras = asesores.map((p) => ({ persona_id: p.id, horas: num(horasDe[p.id]?.horas ?? "") ?? 0 }));
  const calculo = pto && pto > 0 && !errMezcla ? calcularMetas(pto, filasHoras, mezcla, precios, vendeRopa) : null;
  const metaDe = new Map((calculo?.filas ?? []).map((f) => [f.persona_id, f]));
  const sinHoras = asesores.filter((p) => !(num(horasDe[p.id]?.horas ?? "") ?? 0));

  const avisoPrecio = (actual: number | null, ant: number | null | undefined) => {
    const v = variacion(actual, ant);
    return v != null && v > 0.3 ? `Difiere ${Math.round(v * 100)} % del mes anterior (${fmtMoney(ant ?? 0)}).` : null;
  };

  async function guardar() {
    setError(null);
    if (errMezcla) return setError(errMezcla);
    if (!inicio || !fin || inicio > fin) return setError("Revisa las fechas del mes retail.");
    if (!pto || pto <= 0) return setError("Escribe el presupuesto de la tienda.");
    if (!precios.calzado || !precios.accesorios || (vendeRopa && !precios.ropa)) {
      return setError("Escribe el precio promedio de cada categoría.");
    }
    if (!calculo || calculo.filas.length === 0) return setError("Ningún asesor tiene horas: escribe las horas del mes.");
    if (
      sinHoras.length > 0 &&
      !confirm(`${sinHoras.map((p) => p.nombre).join(", ")} no tiene(n) horas y quedará(n) sin presupuesto. ¿Continuar?`)
    )
      return;
    if (
      mesInfo &&
      !mesInfo.provisional &&
      mesInfo.presupuesto &&
      !confirm(
        `Ya hay un presupuesto cargado del planeador para ${NOMBRES_MES[mes - 1]} ${anio}. El provisional lo reemplaza. ¿Continuar?`,
      )
    )
      return;

    setGuardando(true);
    try {
      const metas = metasDiarias(pto, inicio, fin, metasPrevias);
      const { error: e1 } = await supabase.from("meses_retail").upsert({
        anio,
        mes,
        nombre: NOMBRES_MES[mes - 1],
        inicio,
        fin,
        presupuesto: pto,
        tienda: tienda.nombre,
        semanas: semanasRetail(inicio, fin, metas),
        archivo: ARCHIVO_MANUAL,
        cargado_por: subidoPor,
        cargado_en: new Date().toISOString(),
        fecha_corte: null,
        meta_a_corte: null,
        venta_a_corte: null,
        provisional: true,
        precio_calzado: precios.calzado,
        precio_accesorios: precios.accesorios,
        precio_ropa: precios.ropa,
      });
      if (e1) throw new Error("No se guardó el mes retail: " + e1.message);

      // Solo la meta: la venta de los días que ya tengan cierre no se toca.
      const { error: e2 } = await supabase
        .from("presupuestos_diarios")
        .upsert(metas.map((m) => ({ fecha: m.fecha, meta: m.meta, registrado_por: subidoPor })), { onConflict: "tienda_id,fecha" });
      if (e2) throw new Error("No se guardaron las metas por día: " + e2.message);

      const { error: e3 } = await supabase.from("kpis_mensuales").upsert(
        calculo.filas.map((f) => ({
          persona_id: f.persona_id,
          anio,
          mes,
          presupuesto: f.presupuesto,
          pares_meta: f.pares_meta,
          acc_meta: f.acc_meta,
          ropa_meta: f.ropa_meta,
          horas: f.horas,
          subido_por: subidoPor,
        })),
        { onConflict: "persona_id,anio,mes" },
      );
      if (e3) throw new Error("No se guardó el presupuesto por asesor: " + e3.message);

      await supabase.from("presupuestos_uploads").insert({
        anio,
        mes,
        semana_label: null,
        nombre_archivo: ARCHIVO_MANUAL,
        subido_por: subidoPor,
        presupuesto_total: pto,
        horas_total: calculo.horasTotal,
        venta_por_hora: calculo.ventaPorHora,
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
      <input
        inputMode="numeric"
        value={valor}
        onChange={(e) => set(e.target.value)}
        placeholder="$"
        className={inputCls + " block mt-1 w-full"}
      />
      <span className="block normal-case tracking-normal text-[11px] text-[#8A5A16] mt-0.5 min-h-[14px]">
        {avisoPrecio(num(valor), ant) ?? ""}
      </span>
    </label>
  );

  return (
    <Modal titulo={`Presupuesto manual — ${NOMBRES_MES[mes - 1]} ${anio}`} onClose={onClose} ancho="max-w-4xl">
      <p className="text-[12.5px] text-muted mb-3">
        Para cuando termina el mes retail y aún no llega el planeador. Queda marcado como{" "}
        <strong>provisional</strong>; cuando llegue el real, bórralo y sube el Excel (o súbelo directamente:
        lo reemplaza).
      </p>

      {errMezcla && (
        <div className="mb-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">{errMezcla}</div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <label className="text-xs text-muted uppercase tracking-wider">
          Inicio del mes retail
          <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className={inputCls + " block mt-1 w-full"} />
        </label>
        <label className="text-xs text-muted uppercase tracking-wider">
          Fin del mes retail
          <input type="date" value={fin} onChange={(e) => setFin(e.target.value)} className={inputCls + " block mt-1 w-full"} />
        </label>
        <label className="text-xs text-muted uppercase tracking-wider col-span-2">
          Presupuesto de la tienda
          <input
            inputMode="numeric"
            value={presupuesto}
            onChange={(e) => setPresupuesto(e.target.value)}
            placeholder="$"
            className={inputCls + " block mt-1 w-full"}
          />
        </label>
      </div>

      <div className={"grid gap-3 mb-1 " + (vendeRopa ? "grid-cols-3" : "grid-cols-2")}>
        {campoPrecio("Precio promedio calzado", precioCalzado, setPrecioCalzado, anterior?.precio_calzado)}
        {campoPrecio("Precio promedio accesorios", precioAcc, setPrecioAcc, anterior?.precio_accesorios)}
        {vendeRopa && campoPrecio("Precio promedio ropa", precioRopa, setPrecioRopa, anterior?.precio_ropa)}
      </div>
      <p className="text-[11.5px] text-muted mb-3">
        Mezcla de la tienda: calzado {Number.isFinite(mezcla.calzado) ? mezcla.calzado : "—"} % · accesorios{" "}
        {Number.isFinite(mezcla.accesorios) ? mezcla.accesorios : "—"} %
        {vendeRopa ? ` · ropa ${Number.isFinite(mezcla.ropa) ? mezcla.ropa : "—"} %` : " · esta tienda no vende ropa"}. Se cambia en
        Personal → Datos de la tienda. Las metas por día se reparten{" "}
        {metasPrevias.some((m) => m.meta) ? "con el peso de cada día de la semana del mes anterior" : "en partes iguales"}.
      </p>

      <div className="bg-panel border border-line rounded-[10px] overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-muted uppercase tracking-wider text-[10.5px] border-b border-line">
              <th className="px-3 py-2">Asesor</th>
              <th className="px-2 py-2 text-right">Horas del mes</th>
              <th className="px-2 py-2 text-right">Presupuesto</th>
              <th className="px-2 py-2 text-right">Pares</th>
              <th className="px-2 py-2 text-right">Accesorios</th>
              {vendeRopa && <th className="px-2 py-2 text-right">Ropa</th>}
            </tr>
          </thead>
          <tbody>
            {asesores.map((p) => {
              const h = horasDe[p.id];
              const m = metaDe.get(p.id);
              return (
                <tr key={p.id} className="border-b border-line/60 last:border-0">
                  <td className="px-3 py-1.5">
                    {p.nombre}
                    <span className="text-muted text-[11px]"> · {p.cargo}</span>
                  </td>
                  <td className="px-2 py-1 text-right">
                    <input
                      inputMode="numeric"
                      value={h?.horas ?? ""}
                      onChange={(e) =>
                        setHorasDe((d) => ({ ...d, [p.id]: { horas: e.target.value, origen: "manual" } }))
                      }
                      className="w-20 px-2 py-1 border border-line rounded text-right font-mono bg-white"
                    />
                    <div className="text-[10px] text-muted">{horasLeidas ? (h?.origen ?? "") : "leyendo…"}</div>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">{m ? fmtMoney(m.presupuesto) : "—"}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{m ? m.pares_meta : "—"}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{m ? m.acc_meta : "—"}</td>
                  {vendeRopa && <td className="px-2 py-1.5 text-right font-mono">{m?.ropa_meta ?? "—"}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {calculo && (
        <p className="text-[12px] text-muted mt-2">
          {calculo.horasTotal} horas en total · venta por hora {fmtMoney(Math.round(calculo.ventaPorHora))} · reparto{" "}
          {fmtMoney(calculo.filas.reduce((a, f) => a + f.presupuesto, 0))} de {fmtMoney(pto ?? 0)}.
        </p>
      )}

      {error && (
        <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">{error}</div>
      )}
      <button
        type="button"
        onClick={guardar}
        disabled={guardando || cargando || !!errMezcla}
        className="mt-4 w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light transition-colors"
      >
        {guardando ? "Guardando…" : "Guardar presupuesto provisional"}
      </button>
    </Modal>
  );
}

/**
 * Borra el presupuesto del mes (provisional o del planeador) para cargar el
 * real. Lo vendido (cierres del día y ventas consolidadas) no se toca.
 */
export async function borrarPresupuestoMes(anio: number, mes: number, mesInfo: MesRetail | null): Promise<string | null> {
  const { error: e1 } = await supabase
    .from("kpis_mensuales")
    .update({ presupuesto: null, pares_meta: null, acc_meta: null, ropa_meta: null, horas: null })
    .eq("anio", anio)
    .eq("mes", mes);
  if (e1) return e1.message;
  // Filas que se quedaron vacías (sin nada vendido) se eliminan.
  await supabase
    .from("kpis_mensuales")
    .delete()
    .eq("anio", anio)
    .eq("mes", mes)
    .is("corte_ventas", null)
    .is("acumulado_neto", null)
    .is("acumulado_bruto", null);

  if (mesInfo) {
    const { error: e2 } = await supabase
      .from("presupuestos_diarios")
      .update({ meta: null })
      .gte("fecha", mesInfo.inicio)
      .lte("fecha", mesInfo.fin);
    if (e2) return e2.message;
    await supabase.from("presupuestos_diarios").delete().gte("fecha", mesInfo.inicio).lte("fecha", mesInfo.fin).is("venta", null);

    // El mes retail se conserva si ya tiene ventas consolidadas cargadas.
    const { error: e3 } = mesInfo.ventas_archivo
      ? await supabase
          .from("meses_retail")
          .update({
            presupuesto: null,
            archivo: null,
            provisional: false,
            precio_calzado: null,
            precio_accesorios: null,
            precio_ropa: null,
            semanas: mesInfo.semanas.map((s) => ({ ...s, target: null })),
          })
          .eq("anio", anio)
          .eq("mes", mes)
      : await supabase.from("meses_retail").delete().eq("anio", anio).eq("mes", mes);
    if (e3) return e3.message;
  }
  await supabase.from("presupuestos_uploads").delete().eq("anio", anio).eq("mes", mes).eq("nombre_archivo", ARCHIVO_MANUAL);
  return null;
}
