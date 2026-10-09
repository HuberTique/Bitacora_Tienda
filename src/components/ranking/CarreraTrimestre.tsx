"use client";

// Carrera del trimestre (Huber, 9-oct-2026): gana quien más puntos suma en los 3 meses; además
// se reconoce a quien más mejoró frente a su mes anterior. El asesor ve el podio y su propia
// fila; la tabla completa, la jefatura.

import { NOMBRES_MES } from "@/lib/horarios";
import type { FilaRanking, HistorialRanking } from "@/lib/ranking";
import { carreraTrimestre, trimestreDe } from "@/lib/mi-ranking";
import { useMountedAnimado } from "@/components/charts/hooks";
import { Avatar } from "./ui";

const MEDALLA = ["🥇", "🥈", "🥉"];
const ANILLOS = ["oro", "plata", "bronce"] as const;
const pts = (v: number) => (Math.round(v * 10) / 10).toString().replace(".", ",");
const primerNombre = (n: string) => n.trim().split(/\s+/)[0];

export function CarreraTrimestre({
  historial,
  filas,
  anio,
  mes,
  fotos,
  esJefatura,
  miId,
}: {
  historial: HistorialRanking[];
  filas: FilaRanking[];
  anio: number;
  mes: number;
  fotos: Record<string, string>;
  esJefatura: boolean;
  miId: string;
}) {
  const animado = useMountedAnimado();
  // Solo compiten quienes están en el ranking del mes (jefe y subjefes auditan).
  const compiten = new Set(filas.map((f) => f.persona.id));
  const tri = carreraTrimestre(historial, filas, anio, mes);
  const lista = tri.filas.filter((f) => compiten.has(f.persona_id));
  const max = Math.max(1, ...lista.map((f) => f.total));
  const visibles = esJefatura ? lista : lista.filter((f, i) => i < 3 || f.persona_id === miId);

  if (lista.length === 0) {
    return (
      <div className="bg-panel border border-line rounded-[10px] p-8 text-center text-muted text-sm">
        Aún no hay puntajes en este trimestre.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[12.5px] text-muted">
        <strong className="text-ink">
          Trimestre {trimestreDe(mes)} de {anio}
        </strong>{" "}
        ({tri.meses.map((m) => NOMBRES_MES[m - 1]).join(", ")}): gana quien más puntos suma en los tres meses. Los meses cerrados salen
        del historial; el mes en curso va en vivo.
      </p>
      {tri.sinCerrar.length > 0 && (
        <div className="text-[12px] bg-amber-50 border border-amber-300 text-[#8A5A16] rounded-md px-3 py-2">
          ⚠ {tri.sinCerrar.map((m) => NOMBRES_MES[m - 1]).join(" y ")} no se cerró: sus puntos no suman todavía.
          {esJefatura ? " Ciérralo en Ranking → Meses anteriores." : ""}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {lista.slice(0, 3).map((f, i) => (
          <div
            key={f.persona_id}
            className={"bg-panel border rounded-[12px] px-3 pt-4 pb-3 flex flex-col items-center text-center " + (i === 0 ? "border-[#E0A526] shadow-md" : "border-line")}
          >
            <div className="text-2xl leading-none mb-2" aria-hidden>
              {MEDALLA[i]}
            </div>
            <Avatar nombre={f.nombre} url={fotos[f.persona_id]} tam={i === 0 ? 72 : 58} anillo={ANILLOS[i]} />
            <div className="mt-2 font-display font-bold text-[15px] leading-tight">{primerNombre(f.nombre)}</div>
            <div className="text-[13px] font-semibold text-muted">{pts(f.total)} pts</div>
          </div>
        ))}
      </div>

      {tri.masMejoro && compiten.has(tri.masMejoro.persona_id) && (
        <div className="bg-panel border-2 border-[#E0A526]/70 rounded-[12px] p-3 flex items-center gap-3">
          <Avatar nombre={tri.masMejoro.nombre} url={fotos[tri.masMejoro.persona_id]} tam={44} anillo="oro" />
          <div>
            <div className="text-[11px] uppercase tracking-wider font-semibold text-[#8A5A16]">🚀 Quien más mejoró</div>
            <div className="text-[14px] font-semibold">
              {primerNombre(tri.masMejoro.nombre)} subió {pts(tri.masMejoro.mejora!)} puntos frente a su mes anterior
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {visibles.map((f) => {
          const i = lista.indexOf(f);
          return (
            <div
              key={f.persona_id}
              className={"bg-panel border rounded-[10px] px-3 py-2.5 flex items-center gap-3 " + (f.persona_id === miId ? "border-brand" : "border-line")}
            >
              <div className="w-7 text-center font-display font-bold text-[18px] text-muted">{i + 1}</div>
              <Avatar nombre={f.nombre} url={fotos[f.persona_id]} tam={36} />
              <div className="flex-1 min-w-0">
                <div className="flex justify-between gap-2">
                  <span className="font-semibold text-[13.5px] truncate">
                    {f.nombre}
                    {f.persona_id === miId ? " (tú)" : ""}
                  </span>
                  <span className="font-display font-bold">{pts(f.total)}</span>
                </div>
                <div className="relative h-2 rounded-full bg-neutral-100 mt-1 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-brand transition-[width] ease-out"
                    style={{ width: animado ? `${(f.total / max) * 100}%` : "0%", transitionDuration: "900ms" }}
                  />
                </div>
                <div className="text-[11px] text-muted mt-1">
                  {tri.meses.map((m, k) => `${NOMBRES_MES[m - 1].slice(0, 3)} ${f.porMes[k] != null ? pts(f.porMes[k]!) : "—"}`).join(" · ")}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {!esJefatura && <p className="text-[11.5px] text-muted">Ves el podio y tu posición; la tabla completa la ve la jefatura.</p>}
    </div>
  );
}
