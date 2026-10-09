"use client";

// "Mi ranking" (Huber, 9-oct-2026): lo que ve cada asesor de sí mismo para una competencia sana.
// Su puesto y cuánto le falta para subir, sus reconocimientos, su evolución mes a mes y sus
// fortalezas y oportunidades con datos concretos. La jefatura puede abrir la de cualquiera.

import { useState } from "react";
import { NOMBRES_MES } from "@/lib/horarios";
import { estiloCumplimiento } from "@/lib/cumplimiento";
import {
  ITEMS_RECONOCIMIENTO,
  type FilaRanking,
  type HistorialRanking,
  type MagiaEvaluacion,
  type PersonaRk,
  type RankingConfig,
} from "@/lib/ranking";
import { aspectosDe, carreraTrimestre, fortalezasYOportunidades, miPosicion, trimestreDe, type Aspecto } from "@/lib/mi-ranking";
import { useMountedAnimado } from "@/components/charts/hooks";
import { Avatar, inputCls } from "./ui";

const pts = (v: number) => (Math.round(v * 10) / 10).toString().replace(".", ",");

export function MiRankingView({
  filas,
  personaId,
  personas,
  historial,
  evals,
  config,
  vendeRopa,
  fotos,
  anio,
  mes,
  esJefatura,
}: {
  filas: FilaRanking[];
  personaId: string;
  personas: PersonaRk[];
  historial: HistorialRanking[];
  evals: MagiaEvaluacion[];
  config: RankingConfig;
  vendeRopa: boolean;
  fotos: Record<string, string>;
  anio: number;
  mes: number;
  esJefatura: boolean;
}) {
  const animado = useMountedAnimado();
  // La jefatura (que no compite) elige a quién ver; el asesor se ve a sí mismo.
  const [elegido, setElegido] = useState(() => (filas.some((f) => f.persona.id === personaId) ? personaId : (filas[0]?.persona.id ?? "")));
  const id = esJefatura ? elegido : personaId;
  const f = filas.find((x) => x.persona.id === id) ?? null;

  const selector = esJefatura && (
    <label className="text-[12px] text-muted flex items-center gap-2 flex-wrap">
      Ver la tarjeta de
      <select value={elegido} onChange={(e) => setElegido(e.target.value)} className={inputCls}>
        {personas.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre}
          </option>
        ))}
      </select>
      <span className="text-[11px]">(lo mismo que ve esa persona: úsalo en la conversación de seguimiento)</span>
    </label>
  );

  if (!f) {
    return (
      <div className="space-y-3">
        {selector}
        <div className="bg-panel border border-line rounded-[10px] p-6 text-center text-muted text-sm">
          Jefe de tienda y subjefes no compiten en el ranking: auditan. Aquí cada asesor ve su puesto, su evolución y qué mejorar.
        </div>
      </div>
    );
  }

  const pos = miPosicion(filas, id);
  const ev = evals.filter((e) => e.persona_id === id).sort((a, b) => b.numero - a.numero)[0] ?? null;
  const aspectos = aspectosDe(f, config, vendeRopa, ev);
  const { fortalezas, oportunidades } = fortalezasYOportunidades(aspectos);
  const tri = carreraTrimestre(historial, filas, anio, mes);
  const posTri = tri.filas.findIndex((x) => x.persona_id === id);
  const miTri = posTri >= 0 ? tri.filas[posTri] : null;

  // Evolución: los últimos meses cerrados + el mes en curso.
  const evolucion = [
    ...historial
      .filter((h) => h.persona_id === id && (h.anio < anio || (h.anio === anio && h.mes < mes)))
      .sort((a, b) => a.anio - b.anio || a.mes - b.mes)
      .slice(-5)
      .map((h) => ({ k: `${h.anio}-${h.mes}`, label: NOMBRES_MES[h.mes - 1].slice(0, 3), puntaje: Number(h.puntaje), puesto: h.puesto, vivo: false })),
    ...(f.puntaje != null && pos ? [{ k: "actual", label: NOMBRES_MES[mes - 1].slice(0, 3), puntaje: f.puntaje, puesto: pos.puesto, vivo: true }] : []),
  ];
  const maxEv = Math.max(100, ...evolucion.map((e) => e.puntaje));
  const est = estiloCumplimiento(f.puntaje != null ? f.puntaje / 100 : null);

  const tarjeta = (a: Aspecto, tipo: "f" | "o") => (
    <li key={a.id} className={"rounded-md border px-3 py-2 " + (tipo === "f" ? "border-emerald-200 bg-emerald-50/60" : "border-amber-300 bg-amber-50/70")}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold">{a.titulo}</span>
        <span className={"text-[12px] font-bold " + estiloCumplimiento(a.score / 100).text}>{Math.round(a.score)}</span>
      </div>
      <div className="text-[12px] text-ink/80 mt-0.5">{a.texto}</div>
    </li>
  );

  return (
    <div className="space-y-4">
      {selector}

      {/* Puesto y cuánto falta */}
      <div className="bg-panel border border-line rounded-[12px] p-4 flex items-center gap-4 flex-wrap">
        <Avatar nombre={f.persona.nombre} url={fotos[f.persona.id]} tam={64} anillo={pos && pos.puesto <= 3 ? (["oro", "plata", "bronce"] as const)[pos.puesto - 1] : "ninguno"} />
        <div className="flex-1 min-w-[200px]">
          <div className="text-[12px] text-muted uppercase tracking-wider">
            {NOMBRES_MES[mes - 1]} {anio}
          </div>
          <div className="font-display text-[22px] font-bold leading-tight">
            {pos ? (
              <>
                Vas {pos.puesto}.º <span className="text-[15px] font-semibold text-muted">de {pos.de}</span>
              </>
            ) : (
              "Aún sin puntaje"
            )}
          </div>
          <div className="text-[13px] mt-0.5">
            {pos?.paraSubir != null
              ? `Te faltan ${pts(pos.paraSubir)} puntos para pasar al ${pos.puesto - 1}.º lugar.`
              : pos
                ? pos.ventaja != null
                  ? `¡Vas de primero! Le llevas ${pts(pos.ventaja)} puntos al 2.º.`
                  : "¡Vas de primero!"
                : "Tu puntaje aparece cuando haya cierres y datos del mes."}
          </div>
        </div>
        <div className={"font-display text-[30px] font-bold " + est.text}>{f.puntaje != null ? `${Math.round(f.puntaje)}` : "—"}</div>
      </div>

      {/* Reconocimientos */}
      {f.reconocimientos.length > 0 && (
        <div className="bg-panel border-2 border-[#E0A526]/70 rounded-[12px] p-3">
          <div className="text-[12px] font-semibold uppercase tracking-wider text-[#8A5A16] mb-1.5">Tus reconocimientos del mes</div>
          <div className="flex flex-wrap gap-1.5">
            {f.reconocimientos.map((r) => (
              <span key={r} className="text-[12px] font-semibold px-2 py-1 rounded-full bg-[#FFF4D6] text-[#8A5A16]">
                🏅 {ITEMS_RECONOCIMIENTO.find((i) => i.id === r)?.titulo}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Fortalezas y oportunidades */}
      <div className="grid md:grid-cols-2 gap-3">
        <div className="bg-panel border border-line rounded-[12px] p-3">
          <div className="text-[13px] font-semibold mb-2">💪 Tus fortalezas</div>
          {fortalezas.length ? <ul className="space-y-2">{fortalezas.map((a) => tarjeta(a, "f"))}</ul> : <p className="text-[12px] text-muted">Aún no hay datos suficientes este mes.</p>}
        </div>
        <div className="bg-panel border border-line rounded-[12px] p-3">
          <div className="text-[13px] font-semibold mb-2">🎯 Para subir en el ranking</div>
          {oportunidades.length ? (
            <ul className="space-y-2">{oportunidades.map((a) => tarjeta(a, "o"))}</ul>
          ) : (
            <p className="text-[12px] text-muted">{aspectos.length ? "¡Vas al día en todo! Sigue así." : "Aún no hay datos suficientes este mes."}</p>
          )}
        </div>
      </div>

      {/* Evolución */}
      {evolucion.length > 0 && (
        <div className="bg-panel border border-line rounded-[12px] p-3">
          <div className="text-[13px] font-semibold mb-2">📈 Tu evolución</div>
          <div className="flex items-end gap-3 h-32">
            {evolucion.map((e, i) => (
              <div key={e.k} className="flex-1 flex flex-col items-center justify-end h-full min-w-[36px]">
                <div className="text-[11px] font-semibold">{Math.round(e.puntaje)}</div>
                <div
                  className={"w-full max-w-[44px] rounded-t transition-[height] ease-out " + (e.vivo ? "bg-brand" : "bg-brand/40")}
                  style={{ height: animado ? `${(e.puntaje / maxEv) * 80}%` : "0%", transitionDuration: "800ms", transitionDelay: `${i * 80}ms` }}
                />
                <div className="text-[11px] text-muted mt-1 capitalize">{e.label}</div>
                <div className="text-[10.5px] text-muted">{e.puesto}.º</div>
              </div>
            ))}
          </div>
          {evolucion.length === 1 && <p className="text-[11.5px] text-muted mt-1">Aquí verás cómo te va mes a mes cuando la jefatura cierre los meses.</p>}
        </div>
      )}

      {/* Trimestre */}
      {miTri && (
        <div className="bg-panel border border-line rounded-[12px] p-3 text-[13px]">
          <div className="font-semibold mb-1">🏁 Carrera del trimestre (T{trimestreDe(mes)})</div>
          Vas <strong>{posTri + 1}.º</strong> de {tri.filas.length} con <strong>{pts(miTri.total)}</strong> puntos sumando los meses del trimestre
          {posTri > 0 ? ` · te faltan ${pts(tri.filas[posTri - 1].total - miTri.total)} para el ${posTri}.º` : ""}.
          {miTri.mejora != null && (
            <span className={miTri.mejora >= 0 ? " text-operaciones" : " text-warn"}>
              {" "}
              {miTri.mejora >= 0 ? `Subiste ${pts(miTri.mejora)}` : `Bajaste ${pts(-miTri.mejora)}`} puntos frente al mes anterior.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
