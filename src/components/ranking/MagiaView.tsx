"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { NOMBRES_MES } from "@/lib/horarios";
import { useTienda } from "@/lib/tienda-config";
import { MAGIA_PUNTOS_MAX, totalMagia, type MagiaEvaluacion, type PersonaRk } from "@/lib/ranking";
import {
  COLOR_CUADRANTE,
  MAGIA_ITEMS,
  criteriosMagia,
  cuadranteMagia,
  escalaMagia,
  labelFormato,
  normalizarFormato,
  promedioMagia,
  redondear1,
  resumenMesMagia,
  ventanaMagia,
  MAGIA_DIA_LIMITE,
  type ClaveCriterio,
  type FormatoTienda,
  type NivelMagia,
} from "@/lib/magia";
import { generarMagiaPdf } from "@/lib/magia-pdf";
import { CuadriculaMagia, type PuntoCuadricula } from "./CuadriculaMagia";
import { Modal, inputCls } from "./ui";

type Clave = ClaveCriterio | "impresion_final";

// Los promedios se muestran siempre con un decimal.
const fmt = (n: number, dec = 1) => redondear1(n).toFixed(dec).replace(".", ",");

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a}` : iso;
}

/** Casilla de la cuadrícula con su color y el nombre del nivel en ese formato. */
function CasillaTag({ casilla, formato }: { casilla: NivelMagia; formato: FormatoTienda }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold whitespace-nowrap">
      <span
        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
        style={{ background: COLOR_CUADRANTE[casilla] }}
        aria-hidden
      />
      {casilla} · {escalaMagia(formato)[casilla - 1].label}
    </span>
  );
}

/** Personas que todavía no tienen ninguna evaluación Magia en el mes que se mira. */
export function pendientesMagia(personas: PersonaRk[], evals: MagiaEvaluacion[]): PersonaRk[] {
  const evaluadas = new Set(evals.map((e) => e.persona_id));
  return personas.filter((p) => !evaluadas.has(p.id));
}

/**
 * Recordatorio de la ventana de evaluación: Magia se hace en los primeros
 * días de cada mes. Solo aparece al mirar el mes en curso.
 */
function AvisoVentana({ anio, mes, pendientes }: { anio: number; mes: number; pendientes: PersonaRk[] }) {
  const ventana = ventanaMagia(new Date(), anio, mes);
  if (ventana.estado === "otro_mes") return null;
  const nombres = pendientes.map((p) => p.nombre.split(/\s+/).slice(0, 2).join(" ")).join(", ");

  if (pendientes.length === 0) {
    return (
      <div className="bg-operaciones/10 text-operaciones border border-operaciones/30 rounded-md px-3 py-2 text-[12.5px]">
        ✓ Todo el equipo ya tiene su evaluación Magia de este mes.
      </div>
    );
  }
  if (ventana.estado === "abierta") {
    const dias = ventana.diasRestantes;
    return (
      <div className="bg-amber-50 text-[#8A5A16] border border-amber-300 rounded-md px-3 py-2 text-[12.5px]">
        <strong>
          {dias === 1 ? "Hoy es el último día" : `Quedan ${dias} días`} para la evaluación Magia del mes
        </strong>{" "}
        (se hace del 1 al {MAGIA_DIA_LIMITE}). Faltan {pendientes.length} por evaluar: {nombres}.
      </div>
    );
  }
  return (
    <div className="bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-[12.5px]">
      <strong>
        La evaluación Magia del mes venció el día {MAGIA_DIA_LIMITE} (hace {ventana.diasDeAtraso}{" "}
        {ventana.diasDeAtraso === 1 ? "día" : "días"}).
      </strong>{" "}
      Faltan {pendientes.length} por evaluar: {nombres}.
    </div>
  );
}

export function MagiaView({
  personas,
  roster,
  evals,
  anio,
  mes,
  esJefatura,
  evaluadorId,
  miId,
  onGuardado,
}: {
  personas: PersonaRk[]; // quienes se evalúan (los que compiten)
  roster: PersonaRk[]; // todo el equipo, para mostrar el nombre de quien evaluó
  evals: MagiaEvaluacion[];
  anio: number;
  mes: number;
  esJefatura: boolean;
  evaluadorId: string;
  miId: string;
  onGuardado: () => void;
}) {
  const tienda = useTienda();
  const [abierta, setAbierta] = useState<{ persona: PersonaRk; numero: 1 | 2 } | null>(null);
  const [verResultados, setVerResultados] = useState<PersonaRk | null>(null);
  const [verHistorico, setVerHistorico] = useState<PersonaRk | null>(null);

  const evalDe = (personaId: string, n: 1 | 2) =>
    evals.find((e) => e.persona_id === personaId && e.numero === n) ?? null;

  const nombreDe = (id: string | null) => roster.find((p) => p.id === id)?.nombre ?? "";

  // Jefatura ve a todo el equipo; un asesor solo su propia fila (RLS ya filtra
  // los datos), aunque todavía no tenga evaluación este mes, para que pueda
  // abrir su histórico.
  const filas = esJefatura ? personas : personas.filter((p) => p.id === miId);

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-muted max-w-2xl">
        Evaluación <strong>Magia con una sonrisa</strong>, formato{" "}
        <strong>{labelFormato(tienda.formato)}</strong>: dos evaluaciones por mes (escala 1 a 4 en
        cinco criterios M-A-G-I-A más la impresión final, máximo {MAGIA_PUNTOS_MAX} puntos). Se
        realiza en los primeros {MAGIA_DIA_LIMITE} días de cada mes. El promedio de cada evaluación,
        con un decimal, define su lugar en la cuadrícula Gestión / Resultados, y el promedio del mes
        alimenta el ranking.
      </p>
      {esJefatura && <AvisoVentana anio={anio} mes={mes} pendientes={pendientesMagia(personas, evals)} />}
      {filas.length === 0 ? (
        <div className="bg-panel border border-line rounded-[10px] p-8 text-center text-muted text-sm">
          {esJefatura ? "No hay personas para evaluar." : "No estás en la lista de personas que se evalúan."}
        </div>
      ) : (
        <div className="bg-panel border border-line rounded-[10px] overflow-x-auto">
          <table className="w-full text-[13px] min-w-[720px]">
            <thead>
              <tr className="text-left text-muted uppercase tracking-wider text-[10.5px] border-b border-line">
                <th className="px-3 py-2">Nombre</th>
                <th className="px-2 py-2 text-center">Evaluación 1</th>
                <th className="px-2 py-2 text-center">Evaluación 2</th>
                <th className="px-2 py-2 text-center">Promedio del mes</th>
                <th className="px-2 py-2">Casilla</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {filas.map((p) => {
                const e1 = evalDe(p.id, 1);
                const e2 = evalDe(p.id, 2);
                const delMes = [e1, e2].filter((e): e is MagiaEvaluacion => !!e);
                const resumen = resumenMesMagia(delMes);
                const formatoMes = normalizarFormato((e2 ?? e1)?.formato ?? tienda.formato);
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
                      {resumen ? `${fmt(resumen.totalPromedio, 1)}/${MAGIA_PUNTOS_MAX}` : "—"}
                    </td>
                    <td className="px-2 py-2">
                      {resumen ? (
                        <CasillaTag casilla={resumen.cuadrante} formato={formatoMes} />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
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
                      <button
                        type="button"
                        onClick={() => setVerHistorico(p)}
                        className="text-xs text-brand hover:underline mr-3"
                      >
                        Histórico
                      </button>
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
          anio={anio}
          mes={mes}
          e1={evalDe(verResultados.id, 1)}
          e2={evalDe(verResultados.id, 2)}
          puedeConfirmar={verResultados.id === miId}
          nombreDe={nombreDe}
          onClose={() => setVerResultados(null)}
          onConfirmada={onGuardado}
        />
      )}
      {verHistorico && (
        <Historico persona={verHistorico} nombreDe={nombreDe} onClose={() => setVerHistorico(null)} />
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
  // Una evaluación ya guardada conserva el formato con el que se hizo; una
  // nueva toma el formato actual de la tienda.
  const formato = normalizarFormato(existente?.formato ?? tienda.formato);
  const criterios = criteriosMagia(formato);
  const escala = escalaMagia(formato);

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

  const completo = criterios.every((c) => valores[c.key]) && !!valores.impresion_final;
  const total = Object.values(valores).reduce((a, b) => a + (b ?? 0), 0);
  const promedio = completo ? total / MAGIA_ITEMS : null;

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
        formato,
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
        {escala.map((e) => (
          <button
            key={e.v}
            type="button"
            title={e.label}
            aria-label={`${e.v}: ${e.label}`}
            aria-pressed={valores[k] === e.v}
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
    <Modal
      titulo={`Evaluación del vendedor — Magia con una sonrisa (${numero}) · ${labelFormato(formato)}`}
      onClose={onClose}
      ancho="max-w-3xl"
    >
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
        Escala: {escala.map((e) => `${e.v} ${e.label}`).join(" · ")}
      </p>

      <div className="space-y-2">
        {criterios.map((c) => (
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

      <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-1 mt-3 text-sm">
        <span>
          Total: <strong className="font-mono">{total}/{MAGIA_PUNTOS_MAX}</strong>
        </span>
        <span>
          Promedio: <strong className="font-mono">{promedio != null ? fmt(promedio) : "—"}</strong>
        </span>
        <span className="inline-flex items-center gap-1.5">
          Casilla:{" "}
          {promedio != null ? (
            <CasillaTag casilla={cuadranteMagia(promedio)} formato={formato} />
          ) : (
            <strong>—</strong>
          )}
        </span>
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

/** Botón que arma y descarga el PDF de un mes (una hoja por evaluación + resultados). */
function BotonPdf({
  persona,
  anio,
  mes,
  evaluaciones,
  nombreDe,
  className,
}: {
  persona: PersonaRk;
  anio: number;
  mes: number;
  evaluaciones: MagiaEvaluacion[];
  nombreDe: (id: string | null) => string;
  className?: string;
}) {
  const tienda = useTienda();
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function descargar() {
    setError(null);
    setGenerando(true);
    try {
      await generarMagiaPdf({
        evaluado: persona.nombre,
        tienda: tienda.nombre,
        anio,
        mes,
        evaluaciones,
        nombreEvaluador: nombreDe,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerando(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={descargar}
        disabled={generando || evaluaciones.length === 0}
        className={
          className ??
          "text-xs px-2.5 py-1.5 border border-brand text-brand rounded-md bg-white hover:bg-brand/5 disabled:opacity-50"
        }
      >
        {generando ? "Generando…" : "Descargar PDF"}
      </button>
      {error && <span className="text-xs text-warn ml-2">{error}</span>}
    </>
  );
}

function Resultados({
  persona,
  anio,
  mes,
  e1,
  e2,
  puedeConfirmar,
  nombreDe,
  onClose,
  onConfirmada,
}: {
  persona: PersonaRk;
  anio: number;
  mes: number;
  e1: MagiaEvaluacion | null;
  e2: MagiaEvaluacion | null;
  puedeConfirmar: boolean;
  nombreDe: (id: string | null) => string;
  onClose: () => void;
  onConfirmada: () => void;
}) {
  const delMes = [e1, e2].filter((e): e is MagiaEvaluacion => !!e);
  const resumen = resumenMesMagia(delMes);
  const puntos: PuntoCuadricula[] = delMes.map((e) => ({
    casilla: cuadranteMagia(promedioMagia(e)),
    promedio: promedioMagia(e),
    etiqueta: `Eval ${e.numero} · ${fmt(promedioMagia(e))}`,
    detalle: `Evaluación ${e.numero} · ${fechaCorta(e.fecha)} · promedio ${fmt(promedioMagia(e))}`,
  }));

  return (
    <Modal titulo={`Plantilla de resultados — ${persona.nombre}`} onClose={onClose} ancho="max-w-3xl">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="text-[12.5px] text-muted capitalize">
          {NOMBRES_MES[mes - 1]} {anio}
        </div>
        <BotonPdf persona={persona} anio={anio} mes={mes} evaluaciones={delMes} nombreDe={nombreDe} />
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4 text-center">
        {[
          ["Evaluación 1", e1 ? `${totalMagia(e1)}/${MAGIA_PUNTOS_MAX}` : "—"],
          ["Evaluación 2", e2 ? `${totalMagia(e2)}/${MAGIA_PUNTOS_MAX}` : "—"],
          ["Promedio del mes", resumen ? `${fmt(resumen.totalPromedio, 1)}/${MAGIA_PUNTOS_MAX}` : "—"],
        ].map(([t, v]) => (
          <div key={t} className="border border-line rounded-md py-3 bg-white">
            <div className="text-[11px] text-muted uppercase tracking-wider">{t}</div>
            <div className="font-display font-bold text-xl">{v}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,300px)_1fr] gap-4 mb-4 items-start">
        <div>
          <div className="text-[11px] text-muted uppercase tracking-wider mb-1.5">
            Planilla Gestión / Resultados
          </div>
          <CuadriculaMagia puntos={puntos} />
        </div>
        <div className="space-y-3">
          {delMes.map((e) => (
            <DetalleEvaluacion
              key={e.numero}
              e={e}
              puedeConfirmar={puedeConfirmar}
              onConfirmada={onConfirmada}
            />
          ))}
        </div>
      </div>
    </Modal>
  );
}

/** Una evaluación completa: puntajes por letra, promedio, casilla, textos y confirmación. */
function DetalleEvaluacion({
  e,
  puedeConfirmar,
  onConfirmada,
}: {
  e: MagiaEvaluacion;
  puedeConfirmar: boolean;
  onConfirmada: () => void;
}) {
  const formato = normalizarFormato(e.formato);
  const criterios = criteriosMagia(formato);
  const promedio = promedioMagia(e);
  return (
    <div className="border border-line rounded-md p-3 bg-white">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <div className="text-sm font-semibold">
          Evaluación {e.numero} · {fechaCorta(e.fecha)}
        </div>
        <CasillaTag casilla={cuadranteMagia(promedio)} formato={formato} />
      </div>
      <div className="grid grid-cols-6 gap-1.5 mb-2">
        {criterios.map((c) => (
          <div key={c.key} className="text-center border border-line rounded py-1" title={c.texto}>
            <div className="text-[10px] text-muted">{c.letra}</div>
            <div className="font-mono font-bold">{e[c.key]}</div>
          </div>
        ))}
        <div
          className="text-center border border-[#E0A526]/60 rounded py-1 bg-[#FFFBEF]"
          title="Impresión final"
        >
          <div className="text-[10px] text-muted">★</div>
          <div className="font-mono font-bold">{e.impresion_final}</div>
        </div>
      </div>
      <div className="text-[12px] text-muted mb-1.5">
        Total <strong className="text-ink font-mono">{totalMagia(e)}/{MAGIA_PUNTOS_MAX}</strong> ·
        promedio <strong className="text-ink font-mono">{fmt(promedio)}</strong> · formato{" "}
        {labelFormato(formato)}
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
  );
}

/** Histórico de un asesor: todas sus evaluaciones Magia, mes a mes. */
function Historico({
  persona,
  nombreDe,
  onClose,
}: {
  persona: PersonaRk;
  nombreDe: (id: string | null) => string;
  onClose: () => void;
}) {
  const [todas, setTodas] = useState<MagiaEvaluacion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    supabase
      .from("magia_evaluaciones")
      .select("*")
      .eq("persona_id", persona.id)
      .order("anio", { ascending: false })
      .order("mes", { ascending: false })
      .order("numero", { ascending: true })
      .then(({ data, error: err }) => {
        if (!vivo) return;
        if (err) setError(err.message);
        else setTodas((data as MagiaEvaluacion[] | null) ?? []);
      });
    return () => {
      vivo = false;
    };
  }, [persona.id]);

  // Un renglón por mes, del más reciente al más antiguo.
  const meses = useMemo(() => {
    const mapa = new Map<string, { anio: number; mes: number; evals: MagiaEvaluacion[] }>();
    for (const e of todas ?? []) {
      const k = `${e.anio}-${e.mes}`;
      if (!mapa.has(k)) mapa.set(k, { anio: e.anio, mes: e.mes, evals: [] });
      mapa.get(k)!.evals.push(e);
    }
    return [...mapa.values()];
  }, [todas]);

  const puntos: PuntoCuadricula[] = (todas ?? []).map((e) => {
    const abr = (NOMBRES_MES[e.mes - 1] ?? "").slice(0, 3);
    return {
      casilla: cuadranteMagia(promedioMagia(e)),
      promedio: promedioMagia(e),
      etiqueta: `${abr}${String(e.anio).slice(2)}-${e.numero}`,
      detalle: `${NOMBRES_MES[e.mes - 1]} ${e.anio} · evaluación ${e.numero} · promedio ${fmt(promedioMagia(e))}`,
    };
  });

  const general =
    todas && todas.length > 0 ? resumenMesMagia(todas) : null;

  return (
    <Modal titulo={`Histórico Magia con una sonrisa — ${persona.nombre}`} onClose={onClose} ancho="max-w-4xl">
      {error && (
        <div className="bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">
          {error}
        </div>
      )}
      {!error && todas === null && <p className="text-sm text-muted">Cargando histórico…</p>}
      {todas && todas.length === 0 && (
        <p className="text-sm text-muted">Aún no hay evaluaciones registradas para esta persona.</p>
      )}
      {todas && todas.length > 0 && general && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,320px)_1fr] gap-4 items-start mb-4">
            <div>
              <div className="text-[11px] text-muted uppercase tracking-wider mb-1.5">
                Planilla Gestión / Resultados — todas las evaluaciones
              </div>
              <CuadriculaMagia puntos={puntos} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                ["Evaluaciones", String(todas.length)],
                ["Meses evaluados", String(meses.length)],
                ["Promedio histórico", `${fmt(general.totalPromedio, 1)}/${MAGIA_PUNTOS_MAX}`],
                ["Promedio (1 a 4)", fmt(general.promedio)],
              ].map(([t, v]) => (
                <div key={t} className="border border-line rounded-md px-3 py-2.5 bg-white">
                  <div className="text-[10.5px] text-muted uppercase tracking-wider">{t}</div>
                  <div className="font-display font-bold text-lg">{v}</div>
                </div>
              ))}
              <div className="col-span-2 text-[11.5px] text-muted">
                Cada punto es una evaluación. Su promedio (suma de puntajes entre los {MAGIA_ITEMS}{" "}
                ítems, con un decimal) define la casilla y qué tan arriba y a la derecha queda dentro
                de ella: así se ve la tendencia de una evaluación a la siguiente.
              </div>
            </div>
          </div>

          <div className="border border-line rounded-md overflow-x-auto bg-white">
            <table className="w-full text-[13px] min-w-[640px]">
              <thead>
                <tr className="text-left text-muted uppercase tracking-wider text-[10.5px] border-b border-line">
                  <th className="px-3 py-2">Mes</th>
                  <th className="px-2 py-2">Evaluación 1</th>
                  <th className="px-2 py-2">Evaluación 2</th>
                  <th className="px-2 py-2">Promedio del mes</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {meses.map((m) => {
                  const resumen = resumenMesMagia(m.evals);
                  const formatoMes = normalizarFormato(m.evals[m.evals.length - 1]?.formato);
                  return (
                    <tr key={`${m.anio}-${m.mes}`} className="border-b border-line/60 last:border-0 align-top">
                      <td className="px-3 py-2 capitalize whitespace-nowrap">
                        {NOMBRES_MES[m.mes - 1]} {m.anio}
                        <div className="text-[10.5px] text-muted normal-case">
                          Formato {labelFormato(formatoMes)}
                        </div>
                      </td>
                      {([1, 2] as const).map((n) => {
                        const e = m.evals.find((x) => x.numero === n);
                        return (
                          <td key={n} className="px-2 py-2">
                            {e ? (
                              <>
                                <div className="font-mono font-semibold">
                                  {totalMagia(e)}/{MAGIA_PUNTOS_MAX}
                                  <span className="text-muted font-normal"> · {fmt(promedioMagia(e))}</span>
                                </div>
                                <CasillaTag
                                  casilla={cuadranteMagia(promedioMagia(e))}
                                  formato={normalizarFormato(e.formato)}
                                />
                                <div className="text-[10.5px] text-muted">
                                  {fechaCorta(e.fecha)}
                                  {e.confirmada_at ? " · confirmada" : " · sin confirmar"}
                                </div>
                              </>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-2 py-2">
                        {resumen && (
                          <>
                            <div className="font-mono font-bold">
                              {fmt(resumen.totalPromedio, 1)}/{MAGIA_PUNTOS_MAX}
                              <span className="text-muted font-normal"> · {fmt(resumen.promedio)}</span>
                            </div>
                            <CasillaTag casilla={resumen.cuadrante} formato={formatoMes} />
                          </>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        <BotonPdf
                          persona={persona}
                          anio={m.anio}
                          mes={m.mes}
                          evaluaciones={m.evals}
                          nombreDe={nombreDe}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
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
