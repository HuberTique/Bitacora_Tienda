"use client";

import { estiloCumplimiento } from "@/lib/cumplimiento";
import { diasEntre, ymd, type MesRetail } from "@/lib/mes-retail";
import { fmtMoney } from "@/lib/types";
import { uptDe, type AvanceMes, type KpiMensual, type PersonaRk, type RankingConfig } from "@/lib/ranking";
import { textoFaltan } from "@/lib/cierres-faltantes";
import { Tile } from "./ui";

/**
 * Cabecera del módulo: en qué punto del mes retail estamos, qué archivo está
 * cargado y cómo va la tienda frente a la meta A LA FECHA (no contra el mes
 * completo, que es lo que confunde a mitad de mes).
 */
export function ResumenPeriodo({
  cierresFaltan = [],
  avanceMes,
  metaHastaHoy,
  mesInfo,
  kpis,
  roster,
  config,
  esJefatura,
  onCargar,
}: {
  /** Días del mes (hasta ayer) a los que les falta el cierre: la venta sale solo de los cierres. */
  cierresFaltan?: string[];
  /** Avance según los cierres del día cargados. */
  avanceMes: AvanceMes | null;
  /** Meta de la tienda sumando los días hasta hoy incluido. */
  metaHastaHoy?: number | null;
  mesInfo: MesRetail | null;
  kpis: KpiMensual[];
  roster: PersonaRk[];
  config: RankingConfig;
  esJefatura: boolean;
  onCargar: () => void;
}) {
  if (!mesInfo && kpis.length === 0) {
    return (
      <div className="bg-panel border border-line rounded-[10px] p-8 text-center">
        <div className="text-[15px] font-semibold mb-1">Aún no hay datos de este mes</div>
        <p className="text-muted text-sm mb-3">
          {esJefatura
            ? "Sube el planeador (Excel) y el ranking, las metas y los KPIs se llenan solos."
            : "Jefatura todavía no ha cargado el planeador de este mes."}
        </p>
        {esJefatura && (
          <button
            type="button"
            onClick={onCargar}
            className="px-4 py-2 bg-brand text-white rounded-md font-semibold text-sm hover:bg-brand-light"
          >
            Cargar planeador
          </button>
        )}
      </div>
    );
  }

  const hoy = ymd(new Date());
  const dias = mesInfo ? diasEntre(mesInfo.inicio, mesInfo.fin) : [];
  const total = dias.length;
  const transcurridos = mesInfo ? dias.filter((d) => d.fecha <= hoy).length : 0;

  const presupuesto =
    mesInfo?.presupuesto ?? kpis.reduce((a, k) => a + (k.presupuesto ?? 0), 0);
  // Todo se mide con los cierres del día cargados: cada cierre nuevo mueve estas cifras.
  const hayCierres = !!avanceMes?.ultimo_cierre;
  const metaFecha = hayCierres ? avanceMes!.meta_a_cierre : null;
  const ventaFecha = hayCierres ? avanceMes!.venta_total : 0;
  const cumpl = metaFecha && metaFecha > 0 ? ventaFecha / metaFecha : null;
  const falta = Math.max(0, presupuesto - ventaFecha);
  const avance = metaFecha && presupuesto > 0 ? metaFecha / presupuesto : null;
  const corte = avanceMes?.ultimo_cierre ?? null;
  const proyeccion = avance && avance > 0 ? ventaFecha / avance : null;

  // UPT del equipo: el de cada persona (el de Xstore o unidades ÷ TRX) ponderado por su TRX.
  const conUpt = kpis.filter((k) => (k.trx ?? 0) > 0 && uptDe(k) != null);
  const trx = conUpt.reduce((a, k) => a + k.trx!, 0);
  const upt = trx > 0 ? conUpt.reduce((a, k) => a + uptDe(k)! * k.trx!, 0) / trx : null;

  const quien = roster.find((p) => p.id === mesInfo?.cargado_por)?.nombre;

  return (
    <div className="space-y-3">
      {mesInfo && (
        <div className="bg-panel border border-line rounded-[10px] px-4 py-3">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div className="text-[13px]">
              <strong>Mes retail:</strong> {mesInfo.inicio} → {mesInfo.fin}{" "}
              <span className="text-muted">({total} días, {mesInfo.semanas.length} semanas)</span>
            </div>
            <div className="text-[12px] text-muted">
              {transcurridos > 0 && transcurridos <= total ? `Hoy es el día ${transcurridos} de ${total}` : transcurridos > total ? "Mes terminado" : "Aún no empieza"}
              {corte ? ` · ventas cargadas hasta el ${corte}` : " · aún no hay ventas cargadas"}
            </div>
          </div>
          <div className="relative h-2 rounded-full bg-neutral-100 mt-2 overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-brand/60 rounded-full"
              style={{ width: `${total ? Math.min(100, (transcurridos / total) * 100) : 0}%` }}
            />
          </div>
          <div className="text-[11px] text-muted mt-1.5">
            Archivo: <strong>{mesInfo.archivo ?? "sin registro"}</strong>
            {quien ? ` · subido por ${quien}` : ""}
            {mesInfo.cargado_en
              ? ` · ${new Date(mesInfo.cargado_en).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}`
              : ""}
          </div>
        </div>
      )}

      {cierresFaltan.length > 0 && (
        <div className="text-[12px] bg-amber-50 border border-amber-300 text-[#8A5A16] rounded-md px-3 py-2">
          ⚠ {textoFaltan(cierresFaltan)} La venta a la fecha y el ranking quedan incompletos hasta que se suban
          {esJefatura ? " (Cargar datos → Ventas → Registrar cierre del día)." : "."}
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile valor={fmtMoney(presupuesto)} etiqueta="Presupuesto del mes" />
        {/* La meta a la fecha incluye HOY (lo que hay que llevar al cerrar el día); el
            cumplimiento se sigue midiendo contra los días que ya tienen cierre cargado. */}
        <Tile
          valor={metaHastaHoy != null && metaHastaHoy > 0 ? fmtMoney(metaHastaHoy) : metaFecha != null ? fmtMoney(metaFecha) : "—"}
          etiqueta={metaHastaHoy != null && metaHastaHoy > 0 ? `Meta a la fecha (con hoy, ${hoy.slice(5)})` : corte ? `Meta a la fecha (${corte.slice(5)})` : "Meta a la fecha"}
        />
        <Tile valor={hayCierres ? fmtMoney(ventaFecha) : "—"} etiqueta="Venta a la fecha" />
        <Tile
          valor={cumpl != null ? `${Math.round(cumpl * 100)} %` : "—"}
          etiqueta="Cumplimiento a la fecha"
          color={estiloCumplimiento(cumpl).text}
        />
        <Tile
          valor={upt != null ? upt.toFixed(2) : "—"}
          etiqueta={`UPT del equipo (meta ${config.upt_meta})`}
          color={upt != null && upt >= config.upt_meta ? "text-operaciones" : "text-warn"}
        />
      </div>
      <p className="text-[11.5px] text-muted">
        Faltan <strong>{fmtMoney(falta)}</strong> para el presupuesto del mes
        {proyeccion != null ? (
          <>
            {" "}
            · al ritmo actual se cerraría en <strong>{fmtMoney(proyeccion)}</strong> (
            {presupuesto > 0 ? Math.round((proyeccion / presupuesto) * 100) : 0}% del presupuesto)
          </>
        ) : null}
        . Se actualiza solo cada vez que cargas un cierre del día. El cumplimiento se mide contra la meta de los días que ya tienen cierre
        {corte && metaFecha != null ? (
          <>
            {" "}
            (hasta el {corte.slice(5)}: <strong>{fmtMoney(metaFecha)}</strong>)
          </>
        ) : null}
        , para que el día en curso no baje el porcentaje mientras se vende; no se mide contra el mes completo.
      </p>
    </div>
  );
}
