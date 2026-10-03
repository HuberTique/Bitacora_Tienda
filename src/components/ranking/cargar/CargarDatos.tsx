"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { NOMBRES_MES } from "@/lib/horarios";
import { fmtMoney, type Horario, type Persona, type PersonalCodigoAlterno } from "@/lib/types";
import { construirPeriodo, mesesCalendario, type MesRetail } from "@/lib/mes-retail";
import { leerTargetDesdeArchivo } from "@/lib/planeador-excel";
import { leerKpisMensualDesdeArchivo, type PersonaMatch } from "@/lib/kpis-mensual-excel";
import { leerPreciosPromedio } from "@/lib/precios-excel";
import { RegistrarVentasDiaModal } from "@/components/PresupuestosPanel";
import { ConsolidadasCard } from "../ConsolidadasCard";
import { Modal } from "../ui";
import { PresupuestoModal, type DatosPlaneador } from "./PresupuestoModal";
import { TrxModal } from "./TrxModal";
import { cargasDelMes, eliminarCarga, type Carga } from "./cargas";

type Estado = "ok" | "provisional" | "falta";

const fechaHora = (iso: string) => new Date(iso).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });

function Insignia({ estado, texto }: { estado: Estado; texto: string }) {
  const cls =
    estado === "ok"
      ? "bg-emerald-50 text-operaciones border-emerald-200"
      : estado === "provisional"
        ? "bg-amber-50 text-[#8A5A16] border-amber-300"
        : "bg-warn-soft text-warn border-warn-border";
  const icono = estado === "ok" ? "✓" : estado === "provisional" ? "⚠" : "✗";
  return <span className={"inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full border " + cls}>{icono} {texto}</span>;
}

function Paso({ n, titulo, estado, children }: { n: number; titulo: string; estado: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-panel border border-line rounded-[10px] p-4">
      <div className="flex items-center gap-2.5 flex-wrap mb-2">
        <span className="w-6 h-6 rounded-full bg-brand text-white text-[12px] font-bold flex items-center justify-center">{n}</span>
        <h3 className="text-[15px] font-display font-semibold m-0">{titulo}</h3>
        {estado}
      </div>
      {children}
    </section>
  );
}

