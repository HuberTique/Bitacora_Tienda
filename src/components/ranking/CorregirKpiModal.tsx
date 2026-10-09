"use client";

// Corregir los KPIs de una persona (Huber, 9-oct-2026). Si se cambian sus HORAS o su PRESUPUESTO,
// el presupuesto de la tienda se vuelve a repartir entre todo el equipo (como al subir el planeador):
//   - horas nuevas → todos se recalculan por horas de venta;
//   - presupuesto nuevo → queda FIJADO A MANO y el resto se reparte entre los demás.
// Antes de guardar se ve el antes → después de todo el equipo. Lo vendido (pares, accesorios, TRX,
// UPT) se puede corregir aparte; la próxima carga del informe lo reemplaza.

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmtMoney } from "@/lib/types";
import { useTienda } from "@/lib/tienda-config";
import type { KpiMensual } from "@/lib/ranking";
import { aplicarResultado, calcular, cargarDatosMes, type Contexto, type DatosMes } from "@/lib/presupuesto-semanal-datos";
import type { ResultadoSemanal } from "@/lib/presupuesto-semanal";
import { Modal, inputCls } from "./ui";

type Vendido = "pares_venta" | "acc_venta" | "ropa_venta" | "trx" | "upt";

export function CorregirKpiModal({
  kpi,
  nombre,
  subidoPor,
  onClose,
  onGuardado,
}: {
  kpi: KpiMensual;
  nombre: string;
  subidoPor: string;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const tienda = useTienda();
  const vendeRopa = tienda.vende_ropa !== false;
  const ctx: Contexto = {
    factores: { jefe: tienda.factor_jefe ?? 0.25, subjefe: tienda.factor_subjefe ?? 1 / 3, cajero: tienda.factor_cajero ?? 0.5 },
    pctAccesorios: tienda.pct_accesorios ?? 8,
    pctRopa: tienda.pct_ropa ?? 4,
    vendeRopa,
  };
  const horasIni = kpi.horas_plan ?? kpi.horas;
  const [horas, setHoras] = useState(horasIni != null ? String(horasIni) : "");
  const [pto, setPto] = useState(kpi.presupuesto != null ? String(Math.round(kpi.presupuesto)) : "");
  const [fijo, setFijo] = useState(!!kpi.presupuesto_manual);
  const vendidos: { key: Vendido; label: string }[] = [
    { key: "pares_venta", label: "Pares vendidos" },
    { key: "acc_venta", label: "Accesorios vendidos" },
    ...(vendeRopa ? [{ key: "ropa_venta" as Vendido, label: "Ropa vendida" }] : []),
    { key: "trx", label: "Transacciones (TRX)" },
    { key: "upt", label: "UPT" },
  ];
  const [vend, setVend] = useState<Record<Vendido, string>>(() => {
    const v = {} as Record<Vendido, string>;
    (["pares_venta", "acc_venta", "ropa_venta", "trx", "upt"] as Vendido[]).forEach((k) => (v[k] = kpi[k] == null ? "" : String(kpi[k])));
    return v;
  });
  const [vista, setVista] = useState<{ d: DatosMes; r: ResultadoSemanal } | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const num = (t: string): number | null => {
    const s = t.trim().replace(/\./g, "").replace(",", ".");
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };
  const numDec = (t: string): number | null => {
    const s = t.trim().replace(",", ".");
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };
  const h = numDec(horas);
  const p = num(pto);
  const cambiaHoras = h !== (horasIni ?? null);
  const cambiaPto = p !== (kpi.presupuesto != null ? Math.round(kpi.presupuesto) : null);
  const cambiaFijo = fijo !== !!kpi.presupuesto_manual;
  const reparte = cambiaHoras || cambiaPto || cambiaFijo;

  async function verCambios() {
    setError(null);
    if (Number.isNaN(h) || Number.isNaN(p)) return setError("Revisa las horas y el presupuesto: deben ser números positivos.");
    if (fijo && (p == null || p <= 0)) return setError("Para fijar el presupuesto a mano escribe el valor.");
    setTrabajando(true);
    try {
      const d = await cargarDatosMes(kpi.anio, kpi.mes);
      if (!d) throw new Error("No hay presupuesto del mes cargado para repartir.");
      const yo = d.personas.find((x) => x.persona_id === kpi.persona_id);
      if (!yo) throw new Error("Esta persona no está en el reparto del mes.");
      if (h != null) yo.horasPlan = h;
      yo.manual = fijo ? p : null;
      setVista({ d, r: calcular(d, ctx) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTrabajando(false);
    }
  }

  async function guardarVendido(): Promise<string | null> {
    const patch: Record<string, number | null> = {};
    for (const v of vendidos) {
      const n = v.key === "upt" ? numDec(vend[v.key]) : num(vend[v.key]);
      if (n != null && Number.isNaN(n)) return `"${v.label}" no es un número válido.`;
      if (n !== (kpi[v.key] ?? null)) patch[v.key] = n;
    }
    if (Object.keys(patch).length === 0) return null;
    const { error: e } = await supabase.from("kpis_mensuales").update(patch).eq("id", kpi.id);
    return e?.message ?? null;
  }

  async function guardar() {
    setError(null);
    setTrabajando(true);
    try {
      if (vista) await aplicarResultado(vista.d, vista.r, ctx, subidoPor);
      const e = await guardarVendido();
      if (e) throw new Error(e);
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTrabajando(false);
    }
  }

  const campo = inputCls + " block w-full mt-1 font-mono normal-case tracking-normal";
  const etiqueta = "text-[11px] text-muted uppercase tracking-wider";
  return (
    <Modal titulo={`Corregir KPIs — ${nombre}`} onClose={onClose} ancho="max-w-2xl">
      {!vista ? (
        <>
          <div className="text-[13px] font-semibold mb-1">Presupuesto y horas</div>
          <p className="text-[12px] text-muted mb-2">
            Al cambiarlos, el presupuesto de la tienda se reparte de nuevo entre todo el equipo. Si fijas el presupuesto a mano, el
            resto se reparte entre los demás. Las metas de pares, accesorios y ropa salen del presupuesto.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className={etiqueta}>
              Horas del mes
              <input inputMode="decimal" value={horas} onChange={(e) => setHoras(e.target.value)} className={campo} />
            </label>
            <label className={etiqueta}>
              Presupuesto del mes ($)
              <input
                inputMode="numeric"
                value={pto}
                onChange={(e) => {
                  setPto(e.target.value);
                  setFijo(true);
                }}
                className={campo}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-[12.5px] mt-2">
            <input type="checkbox" checked={fijo} onChange={(e) => setFijo(e.target.checked)} />
            Fijar este presupuesto a mano (si lo desmarcas, se reparte por sus horas)
          </label>
          <p className="text-[11.5px] text-muted mt-1">
            Las horas son la base del mes: en los días que ya tienen horario en Horarios (GeoVictoria) mandan esas horas. Metas actuales:
            pares {kpi.pares_meta != null ? Math.round(kpi.pares_meta) : "—"} · accesorios {kpi.acc_meta != null ? Math.round(kpi.acc_meta) : "—"}
            {vendeRopa ? ` · ropa ${kpi.ropa_meta != null ? Math.round(kpi.ropa_meta) : "—"}` : ""}.
          </p>

          <div className="text-[13px] font-semibold mt-4 mb-1">Lo vendido</div>
          <p className="text-[12px] text-muted mb-2">
            Corrige una lectura equivocada de la consolidada o de Xstore; la próxima carga del informe lo reemplaza. La venta en
            pesos sale de los cierres del día.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {vendidos.map((v) => (
              <label key={v.key} className={etiqueta}>
                {v.label}
                <input inputMode="decimal" value={vend[v.key]} onChange={(e) => setVend((x) => ({ ...x, [v.key]: e.target.value }))} className={campo} />
              </label>
            ))}
          </div>
          {error && <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">{error}</div>}
          <button
            type="button"
            onClick={reparte ? verCambios : guardar}
            disabled={trabajando}
            className="mt-4 w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light"
          >
            {trabajando ? "Calculando…" : reparte ? "Ver cómo queda el reparto del equipo" : "Guardar corrección"}
          </button>
        </>
      ) : (
        <>
          <p className="text-[12.5px] text-muted mb-2">
            Así queda el presupuesto del equipo. El total de la tienda no cambia; lo que ya pasó en semanas cerradas se conserva.
          </p>
          <div className="overflow-x-auto border border-line rounded-md">
            <table className="w-full text-[12.5px]">
              <thead className="bg-paper text-left">
                <tr>
                  <th className="px-2 py-1.5">Persona</th>
                  <th className="px-2 py-1.5 text-right">Antes</th>
                  <th className="px-2 py-1.5 text-right">Después</th>
                  <th className="px-2 py-1.5 text-right">Cambio</th>
                </tr>
              </thead>
              <tbody>
                {vista.d.personas.map((x) => {
                  const antes = Number(vista.d.kpis.get(x.persona_id)?.presupuesto ?? 0);
                  const despues = Math.round(vista.r.porPersona.get(x.persona_id)?.presupuesto ?? 0);
                  const dif = despues - antes;
                  return (
                    <tr key={x.persona_id} className={"border-t border-line/60 " + (x.persona_id === kpi.persona_id ? "bg-brand/5 font-semibold" : "")}>
                      <td className="px-2 py-1.5">
                        {x.nombre}
                        {x.manual != null ? <span className="text-[10.5px] text-muted font-normal"> · fijo a mano</span> : ""}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">{fmtMoney(antes)}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{fmtMoney(despues)}</td>
                      <td className={"px-2 py-1.5 text-right font-mono " + (dif > 0 ? "text-operaciones" : dif < 0 ? "text-warn" : "text-muted")}>
                        {dif === 0 ? "—" : `${dif > 0 ? "+" : ""}${fmtMoney(dif)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {error && <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">{error}</div>}
          <div className="flex gap-2 mt-4">
            <button type="button" onClick={() => setVista(null)} disabled={trabajando} className="flex-1 py-2.5 border border-line rounded-md text-sm font-semibold bg-white">
              Volver
            </button>
            <button
              type="button"
              onClick={guardar}
              disabled={trabajando}
              className="flex-1 py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light"
            >
              {trabajando ? "Guardando…" : "Confirmar y guardar el reparto"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
