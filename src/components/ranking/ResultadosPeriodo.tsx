"use client";

// Resultados y proyección por DÍA, SEMANA y MES (Huber, 8-oct-2026). Por persona: venta en pesos
// frente a la meta del periodo (cierres del día), pares / accesorios / ropa (cortes de la
// consolidada), TRX y UPT (cortes de Xstore) y la proyección al cierre del periodo. Arriba, los
// reconocimientos automáticos del periodo (en día y semana solo cuentan estos).

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { estiloCumplimiento } from "@/lib/cumplimiento";
import { fmtMoney } from "@/lib/types";
import { diasEntre, type MesRetail } from "@/lib/mes-retail";
import { ayer, fechaCorta } from "@/lib/cierres-faltantes";
import { cargarCortes } from "@/lib/cortes";
import { avancePeriodo, deltaPeriodo, partePeriodo, proyectar, type Corte, type ResultadoCortes } from "@/lib/periodos";
import {
  ITEMS_RECONOCIMIENTO,
  ganadoresAutomaticos,
  type KpiMensual,
  type PersonaRk,
  type RankingConfig,
  type ResumenVentas,
} from "@/lib/ranking";
import { useMountedAnimado } from "@/components/charts/hooks";
import { Avatar, inputCls } from "./ui";

type Tipo = "dia" | "semana" | "mes";
const ANILLOS = ["oro", "plata", "bronce"] as const;
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)} %`);

/** Semanas de domingo a sábado del mes (las del mes retail si están cargadas). */
function semanasDe(mes: MesRetail | null, inicio: string, fin: string): { inicio: string; fin: string }[] {
  if (mes?.semanas?.length) return mes.semanas.map((s) => ({ inicio: s.inicio, fin: s.fin }));
  const out: { inicio: string; fin: string }[] = [];
  for (const d of diasEntre(inicio, fin)) {
    if (out.length === 0 || d.weekday === 0) out.push({ inicio: d.fecha, fin: d.fecha });
    else out[out.length - 1].fin = d.fecha;
  }
  return out;
}

export function ResultadosPeriodo({
  anio,
  mes,
  mesInfo,
  inicioMes,
  finMes,
  personas,
  kpis,
  metasDia,
  config,
  vendeRopa,
  fotos,
  ultimoCierre,
  soloPersonaId = null,
}: {
  anio: number;
  mes: number;
  mesInfo: MesRetail | null;
  inicioMes: string;
  finMes: string;
  personas: PersonaRk[];
  kpis: KpiMensual[];
  metasDia: { fecha: string; meta: number | null }[];
  config: RankingConfig;
  vendeRopa: boolean;
  fotos: Record<string, string>;
  /** Último día con cierre cargado: el día que se abre por defecto. */
  ultimoCierre: string | null;
  /** Asesor: ve el podio (3 primeros) y su propia fila; la tabla completa es de la jefatura. */
  soloPersonaId?: string | null;
}) {
  const animado = useMountedAnimado();
  const semanas = useMemo(() => semanasDe(mesInfo, inicioMes, finMes), [mesInfo, inicioMes, finMes]);
  // Por defecto: la semana en curso (la que contiene ayer, el último día que puede tener cierre).
  const refDia = ayer() < inicioMes ? inicioMes : ayer() > finMes ? finMes : ayer();
  const [tipo, setTipo] = useState<Tipo>("semana");
  const [diaSel, setDiaSel] = useState(ultimoCierre && ultimoCierre >= inicioMes && ultimoCierre <= finMes ? ultimoCierre : refDia);
  const [semSel, setSemSel] = useState(() => Math.max(0, semanas.findIndex((s) => refDia >= s.inicio && refDia <= s.fin)));
  const [cortes, setCortes] = useState<Corte[]>([]);
  const [ventas, setVentas] = useState<ResumenVentas[] | null>(null);

  const sem = semanas[Math.min(semSel, semanas.length - 1)] ?? { inicio: inicioMes, fin: finMes };
  const [ini, fin] = tipo === "dia" ? [diaSel, diaSel] : tipo === "semana" ? [sem.inicio, sem.fin] : [inicioMes, finMes];

  useEffect(() => {
    let vivo = true;
    cargarCortes(anio, mes).then((c) => vivo && setCortes(c));
    return () => {
      vivo = false;
    };
  }, [anio, mes]);
  useEffect(() => {
    let vivo = true;
    supabase.rpc("ranking_ventas", { p_desde: ini, p_hasta: fin }).then(({ data }) => {
      if (vivo) setVentas(((data as ResumenVentas[] | null) ?? []).map((v) => ({ ...v, venta: Number(v.venta) })));
    });
    return () => {
      vivo = false;
    };
  }, [ini, fin]);

  const res = useMemo(() => {
    const parte = partePeriodo(metasDia, ini, fin, inicioMes, finMes);
    const ultimoCierre = (ventas ?? []).reduce<string | null>((m, v) => (v.ultimo_dia && (!m || v.ultimo_dia > m) ? v.ultimo_dia : m), null);
    const avPesos = avancePeriodo(metasDia, ini, fin, ultimoCierre);
    const cons: ResultadoCortes = tipo === "dia" ? { estado: "sin_datos" } : deltaPeriodo(cortes, "consolidada", ini, fin, inicioMes);
    const xs: ResultadoCortes = tipo === "dia" ? { estado: "sin_datos" } : deltaPeriodo(cortes, "xstore", ini, fin, inicioMes);
    const avU = cons.estado === "ok" ? avancePeriodo(metasDia, ini, fin, cons.hasta) : null;
    const kpiDe = new Map(kpis.map((k) => [k.persona_id, k]));
    const ventaDe = new Map((ventas ?? []).map((v) => [v.persona_id, v]));

    const filas = personas.map((p) => {
      const k = kpiDe.get(p.id) ?? null;
      const metaP = k?.presupuesto ? k.presupuesto * parte : null;
      // Sin ningún cierre en el periodo no hay venta que mostrar (no es $0).
      const venta = ventas && ventas.length > 0 ? Number(ventaDe.get(p.id)?.venta ?? 0) : null;
      const metaFecha = metaP != null && avPesos ? metaP * avPesos : null;
      const cumpl = metaFecha && venta != null ? venta / metaFecha : null;
      const proy = proyectar(venta, avPesos);
      const u = cons.estado === "ok" ? cons.porPersona.get(p.id) ?? { pares: 0, acc: 0, ropa: 0 } : null;
      const x = xs.estado === "ok" ? xs.porPersona.get(p.id) ?? null : null;
      const cumplU = (v: number | undefined, meta: number | null | undefined) =>
        u && v != null && meta && avU ? v / (meta * parte * avU) : null;
      return {
        p,
        k,
        metaP,
        venta,
        cumpl,
        proy,
        pares: u?.pares ?? null,
        acc: u?.acc ?? null,
        ropa: u?.ropa ?? null,
        metaPares: k?.pares_meta ? k.pares_meta * parte : null,
        metaAcc: k?.acc_meta ? k.acc_meta * parte : null,
        metaRopa: vendeRopa && k?.ropa_meta ? k.ropa_meta * parte : null,
        cumplUnidades: { pares: cumplU(u?.pares, k?.pares_meta), acc: cumplU(u?.acc, k?.acc_meta), ropa: vendeRopa ? cumplU(u?.ropa, k?.ropa_meta) : null },
        trx: x ? x.trx : null,
        upt: x && x.trx > 0 ? x.articulosXstore / x.trx : null,
      };
    });
    filas.sort((a, b) => (b.cumpl ?? -1) - (a.cumpl ?? -1));

    // Reconocimientos automáticos del periodo (los manuales son solo del mes).
    const ganadores = ganadoresAutomaticos(
      filas.map((f) => ({
        persona: f.p,
        cumplimientoFecha: f.cumpl,
        cumplUnidades: f.cumplUnidades,
        kpi: {
          ...(f.k ?? ({} as KpiMensual)),
          pares_venta: f.pares,
          acc_venta: f.acc,
          ropa_venta: vendeRopa ? f.ropa : null,
          trx: f.trx,
          upt: f.upt,
          unidades: null,
          horas: f.k?.horas ? f.k.horas * parte : null,
        },
      })),
      config,
      vendeRopa,
    );
    return { filas, ganadores, ultimoCierre, cons, xs, avPesos };
  }, [metasDia, ini, fin, inicioMes, finMes, ventas, cortes, tipo, kpis, personas, vendeRopa, config]);

  const enCurso = res.avPesos != null && res.avPesos < 1;
  const titulo = tipo === "dia" ? fechaCorta(ini) : tipo === "semana" ? `Semana ${semSel + 1} · ${fechaCorta(ini)} a ${fechaCorta(fin)}` : "Mes completo";
  const avisoCortes = (r: ResultadoCortes, que: string, informe: string) =>
    r.estado === "falta_inicio"
      ? `Para separar ${que} de esta semana falta ${informe} con corte al ${fechaCorta(r.necesita)} (el que hay llega al ${fechaCorta(r.hasta)}).`
      : r.estado === "sin_datos"
        ? `Sin ${informe} con corte en este periodo: ${que} aún no se puede medir.`
        : null;
  const avisos = tipo === "dia" ? [] : [avisoCortes(res.cons, "pares y accesorios", "la consolidada"), avisoCortes(res.xs, "TRX y UPT", "el informe de Xstore")].filter(Boolean);

  const boton = (t: Tipo, label: string) => (
    <button
      key={t}
      type="button"
      onClick={() => setTipo(t)}
      className={"px-3.5 py-1.5 font-semibold " + (tipo === t ? "bg-brand text-white" : "text-muted hover:bg-paper")}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div className="inline-flex rounded-md border border-line overflow-hidden text-[13px] bg-white">
          {boton("dia", "Día")}
          {boton("semana", "Semana")}
          {boton("mes", "Mes")}
        </div>
        {tipo === "dia" && (
          <input type="date" value={diaSel} min={inicioMes} max={finMes} onChange={(e) => e.target.value && setDiaSel(e.target.value)} className={inputCls} />
        )}
        {tipo === "semana" && (
          <select value={semSel} onChange={(e) => setSemSel(Number(e.target.value))} className={inputCls}>
            {semanas.map((s, i) => (
              <option key={s.inicio} value={i}>
                Semana {i + 1} · {fechaCorta(s.inicio)} a {fechaCorta(s.fin)}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="text-[12px] text-muted">
        <strong className="text-ink">{titulo}</strong> · pesos con cierres{res.ultimoCierre ? ` hasta el ${fechaCorta(res.ultimoCierre)}` : ": aún no hay"}
        {tipo !== "dia" && res.cons.estado === "ok" && ` · unidades hasta el ${fechaCorta(res.cons.hasta)}`}
        {tipo !== "dia" && res.xs.estado === "ok" && ` · TRX hasta el ${fechaCorta(res.xs.hasta)}`}
        {enCurso && " · la proyección es al ritmo actual hasta el cierre del periodo"}
        {tipo === "dia" && " · en el día solo hay venta en pesos (las unidades y TRX llegan por semana)"}
      </div>
      {ventas && ventas.length === 0 && (
        <div className="text-[12px] bg-amber-50 border border-amber-300 text-[#8A5A16] rounded-md px-3 py-2">
          ⚠ {tipo === "dia" ? `Falta el cierre del ${fechaCorta(ini)}` : "Aún no hay cierres del día en este periodo"}: súbelo en Cargar datos → Ventas para ver los resultados.
        </div>
      )}
      {avisos.map((a) => (
        <div key={a} className="text-[12px] bg-amber-50 border border-amber-300 text-[#8A5A16] rounded-md px-3 py-2">
          ⚠ {a}
        </div>
      ))}

      {res.ganadores.length > 0 && (
        <div className="bg-panel border-2 border-[#E0A526]/70 rounded-[12px] p-3">
          <div className="text-[12px] font-semibold uppercase tracking-wider text-[#8A5A16] mb-2">
            Reconocimientos {tipo === "dia" ? "del día" : tipo === "semana" ? "de la semana" : "del mes (automáticos)"}
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {res.ganadores.map((g) => {
              const p = personas.find((x) => x.id === g.persona_id)!;
              return (
                <div key={g.item} className="flex items-center gap-2.5 bg-white border border-line rounded-lg px-2.5 py-2">
                  <Avatar nombre={p.nombre} url={fotos[p.id]} tam={36} anillo="oro" />
                  <div className="min-w-0">
                    <div className="text-[10.5px] uppercase tracking-wider text-muted font-semibold">
                      {ITEMS_RECONOCIMIENTO.find((i) => i.id === g.item)?.titulo}
                    </div>
                    <div className="text-[13px] font-semibold truncate">{g.detalle}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {res.filas.map((f, i) => {
          if (soloPersonaId && i >= 3 && f.p.id !== soloPersonaId) return null;
          const est = estiloCumplimiento(f.cumpl);
          const pp = f.proy != null && f.metaP ? f.proy / f.metaP : null;
          return (
            <div
              key={f.p.id}
              className={"bg-panel border rounded-[10px] px-3 py-2.5 flex gap-3 items-start " + (f.p.id === soloPersonaId ? "border-brand" : "border-line")}
            >
              <div className="w-7 text-center font-display font-bold text-[18px] text-muted pt-1">{f.cumpl == null ? "—" : i + 1}</div>
              <Avatar nombre={f.p.nombre} url={fotos[f.p.id]} tam={38} anillo={f.cumpl != null && i < 3 ? ANILLOS[i] : "ninguno"} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-[13.5px] truncate">{f.p.nombre}</span>
                  <span className={"font-display font-bold text-[15px] " + est.text}>{pct(f.cumpl)}</span>
                </div>
                <div className="relative h-2 rounded-full bg-neutral-100 mt-1 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full transition-[width] ease-out"
                    style={{
                      width: animado ? `${Math.min(100, (f.cumpl ?? 0) * 100)}%` : "0%",
                      backgroundColor: est.hex,
                      transitionDuration: "900ms",
                      transitionDelay: `${i * 50}ms`,
                    }}
                  />
                </div>
                <div className="text-[11.5px] text-muted mt-1">
                  {f.venta != null ? fmtMoney(f.venta) : "—"} de {f.metaP != null ? fmtMoney(f.metaP) : "—"}
                  {enCurso && f.proy != null && (
                    <>
                      {" "}
                      · cerraría en <strong className={estiloCumplimiento(pp).text}>{fmtMoney(f.proy)}</strong> ({pct(pp)})
                    </>
                  )}
                </div>
                {tipo !== "dia" && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5 text-[10.5px]">
                    {[
                      ["Pares", f.pares, f.metaPares],
                      ["Acc", f.acc, f.metaAcc],
                      ...(vendeRopa ? ([["Ropa", f.ropa, f.metaRopa]] as const) : []),
                    ].map(([l, v, m]) => (
                      <span key={l as string} className="px-1.5 py-0.5 rounded border border-line text-muted">
                        {l} {v != null ? Math.round(v as number) : "—"}
                        {m ? ` / ${Math.round(m as number)}` : ""}
                      </span>
                    ))}
                    <span className="px-1.5 py-0.5 rounded border border-line text-muted">TRX {f.trx != null ? Math.round(f.trx) : "—"}</span>
                    <span className="px-1.5 py-0.5 rounded border border-line text-muted">
                      UPT {f.upt != null ? f.upt.toFixed(2).replace(".", ",") : "—"}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[11.5px] text-muted">
        La meta del periodo es la meta del mes de cada persona repartida según la meta de la tienda de esos días. El % compara lo
        vendido con lo que ya debía llevar a la fecha del último cierre. Pares, accesorios, TRX y UPT de la semana salen de restar los
        informes acumulados: sube la consolidada y el de Xstore con corte al sábado.
      </p>
    </div>
  );
}