function Historial({
  cargas,
  nombreDe,
  onEliminar,
}: {
  cargas: Carga[];
  nombreDe: (id: string | null) => string;
  onEliminar: (c: Carga) => void;
}) {
  if (cargas.length === 0) return null;
  const detalle = (c: Carga) => {
    const r = c.resumen as Record<string, number | string | boolean | null>;
    if (c.tipo === "presupuesto") return `${fmtMoney(Number(r.presupuesto ?? 0))} · ${r.inicio} → ${r.fin}`;
    if (c.tipo === "ventas_consolidadas") return `${fmtMoney(Number(r.total ?? 0))} · ventas hasta el ${r.corte ?? "—"}`;
    return `${r.personas ?? 0} persona(s)`;
  };
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-[12px] text-brand font-semibold select-none">Historial de cargas ({cargas.length})</summary>
      <ul className="mt-2 space-y-1.5">
        {cargas.map((c) => (
          <li key={c.id} className="flex items-center gap-2 flex-wrap text-[12.5px] border border-line rounded-md bg-white px-3 py-1.5">
            <span className="flex-1 min-w-[200px]">
              <strong>{c.archivo ?? (c.origen === "manual" ? "Ingresado a mano" : "—")}</strong>
              <span className="text-muted"> · {detalle(c)}</span>
              <span className="block text-[11px] text-muted">
                {fechaHora(c.cargado_at)}
                {c.cargado_por ? ` · ${nombreDe(c.cargado_por)}` : ""}
              </span>
            </span>
            {c.vigente ? <Insignia estado="ok" texto="Vigente" /> : <span className="text-[11px] text-muted">Reemplazada</span>}
            <button type="button" onClick={() => onEliminar(c)} className="text-warn text-xs font-semibold hover:underline">
              Eliminar
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

type KpiResumen = { trx: number | null; acumulado_neto: number | null; presupuesto: number | null };

/**
 * Presupuesto y ranking → Cargar datos, en tres pasos: presupuesto, ventas y
 * transacciones. Aquí solo se carga; el detalle por persona está en Ventas y metas.
 */
export function CargarDatos({
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
  const [cargas, setCargas] = useState<Carga[]>([]);
  const [nombres, setNombres] = useState<Map<string, string>>(new Map());
  const [kpis, setKpis] = useState<KpiResumen[]>([]);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [planeador, setPlaneador] = useState<DatosPlaneador | null>(null);
  const [provisional, setProvisional] = useState(false);
  const [trxAbierto, setTrxAbierto] = useState(false);
  const [metasDia, setMetasDia] = useState<{ fecha: string; meta: number | null; venta: number | null }[] | null>(null);
  const [cierre, setCierre] = useState<{ personal: Persona[]; codigos: PersonalCodigoAlterno[]; horarios: Horario[] } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let vivo = true;
    Promise.all([
      cargasDelMes(anio, mes),
      supabase.from("personal").select("id, nombre"),
      supabase.from("kpis_mensuales").select("trx, acumulado_neto, presupuesto").eq("anio", anio).eq("mes", mes),
    ]).then(([c, p, k]) => {
      if (!vivo) return;
      setCargas(c);
      setNombres(new Map(((p.data as { id: string; nombre: string }[] | null) ?? []).map((x) => [x.id, x.nombre])));
      setKpis((k.data as KpiResumen[] | null) ?? []);
    });
    return () => {
      vivo = false;
    };
  }, [anio, mes, mesInfo, version]);

  const listo = useCallback(() => {
    onGuardado();
    setVersion((v) => v + 1);
  }, [onGuardado]);
  const nombreDe = (id: string | null) => (id ? (nombres.get(id) ?? "—") : "—");

  async function eliminar(c: Carga) {
    const que =
      c.tipo === "presupuesto"
        ? "el presupuesto del mes (presupuesto y metas de cada persona, meta de cada día y mes retail)"
        : c.tipo === "ventas_consolidadas"
          ? "la venta acumulada y las unidades cargadas"
          : "la TRX y el UPT";
    const ok = confirm(
      c.vigente
        ? `¿Eliminar esta carga? Es la vigente: se borra ${que}. Lo vendido en los cierres del día no se toca.`
        : "¿Quitar esta carga del historial? Ya estaba reemplazada: no cambia ningún dato.",
    );
    if (!ok) return;
    const err = await eliminarCarga(c, mesInfo, subidoPor);
    if (err) return setError(err);
    listo();
  }

  async function subirPlaneador(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError(null);
    setLeyendo(true);
    try {
      const { data: pers } = await supabase.from("personal").select("id, nombre, cedula, codigo, activo, cargo, rol_jerarquico").eq("activo", true);
      const personal = (pers as PersonaMatch[] | null) ?? [];
      const buf = await f.arrayBuffer();
      const [t, m, s, precios] = await Promise.all([
        leerTargetDesdeArchivo(f),
        leerKpisMensualDesdeArchivo(buf.slice(0), personal),
        leerKpisMensualDesdeArchivo(buf.slice(0), personal, "semanal"),
        leerPreciosPromedio(buf.slice(0)),
      ]);
      if ("error" in t && "error" in m) throw new Error("No encontré ni la hoja Target ni la hoja Kpis mensual en ese archivo.");
      setPlaneador({
        archivo: f.name,
        target: "error" in t ? null : t,
        mensual: "error" in m ? null : m,
        semanal: "error" in s ? null : s,
        precios,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer el archivo.");
    } finally {
      setLeyendo(false);
    }
  }

  async function verMetasDia() {
    if (!mesInfo) return;
    const { data } = await supabase.from("presupuestos_diarios").select("fecha, meta, venta").gte("fecha", mesInfo.inicio).lte("fecha", mesInfo.fin).order("fecha");
    setMetasDia((data as { fecha: string; meta: number | null; venta: number | null }[] | null) ?? []);
  }

  async function abrirCierre() {
    const per = construirPeriodo(anio, mes, mesInfo);
    const filtro = mesesCalendario(per).map((m) => `and(anio.eq.${m.anio},mes.eq.${m.mes})`).join(",");
    const [p, h, c] = await Promise.all([
      supabase.from("personal").select("*").order("nombre"),
      supabase.from("horarios").select("*").or(filtro),
      supabase.from("personal_codigos_alternos").select("*").eq("estado", "aprobado"),
    ]);
    setCierre({
      personal: (p.data as Persona[] | null) ?? [],
      horarios: (h.data as Horario[] | null) ?? [],
      codigos: (c.data as PersonalCodigoAlterno[] | null) ?? [],
    });
  }

  const deTipo = (t: Carga["tipo"]) => cargas.filter((c) => c.tipo === t);
  const pres = cargas.find((c) => c.tipo === "presupuesto" && c.vigente) ?? null;
  const estadoPres: Estado = !mesInfo?.presupuesto ? "falta" : mesInfo.provisional ? "provisional" : "ok";
  const conVenta = kpis.filter((k) => k.acumulado_neto != null).length;
  const conTrx = kpis.filter((k) => k.trx != null && k.trx > 0).length;
  const estadoVentas: Estado = mesInfo?.ventas_archivo ? "ok" : "falta";
  const estadoTrx: Estado = conTrx > 0 && conTrx >= conVenta ? "ok" : conTrx > 0 ? "provisional" : "falta";
  const periodo = construirPeriodo(anio, mes, mesInfo);

  return (
    <div className="space-y-4">
      <p className="text-[12.5px] text-muted max-w-3xl">
        Las cargas del mes, en orden. Aquí solo se carga; el detalle por persona (presupuesto, venta, pares, UPT) está en{" "}
        <strong>Ventas y metas</strong>.
      </p>
      {error && <div className="bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-sm">{error}</div>}

      <Paso
        n={1}
        titulo="Presupuesto del mes"
        estado={<Insignia estado={estadoPres} texto={estadoPres === "ok" ? "Oficial" : estadoPres === "provisional" ? "Provisional" : "Falta"} />}
      >
        {mesInfo?.presupuesto ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-[12.5px] mb-3">
            <div>
              <div className="text-[10.5px] text-muted uppercase tracking-wider">Presupuesto de la tienda</div>
              <div className="font-semibold text-[15px]">{fmtMoney(mesInfo.presupuesto)}</div>
            </div>
            <div>
              <div className="text-[10.5px] text-muted uppercase tracking-wider">Mes retail</div>
              <div className="font-semibold">
                {mesInfo.inicio} → cierra el {mesInfo.fin}
              </div>
              <div className="text-[11px] text-muted">{mesInfo.semanas.length} semanas</div>
            </div>
            <div>
              <div className="text-[10.5px] text-muted uppercase tracking-wider">Archivo</div>
              <div className="font-semibold break-all">{mesInfo.archivo ?? "—"}</div>
            </div>
            <div>
              <div className="text-[10.5px] text-muted uppercase tracking-wider">Cargado</div>
              <div className="font-semibold">{mesInfo.cargado_en ? fechaHora(mesInfo.cargado_en) : "—"}</div>
              <div className="text-[11px] text-muted">{pres ? nombreDe(pres.cargado_por) : nombreDe(mesInfo.cargado_por)}</div>
            </div>
          </div>
        ) : (
          <p className="text-[12.5px] text-muted mb-3">
            Aún no hay presupuesto para {NOMBRES_MES[mes - 1]} {anio}. Sube el planeador de la DSM o, si todavía no llega,
            ingresa uno provisional.
          </p>
        )}
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={leyendo}
            className="px-3 py-2 rounded-md bg-brand text-white text-sm font-semibold hover:bg-brand-light disabled:opacity-50"
          >
            {leyendo ? "Leyendo…" : "Subir planeador (Excel)"}
          </button>
          <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={subirPlaneador} />
          <button
            type="button"
            onClick={() => setProvisional(true)}
            className="px-3 py-2 rounded-md border border-brand text-brand bg-white text-sm font-semibold hover:bg-brand/5"
          >
            Ingresar provisional
          </button>
          {mesInfo?.presupuesto ? (
            <button type="button" onClick={verMetasDia} className="px-3 py-2 rounded-md border border-line bg-white text-sm font-semibold hover:bg-paper">
              Ver meta por día
            </button>
          ) : null}
        </div>
        <Historial cargas={deTipo("presupuesto")} nombreDe={nombreDe} onEliminar={eliminar} />
      </Paso>

      <Paso
        n={2}
        titulo="Ventas"
        estado={<Insignia estado={estadoVentas} texto={estadoVentas === "ok" ? `Consolidadas hasta el ${mesInfo?.ventas_corte ?? "—"}` : "Faltan consolidadas"} />}
      >
        <div className="flex items-center gap-3 flex-wrap mb-3 text-[12.5px]">
          <span className="text-muted flex-1 min-w-[240px]">
            <strong className="text-ink">Cierre del día:</strong> el PDF de venta por asesor de cada día. Alimenta la venta
            del ranking día a día.
          </span>
          <button
            type="button"
            onClick={abrirCierre}
            className="px-3 py-2 rounded-md bg-operaciones text-white text-sm font-semibold hover:bg-operaciones/90"
          >
            Registrar cierre del día (PDF)
          </button>
        </div>
        <ConsolidadasCard anio={anio} mes={mes} mesInfo={mesInfo} subidoPor={subidoPor} onGuardado={listo} />
        <Historial cargas={deTipo("ventas_consolidadas")} nombreDe={nombreDe} onEliminar={eliminar} />
      </Paso>

      <Paso
        n={3}
        titulo="Transacciones (TRX) para el UPT"
        estado={
          <Insignia
            estado={estadoTrx}
            texto={estadoTrx === "ok" ? "Completa" : estadoTrx === "provisional" ? `${conTrx} de ${conVenta} personas` : "Falta"}
          />
        }
      >
        <p className="text-[12.5px] text-muted mb-3">
          Las ventas consolidadas traen pares, accesorios y ropa, pero no las transacciones. Con la TRX de cada persona
          (reporte de Xstore) se calcula el UPT = unidades ÷ TRX, que también cuenta en el ranking.
          {estadoVentas === "ok" && estadoTrx !== "ok" ? " Ya cargaste las ventas: falta la TRX." : ""}
        </p>
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={() => setTrxAbierto(true)} className="px-3 py-2 rounded-md bg-brand text-white text-sm font-semibold hover:bg-brand-light">
            Ingresar TRX
          </button>
          <button
            type="button"
            disabled
            title="Para activarlo necesito un ejemplo del reporte de transacciones de Xstore"
            className="px-3 py-2 rounded-md border border-line bg-white text-sm font-semibold opacity-50 cursor-not-allowed"
          >
            Subir reporte de Xstore (próximamente)
          </button>
        </div>
        <Historial cargas={deTipo("transacciones")} nombreDe={nombreDe} onEliminar={eliminar} />
      </Paso>

      {(planeador || provisional) && (
        <PresupuestoModal
          anio={anio}
          mes={mes}
          mesInfo={mesInfo}
          subidoPor={subidoPor}
          planeador={planeador}
          onClose={() => {
            setPlaneador(null);
            setProvisional(false);
          }}
          onGuardado={() => {
            setPlaneador(null);
            setProvisional(false);
            listo();
          }}
        />
      )}
      {trxAbierto && (
        <TrxModal
          anio={anio}
          mes={mes}
          subidoPor={subidoPor}
          onClose={() => setTrxAbierto(false)}
          onGuardado={() => {
            setTrxAbierto(false);
            listo();
          }}
        />
      )}
      {cierre && (
        <RegistrarVentasDiaModal
          personal={cierre.personal}
          codigosAlternos={cierre.codigos}
          horarios={cierre.horarios}
          personaId={subidoPor}
          anio={anio}
          mes={mes}
          periodoInicio={periodo.inicio}
          periodoFin={periodo.fin}
          onClose={() => setCierre(null)}
          onSaved={() => {
            setCierre(null);
            listo();
          }}
        />
      )}
      {metasDia && (
        <Modal titulo={`Meta por día — ${NOMBRES_MES[mes - 1]} ${anio}`} onClose={() => setMetasDia(null)}>
          <div className="bg-white border border-line rounded-md overflow-x-auto max-h-[60vh] overflow-y-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-muted uppercase tracking-wider text-[10.5px] border-b border-line">
                  <th className="px-3 py-2">Día</th>
                  <th className="px-2 py-2 text-right">Meta</th>
                  <th className="px-2 py-2 text-right">Venta</th>
                </tr>
              </thead>
              <tbody>
                {metasDia.map((d) => (
                  <tr key={d.fecha} className="border-b border-line/60 last:border-0">
                    <td className="px-3 py-1">
                      {new Date(d.fecha + "T12:00:00").toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" })}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">{d.meta != null ? fmtMoney(d.meta) : "—"}</td>
                    <td className="px-2 py-1 text-right font-mono">{d.venta != null ? fmtMoney(d.venta) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold border-t border-line">
                  <td className="px-3 py-1.5">Total</td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmtMoney(metasDia.reduce((a, d) => a + (d.meta ?? 0), 0))}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmtMoney(metasDia.reduce((a, d) => a + (d.venta ?? 0), 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}
