"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { esMandoPersona, type PersonaMatch } from "@/lib/kpis-mensual-excel";
import { leerVentasConsolidadas, type VentasConsolidadas } from "@/lib/ventas-consolidadas";
import type { MesRetail } from "@/lib/mes-retail";
import { NOMBRES_MES } from "@/lib/horarios";
import { fmtMoney } from "@/lib/types";
import { Modal, inputCls } from "./ui";

const soloDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/**
 * Carga del reporte "Visión general de ventas" (ventas consolidadas hasta una fecha de corte).
 * Es la fuente de la venta acumulada de cada asesor: cada asesor se identifica por su CM.
 */
export function ConsolidadasCard({
  anio,
  mes,
  mesInfo,
  subidoPor,
  onGuardado,
}: {
  anio: number;
  mes: number;
  mesInfo: MesRetail | null;
  subidoPor: string;
  onGuardado: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [datos, setDatos] = useState<{
    data: VentasConsolidadas;
    personal: PersonaMatch[];
    archivo: string;
  } | null>(null);

  async function elegido(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError(null);
    setLeyendo(true);
    try {
      const { data: pers, error: pErr } = await supabase
        .from("personal")
        .select("id, nombre, cedula, codigo, activo, cargo, rol_jerarquico")
        .eq("activo", true);
      if (pErr) throw new Error(pErr.message);
      const data = await leerVentasConsolidadas(f);
      setDatos({ data, personal: (pers as PersonaMatch[] | null) ?? [], archivo: f.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer el reporte.");
    } finally {
      setLeyendo(false);
    }
  }

  return (
    <div className="bg-panel border border-line rounded-[10px] p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="max-w-2xl">
          <h3 className="text-sm font-semibold m-0">Ventas consolidadas (PDF &quot;Visión general de ventas&quot;)</h3>
          <p className="text-[12.5px] text-muted mt-1">
            Es la fuente de la <strong>venta acumulada</strong> de cada asesor: trae la venta neta y las unidades
            (pares, ropa y accesorios) desde el inicio del mes retail hasta la fecha de corte del reporte. Cada
            asesor se identifica por su <strong>CM</strong>. Cuando cargues un reporte más nuevo, reemplaza al anterior.
          </p>
          {mesInfo?.ventas_archivo ? (
            <p className="text-[11.5px] text-muted mt-1.5">
              Última carga: <strong>{mesInfo.ventas_archivo}</strong>
              {mesInfo.ventas_corte ? ` · ventas hasta el ${mesInfo.ventas_corte}` : ""}
              {mesInfo.ventas_cargado_en
                ? ` · ${new Date(mesInfo.ventas_cargado_en).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}`
                : ""}
            </p>
          ) : (
            <p className="text-[11.5px] text-warn mt-1.5">Aún no hay ventas consolidadas cargadas para este mes.</p>
          )}
        </div>
        <>
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={leyendo}
            className="px-4 py-2 bg-operaciones text-white rounded-md font-semibold text-sm hover:bg-operaciones/90 disabled:opacity-50"
          >
            {leyendo ? "Leyendo con IA… (puede tardar un minuto)" : "Subir ventas consolidadas (PDF)"}
          </button>
          <input ref={input} type="file" accept="application/pdf" className="hidden" onChange={elegido} />
        </>
      </div>
      {error && (
        <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-sm">
          {error}
        </div>
      )}
      {datos && (
        <PreviewConsolidadas
          data={datos.data}
          personal={datos.personal}
          archivo={datos.archivo}
          anio={anio}
          mes={mes}
          mesInfo={mesInfo}
          subidoPor={subidoPor}
          onClose={() => setDatos(null)}
          onGuardado={() => {
            setDatos(null);
            onGuardado();
          }}
        />
      )}
    </div>
  );
}

function PreviewConsolidadas({
  data,
  personal,
  archivo,
  anio,
  mes,
  mesInfo,
  subidoPor,
  onClose,
  onGuardado,
}: {
  data: VentasConsolidadas;
  personal: PersonaMatch[];
  archivo: string;
  anio: number;
  mes: number;
  mesInfo: MesRetail | null;
  subidoPor: string;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const registrables = useMemo(
    () => personal.filter((p) => !esMandoPersona(p)).sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [personal],
  );
  const porCm = useMemo(() => {
    const m = new Map<string, PersonaMatch>();
    personal.forEach((p) => {
      const c = soloDigitos(p.codigo);
      if (c) m.set(c, p);
    });
    return m;
  }, [personal]);

  // Cada fila del reporte: quién es (por CM) y si se registra.
  const filas = useMemo(
    () =>
      data.empleados.map((e) => {
        const p = porCm.get(e.cm) ?? null;
        const mando = !!p && esMandoPersona(p);
        return { e, p, mando };
      }),
    [data.empleados, porCm],
  );
  const [asignado, setAsignado] = useState<Record<number, string>>(() => {
    const m: Record<number, string> = {};
    filas.forEach(({ p, mando }, i) => (m[i] = p && !mando ? p.id : ""));
    return m;
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mes retail al que pertenece el reporte: el que contiene su fecha final.
  const corte = data.rango?.[1] ?? null;
  const [destino, setDestino] = useState<{ anio: number; mes: number }>({ anio, mes });
  useEffect(() => {
    if (!corte) return;
    supabase
      .from("meses_retail")
      .select("anio, mes")
      .lte("inicio", corte)
      .gte("fin", corte)
      .limit(1)
      .then(({ data: r }) => {
        const x = (r as { anio: number; mes: number }[] | null)?.[0];
        if (x) setDestino(x);
      });
  }, [corte]);

  const asignadas = new Set(Object.values(asignado).filter(Boolean));
  const sinVentaIgnoradas = filas.filter(({ e, p }, i) => !p && !asignado[i] && e.netaImp === 0).length;
  const conVentaSinAsignar = filas.filter(({ e, p, mando }, i) => !mando && !asignado[i] && (e.netaImp !== 0 || !!p)).length;
  const faltan = registrables.filter((p) => !asignadas.has(p.id));

  const avisos = [...data.avisos];
  if (mesInfo && data.rango && data.rango[0] !== mesInfo.inicio) {
    avisos.push(
      `El reporte empieza el ${data.rango[0]} pero el mes retail cargado empieza el ${mesInfo.inicio}. Verifica que sea el reporte del mes correcto.`,
    );
  }
  if (!data.rango) avisos.push("No pude leer el rango de fechas del reporte; la fecha de corte quedará vacía.");

  async function guardar() {
    setError(null);
    const filasGuardar = filas
      .map(({ e }, i) => ({ e, pid: asignado[i] }))
      .filter((x) => x.pid);
    if (new Set(filasGuardar.map((x) => x.pid)).size !== filasGuardar.length) {
      setError("Hay personas asignadas a más de una fila del reporte.");
      return;
    }
    if (filasGuardar.length === 0) {
      setError("No hay filas asignadas a personas del equipo.");
      return;
    }
    setGuardando(true);
    const filasBd = filasGuardar.map(({ e, pid }) => ({
      persona_id: pid,
      anio: destino.anio,
      mes: destino.mes,
      acumulado_bruto: e.brutaImp,
      acumulado_neto: e.netaImp,
      unidades: e.netaRec,
      pares_venta: e.pares,
      acc_venta: e.acc,
      ropa_venta: e.ropa,
      // El reporte no trae facturas: se limpian el UPT y las facturas viejos para no mezclar fuentes.
      upt: null,
      trx: null,
      cumplimiento: null,
      corte_ventas: corte,
      subido_por: subidoPor,
    }));
    // Quien tiene fila en Personal pero no aparece en el reporte no vendió en el periodo: queda en 0.
    const enReporte = new Set(filasGuardar.map((x) => x.pid));
    const ceros = registrables
      .filter((p) => !enReporte.has(p.id))
      .map((p) => ({
        persona_id: p.id,
        anio: destino.anio,
        mes: destino.mes,
        acumulado_bruto: 0,
        acumulado_neto: 0,
        unidades: 0,
        pares_venta: 0,
        acc_venta: 0,
        ropa_venta: 0,
        upt: null,
        trx: null,
        cumplimiento: null,
        corte_ventas: corte,
        subido_por: subidoPor,
      }));
    const { error: err } = await supabase
      .from("kpis_mensuales")
      .upsert([...filasBd, ...ceros], { onConflict: "persona_id,anio,mes" });
    if (err) {
      setGuardando(false);
      setError(err.message + " (¿aplicaste la migración 0023?)");
      return;
    }
    await supabase
      .from("meses_retail")
      .update({
        ventas_archivo: archivo,
        ventas_cargado_por: subidoPor,
        ventas_cargado_en: new Date().toISOString(),
        ventas_corte: corte,
        ventas_total: data.totalNetaImp ?? data.sumaNetaImp,
      })
      .eq("anio", destino.anio)
      .eq("mes", destino.mes);
    setGuardando(false);
    onGuardado();
  }

  return (
    <Modal titulo="Vista previa de las ventas consolidadas" onClose={onClose} ancho="max-w-5xl">
      <p className="text-[12.5px] text-muted mb-3">
        {data.tienda ? <strong>{data.tienda}</strong> : "Tienda no detectada"}
        {data.rango ? (
          <>
            {" "}
            · ventas del <strong>{data.rango[0]}</strong> al <strong>{data.rango[1]}</strong>
          </>
        ) : null}
        . Se guardarán en <strong>{NOMBRES_MES[destino.mes - 1]} {destino.anio}</strong>. Jefe de tienda y subjefes
        no se registran porque auditan.
      </p>
      {avisos.map((a, i) => (
        <div key={i} className="mb-2 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">
          ⚠ {a}
        </div>
      ))}

      <div className="overflow-x-auto border border-line rounded-md mt-2">
        <table className="w-full text-[12px] min-w-[760px]">
          <thead>
            <tr className="text-left text-muted uppercase tracking-wider text-[10.5px] border-b border-line">
              <th className="px-2 py-1.5">CM</th>
              <th className="px-2 py-1.5">Nombre en el reporte</th>
              <th className="px-2 py-1.5 text-right">Venta neta</th>
              <th className="px-2 py-1.5 text-right">Unds</th>
              <th className="px-2 py-1.5 text-right">Pares</th>
              <th className="px-2 py-1.5 text-right">Ropa</th>
              <th className="px-2 py-1.5 text-right">Acc</th>
              <th className="px-2 py-1.5">Persona registrada</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(({ e, p, mando }, i) => {
              // Filas sin venta y sin persona conocida (ex empleados) se ocultan para no ensuciar.
              if (!p && e.netaImp === 0 && !asignado[i]) return null;
              const sel = asignado[i] ? personal.find((x) => x.id === asignado[i]) : undefined;
              return (
                <tr
                  key={e.cm}
                  className={
                    "border-b border-line/60 last:border-0 align-top " +
                    (mando ? "bg-neutral-100/70 text-muted" : !p && !asignado[i] ? "bg-warn-soft/50" : "")
                  }
                >
                  <td className="px-2 py-1.5 font-mono">{e.cm}</td>
                  <td className="px-2 py-1.5">{e.nombre}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmtMoney(e.netaImp)}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{e.netaRec}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{e.pares ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{e.ropa ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{e.acc ?? "—"}</td>
                  <td className="px-2 py-1.5">
                    {mando ? (
                      <span className="text-[11px]">Jefe / subjefe: audita, no se registra.</span>
                    ) : (
                      <>
                        <select
                          value={asignado[i]}
                          onChange={(ev) => setAsignado((a) => ({ ...a, [i]: ev.target.value }))}
                          className={inputCls + " w-full py-1 " + (asignado[i] ? "" : "border-amber-400 bg-amber-50")}
                        >
                          <option value="">— No importar —</option>
                          {registrables.map((r) => (
                            <option
                              key={r.id}
                              value={r.id}
                              disabled={asignadas.has(r.id) && asignado[i] !== r.id}
                            >
                              {r.codigo ?? "sin CM"} — {r.nombre}
                            </option>
                          ))}
                        </select>
                        <div className={"text-[10.5px] mt-0.5 " + (p ? "text-operaciones" : "text-warn")}>
                          {p
                            ? `✓ CM ${e.cm} coincide con ${p.nombre}`
                            : sel
                              ? `⚠ CM del reporte ${e.cm} ≠ CM Personal ${sel.codigo ?? "sin CM"} (asignada a mano)`
                              : `⛔ El CM ${e.cm} no está registrado en Personal`}
                        </div>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sinVentaIgnoradas > 0 && (
        <p className="text-[11.5px] text-muted mt-1.5">
          {sinVentaIgnoradas} fila(s) sin ventas de personas que no están en Personal se omiten.
        </p>
      )}
      {conVentaSinAsignar > 0 && (
        <p className="text-[12px] text-[#8A5A16] mt-1.5">
          {conVentaSinAsignar} fila(s) con ventas sin asignar no se importarán.
        </p>
      )}
      {faltan.length > 0 && (
        <div className="mt-2 text-[12px] bg-amber-50 border border-amber-300 text-[#8A5A16] rounded-md px-3 py-2">
          <strong>Personas del equipo que no salen en el reporte:</strong> {faltan.map((p) => p.nombre).join(", ")}.
          Se guardarán con venta en 0 (no vendieron en el periodo). Si alguna sí vendió, asígnale su fila arriba.
        </div>
      )}
      {error && (
        <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">{error}</div>
      )}
      <button
        type="button"
        onClick={guardar}
        disabled={guardando}
        className="mt-4 w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light"
      >
        {guardando
          ? "Guardando…"
          : `Guardar ventas de ${asignadas.size} persona(s)${corte ? ` hasta el ${corte}` : ""}`}
      </button>
    </Modal>
  );
}
