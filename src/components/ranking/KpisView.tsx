"use client";

import { useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { NOMBRES_MES } from "@/lib/horarios";
import { estiloCumplimiento } from "@/lib/cumplimiento";
import {
  leerKpisMensualDesdeArchivo,
  type FilaKpiExcel,
  type KpisMensualParsed,
  type PersonaMatch,
  esMandoPersona,
} from "@/lib/kpis-mensual-excel";
import { fmtMoney } from "@/lib/types";
import { uptDe, type AvanceMes, type KpiMensual, type PersonaRk, type ResumenVentas } from "@/lib/ranking";
import { leerTargetDesdeArchivo, type TargetParsed } from "@/lib/planeador-excel";
import type { MesRetail } from "@/lib/mes-retail";
import { Modal, inputCls } from "./ui";

const num = (v: number | null | undefined, dec = 0) =>
  v == null ? "—" : v.toLocaleString("es-CO", { maximumFractionDigits: dec });

export function KpisView({
  kpis,
  roster,
  anio,
  mes,
  esJefatura,
  subidoPor,
  mesInfo,
  ventasVivas,
  avanceMes,
  avance,
  onGuardado,
}: {
  kpis: KpiMensual[];
  roster: PersonaRk[];
  anio: number;
  mes: number;
  esJefatura: boolean;
  subidoPor: string;
  mesInfo: MesRetail | null;
  /** Venta acumulada por persona según los cierres del día cargados. */
  ventasVivas: ResumenVentas[];
  avanceMes: AvanceMes | null;
  /** Fracción del presupuesto que ya debía llevarse al último cierre (0..1). */
  avance: number | null;
  onGuardado: () => void;
}) {
  const [detalle, setDetalle] = useState(false);
  const factor = avance;
  // UPT y facturas solo se muestran si hay datos (las ventas consolidadas no los traen).
  const hayUpt = kpis.some((k) => uptDe(k) != null || k.trx != null);
  const ventaViva = new Map(ventasVivas.map((v) => [v.persona_id, v.venta]));
  const [preview, setPreview] = useState<{
    parsed: KpisMensualParsed;
    personal: PersonaMatch[];
    target: TargetParsed | null;
    semanal: KpisMensualParsed | null;
    archivo: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const nombreDe = new Map(roster.map((p) => [p.id, p]));
  const [editando, setEditando] = useState<KpiMensual | null>(null);

  async function eliminarFila(k: KpiMensual) {
    const nombre = nombreDe.get(k.persona_id)?.nombre ?? "esta persona";
    if (!confirm(`¿Eliminar los KPIs de ${nombre} de ${NOMBRES_MES[mes - 1]} ${anio}?`)) return;
    const { error: err } = await supabase.from("kpis_mensuales").delete().eq("id", k.id);
    if (err) return setError(err.message);
    onGuardado();
  }

  // Lo vendido que quedó de una carga anterior del Excel (sin fecha de corte de ventas consolidadas):
  // pares, UPT, facturas, etc. Se puede limpiar sin tocar presupuestos ni metas.
  const conVendidoViejo = kpis.filter(
    (k) =>
      !k.corte_ventas &&
      [k.upt, k.trx, k.unidades, k.pares_venta, k.acc_venta, k.ropa_venta, k.acumulado_neto, k.acumulado_bruto].some(
        (v) => v != null,
      ),
  );

  async function limpiarVendidoViejo() {
    if (
      !confirm(
        `¿Limpiar lo vendido que quedó del Excel en ${conVendidoViejo.length} persona(s)?\n\nSe borran: venta neta y bruta, pares, accesorios, ropa, unidades, UPT y facturas de esa carga. Los presupuestos y las metas NO se tocan. La venta del ranking sigue saliendo de tus cierres del día y de las ventas consolidadas.`,
      )
    )
      return;
    const { error: err } = await supabase
      .from("kpis_mensuales")
      .update({
        acumulado_bruto: null,
        acumulado_neto: null,
        cumplimiento: null,
        pares_venta: null,
        acc_venta: null,
        ropa_venta: null,
        unidades: null,
        trx: null,
        upt: null,
      })
      .in(
        "id",
        conVendidoViejo.map((k) => k.id),
      );
    if (err) return setError(err.message);
    onGuardado();
  }

  async function eliminarMes() {
    if (
      !confirm(
        `¿Eliminar TODOS los KPIs de ${NOMBRES_MES[mes - 1]} ${anio} (${kpis.length} personas)?\n\nDespués puedes volver a subir el Excel correcto.`,
      )
    )
      return;
    const { error: err } = await supabase.from("kpis_mensuales").delete().eq("anio", anio).eq("mes", mes);
    if (err) return setError(err.message);
    onGuardado();
  }

  async function elegido(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError(null);
    setLeyendo(true);
    try {
      // Jefatura lee Personal completo (con cédula y CM) para identificar a cada
      // asesor con exactitud, no solo por el nombre de pila.
      const { data: pers, error: pErr } = await supabase
        .from("personal")
        .select("id, nombre, cedula, codigo, activo, cargo, rol_jerarquico")
        .eq("activo", true);
      if (pErr) throw new Error(pErr.message);
      const personal = (pers as PersonaMatch[] | null) ?? [];
      const r = await leerKpisMensualDesdeArchivo(f, personal);
      if ("error" in r) setError(r.error);
      else {
        // El planeador completo trae también el calendario retail (hoja Target) y los KPIs
        // de la semana: se leen en la misma carga para alimentar todo de una vez.
        const t = await leerTargetDesdeArchivo(f);
        const sem = await leerKpisMensualDesdeArchivo(f, personal, "semanal");
        setPreview({
          parsed: r,
          personal,
          target: "error" in t ? null : t,
          semanal: "error" in sem ? null : sem,
          archivo: f.name,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer el archivo.");
    } finally {
      setLeyendo(false);
    }
  }

  const pctVivo = (k: KpiMensual): number | null => {
    const venta = ventaViva.get(k.persona_id);
    return factor && k.presupuesto && venta != null ? venta / (k.presupuesto * factor) : null;
  };
  const ordenados = [...kpis].sort((a, b) => (pctVivo(b) ?? -1) - (pctVivo(a) ?? -1));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[12.5px] text-muted max-w-2xl">
          Cuadro de KPIs del mes por integrante (hoja <strong>Kpis mensual</strong> del planeador).
          {esJefatura ? "" : " Solo jefatura sube el archivo."}
        </p>
        {esJefatura && (
          <>
            {conVendidoViejo.length > 0 && (
              <button
                type="button"
                onClick={limpiarVendidoViejo}
                className="px-3 py-2 rounded-md border border-brand text-brand text-sm font-semibold hover:bg-brand/5"
                title="Borra lo vendido que quedó de la carga anterior del Excel (UPT, pares, facturas…)"
              >
                Limpiar lo vendido del Excel
              </button>
            )}
            {kpis.length > 0 && (
              <button
                type="button"
                onClick={eliminarMes}
                className="px-3 py-2 rounded-md border border-warn text-warn text-sm font-semibold hover:bg-warn-soft"
              >
                Eliminar KPIs del mes
              </button>
            )}
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={leyendo}
              className="px-3 py-2 rounded-md bg-brand text-white text-sm font-semibold hover:bg-brand-light disabled:opacity-50"
            >
              {leyendo ? "Leyendo…" : "Subir planeador (Excel)"}
            </button>
            <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={elegido} />
          </>
        )}
      </div>
      {error && (
        <div className="bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <CargaInfo mesInfo={mesInfo} roster={roster} kpis={kpis} avanceMes={avanceMes} />

      {kpis.length === 0 ? (
        <div className="bg-panel border border-line rounded-[10px] p-8 text-center text-muted text-sm">
          No hay KPIs cargados para {NOMBRES_MES[mes - 1]} {anio}.
          {esJefatura ? " Sube el planeador para llenarlos." : ""}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[11.5px] text-muted max-w-2xl">
              El presupuesto de cada persona es el dato inicial del planeador. La <strong>venta</strong> sale de los cierres
              del día que vas cargando y el <strong>% a la fecha</strong> la compara con lo que ya debía llevar
              {factor != null ? ` (${Math.round(factor * 100)}% del presupuesto del mes al último cierre)` : " (aún no hay cierres cargados)"}.
            </p>
            <button
              type="button"
              onClick={() => setDetalle((v) => !v)}
              className="text-[12px] font-semibold text-brand hover:underline"
            >
              {detalle ? "Ocultar detalle" : "Ver detalle (pares, accesorios, ropa…)"}
            </button>
          </div>
          <div className="bg-panel border border-line rounded-[10px] overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-muted uppercase tracking-wider text-[10.5px] border-b border-line">
                  <th className="px-3 py-2">Nombre</th>
                  <th className="px-2 py-2 text-right">Presupuesto del mes</th>
                  <th className="px-2 py-2 text-right">Meta a la fecha</th>
                  <th className="px-2 py-2 text-right">Venta a la fecha</th>
                  <th className="px-2 py-2 text-right">% a la fecha</th>
                  {hayUpt && (
                    <>
                      <th className="px-2 py-2 text-right">UPT</th>
                      <th className="px-2 py-2 text-right">Facturas</th>
                    </>
                  )}
                  {detalle && (
                    <>
                      <th className="px-2 py-2 text-right">Pares M/V</th>
                      <th className="px-2 py-2 text-right">Acc M/V</th>
                      <th className="px-2 py-2 text-right">Ropa M/V</th>
                      <th className="px-2 py-2 text-right">Unds</th>
                      <th className="px-2 py-2 text-right">Horas</th>
                    </>
                  )}
                  {esJefatura && <th className="px-2 py-2" />}
                </tr>
              </thead>
              <tbody>
                {ordenados.map((k) => {
                  const p = nombreDe.get(k.persona_id);
                  const metaFecha = factor != null && k.presupuesto ? k.presupuesto * factor : null;
                  const ventaFecha = ventaViva.get(k.persona_id) ?? null;
                  const mostrado = pctVivo(k);
                  const est = estiloCumplimiento(mostrado);
                  return (
                    <tr key={k.id} className="border-b border-line/60 last:border-0">
                      <td className="px-3 py-1.5">
                        {p?.nombre ?? "—"}
                        {p && <span className="text-muted text-[11px]"> · {p.cargo}</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">{fmtMoney(k.presupuesto)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-muted">{metaFecha != null ? fmtMoney(metaFecha) : "—"}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{ventaFecha != null ? fmtMoney(ventaFecha) : "—"}</td>
                      <td className={"px-2 py-1.5 text-right font-mono font-semibold " + est.text}>
                        {mostrado != null ? `${Math.round(mostrado * 100)}%` : "—"}
                      </td>
                      {hayUpt && (
                        <>
                          <td className="px-2 py-1.5 text-right font-mono">{num(uptDe(k), 2)}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{num(k.trx)}</td>
                        </>
                      )}
                      {detalle && (
                        <>
                          <td className="px-2 py-1.5 text-right font-mono">
                            {num(k.pares_meta)}/{num(k.pares_venta)}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono">
                            {num(k.acc_meta)}/{num(k.acc_venta)}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono">
                            {num(k.ropa_meta)}/{num(k.ropa_venta)}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono">{num(k.unidades)}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{num(k.horas)}</td>
                        </>
                      )}
                      {esJefatura && (
                        <td className="px-2 py-1.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setEditando(k)}
                            className="text-brand text-xs font-semibold hover:underline mr-2"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => eliminarFila(k)}
                            className="text-warn text-xs hover:underline"
                          >
                            Eliminar
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editando && (
        <EditarKpiModal
          kpi={editando}
          nombre={nombreDe.get(editando.persona_id)?.nombre ?? "—"}
          onClose={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null);
            onGuardado();
          }}
        />
      )}

      {preview && (
        <PreviewKpis
          parsed={preview.parsed}
          personal={preview.personal}
          target={preview.target}
          semanal={preview.semanal}
          archivo={preview.archivo}
          anioInicial={preview.target?.anio ?? anio}
          mesInicial={preview.target?.mes ?? preview.parsed.mesDetectado ?? mes}
          subidoPor={subidoPor}
          onClose={() => setPreview(null)}
          onGuardado={() => {
            setPreview(null);
            onGuardado();
          }}
        />
      )}
    </div>
  );
}

function PreviewKpis({
  parsed,
  personal,
  target,
  semanal,
  archivo,
  anioInicial,
  mesInicial,
  subidoPor,
  onClose,
  onGuardado,
}: {
  parsed: KpisMensualParsed;
  personal: PersonaMatch[];
  target: TargetParsed | null;
  semanal: KpisMensualParsed | null;
  archivo: string;
  anioInicial: number;
  mesInicial: number;
  subidoPor: string;
  onClose: () => void;
  onGuardado: () => void;
}) {
  // Solo se registran asesores, cajeros y part-time: jefe de tienda y subjefes auditan.
  const registrables = useMemo(
    () =>
      personal
        .filter((p) => !esMandoPersona(p))
        .sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [personal],
  );
  const persona = (id: string) => personal.find((p) => p.id === id);

  const [anio, setAnio] = useState(anioInicial);
  const [mes, setMes] = useState(mesInicial);
  // Qué partes del planeador se guardan.
  const [guardarCalendario, setGuardarCalendario] = useState(!!target);
  const [guardarSemanal, setGuardarSemanal] = useState(!!semanal);
  // Por defecto solo se cargan los datos iniciales (presupuestos, metas, fechas). Lo vendido sale de los
  // cierres del día; esta casilla trae también las cifras vendidas que tenga el Excel.
  const [importarActuales, setImportarActuales] = useState(false);
  const [semanaRetail, setSemanaRetail] = useState<number>(() => {
    if (!semanal?.semanaNumero || !target) return 1;
    const n = semanal.semanaNumero;
    if (n <= target.semanas.length) return n;
    // Semana del año (p. ej. 36) → semana del mes retail, según la semana ISO en que empieza.
    const c = new Date(target.inicio + "T00:00:00");
    c.setDate(c.getDate() + 1);
    const d = new Date(Date.UTC(c.getFullYear(), c.getMonth(), c.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const iso = Math.ceil(((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
    return Math.min(Math.max(n - iso + 1, 1), target.semanas.length);
  });
  const [asignado, setAsignado] = useState<Record<number, string>>(() => {
    const m: Record<number, string> = {};
    parsed.filas.forEach((f, i) => (m[i] = f.omitir ? "" : (f.personaId ?? "")));
    return m;
  });
  // Personas de Personal que jefatura confirma que NO tienen KPIs este mes.
  const [sinDatos, setSinDatos] = useState<Set<string>>(new Set());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const asignadas = new Set(Object.values(asignado).filter(Boolean));
  const faltan = registrables.filter((p) => !asignadas.has(p.id) && !sinDatos.has(p.id));
  const confirmadasSinDatos = registrables.filter((p) => !asignadas.has(p.id) && sinDatos.has(p.id));
  const filasLibres = parsed.filas
    .map((f, i) => ({ f, i }))
    .filter(({ f, i }) => !f.omitir && !asignado[i]);
  const omitidas = parsed.filas.filter((f) => f.omitir);
  const sinAsignar = filasLibres.length;
  const conError = filasLibres.filter(({ f }) => f.alertas.some((a) => a.nivel === "error")).length;
  const totalAsignadas = Object.values(asignado).filter(Boolean).length;

  function vincular(idxFila: number, personaId: string) {
    setAsignado((a) => ({ ...a, [idxFila]: personaId }));
  }

  async function guardar() {
    setError(null);
    if (faltan.length > 0) {
      setError(`Responde por ${faltan.length} persona(s) del equipo que no salen en el Excel.`);
      return;
    }
    const filas: { f: FilaKpiExcel; personaId: string }[] = [];
    parsed.filas.forEach((f, i) => {
      if (asignado[i]) filas.push({ f, personaId: asignado[i] });
    });
    const repetidos = filas.length - new Set(filas.map((x) => x.personaId)).size;
    if (repetidos > 0) {
      setError("Hay personas asignadas a más de una fila del Excel. Revisa las asignaciones.");
      return;
    }
    if (filas.length === 0) {
      setError("No hay filas asignadas a personas del equipo.");
      return;
    }
    const conAlertaGrave = filas.filter(
      ({ f }) => f.personaId == null && f.alertas.some((a) => a.nivel === "error"),
    );
    if (
      conAlertaGrave.length > 0 &&
      !confirm(
        `Asignaste a mano ${conAlertaGrave.length} fila(s) que tenían alertas de identificación (${conAlertaGrave
          .map(({ f }) => f.nombreExcel.trim())
          .join(", ")}). ¿Confirmas que son las personas correctas?`,
      )
    ) {
      return;
    }
    setGuardando(true);
    if (guardarCalendario && target) {
      const errCal = await guardarCalendarioRetail();
      if (errCal) {
        setGuardando(false);
        setError(errCal);
        return;
      }
    }
    const rows = filas.map(({ f, personaId }) => ({
      persona_id: personaId,
      anio,
      mes,
      presupuesto: f.presupuesto,
      // Lo vendido solo se importa si se pidió; si no, el ranking usa los cierres del día.
      acumulado_bruto: importarActuales ? f.acumuladoBruto : null,
      acumulado_neto: importarActuales ? f.acumuladoNeto : null,
      cumplimiento: importarActuales
        ? f.presupuesto && f.presupuesto > 0 && f.acumuladoNeto != null
          ? f.acumuladoNeto / f.presupuesto
          : f.cumplimiento
        : null,
      pares_meta: f.paresMeta,
      pares_venta: importarActuales ? f.paresVenta : null,
      acc_meta: f.accMeta,
      acc_venta: importarActuales ? f.accVenta : null,
      ropa_meta: f.ropaMeta,
      ropa_venta: importarActuales ? f.ropaVenta : null,
      unidades: importarActuales ? f.unidades : null,
      trx: importarActuales ? f.trx : null,
      upt: importarActuales ? f.upt : null,
      horas: f.horas,
      subido_por: subidoPor,
    }));
    const { error: err } = await supabase
      .from("kpis_mensuales")
      .upsert(rows, { onConflict: "persona_id,anio,mes" });
    if (err) {
      setGuardando(false);
      setError(err.message);
      return;
    }
    // Registro de la carga: alimenta la meta por asesor (venta por hora) y el historial.
    if (parsed.ventaPorHora || parsed.presupuestoTotal) {
      await supabase.from("presupuestos_uploads").insert({
        anio,
        mes,
        semana_label: null,
        nombre_archivo: archivo,
        subido_por: subidoPor,
        presupuesto_total: parsed.presupuestoTotal,
        horas_total: parsed.horasTotal,
        venta_por_hora: parsed.ventaPorHora,
        fecha_corte: target?.fechaCorte ?? null,
      });
    }
    if (guardarSemanal && semanal) {
      const errSem = await guardarKpisSemana();
      if (errSem) {
        setGuardando(false);
        setError(errSem);
        return;
      }
    }
    setGuardando(false);
    onGuardado();
  }

  /** Guarda el mes retail, la meta de cada día y la venta real de los días ya cerrados. */
  async function guardarCalendarioRetail(): Promise<string | null> {
    if (!target) return null;
    const { error: e1 } = await supabase.from("meses_retail").upsert({
      anio: target.anio,
      mes: target.mes,
      nombre: target.nombreMes,
      inicio: target.inicio,
      fin: target.fin,
      presupuesto: target.presupuesto,
      tienda: target.tienda,
      semanas: target.semanas,
      // Trazabilidad: qué archivo, quién, cuándo y hasta qué día llegan los datos.
      archivo,
      cargado_por: subidoPor,
      cargado_en: new Date().toISOString(),
      fecha_corte: target.fechaCorte,
      meta_a_corte: target.metaACorte,
      venta_a_corte: target.ventaACorte,
    });
    if (e1) return "No pude guardar el calendario retail: " + e1.message + " (¿aplicaste las migraciones 0020 y 0021?)";
    // No se pisa una venta del día que ya vino de los cierres (PDF/fotos).
    const { data: existentes } = await supabase
      .from("presupuestos_diarios")
      .select("fecha, venta")
      .gte("fecha", target.inicio)
      .lte("fecha", target.fin);
    const conVenta = new Set(
      ((existentes as { fecha: string; venta: number | null }[] | null) ?? [])
        .filter((x) => x.venta != null)
        .map((x) => x.fecha),
    );
    const base = target.dias.map((d) => ({
      fecha: d.fecha,
      meta: d.target,
      anio_anterior: d.anioAnterior,
      venta_con_iva: d.ventaConIva,
      registrado_por: subidoPor,
    }));
    const { error: e2 } = await supabase
      .from("presupuestos_diarios")
      .upsert(
        base.filter((b) => !importarActuales || conVenta.has(b.fecha) || target.dias.find((d) => d.fecha === b.fecha)?.real == null),
        { onConflict: "fecha" },
      );
    if (e2) return "No pude guardar las metas por día: " + e2.message;
    const conReal = target.dias
      .filter((d) => importarActuales && d.real != null && !conVenta.has(d.fecha))
      .map((d) => ({
        fecha: d.fecha,
        meta: d.target,
        anio_anterior: d.anioAnterior,
        venta_con_iva: d.ventaConIva,
        venta: d.real,
        registrado_por: subidoPor,
      }));
    if (conReal.length > 0) {
      const { error: e3 } = await supabase.from("presupuestos_diarios").upsert(conReal, { onConflict: "fecha" });
      if (e3) return "No pude guardar la venta real por día: " + e3.message;
    }
    return null;
  }

  /** Guarda los KPIs de la semana (hoja "Kpis semanal") como presupuestos semanales. */
  async function guardarKpisSemana(): Promise<string | null> {
    if (!semanal) return null;
    const label = `Semana ${semanaRetail}`;
    const filas = semanal.filas.filter((f) => !f.omitir && f.personaId);
    if (filas.length === 0) return null;
    const { error: e1 } = await supabase
      .from("presupuestos_semanales")
      .delete()
      .eq("anio", anio)
      .eq("mes", mes)
      .eq("semana_label", label);
    if (e1) return "No pude reemplazar la semana: " + e1.message;
    const { error: e2 } = await supabase.from("presupuestos_semanales").insert(
      filas.map((f) => ({
        persona_id: f.personaId,
        anio,
        mes,
        semana_label: label,
        meta: f.presupuesto,
        venta: importarActuales ? f.acumuladoNeto : null,
        cumplimiento: importarActuales
          ? f.presupuesto && f.presupuesto > 0 && f.acumuladoNeto != null
            ? f.acumuladoNeto / f.presupuesto
            : f.cumplimiento
          : null,
        horas_reportadas: f.horas,
      })),
    );
    return e2 ? "No pude guardar los KPIs de la semana: " + e2.message : null;
  }

  const etiquetaPersona = (p: PersonaMatch) => `${p.codigo ? p.codigo : "sin CM"} — ${p.nombre}`;

  return (
    <Modal titulo="Vista previa de KPIs" onClose={onClose} ancho="max-w-5xl">
      <p className="text-[12.5px] text-muted mb-3">
        Hoja <strong>{parsed.hoja}</strong> · {parsed.filas.length} filas. Cada fila se identifica con el{" "}
        <strong>CM</strong> (código de empleado) cruzado con la hoja Plantilla y con Personal. Jefe de
        tienda y subjefes no se registran porque auditan. La lista desplegable muestra el CM de cada
        persona registrada para que puedas compararlo con el del Excel.
      </p>
      <div className="flex gap-3 mb-3 items-end">
        <label className="text-xs text-muted uppercase tracking-wider">
          Mes
          <select
            value={mes}
            onChange={(e) => setMes(parseInt(e.target.value, 10))}
            className={inputCls + " block mt-1"}
          >
            {NOMBRES_MES.map((n, i) => (
              <option key={n} value={i + 1}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted uppercase tracking-wider">
          Año
          <input
            type="number"
            value={anio}
            onChange={(e) => setAnio(parseInt(e.target.value, 10) || anio)}
            className={inputCls + " block mt-1 w-24"}
          />
        </label>
      </div>

      <label className="mb-3 flex items-start gap-2 text-[12.5px] cursor-pointer border border-line bg-white rounded-md px-3 py-2">
        <input
          type="checkbox"
          checked={importarActuales}
          onChange={(e) => setImportarActuales(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <strong>Importar también lo vendido que trae el Excel</strong> (venta, pares, accesorios, ropa, UPT y
          facturas). Déjalo apagado si vas a ir cargando los cierres del día: el ranking se arma con esos cierres y
          el Excel solo aporta los datos iniciales (presupuestos, metas y fechas).
        </span>
      </label>

      {target && (
        <div className="mb-3 border border-brand/30 bg-brand/5 rounded-md px-3 py-2.5">
          <label className="flex items-start gap-2 text-[13px] cursor-pointer">
            <input
              type="checkbox"
              checked={guardarCalendario}
              onChange={(e) => setGuardarCalendario(e.target.checked)}
              className="mt-1"
            />
            <span>
              <strong>Calendario retail y metas por día</strong> (hoja {target.hoja}): mes de{" "}
              <strong>{target.nombreMes} {target.anio}</strong>, del <strong>{target.inicio}</strong> al{" "}
              <strong>{target.fin}</strong> ({target.dias.length} días, {target.semanas.length} semanas), presupuesto{" "}
              <strong>{fmtMoney(target.presupuesto)}</strong>
              {target.tienda ? ` · tienda ${target.tienda}` : ""}. El mes se cuenta con las fechas de la compañía,
              no con el mes calendario.
            </span>
          </label>
        </div>
      )}
      {semanal && (
        <div className="mb-3 border border-line bg-white rounded-md px-3 py-2.5">
          <label className="flex items-start gap-2 text-[13px] cursor-pointer">
            <input
              type="checkbox"
              checked={guardarSemanal}
              onChange={(e) => setGuardarSemanal(e.target.checked)}
              className="mt-1"
            />
            <span>
              <strong>KPIs de la semana</strong> (hoja {semanal.hoja}
              {semanal.semanaNumero ? `, "SEMANA ${semanal.semanaNumero}"` : ""}):{" "}
              {semanal.filas.filter((f) => !f.omitir && f.personaId).length} personas identificadas de{" "}
              {semanal.filas.filter((f) => !f.omitir).length}. Se guardan como la semana retail{" "}
              <select
                value={semanaRetail}
                onChange={(e) => setSemanaRetail(parseInt(e.target.value, 10))}
                className={inputCls + " inline-block py-0.5 px-1.5 text-[12px] w-auto"}
                onClick={(e) => e.stopPropagation()}
              >
                {Array.from({ length: target?.semanas.length ?? 5 }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}
                    {target?.semanas[i] ? ` (${target.semanas[i].inicio.slice(5)} a ${target.semanas[i].fin.slice(5)})` : ""}
                  </option>
                ))}
              </select>
              .
            </span>
          </label>
        </div>
      )}

      <div className="overflow-x-auto border border-line rounded-md">
        <table className="w-full text-[12px] min-w-[780px]">
          <thead>
            <tr className="text-left text-muted uppercase tracking-wider text-[10.5px] border-b border-line">
              <th className="px-2 py-1.5">Fila del Excel</th>
              <th className="px-2 py-1.5">CM Excel</th>
              <th className="px-2 py-1.5 text-right">Presup.</th>
              <th className="px-2 py-1.5 text-right">Venta neta</th>
              <th className="px-2 py-1.5 text-right">%</th>
              <th className="px-2 py-1.5">Persona registrada (CM — nombre)</th>
            </tr>
          </thead>
          <tbody>
            {parsed.filas.map((f, i) => {
              if (f.omitir) {
                return (
                  <tr key={i} className="border-b border-line/60 bg-neutral-100/70 text-muted">
                    <td className="px-2 py-1.5">
                      <strong>{f.nombreExcel}</strong>
                      <span> · {f.cargoExcel}</span>
                    </td>
                    <td className="px-2 py-1.5 font-mono">{f.cmResuelto ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{fmtMoney(f.presupuesto)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{fmtMoney(f.acumuladoNeto)}</td>
                    <td className="px-2 py-1.5" />
                    <td className="px-2 py-1.5 text-[11px]">Jefe / subjefe: audita, no se registra.</td>
                  </tr>
                );
              }
              const hayError = f.alertas.some((a) => a.nivel === "error");
              const hayAviso = f.alertas.length > 0;
              const sel = asignado[i] ? persona(asignado[i]) : undefined;
              const cmExcel = f.cmExcel ?? f.cmResuelto;
              const cmPers = sel?.codigo ? sel.codigo.replace(/\D/g, "") : "";
              const compara =
                sel && cmExcel
                  ? cmPers === cmExcel
                    ? { ok: true, texto: `✓ CM coincide (${cmExcel})` }
                    : {
                        ok: false,
                        texto: cmPers
                          ? `⚠ CM Excel ${cmExcel} ≠ CM Personal ${cmPers}`
                          : `⚠ Esta persona no tiene CM en Personal (Excel: ${cmExcel})`,
                      }
                  : null;
              return (
                <tr
                  key={i}
                  className={
                    "border-b border-line/60 last:border-0 align-top " +
                    (hayError && !asignado[i] ? "bg-warn-soft/50" : hayAviso ? "bg-amber-50/60" : "")
                  }
                >
                  <td className="px-2 py-1.5">
                    <strong>{f.nombreExcel}</strong>
                    <span className="text-muted"> · {f.cargoExcel}</span>
                    {f.alertas.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {f.alertas.map((a, k) => (
                          <li
                            key={k}
                            className={
                              "text-[11px] leading-snug " + (a.nivel === "error" ? "text-warn" : "text-[#8A5A16]")
                            }
                          >
                            {a.nivel === "error" ? "⛔ " : "⚠ "}
                            {a.texto}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-2 py-1.5 font-mono">
                    {cmExcel ?? "—"}
                    {!f.cmExcel && f.cmResuelto && (
                      <div className="text-[10px] text-muted font-sans">de la Plantilla</div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmtMoney(f.presupuesto)}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmtMoney(f.acumuladoNeto)}</td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    {f.presupuesto && f.acumuladoNeto != null
                      ? `${Math.round((f.acumuladoNeto / f.presupuesto) * 100)}%`
                      : f.cumplimiento != null
                        ? `${Math.round(f.cumplimiento * 100)}%`
                        : "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      value={asignado[i]}
                      onChange={(e) => vincular(i, e.target.value)}
                      className={
                        inputCls + " w-full py-1 " + (asignado[i] ? "" : "border-amber-400 bg-amber-50")
                      }
                    >
                      <option value="">— No importar —</option>
                      {registrables.map((p) => {
                        const usadaEnOtra = asignadas.has(p.id) && asignado[i] !== p.id;
                        return (
                          <option key={p.id} value={p.id} disabled={usadaEnOtra}>
                            {etiquetaPersona(p)}
                            {p.id === f.sugeridoId && p.id !== f.personaId ? " (sugerida)" : ""}
                            {usadaEnOtra ? " (ya asignada)" : ""}
                          </option>
                        );
                      })}
                    </select>
                    {compara && (
                      <div className={"text-[10.5px] mt-0.5 " + (compara.ok ? "text-operaciones" : "text-warn")}>
                        {compara.texto}
                      </div>
                    )}
                    {sel && f.personaId !== asignado[i] && !compara && (
                      <div className="text-[10.5px] text-[#8A5A16] mt-0.5">Asignada a mano</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {omitidas.length > 0 && (
        <p className="text-[11.5px] text-muted mt-1.5">
          {omitidas.length} fila(s) de jefe/subjefe no se importan:{" "}
          {omitidas.map((f) => f.nombreExcel.trim()).join(", ")}.
        </p>
      )}
      {sinAsignar > 0 && (
        <p className="text-[12px] text-[#8A5A16] mt-2">
          {sinAsignar} fila(s) del Excel sin asignar no se importarán
          {conError > 0 ? ` (${conError} con alertas de identificación)` : ""}.
        </p>
      )}

      {(faltan.length > 0 || confirmadasSinDatos.length > 0) && (
        <div className="mt-3 border border-amber-300 bg-amber-50 rounded-md px-3 py-3">
          <div className="text-[13px] font-semibold text-[#8A5A16] mb-1">
            Personas registradas en Personal que no salen en el Excel
            {faltan.length > 0 ? ` — falta responder por ${faltan.length}` : " — todas respondidas"}
          </div>
          <p className="text-[11.5px] text-muted mb-2">
            Para cada una indica si corresponde a alguna fila del Excel que no se reconoció (por ejemplo,
            el nombre está escrito distinto) o confirma que este mes no tiene KPIs.
          </p>
          <div className="space-y-2">
            {faltan.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2 flex-wrap bg-white border border-line rounded-md px-2.5 py-2"
              >
                <div className="min-w-[180px] flex-1">
                  <div className="text-[13px] font-semibold">{p.nombre}</div>
                  <div className={"text-[11px] " + (p.codigo ? "text-muted" : "text-warn")}>
                    {p.codigo ? `CM ${p.codigo}` : "Sin CM en Personal"} · {p.cargo ?? ""}
                  </div>
                </div>
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value !== "") vincular(parseInt(e.target.value, 10), p.id);
                  }}
                  className={inputCls + " py-1 text-[12px] max-w-[260px]"}
                >
                  <option value="">Vincular con una fila del Excel…</option>
                  {filasLibres.map(({ f, i }) => (
                    <option key={i} value={i}>
                      {f.nombreExcel.trim()} {f.cmResuelto ? `(CM ${f.cmResuelto})` : `· ${f.cargoExcel}`}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setSinDatos((s) => new Set(s).add(p.id))}
                  className="px-2.5 py-1 rounded-md border border-line bg-white text-[12px] hover:bg-paper"
                >
                  No tiene KPIs este mes
                </button>
              </div>
            ))}
            {confirmadasSinDatos.map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-[12px] text-muted">
                <span>✓ {p.nombre} · sin KPIs este mes</span>
                <button
                  type="button"
                  onClick={() =>
                    setSinDatos((s) => {
                      const n = new Set(s);
                      n.delete(p.id);
                      return n;
                    })
                  }
                  className="text-brand hover:underline"
                >
                  Deshacer
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={guardar}
        disabled={guardando || faltan.length > 0}
        className="mt-4 w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light"
      >
        {guardando
          ? "Guardando…"
          : faltan.length > 0
            ? `Responde por ${faltan.length} persona(s) para poder guardar`
            : `Guardar KPIs de ${NOMBRES_MES[mes - 1]} ${anio} (${totalAsignadas} personas)`}
      </button>
    </Modal>
  );
}

const CAMPOS_KPI: { key: keyof KpiMensual; label: string; dec?: boolean }[] = [
  { key: "presupuesto", label: "Presupuesto del mes ($)" },
  { key: "acumulado_bruto", label: "Acumulado bruto ($)" },
  { key: "acumulado_neto", label: "Venta neta ($)" },
  { key: "pares_meta", label: "Pares · meta", dec: true },
  { key: "pares_venta", label: "Pares · venta" },
  { key: "acc_meta", label: "Accesorios · meta", dec: true },
  { key: "acc_venta", label: "Accesorios · venta" },
  { key: "ropa_meta", label: "Ropa · meta", dec: true },
  { key: "ropa_venta", label: "Ropa · venta" },
  { key: "unidades", label: "Unidades vendidas" },
  { key: "trx", label: "Transacciones (facturas)" },
  { key: "upt", label: "UPT (vacío = unidades ÷ facturas)", dec: true },
  { key: "horas", label: "Horas trabajadas" },
];

/** Corrige a mano los KPIs de una persona (cuando el Excel traía un dato equivocado). */
function EditarKpiModal({
  kpi,
  nombre,
  onClose,
  onGuardado,
}: {
  kpi: KpiMensual;
  nombre: string;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [valores, setValores] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    CAMPOS_KPI.forEach((c) => (v[c.key] = kpi[c.key] == null ? "" : String(kpi[c.key])));
    return v;
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numero = (k: string): number | null => {
    const t = valores[k].trim().replace(",", ".");
    if (t === "") return null;
    const n = Number(t);
    return isFinite(n) ? n : NaN;
  };

  async function guardar() {
    setError(null);
    const patch: Record<string, number | null> = {};
    for (const c of CAMPOS_KPI) {
      const n = numero(c.key);
      if (n != null && isNaN(n)) return setError(`"${c.label}" no es un número válido.`);
      if (n != null && n < 0) return setError(`"${c.label}" no puede ser negativo.`);
      patch[c.key] = n;
    }
    // El cumplimiento se recalcula con la venta neta y el presupuesto corregidos.
    patch.cumplimiento =
      patch.presupuesto && patch.presupuesto > 0 && patch.acumulado_neto != null
        ? patch.acumulado_neto / patch.presupuesto
        : null;
    setGuardando(true);
    const { error: err } = await supabase.from("kpis_mensuales").update(patch).eq("id", kpi.id);
    setGuardando(false);
    if (err) return setError(err.message);
    onGuardado();
  }

  const neto = numero("acumulado_neto");
  const pto = numero("presupuesto");
  const cumpl = pto && neto != null && !isNaN(neto) && !isNaN(pto) ? neto / pto : null;

  return (
    <Modal titulo={`Corregir KPIs — ${nombre}`} onClose={onClose} ancho="max-w-2xl">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {CAMPOS_KPI.map((c) => (
          <label key={c.key} className="text-[11px] text-muted uppercase tracking-wider">
            {c.label}
            <input
              inputMode="decimal"
              value={valores[c.key]}
              onChange={(e) => setValores((v) => ({ ...v, [c.key]: e.target.value }))}
              className={inputCls + " block w-full mt-1 font-mono normal-case tracking-normal"}
            />
          </label>
        ))}
      </div>
      <p className="text-[12px] text-muted mt-3">
        Cumplimiento resultante:{" "}
        <strong className="font-mono">{cumpl != null ? `${Math.round(cumpl * 100)}%` : "—"}</strong> (venta neta /
        presupuesto).
      </p>
      {error && (
        <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={guardar}
        disabled={guardando}
        className="mt-4 w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light"
      >
        {guardando ? "Guardando…" : "Guardar corrección"}
      </button>
    </Modal>
  );
}

/** Tarjeta "¿Qué archivo hay cargado?": archivo, quién lo subió, cuándo y hasta qué fecha llegan los datos. */
function CargaInfo({
  mesInfo,
  roster,
  kpis,
  avanceMes,
}: {
  mesInfo: MesRetail | null;
  roster: PersonaRk[];
  kpis: KpiMensual[];
  avanceMes: AvanceMes | null;
}) {
  if (!mesInfo) {
    return (
      <div className="text-[12px] text-muted bg-panel border border-line rounded-md px-3 py-2">
        Todavía no hay un planeador cargado para este mes.
      </div>
    );
  }
  const quien = roster.find((p) => p.id === mesInfo.cargado_por)?.nombre;
  const totalPto = kpis.reduce((a, k) => a + (k.presupuesto ?? 0), 0);
  return (
    <div className="bg-panel border border-line rounded-[10px] px-4 py-3 grid grid-cols-2 lg:grid-cols-4 gap-3 text-[12.5px]">
      <div>
        <div className="text-[10.5px] text-muted uppercase tracking-wider">Archivo cargado</div>
        <div className="font-semibold break-all">{mesInfo.archivo ?? "— (sin registro)"}</div>
        <div className="text-[11px] text-muted">
          {quien ? `por ${quien}` : ""}
          {mesInfo.cargado_en ? ` · ${new Date(mesInfo.cargado_en).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}` : ""}
        </div>
      </div>
      <div>
        <div className="text-[10.5px] text-muted uppercase tracking-wider">Mes retail</div>
        <div className="font-semibold">
          {mesInfo.inicio} → {mesInfo.fin}
        </div>
        <div className="text-[11px] text-muted">{mesInfo.semanas.length} semanas</div>
      </div>
      <div>
        <div className="text-[10.5px] text-muted uppercase tracking-wider">Último cierre cargado</div>
        <div className="font-semibold">{avanceMes?.ultimo_cierre ?? "— (aún ninguno)"}</div>
        <div className="text-[11px] text-muted">{avanceMes?.dias_cerrados ?? 0} día(s) con cierre</div>
      </div>
      <div>
        <div className="text-[10.5px] text-muted uppercase tracking-wider">Presupuesto del mes</div>
        <div className="font-semibold">{fmtMoney(mesInfo.presupuesto)}</div>
        <div className="text-[11px] text-muted">
          {totalPto > 0 ? `asesores: ${fmtMoney(totalPto)}` : "según la hoja Target"}
        </div>
      </div>
    </div>
  );
}
