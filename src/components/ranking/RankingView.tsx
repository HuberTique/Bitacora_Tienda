"use client";

import { useMemo, useState } from "react";
import { descargarPodioPng } from "@/lib/podio-imagen";
import { PodioOlimpico } from "./PodioOlimpico";
import { estiloCumplimiento } from "@/lib/cumplimiento";
import { fmtMoney } from "@/lib/types";
import {
  ITEMS_RECONOCIMIENTO,
  NOMBRE_COMPONENTE,
  uptDe,
  type Componente,
  type FilaRanking,
  type KpiMensual,
  type RankingConfig,
} from "@/lib/ranking";
import { useMountedAnimado } from "@/components/charts/hooks";
import { Avatar, Tile } from "./ui";

const ANILLOS = ["oro", "plata", "bronce"] as const;
const ORDEN_COMP: Componente[] = ["ventas", "upt", "magia", "puntualidad", "maximizador"];

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)} %`);
const primerNombre = (n: string) => n.trim().split(/\s+/)[0];

type Premio = { titulo: string; fila: FilaRanking; detalle: string; puntos?: string };

function mejorPor(
  filas: FilaRanking[],
  valor: (f: FilaRanking) => number | null,
): { fila: FilaRanking; v: number } | null {
  let mejor: { fila: FilaRanking; v: number } | null = null;
  for (const f of filas) {
    const v = valor(f);
    if (v == null || !isFinite(v) || v <= 0) continue;
    if (!mejor || v > mejor.v) mejor = { fila: f, v };
  }
  return mejor;
}

export function RankingView({
  filas,
  kpisTodos,
  config,
  fotos,
  esJefatura,
  onFotoCambio,
  tienda,
  periodo,
  secciones,
}: {
  /** Qué partes mostrar (por defecto todas): resumen, reconocimientos, podio y lista. */
  secciones?: { tiles?: boolean; premios?: boolean; podio?: boolean; lista?: boolean };
  tienda: string;
  periodo: string;
  filas: FilaRanking[];
  kpisTodos: KpiMensual[];
  config: RankingConfig;
  fotos: Record<string, string>;
  esJefatura: boolean;
  onFotoCambio: () => void;
}) {
  const animado = useMountedAnimado();
  const sec = { tiles: true, premios: true, podio: true, lista: true, ...secciones };
  const [descargando, setDescargando] = useState(false);

  async function descargarPodio() {
    setDescargando(true);
    try {
      await descargarPodioPng({
        tienda,
        periodo,
        items: filas
          .filter((f) => f.puntaje != null)
          .slice(0, 3)
          .map((f) => ({ nombre: f.persona.nombre, puntaje: f.puntaje!, fotoUrl: fotos[f.persona.id] })),
      });
    } finally {
      setDescargando(false);
    }
  }

  const totales = useMemo(() => {
    const suma = (f: (k: KpiMensual) => number | null) =>
      kpisTodos.reduce((a, k) => a + (f(k) ?? 0), 0);
    const pto = suma((k) => k.presupuesto);
    const neto = suma((k) => k.acumulado_neto);
    const unds = suma((k) => k.unidades);
    const trx = suma((k) => k.trx);
    return {
      pto,
      neto,
      cumplimiento: pto > 0 ? neto / pto : null,
      upt: trx > 0 ? unds / trx : null,
      pares: suma((k) => k.pares_venta),
      acc: suma((k) => k.acc_venta),
      trx,
    };
  }, [kpisTodos]);

  const pesoTotal =
    config.peso_ventas + config.peso_upt + config.peso_magia + config.peso_puntualidad + config.peso_maximizador + config.peso_reconocimientos;
  const valorItem = pesoTotal > 0 ? ((config.peso_reconocimientos / ITEMS_RECONOCIMIENTO.length) * 100) / pesoTotal : 0;
  const valorTxt = `+${valorItem.toFixed(2).replace(/\.?0+$/, "").replace(".", ",")}`;
  const reconocimientos = useMemo<Premio[]>(
    () =>
      ITEMS_RECONOCIMIENTO.flatMap((it) => {
        const f = filas.find((x) => x.reconocimientos.includes(it.id));
        return f
          ? [{ titulo: it.titulo, fila: f, detalle: it.manual ? `${primerNombre(f.persona.nombre)} · ${f.detalleReconocimientos[it.id] ?? "calificado por la jefatura"}` : (f.detalleReconocimientos[it.id] ?? primerNombre(f.persona.nombre)), puntos: valorTxt }]
          : [];
      }),
    [filas, valorTxt],
  );
  const premios = useMemo<Premio[]>(() => {
    const out: Premio[] = [];
    const conPuntaje = filas.filter((f) => f.puntaje != null);
    if (conPuntaje.length > 0) {
      const g = conPuntaje[0];
      out.push({
        titulo: "Vendedor del mes",
        fila: g,
        detalle: `${primerNombre(g.persona.nombre)} con ${Math.round(g.puntaje!)} puntos en el ranking general`,
      });
    }
    const venta = mejorPor(filas, (f) => f.ventaAcum ?? null);
    if (venta)
      out.push({
        titulo: "Mayor venta acumulada",
        fila: venta.fila,
        detalle: `${primerNombre(venta.fila.persona.nombre)} con ${fmtMoney(venta.v)}`,
      });
    const upt = mejorPor(filas, (f) => uptDe(f.kpi));
    if (upt)
      out.push({
        titulo: "Mejor UPT",
        fila: upt.fila,
        detalle: `${primerNombre(upt.fila.persona.nombre)} con UPT ${upt.v.toFixed(2)}`,
      });
    const magia = mejorPor(filas, (f) => (f.magia ? Number(f.magia.promedio) : null));
    if (magia)
      out.push({
        titulo: "Magia con una sonrisa",
        fila: magia.fila,
        detalle: `${primerNombre(magia.fila.persona.nombre)} con ${magia.v.toFixed(1)} de 24 puntos`,
      });
    return out;
  }, [filas]);

  const podio = filas.filter((f) => f.puntaje != null).slice(0, 3);

  if (filas.every((f) => f.puntaje == null)) {
    return (
      <div className="bg-panel border border-line rounded-[10px] p-8 text-center text-muted text-sm">
        Aún no hay datos para este mes. Jefatura sube el Excel en la pestaña <strong>KPIs</strong>.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Resumen del equipo */}
      {sec.tiles && (
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile valor={fmtMoney(totales.neto)} etiqueta={`Venta neta de ${fmtMoney(totales.pto)}`} />
        <Tile
          valor={pct(totales.cumplimiento)}
          etiqueta="Cumplimiento del equipo"
          color={estiloCumplimiento(totales.cumplimiento).text}
        />
        <Tile
          valor={totales.upt != null ? totales.upt.toFixed(2) : "—"}
          etiqueta={`UPT del equipo (meta ${config.upt_meta})`}
          color={
            totales.upt != null && totales.upt >= config.upt_meta ? "text-operaciones" : "text-warn"
          }
        />
        <Tile
          valor={String(Math.round(totales.pares))}
          etiqueta={`Pares · ${Math.round(totales.acc)} accesorios`}
        />
        <Tile valor={String(Math.round(totales.trx))} etiqueta="Facturas" />
      </div>
      )}

      {/* Premios */}
      {sec.premios && (premios.length > 0 || reconocimientos.length > 0) && (
        <details className="bg-panel border-2 border-[#E0A526]/70 rounded-[12px] p-4">
          <summary className="cursor-pointer font-display text-[17px] font-bold select-none">
            Vendedores que hacen <span className="text-[#C88A12]">MAGIA</span>
            <span className="text-[12px] font-normal text-muted ml-2">
              ({reconocimientos.length} de {ITEMS_RECONOCIMIENTO.length} reconocimientos · clic para ver)
            </span>
          </summary>
          <div className="text-[11.5px] text-muted mt-2">
            Cada reconocimiento suma {valorTxt} al puntaje y no se repite persona. Puntualidad, Trabajo en equipo e Iniciativa los
            califica la jefatura al cerrar el mes.
          </div>
          <div className="space-y-2 mt-3">
            {[...reconocimientos, ...premios].map((p, i) => (
              <div
                key={p.titulo}
                className={
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 " +
                  (i === 0 ? "bg-brand text-white" : "bg-white border border-line text-ink")
                }
              >
                <Avatar
                  nombre={p.fila.persona.nombre}
                  url={fotos[p.fila.persona.id]}
                  tam={44}
                  anillo="oro"
                />
                <div className="min-w-0 flex-1">
                  <div
                    className={
                      "text-[11px] uppercase tracking-wider font-semibold " +
                      (i === 0 ? "text-white/70" : "text-muted")
                    }
                  >
                    {p.titulo}
                  </div>
                  <div className="text-[14px] font-semibold truncate">{p.detalle}</div>
                </div>
                {p.puntos && (
                  <span
                    className={
                      "text-[12px] font-bold px-2 py-0.5 rounded-full " + (i === 0 ? "bg-white/20 text-white" : "bg-[#FFF4D6] text-[#8A5A16]")
                    }
                  >
                    {p.puntos}
                  </span>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Podio */}
      {sec.podio && podio.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[12px] text-muted font-semibold uppercase tracking-wider">
              Podio del mes
            </div>
            <button
              type="button"
              onClick={descargarPodio}
              disabled={descargando}
              className="text-[12px] font-semibold text-brand hover:underline disabled:opacity-50"
            >
              {descargando ? "Generando…" : "⬇ Descargar podio (imagen)"}
            </button>
          </div>
          <PodioOlimpico
            puestos={podio.map((f, i) => ({
              id: f.persona.id,
              nombre: primerNombre(f.persona.nombre),
              puntos: f.puntaje!,
              avatar: (
                <Avatar
                  nombre={f.persona.nombre}
                  url={fotos[f.persona.id]}
                  tam={i === 0 ? 92 : 72}
                  anillo={ANILLOS[i]}
                  editable={esJefatura}
                  personaId={f.persona.id}
                  rutaFoto={f.persona.foto_path}
                  onCambio={onFotoCambio}
                />
              ),
            }))}
          />
        </div>
      )}

      {/* Listado completo */}
      {sec.lista && (
      <div className="space-y-2">
        <div className="text-[12px] text-muted font-semibold uppercase tracking-wider">
          Ranking general
        </div>
        {filas.map((f, i) => {
          const sin = f.puntaje == null;
          const est = estiloCumplimiento(sin ? null : f.puntaje! / 100);
          return (
            <div
              key={f.persona.id}
              className="bg-panel border border-line rounded-[10px] px-3 py-2.5 flex gap-3 items-start"
            >
              <div className="w-7 text-center font-display font-bold text-[18px] text-muted pt-1">
                {sin ? "—" : i + 1}
              </div>
              <Avatar
                nombre={f.persona.nombre}
                url={fotos[f.persona.id]}
                tam={40}
                anillo={!sin && i < 3 ? ANILLOS[i] : "ninguno"}
                editable={esJefatura}
                personaId={f.persona.id}
                rutaFoto={f.persona.foto_path}
                onCambio={onFotoCambio}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="font-semibold text-[14px] truncate">{f.persona.nombre}</div>
                  <div className={"font-display font-bold text-[16px] " + est.text}>
                    {sin ? "—" : `${Math.round(f.puntaje!)} pts`}
                  </div>
                </div>
                <div className="relative h-2.5 rounded-full bg-neutral-100 mt-1.5 overflow-hidden">
                  {!sin && (
                    <div
                      className="absolute inset-y-0 left-0 rounded-full transition-[width] ease-out"
                      style={{
                        width: animado ? `${Math.min(100, f.puntaje!)}%` : "0%",
                        backgroundColor: est.hex,
                        transitionDuration: "900ms",
                        transitionDelay: `${i * 60}ms`,
                      }}
                    />
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {f.ventaAcum != null && <Chip>Venta {fmtMoney(f.ventaAcum)}</Chip>}
                  {f.metaFecha != null && <Chip>Meta a la fecha {fmtMoney(f.metaFecha)}</Chip>}
                  {f.cumplimientoFecha != null && <Chip>{Math.round(f.cumplimientoFecha * 100)}% de la meta</Chip>}
                  {uptDe(f.kpi) != null && <Chip>UPT {uptDe(f.kpi)!.toFixed(2)}</Chip>}
                  {f.kpi?.pares_venta != null && <Chip>Pares {Math.round(f.kpi.pares_venta)}</Chip>}
                  {f.kpi?.trx != null && <Chip>Facturas {Math.round(f.kpi.trx)}</Chip>}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {ORDEN_COMP.filter((c) => c !== "maximizador" || config.peso_maximizador > 0).map((c) => {
                    const s = f.scores[c];
                    const e = estiloCumplimiento(s == null ? null : s / 100);
                    return (
                      <span
                        key={c}
                        className={
                          "text-[10.5px] px-1.5 py-0.5 rounded font-semibold " +
                          (s == null ? "bg-neutral-100 text-muted/70" : e.bg + " " + e.text)
                        }
                        title={s == null ? "Sin datos este mes" : undefined}
                      >
                        {NOMBRE_COMPONENTE[c]} {s == null ? "—" : Math.round(s)}
                      </span>
                    );
                  })}
                  {f.bonus.total !== 0 && (
                    <span
                      className={
                        "text-[10.5px] px-1.5 py-0.5 rounded font-semibold " +
                        (f.bonus.total > 0 ? "bg-[#FFF4D6] text-[#8A5A16]" : "bg-warn-soft text-warn")
                      }
                      title={`Reconocimientos ${Math.round(f.bonus.reconocimientos * 100) / 100} · A&A ${f.bonus.ayA} · Bonos ${f.bonus.extra} · Constancia ${f.bonus.constancia}`}
                    >
                      Bonus {f.bonus.total > 0 ? "+" : ""}
                      {Math.round(f.bonus.total * 10) / 10}
                    </span>
                  )}
                  {f.faltas && f.faltas.faltas > 0 && (
                    <span className="text-[10.5px] px-1.5 py-0.5 rounded font-semibold bg-warn-soft text-warn">
                      {f.faltas.faltas} llamado{f.faltas.faltas === 1 ? "" : "s"} de atención
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <p className="text-[11.5px] text-muted">
          Puntaje sobre 100 = todo cumplido (puede pasar de 100). Combina ventas en pesos y unidades ({config.peso_ventas}%), UPT (
          {config.peso_upt}%), Magia menos reclamos ({config.peso_magia}%), puntualidad y operación según Feedbacks (
          {config.peso_puntualidad}%) y los 8 reconocimientos ({config.peso_reconocimientos}%, {valorTxt} cada uno); lo que aún no
          tiene datos no suma ni resta. Además se suman bonos: meta de accesorios y de ropa, constancia en el podio y puntos extra
          de jefatura. Jefe de tienda y subjefes no compiten porque auditan.
        </p>
      </div>
      )}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10.5px] px-1.5 py-0.5 rounded border border-line text-muted">{children}</span>
  );
}
