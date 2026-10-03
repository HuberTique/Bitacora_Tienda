"use client";

// Meta y venta por día de cada asesor, en una sola tabla con tres vistas
// (día, semana, mes). La meta del día sale del presupuesto del mes de cada
// persona repartido según su horario (ver distribuirMetasDiarias); la venta,
// de los cierres del día cargados. Reemplaza la "meta diaria por asesor", la
// "venta registrada por asesor" y las vistas semanal / diario de tienda.

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Periodo } from "@/lib/mes-retail";
import { DIAS_CORTOS, semanasDelPeriodo, type DistribucionAsesor, type MetaDiaria } from "@/lib/presupuestos-calc";
import { estiloCumplimiento, fmtMoneyCompacto } from "@/lib/cumplimiento";
import { NOMBRES_MES } from "@/lib/horarios";
import { fmtMoney } from "@/lib/types";

type Modo = "dia" | "semana" | "mes";
type Dia = Periodo["fechas"][number];

const mesCorto = (m: number) => NOMBRES_MES[m - 1].slice(0, 3).toLowerCase();
const DIAS_LARGOS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const pct = (v: number | null) => (v == null ? "" : `${Math.round(v * 100)}%`);

/** Meta, venta y cumplimiento de un tramo de días (el % solo cuenta días con cierre). */
function resumen(d: DistribucionAsesor, fechas: Dia[]) {
  let meta = 0;
  let venta = 0;
  let metaConVenta = 0;
  let hayVenta = false;
  for (const { fecha } of fechas) {
    const md = d.diaria.get(fecha);
    if (!md) continue;
    meta += md.meta;
    if (md.venta != null) {
      hayVenta = true;
      venta += md.venta;
      metaConVenta += md.meta;
    }
  }
  return { meta, venta: hayVenta ? venta : null, cumplimiento: metaConVenta > 0 ? venta / metaConVenta : null };
}

