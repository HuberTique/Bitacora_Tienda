"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { esMandoPersona, type PersonaMatch } from "@/lib/kpis-mensual-excel";
import { leerVentasConsolidadas, type Giro, type VentasConsolidadas } from "@/lib/ventas-consolidadas";
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
  const [giro, setGiro] = useState<Giro>("auto");
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
      const data = await leerVentasConsolidadas(f, giro);
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
        <div className="flex flex-col items-end gap-1.5">
          <label className="text-[11px] text-muted flex items-center gap-1.5">
            Orientación:
            <select
              value={String(giro)}
              onChange={(e) => setGiro(e.target.value === "auto" ? "auto" : (Number(e.target.value) as Giro))}
              className={inputCls + " py-0.5 px-1.5 text-[11.5px]"}
            >
              <option value="auto">Automática</option>
              <option value="0">Sin girar</option>
              <option value="90">Girar 90°</option>
              <option value="180">Girar 180°</option>
              <option value="270">Girar 270°</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={leyendo}
            className="px-4 py-2 bg-operaciones text-white rounded-md font-semibold text-sm hover:bg-operaciones/90 disabled:opacity-50"
          >
            {leyendo ? "Leyendo con IA… (puede tardar un minuto)" : "Subir ventas consolidadas (PDF)"}
          </button>
          <input ref={input} type="file" accept="application/pdf" className="hidden" onChange={elegido} />
        </div>
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

type Edicion = { netaImp?: string; netaRec?: string; pares?: string; ropa?: string; acc?: string };

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

  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const graves: string[] = [];
  const avisos = [...data.avisos];
  if (!data.titulo || !norm(data.titulo).includes("vision general de ventas")) {
    graves.push(`El archivo no parece ser el informe "Visión general de ventas" (título leído: ${data.titulo ?? "ninguno"}).`);
  }
  const codigoTienda = mesInfo?.tienda ? soloDigitos(mesInfo.tienda) : "";
  if (codigoTienda) {
    if (!data.tienda) avisos.push(`No pude leer la tienda del informe (se esperaba la ${codigoTienda}).`);
    else if (!soloDigitos(data.tienda).includes(codigoTienda))
      graves.push(`La tienda del informe (${data.tienda}) no coincide con la tienda ${codigoTienda} de esta aplicación.`);
  }
  if (!data.rango) {
    avisos.push("No pude leer el rango de fechas del reporte; la fecha de corte quedará vacía.");
  } else if (mesInfo) {
    if (data.rango[0] !== mesInfo.inicio)
      avisos.push(`El informe empieza el ${data.rango[0]} pero el mes retail cargado empieza el ${mesInfo.inicio}.`);
    if (data.rango[1] > mesInfo.fin || data.rango[1] < mesInfo.inicio)
      graves.push(`El rango del informe (${data.rango[0]} a ${data.rango[1]}) está fuera del mes retail ${mesInfo.inicio} a ${mesInfo.fin}.`);
  }

  // Correcciones a mano de lo que leyó la IA.
  const [edits, setEdits] = useState<Record<number, Edicion>>({});
  const [confirmado, setConfirmado] = useState(false);
  const num = (i: number, c: keyof Edicion, original: number | null): number | null => {
    const v = edits[i]?.[c];
    if (v === undefined) return original;
    if (v.trim() === "") return null;
    const n = Number(v.replace(/[^0-9.-]/g, ""));
    return isFinite(n) ? n : original;
  };
  const sumaActual =
    filas.reduce((a, { e }, i) => a + (num(i, "netaImp", e.netaImp) ?? 0), 0) + (data.ventaEmpleados ?? 0);
  const difTotal =
    data.totalNetaImp && data.totalNetaImp > 0 ? Math.abs(sumaActual - data.totalNetaImp) / data.totalNetaImp : null;
  const campo = (i: number, c: keyof Edicion, original: number | null, ancho = "w-16") => {
    const v = edits[i]?.[c];
    return (
      <input
        inputMode="numeric"
        value={v !== undefined ? v : original == null ? "" : String(Math.round(original))}
        onChange={(ev) => setEdits((p) => ({ ...p, [i]: { ...p[i], [c]: ev.target.value } }))}
        placeholder="—"
        className={
          `${ancho} px-1.5 py-0.5 border rounded text-right font-mono text-[12px] ` +
          (original == null && v === undefined ? "border-amber-400 bg-amber-50" : "border-line bg-white")
        }
      />
    );
  };

  async function guardar() {
    setError(null);
    if (graves.length > 0 && !confirmado) {
      setError("Hay advertencias graves arriba. Marca la casilla de confirmación si aun así quieres guardar.");
      return;
    }
    const filasGuardar = filas
      .map(({ e }, i) => ({ e, i, pid: asignado[i] }))
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
    const filasBd = filasGuardar.map(({ e, i, pid }) => ({
      persona_id: pid,
      anio: destino.anio,
      mes: destino.mes,
      acumulado_bruto: null,
      acumulado_neto: num(i, "netaImp", e.netaImp),
      unidades: num(i, "netaRec", e.netaRec),
      pares_venta: num(i, "pares", e.pares),
      acc_venta: num(i, "acc", e.acc),
      ropa_venta: num(i, "ropa", e.ropa),
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
        acumulado_bruto: null,
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
        ventas_total: data.totalNetaImp ?? sumaActual,
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
      {graves.map((g, i) => (
        <div key={i} className="mb-2 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs font-semibold">
          ⛔ {g}
        </div>
      ))}
      {graves.length > 0 && (
        <label className="mb-2 flex items-center gap-2 text-[12px]">
          <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
          Entiendo las advertencias y quiero guardar de todos modos.
        </label>
      )}
      {avisos.map((a, i) => (
        <div key={i} className="mb-2 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">
          ⚠ {a}
        </div>
      ))}
      <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] bg-paper border border-line rounded-md px-3 py-2">
        <span>Informe: <strong>{data.titulo ?? "—"}</strong></span>
        <span>Total del informe: <strong>{data.totalNetaImp != null ? fmtMoney(data.totalNetaImp) : "—"}</strong></span>
        <span>Suma de la tabla: <strong>{fmtMoney(sumaActual)}</strong></span>
        <span>Venta a empleados (9999): <strong>{data.ventaEmpleados != null ? fmtMoney(data.ventaEmpleados) : "—"}</strong></span>
        {difTotal != null && (
          <span className={difTotal <= 0.005 ? "text-operaciones font-semibold" : "text-warn font-semibold"}>
            {difTotal <= 0.005 ? "✓ Cuadra" : `Diferencia ${(difTotal * 100).toFixed(1)}%`}
          </span>
        )}
      </div>
      <p className="text-[11.5px] text-muted">Puedes corregir cualquier cifra directamente en la tabla.</p>

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
                  <td className="px-2 py-1.5 text-right">{campo(i, "netaImp", e.netaImp, "w-28")}</td>
                  <td className="px-2 py-1.5 text-right">{campo(i, "netaRec", e.netaRec)}</td>
                  <td className="px-2 py-1.5 text-right">{campo(i, "pares", e.pares)}</td>
                  <td className="px-2 py-1.5 text-right">{campo(i, "ropa", e.ropa)}</td>
                  <td className="px-2 py-1.5 text-right">{campo(i, "acc", e.acc)}</td>
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
