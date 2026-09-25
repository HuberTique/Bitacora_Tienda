"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { NOMBRES_MES } from "@/lib/horarios";
import { useTienda } from "@/lib/tienda-config";
import {
  MAGIA_CRITERIOS,
  MAGIA_ESCALA,
  MAGIA_PUNTOS_MAX,
  totalMagia,
  type MagiaEvaluacion,
  type PersonaRk,
} from "@/lib/ranking";
import { Modal, inputCls } from "./ui";

type Clave = (typeof MAGIA_CRITERIOS)[number]["key"] | "impresion_final";

export function MagiaView({
  personas,
  evals,
  anio,
  mes,
  esJefatura,
  evaluadorId,
  miId,
  onGuardado,
}: {
  personas: PersonaRk[]; // quienes se evalúan (los que compiten)
  evals: MagiaEvaluacion[];
  anio: number;
  mes: number;
  esJefatura: boolean;
  evaluadorId: string;
  miId: string;
  onGuardado: () => void;
}) {
  const [abierta, setAbierta] = useState<{ persona: PersonaRk; numero: 1 | 2 } | null>(null);
  const [verResultados, setVerResultados] = useState<PersonaRk | null>(null);

  const evalDe = (personaId: string, n: 1 | 2) =>
    evals.find((e) => e.persona_id === personaId && e.numero === n) ?? null;

  // Un asesor solo ve lo suyo (RLS ya filtra); jefatura ve a todos.
  const filas = esJefatura ? personas : personas.filter((p) => evals.some((e) => e.persona_id === p.id));

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-muted max-w-2xl">
        Evaluación <strong>Magia con una sonrisa</strong>: dos evaluaciones por mes (escala 1 a 4 en
        cinco criterios M-A-G-I-A más la impresión final, máximo {MAGIA_PUNTOS_MAX} puntos). El
        promedio del mes alimenta el ranking.
      </p>
      {filas.length === 0 ? (
        <div className="bg-panel border border-line rounded-[10px] p-8 text-center text-muted text-sm">
          {esJefatura
            ? "No hay personas para evaluar."
            : `Aún no tienes evaluaciones Magia en ${NOMBRES_MES[mes - 1]} ${anio}.`}
        </div>
      ) : (
        <div className="bg-panel border border-line rounded-[10px] overflow-x-auto">
          <table className="w-full text-[13px] min-w-[560px]">
            <thead>
              <tr className="text-left text-muted uppercase tracking-wider text-[10.5px] border-b border-line">
                <th className="px-3 py-2">Nombre</th>
                <th className="px-2 py-2 text-center">Evaluación 1</th>
                <th className="px-2 py-2 text-center">Evaluación 2</th>
                <th className="px-2 py-2 text-center">Promedio del mes</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {filas.map((p) => {
                const e1 = evalDe(p.id, 1);
                const e2 = evalDe(p.id, 2);
                const totales = [e1, e2].filter(Boolean).map((e) => totalMagia(e!));
                const prom = totales.length ? totales.reduce((a, b) => a + b, 0) / totales.length : null;
                return (
                  <tr key={p.id} className="border-b border-line/60 last:border-0">
                    <td className="px-3 py-2">{p.nombre}</td>
                    {([1, 2] as const).map((n) => {
                      const e = n === 1 ? e1 : e2;
                      return (
                        <td key={n} className="px-2 py-2 text-center">
                          {e ? (
                            <span className="font-mono font-semibold">
                              {totalMagia(e)}/{MAGIA_PUNTOS_MAX}
                            </span>
                          ) : esJefatura ? (
                            <button
                              type="button"
                              onClick={() => setAbierta({ persona: p, numero: n })}
                              className="text-brand text-xs font-semibold hover:underline"
                            >
                              Evaluar
                            </button>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 text-center font-mono font-bold">
                      {prom != null ? `${prom.toFixed(1)}/${MAGIA_PUNTOS_MAX}` : "—"}
                    </td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      {(e1 || e2) && (
                        <button
                          type="button"
                          onClick={() => setVerResultados(p)}
                          className="text-xs text-brand hover:underline mr-3"
                        >
                          Ver resultados
                        </button>
                      )}
                      {esJefatura && e1 && (
                        <button
                          type="button"
                          onClick={() => setAbierta({ persona: p, numero: 1 })}
                          className="text-xs text-muted hover:underline mr-2"
                        >
                          Editar 1
                        </button>
                      )}
                      {esJefatura && e2 && (
                        <button
                          type="button"
                          onClick={() => setAbierta({ persona: p, numero: 2 })}
                          className="text-xs text-muted hover:underline"
                        >
                          Editar 2
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {abierta && (
        <FormularioMagia
          persona={abierta.persona}
          numero={abierta.numero}
          existente={evalDe(abierta.persona.id, abierta.numero)}
          anio={anio}
          mes={mes}
          evaluadorId={evaluadorId}
          onClose={() => setAbierta(null)}
          onGuardado={() => {
            setAbierta(null);
            onGuardado();
          }}
        />
      )}
      {verResultados && (
        <Resultados
          persona={verResultados}
          e1={evalDe(verResultados.id, 1)}
          e2={evalDe(verResultados.id, 2)}
          puedeConfirmar={verResultados.id === miId}
          onClose={() => setVerResultados(null)}
          onConfirmada={onGuardado}
        />
      )}
    </div>
  );
}

function FormularioMagia({
  persona,
  numero,
  existente,
  anio,
  mes,
  evaluadorId,
  onClose,
  onGuardado,
}: {
  persona: PersonaRk;
  numero: 1 | 2;
  existente: MagiaEvaluacion | null;
  anio: number;
  mes: number;
  evaluadorId: string;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const tienda = useTienda();
  const [valores, setValores] = useState<Partial<Record<Clave, number>>>(() =>
    existente
      ? {
          c_sonrisa: existente.c_sonrisa,
          c_preguntas: existente.c_preguntas,
          c_experiencia: existente.c_experiencia,
          c_tecnologias: existente.c_tecnologias,
          c_cierre: existente.c_cierre,
          impresion_final: existente.impresion_final,
        }
      : {},
  );
  const [fecha, setFecha] = useState(existente?.fecha ?? new Date().toISOString().slice(0, 10));
  const [fortalezas, setFortalezas] = useState(existente?.fortalezas ?? "");
  const [oportunidades, setOportunidades] = useState(existente?.oportunidades ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const completo = MAGIA_CRITERIOS.every((c) => valores[c.key]) && valores.impresion_final;
  const total = Object.values(valores).reduce((a, b) => a + (b ?? 0), 0);

  async function guardar() {
    setError(null);
    if (!completo) {
      setError("Califica los cinco criterios y la impresión final.");
      return;
    }
    setGuardando(true);
    const { error: err } = await supabase.from("magia_evaluaciones").upsert(
      {
        persona_id: persona.id,
        evaluador_id: evaluadorId,
        anio,
        mes,
        numero,
        fecha,
        c_sonrisa: valores.c_sonrisa,
        c_preguntas: valores.c_preguntas,
        c_experiencia: valores.c_experiencia,
        c_tecnologias: valores.c_tecnologias,
        c_cierre: valores.c_cierre,
        impresion_final: valores.impresion_final,
        fortalezas: fortalezas.trim(),
        oportunidades: oportunidades.trim(),
        // Si jefatura cambia la evaluación, el evaluado debe volver a confirmarla.
        confirmada_at: null,
        comentario_evaluado: "",
      },
      { onConflict: "persona_id,anio,mes,numero" },
    );
    setGuardando(false);
    if (err) {
      setError(err.message);
      return;
    }
    onGuardado();
  }

  function botones(k: Clave) {
    return (
      <div className="flex gap-1.5">
        {MAGIA_ESCALA.map((e) => (
          <button
            key={e.v}
            type="button"
            title={e.label}
            onClick={() => setValores((v) => ({ ...v, [k]: e.v }))}
            className={
              "w-9 h-9 rounded-md border text-sm font-semibold transition-colors " +
              (valores[k] === e.v
                ? "bg-brand text-white border-brand"
                : "bg-white border-line hover:bg-paper")
            }
          >
            {e.v}
          </button>
        ))}
      </div>
    );
  }

  return (
    <Modal titulo={`Evaluación del vendedor — Magia con una sonrisa (${numero})`} onClose={onClose} ancho="max-w-3xl">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3 text-sm">
        <div>
          <div className="text-[11px] text-muted uppercase tracking-wider">Evaluado</div>
          <div className="font-semibold">{persona.nombre}</div>
        </div>
        <div>
          <div className="text-[11px] text-muted uppercase tracking-wider">Tienda</div>
          <div className="font-semibold">{tienda.nombre}</div>
        </div>
        <label className="text-[11px] text-muted uppercase tracking-wider">
          Fecha
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className={inputCls + " block w-full mt-1"}
          />
        </label>
      </div>
      <p className="text-[11.5px] text-muted mb-3">
        Escala: {MAGIA_ESCALA.map((e) => `${e.v} ${e.label}`).join(" · ")}
      </p>

      <div className="space-y-2">
        {MAGIA_CRITERIOS.map((c) => (
          <div
            key={c.key}
            className="flex items-center gap-3 border border-line rounded-md px-3 py-2 bg-white"
          >
            <div className="w-8 h-8 rounded-full bg-brand text-white font-display font-bold flex items-center justify-center shrink-0">
              {c.letra}
            </div>
            <div className="flex-1 text-[13px]">{c.texto}</div>
            {botones(c.key)}
          </div>
        ))}
        <div className="flex items-center gap-3 border border-[#E0A526]/60 rounded-md px-3 py-2 bg-[#FFFBEF]">
          <div className="w-8 h-8 rounded-full bg-[#E0A526] text-white flex items-center justify-center shrink-0">
            ★
          </div>
          <div className="flex-1 text-[13px] font-semibold">Impresión final</div>
          {botones("impresion_final")}
        </div>
      </div>

      <div className="flex justify-end mt-2 text-sm">
        Total: <strong className="ml-1 font-mono">{total}/{MAGIA_PUNTOS_MAX}</strong>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
        <label className="text-[11px] text-muted uppercase tracking-wider">
          Fortalezas
          <textarea
            value={fortalezas}
            onChange={(e) => setFortalezas(e.target.value)}
            rows={3}
            className={inputCls + " block w-full mt-1 normal-case tracking-normal"}
          />
        </label>
        <label className="text-[11px] text-muted uppercase tracking-wider">
          Oportunidades para mejorar
          <textarea
            value={oportunidades}
            onChange={(e) => setOportunidades(e.target.value)}
            rows={3}
            className={inputCls + " block w-full mt-1 normal-case tracking-normal"}
          />
        </label>
      </div>

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
        {guardando ? "Guardando…" : existente ? "Actualizar evaluación" : "Guardar evaluación"}
      </button>
    </Modal>
  );
}

function Resultados({
  persona,
  e1,
  e2,
  puedeConfirmar,
  onClose,
  onConfirmada,
}: {
  persona: PersonaRk;
  e1: MagiaEvaluacion | null;
  e2: MagiaEvaluacion | null;
  puedeConfirmar: boolean;
  onClose: () => void;
  onConfirmada: () => void;
}) {
  const totales = [e1, e2].filter(Boolean).map((e) => totalMagia(e!));
  const prom = totales.length ? totales.reduce((a, b) => a + b, 0) / totales.length : null;
  return (
    <Modal titulo={`Plantilla de resultados — ${persona.nombre}`} onClose={onClose} ancho="max-w-3xl">
      <div className="grid grid-cols-3 gap-3 mb-4 text-center">
        {[
          ["Evaluación 1", e1 ? `${totalMagia(e1)}/${MAGIA_PUNTOS_MAX}` : "—"],
          ["Evaluación 2", e2 ? `${totalMagia(e2)}/${MAGIA_PUNTOS_MAX}` : "—"],
          ["Promedio del mes", prom != null ? `${prom.toFixed(1)}/${MAGIA_PUNTOS_MAX}` : "—"],
        ].map(([t, v]) => (
          <div key={t} className="border border-line rounded-md py-3 bg-white">
            <div className="text-[11px] text-muted uppercase tracking-wider">{t}</div>
            <div className="font-display font-bold text-xl">{v}</div>
          </div>
        ))}
      </div>
      {[e1, e2].map(
        (e, i) =>
          e && (
            <div key={i} className="border border-line rounded-md p-3 mb-3 bg-white">
              <div className="text-sm font-semibold mb-2">
                Evaluación {i + 1} · {e.fecha}
              </div>
              <div className="grid grid-cols-6 gap-1.5 mb-2">
                {MAGIA_CRITERIOS.map((c) => (
                  <div key={c.key} className="text-center border border-line rounded py-1">
                    <div className="text-[10px] text-muted">{c.letra}</div>
                    <div className="font-mono font-bold">{e[c.key]}</div>
                  </div>
                ))}
                <div className="text-center border border-[#E0A526]/60 rounded py-1 bg-[#FFFBEF]">
                  <div className="text-[10px] text-muted">★</div>
                  <div className="font-mono font-bold">{e.impresion_final}</div>
                </div>
              </div>
              {e.fortalezas && (
                <p className="text-[12.5px]">
                  <strong>Fortalezas:</strong> {e.fortalezas}
                </p>
              )}
              {e.oportunidades && (
                <p className="text-[12.5px]">
                  <strong>Oportunidades:</strong> {e.oportunidades}
                </p>
              )}
              <Confirmacion e={e} puedeConfirmar={puedeConfirmar} onConfirmada={onConfirmada} />
            </div>
          ),
      )}
    </Modal>
  );
}

function Confirmacion({
  e,
  puedeConfirmar,
  onConfirmada,
}: {
  e: MagiaEvaluacion;
  puedeConfirmar: boolean;
  onConfirmada: () => void;
}) {
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (e.confirmada_at) {
    return (
      <div className="mt-2 text-[12px] bg-operaciones/10 text-operaciones rounded px-2.5 py-1.5">
        ✓ Confirmada por el evaluado el {new Date(e.confirmada_at).toLocaleDateString("es-CO")}
        {e.comentario_evaluado ? ` — "${e.comentario_evaluado}"` : ""}
      </div>
    );
  }
  if (!puedeConfirmar) {
    return (
      <div className="mt-2 text-[12px] bg-amber-50 text-[#8A5A16] rounded px-2.5 py-1.5">
        Pendiente de confirmación del evaluado.
      </div>
    );
  }

  async function confirmar() {
    setError(null);
    setEnviando(true);
    const { error: err } = await supabase.rpc("confirmar_magia", {
      p_id: e.id,
      p_comentario: comentario.trim(),
    });
    setEnviando(false);
    if (err) {
      setError(err.message);
      return;
    }
    onConfirmada();
  }

  return (
    <div className="mt-2 border border-amber-300 bg-amber-50 rounded px-2.5 py-2">
      <div className="text-[12px] text-[#8A5A16] font-semibold mb-1">
        Revisa tu evaluación y confírmala
      </div>
      <textarea
        value={comentario}
        onChange={(ev) => setComentario(ev.target.value)}
        rows={2}
        placeholder="Comentario (opcional)"
        className={inputCls + " w-full text-[12.5px]"}
      />
      {error && <div className="text-xs text-warn mt-1">{error}</div>}
      <button
        type="button"
        onClick={confirmar}
        disabled={enviando}
        className="mt-1.5 px-3 py-1.5 rounded-md bg-brand text-white text-xs font-semibold disabled:opacity-50"
      >
        {enviando ? "Enviando…" : "Confirmo que la revisé"}
      </button>
    </div>
  );
}