export function MetaPorDia({
  equipo,
  mandos,
  periodo,
  hoy,
  diasConCierre,
  hayPresupuesto,
  onEditarVenta,
  onEliminarCierre,
}: {
  /** Asesores y cajeros, ya ordenados. */
  equipo: DistribucionAsesor[];
  /** Jefe de tienda y subjefes: van en un desplegable. */
  mandos: DistribucionAsesor[];
  periodo: Periodo;
  /** Fecha de hoy (YYYY-MM-DD). */
  hoy: string;
  diasConCierre: Set<string>;
  hayPresupuesto: boolean;
  onEditarVenta: (personaId: string, fecha: string) => void;
  onEliminarCierre: (fecha: string) => void;
}) {
  const fechas = periodo.fechas;
  const semanas = useMemo(() => semanasDelPeriodo(periodo), [periodo]);
  // Se abre en el día y la semana de hoy, o lo más cercano. (El padre monta el
  // componente con key = inicio del periodo, así que al cambiar de mes se recalcula.)
  const [inicial] = useState(() => {
    const iHoy = fechas.findIndex((f) => f.fecha === hoy);
    const despues = fechas.length > 0 && hoy > fechas[fechas.length - 1].fecha;
    const iDia = iHoy >= 0 ? iHoy : despues ? fechas.length - 1 : 0;
    const fechaRef = fechas[iDia]?.fecha;
    return { iDia, iSemana: Math.max(0, semanas.findIndex((s) => s.some((d) => d.fecha === fechaRef))) };
  });
  const [modo, setModo] = useState<Modo>("semana");
  const [semanaIdx, setSemanaIdx] = useState(inicial.iSemana);
  const [diaIdx, setDiaIdx] = useState(inicial.iDia);

  const todos = useMemo(() => [...equipo, ...mandos], [equipo, mandos]);
  const sinHorario = todos.filter((d) => d.sinHorario);
  const nombreMes = fechas.length ? NOMBRES_MES[(fechas[Math.floor(fechas.length / 2)].mes ?? 1) - 1] : "";

  const semana = semanas[semanaIdx] ?? [];
  const rango: Dia[] = modo === "mes" ? fechas : semana;
  const dia = fechas[diaIdx];

  return (
    <div className="bg-panel border border-line rounded-[10px] p-4">
      <div className="flex justify-between items-start flex-wrap gap-3 mb-3">
        <div>
          <h3 className="font-display font-semibold text-sm">Meta y venta por día</h3>
          <p className="text-muted text-[11.5px] mt-0.5 max-w-xl">
            El presupuesto del mes de cada persona (el del cuadro de arriba), repartido según las horas de su horario.
          </p>
        </div>
        <div className="inline-flex rounded-md border border-line overflow-hidden text-sm">
          {(
            [
              { v: "dia", label: "Día" },
              { v: "semana", label: "Semana" },
              { v: "mes", label: "Mes" },
            ] as const
          ).map(({ v, label }) => (
            <button
              key={v}
              type="button"
              onClick={() => setModo(v)}
              className={"px-3 py-1.5 " + (modo === v ? "bg-brand text-white font-semibold" : "bg-white text-ink hover:bg-paper")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!hayPresupuesto && (
        <Aviso>
          Todavía no hay presupuesto de este mes: se ve solo lo vendido. Cárgalo en <strong>Cargar datos → paso 1</strong>.
        </Aviso>
      )}
      {hayPresupuesto && sinHorario.length > 0 && (
        <Aviso>
          Faltan los horarios de {nombreMes.toLowerCase()} de {sinHorario.length}{" "}
          {sinHorario.length === 1 ? "persona" : "personas"} ({sinHorario.map((d) => d.persona.nombre.split(" ")[0]).join(", ")}): su
          meta del mes está en el cuadro, pero no se puede repartir por día.{" "}
          <Link href="/horarios" className="underline font-semibold">
            Ir a Horarios
          </Link>
        </Aviso>
      )}

      {/* Navegación del tramo */}
      {modo !== "mes" && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Flecha
            dir="ant"
            disabled={modo === "dia" ? diaIdx === 0 : semanaIdx === 0}
            onClick={() => (modo === "dia" ? setDiaIdx((i) => i - 1) : setSemanaIdx((i) => i - 1))}
          />
          <span className="text-sm font-semibold min-w-[190px] text-center">
            {modo === "dia" && dia
              ? `${DIAS_LARGOS[dia.weekday]} ${dia.dia} de ${NOMBRES_MES[dia.mes - 1].toLowerCase()}`
              : semana.length
                ? `Semana ${semanaIdx + 1} · ${semana[0].dia} ${mesCorto(semana[0].mes)} al ${semana[semana.length - 1].dia} ${mesCorto(semana[semana.length - 1].mes)}`
                : ""}
          </span>
          <Flecha
            dir="sig"
            disabled={modo === "dia" ? diaIdx >= fechas.length - 1 : semanaIdx >= semanas.length - 1}
            onClick={() => (modo === "dia" ? setDiaIdx((i) => i + 1) : setSemanaIdx((i) => i + 1))}
          />
          {fechas.some((f) => f.fecha === hoy) && (
            <button
              type="button"
              onClick={() => {
                const i = fechas.findIndex((f) => f.fecha === hoy);
                setDiaIdx(i);
                setSemanaIdx(Math.max(0, semanas.findIndex((s) => s.some((d) => d.fecha === hoy))));
              }}
              className="px-2.5 py-1 rounded-md border border-line bg-white text-xs hover:bg-paper"
            >
              Hoy
            </button>
          )}
          {modo === "dia" && dia && diasConCierre.has(dia.fecha) && (
            <button
              type="button"
              onClick={() => onEliminarCierre(dia.fecha)}
              className="ml-auto px-2.5 py-1 rounded-md border border-warn-border text-warn bg-white text-xs hover:bg-warn-soft"
            >
              Borrar el cierre de este día
            </button>
          )}
        </div>
      )}

      {modo === "dia" && dia ? (
        <VistaDia equipo={equipo} mandos={mandos} dia={dia} onEditarVenta={onEditarVenta} />
      ) : (
        <VistaRango
          equipo={equipo}
          mandos={mandos}
          rango={rango}
          esMes={modo === "mes"}
          hoy={hoy}
          diasConCierre={diasConCierre}
          onEditarVenta={onEditarVenta}
          onEliminarCierre={onEliminarCierre}
        />
      )}

      <div className="flex gap-x-4 gap-y-1.5 flex-wrap items-center mt-3 text-[11px] text-muted">
        <Chip nivel={1}>100 % o más</Chip>
        <Chip nivel={0.9}>80 a 99 %</Chip>
        <Chip nivel={0.5}>menos de 80 %</Chip>
        <span>
          {modo === "dia"
            ? "Toca una fila para ver o corregir la venta."
            : "Arriba la meta del día, abajo cuánto cumplió. Toca una celda para ver o corregir la venta; la × del encabezado borra el cierre de ese día."}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Semana / mes: personas en filas, días en columnas.

function VistaRango({
  equipo,
  mandos,
  rango,
  esMes,
  hoy,
  diasConCierre,
  onEditarVenta,
  onEliminarCierre,
}: {
  equipo: DistribucionAsesor[];
  mandos: DistribucionAsesor[];
  rango: Dia[];
  esMes: boolean;
  hoy: string;
  diasConCierre: Set<string>;
  onEditarVenta: (personaId: string, fecha: string) => void;
  onEliminarCierre: (fecha: string) => void;
}) {
  const todos = [...equipo, ...mandos];
  const anchoDia = esMes ? "min-w-[52px]" : "min-w-[78px]";

  const encabezado = (
    <thead className="bg-paper">
      <tr>
        <th className="sticky left-0 bg-paper border-b border-r border-line px-2 py-1.5 text-left font-semibold min-w-[170px] z-10">
          Asesor
        </th>
        {rango.map((d) => {
          const cerrado = diasConCierre.has(d.fecha);
          return (
            <th
              key={d.fecha}
              className={
                "border-b border-r border-line px-0.5 py-1 font-semibold " +
                anchoDia +
                (d.fecha === hoy ? " outline outline-2 outline-brand -outline-offset-2" : "")
              }
            >
              <div className="text-[9px] text-muted">{DIAS_CORTOS[d.weekday]}</div>
              <div className="text-[11px]">
                {d.dia}
                {(d.dia === 1 || d === rango[0]) && <span className="text-[8px] text-muted"> {mesCorto(d.mes)}</span>}
              </div>
              {cerrado && (
                <button
                  type="button"
                  onClick={() => onEliminarCierre(d.fecha)}
                  title="Borrar el cierre de este día para volver a subirlo"
                  className="text-[10px] leading-none text-muted hover:text-warn"
                >
                  ×
                </button>
              )}
            </th>
          );
        })}
        <th className="border-b border-line px-2 py-1.5 font-semibold text-[10px] text-muted uppercase min-w-[110px]">
          {esMes ? "Mes" : "Semana"}
        </th>
      </tr>
    </thead>
  );

  const fila = (d: DistribucionAsesor) => {
    const r = resumen(d, rango);
    const metaTotal = esMes ? d.metaMes : r.meta;
    return (
      <tr key={d.persona.id} className="hover:bg-paper/50">
        <td className="sticky left-0 bg-panel border-b border-r border-line px-2 py-1 z-10">
          <div className="text-sm truncate max-w-[170px]">{d.persona.nombre}</div>
          <div className="text-[10px] text-muted">
            {d.horasMes === 0
              ? d.metaMes > 0
                ? "sin horario cargado"
                : "sin horario ni presupuesto"
              : `${d.horasMes} h · ${d.diasTrabajo} días en el mes`}
          </div>
        </td>
        {rango.map((dia) => (
          <Celda
            key={dia.fecha}
            md={d.diaria.get(dia.fecha)}
            compacta={esMes}
            sinHorario={d.sinHorario || d.horasMes === 0}
            esHoy={dia.fecha === hoy}
            onClick={() => onEditarVenta(d.persona.id, dia.fecha)}
          />
        ))}
        <td className="border-b border-line px-2 py-1 text-right font-mono text-[11px]">
          <div className="text-muted" title={`Meta ${fmtMoney(metaTotal)}`}>
            {metaTotal > 0 ? `meta ${fmtMoneyCompacto(metaTotal)}` : "—"}
          </div>
          {r.venta != null && (
            <div className={"font-semibold " + estiloCumplimiento(r.cumplimiento).text} title={`Vendido ${fmtMoney(r.venta)}`}>
              {fmtMoneyCompacto(r.venta)}
              {r.cumplimiento != null && ` · ${pct(r.cumplimiento)}`}
            </div>
          )}
        </td>
      </tr>
    );
  };

  // Total de la tienda (todas las personas, mandos incluidos).
  const totalDia = (fecha: string) => {
    let meta = 0;
    let venta = 0;
    let metaConVenta = 0;
    let hay = false;
    for (const d of todos) {
      const md = d.diaria.get(fecha);
      if (!md) continue;
      meta += md.meta;
      if (md.venta != null) {
        hay = true;
        venta += md.venta;
        metaConVenta += md.meta;
      }
    }
    return { meta, venta: hay ? venta : null, metaConVenta, cumplimiento: metaConVenta > 0 ? venta / metaConVenta : null };
  };
  const totales = rango.map((d) => totalDia(d.fecha));
  const tMeta = esMes ? todos.reduce((a, d) => a + d.metaMes, 0) : totales.reduce((a, t) => a + t.meta, 0);
  const tVenta = totales.some((t) => t.venta != null) ? totales.reduce((a, t) => a + (t.venta ?? 0), 0) : null;
  const tMetaConVenta = totales.reduce((a, t) => a + t.metaConVenta, 0);
  const tCumpl = tVenta != null && tMetaConVenta > 0 ? tVenta / tMetaConVenta : null;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse min-w-full">
          {encabezado}
          <tbody>
            {equipo.map(fila)}
            <tr className="bg-paper font-semibold">
              <td className="sticky left-0 bg-paper border-b border-r border-line px-2 py-1.5 text-xs uppercase tracking-wider z-10">
                Total tienda
              </td>
              {totales.map((t, i) => (
                <td
                  key={rango[i].fecha}
                  className="border-b border-r border-line px-0.5 py-1 text-center font-mono text-[10px]"
                  title={`Meta ${fmtMoney(t.meta)}${t.venta != null ? ` · vendido ${fmtMoney(t.venta)}` : ""}`}
                >
                  <div className="text-muted">{fmtMoneyCompacto(t.meta)}</div>
                  {t.venta != null && <div className={estiloCumplimiento(t.cumplimiento).text}>{fmtMoneyCompacto(t.venta)}</div>}
                </td>
              ))}
              <td className="border-b border-line px-2 py-1.5 text-right font-mono text-[11px]">
                <div className="text-muted">meta {fmtMoneyCompacto(tMeta)}</div>
                {tVenta != null && (
                  <div className={estiloCumplimiento(tCumpl).text}>
                    {fmtMoneyCompacto(tVenta)}
                    {tCumpl != null && ` · ${pct(tCumpl)}`}
                  </div>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {mandos.length > 0 && (
        <details className="border border-line rounded-[10px]">
          <summary className="cursor-pointer px-3 py-2 text-[12.5px] font-semibold select-none">
            Jefe de tienda y subjefes ({mandos.length}) — no compiten en el ranking
          </summary>
          <div className="overflow-x-auto border-t border-line">
            <table className="text-xs border-collapse min-w-full">
              {encabezado}
              <tbody>{mandos.map(fila)}</tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function Celda({
  md,
  compacta,
  sinHorario,
  esHoy,
  onClick,
}: {
  md: MetaDiaria | undefined;
  compacta: boolean;
  sinHorario: boolean;
  esHoy: boolean;
  onClick: () => void;
}) {
  const base =
    "border-b border-r border-line px-0.5 py-1 text-center font-mono text-[10px] cursor-pointer hover:ring-1 hover:ring-brand/40 " +
    (esHoy ? "outline outline-2 outline-brand -outline-offset-2 " : "");
  const trabaja = md?.tipo === "trabajo" && md.meta > 0;

  if (md && trabaja) {
    const conVenta = md.venta != null;
    const estilo = estiloCumplimiento(md.cumplimiento);
    return (
      <td
        className={base + (conVenta ? estilo.bg : "")}
        onClick={onClick}
        title={`${md.horas} h · meta ${fmtMoney(md.meta)}${conVenta ? ` · vendió ${fmtMoney(md.venta)}` : " · sin cierre todavía"}`}
      >
        <div className="text-muted">{fmtMoneyCompacto(md.meta)}</div>
        <div className={conVenta ? `font-bold ${estilo.text}` : "text-muted/60"}>{conVenta ? pct(md.cumplimiento) : "—"}</div>
      </td>
    );
  }
  // Vendió un día que no figura como turno (o la persona no tiene horario).
  if (md && md.venta != null && md.venta > 0) {
    return (
      <td
        className={base}
        onClick={onClick}
        title={`Vendió ${fmtMoney(md.venta)} · ${sinHorario ? "sin horario cargado" : "sin turno en el horario"}`}
      >
        {!sinHorario && <div className="text-muted/60">sin turno</div>}
        <div className="font-semibold">{fmtMoneyCompacto(md.venta)}</div>
      </td>
    );
  }
  const texto = sinHorario ? "" : md?.tipo === "libre" ? "Libre" : compacta ? "·" : "Descansa";
  return (
    <td
      className={base + "text-muted/60 bg-neutral-100/40"}
      onClick={onClick}
      title={sinHorario ? "Sin horario cargado" : md?.tipo === "libre" ? "Día libre" : "Descanso"}
    >
      {texto}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Día: una fila por persona con turno, meta, venta y cumplimiento.

function VistaDia({
  equipo,
  mandos,
  dia,
  onEditarVenta,
}: {
  equipo: DistribucionAsesor[];
  mandos: DistribucionAsesor[];
  dia: Dia;
  onEditarVenta: (personaId: string, fecha: string) => void;
}) {
  const tabla = (lista: DistribucionAsesor[], conTotal: boolean) => {
    let tMeta = 0;
    let tVenta = 0;
    let tMetaConVenta = 0;
    let hay = false;
    const filas = lista.map((d) => {
      const md = d.diaria.get(dia.fecha);
      const meta = md?.meta ?? 0;
      const venta = md?.venta ?? null;
      tMeta += meta;
      if (venta != null) {
        hay = true;
        tVenta += venta;
        tMetaConVenta += meta;
      }
      const cumpl = venta != null && meta > 0 ? venta / meta : null;
      const turno = d.horasMes === 0 ? "sin horario" : md?.tipo === "trabajo" ? `${md.horas} h` : md?.tipo === "libre" ? "Libre" : "Descansa";
      return (
        <tr key={d.persona.id} onClick={() => onEditarVenta(d.persona.id, dia.fecha)} className="cursor-pointer hover:bg-paper/60">
          <td className="py-1.5 pr-3 border-b border-line/60">{d.persona.nombre}</td>
          <td className="py-1.5 pr-3 border-b border-line/60 text-muted text-xs">{turno}</td>
          <td className="py-1.5 pr-3 border-b border-line/60 text-right font-mono">{meta > 0 ? fmtMoney(meta) : "—"}</td>
          <td className="py-1.5 pr-3 border-b border-line/60 text-right font-mono">{venta != null ? fmtMoney(venta) : "—"}</td>
          <td className={"py-1.5 border-b border-line/60 text-right font-mono font-semibold " + estiloCumplimiento(cumpl).text}>
            {cumpl != null ? pct(cumpl) : "—"}
          </td>
        </tr>
      );
    });
    const tCumpl = tMetaConVenta > 0 ? tVenta / tMetaConVenta : null;
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[520px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
              <th className="pb-1.5 pr-3 font-semibold">Asesor</th>
              <th className="pb-1.5 pr-3 font-semibold">Turno</th>
              <th className="pb-1.5 pr-3 font-semibold text-right">Meta del día</th>
              <th className="pb-1.5 pr-3 font-semibold text-right">Vendido</th>
              <th className="pb-1.5 font-semibold text-right">Cumplimiento</th>
            </tr>
          </thead>
          <tbody>
            {filas}
            {conTotal && (
              <tr className="font-semibold bg-paper">
                <td className="py-1.5 pr-3 text-xs uppercase tracking-wider" colSpan={2}>
                  Total equipo
                </td>
                <td className="py-1.5 pr-3 text-right font-mono">{tMeta > 0 ? fmtMoney(tMeta) : "—"}</td>
                <td className="py-1.5 pr-3 text-right font-mono">{hay ? fmtMoney(tVenta) : "—"}</td>
                <td className={"py-1.5 text-right font-mono " + estiloCumplimiento(tCumpl).text}>{tCumpl != null ? pct(tCumpl) : "—"}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  };
  return (
    <div className="space-y-3">
      {tabla(equipo, true)}
      {mandos.length > 0 && (
        <details className="border border-line rounded-[10px]">
          <summary className="cursor-pointer px-3 py-2 text-[12.5px] font-semibold select-none">
            Jefe de tienda y subjefes ({mandos.length}) — no compiten en el ranking
          </summary>
          <div className="px-3 pb-2 border-t border-line">{tabla(mandos, false)}</div>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Aviso({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-[12.5px]">{children}</div>;
}

function Flecha({ dir, disabled, onClick }: { dir: "ant" | "sig"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "ant" ? "Anterior" : "Siguiente"}
      className="w-8 h-8 rounded-md border border-line bg-white text-sm hover:bg-paper disabled:opacity-40"
    >
      {dir === "ant" ? "‹" : "›"}
    </button>
  );
}

function Chip({ nivel, children }: { nivel: number; children: React.ReactNode }) {
  const e = estiloCumplimiento(nivel);
  return <span className={`px-2 py-0.5 rounded ${e.bg} ${e.text} font-semibold`}>{children}</span>;
}
