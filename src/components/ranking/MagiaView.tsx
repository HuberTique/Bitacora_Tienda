"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { NOMBRES_MES } from "@/lib/horarios";
import { useTienda } from "@/lib/tienda-config";
import { MAGIA_PUNTOS_MAX, totalMagia, type MagiaEvaluacion, type PersonaRk } from "@/lib/ranking";
import {
  COLOR_CUADRANTE,
  MAGIA_DIA_LIMITE,
  MAGIA_ITEMS,
  criteriosMagia,
  cuadranteMagia,
  escalaMagia,
  labelFormato,
  mesCuentaParaMagia,
  mesEvaluableMagia,
  normalizarFormato,
  promedioMagia,
  redondear1,
  resumenMesMagia,
  type ClaveCriterio,
  type FormatoTienda,
  type NivelMagia,
  type VentanaMagia,
} from "@/lib/magia";
import { generarMagiaPdf, inicioBimestre } from "@/lib/magia-pdf";
import { CuadriculaMagia, type PuntoCuadricula } from "./CuadriculaMagia";
import { Modal, inputCls } from "./ui";

type Clave = ClaveCriterio | "impresion_final";

// Los promedios se muestran siempre con un decimal.
const fmt = (n: number) => redondear1(n).toFixed(1).replace(".", ",");

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a}` : iso;
}

const nombreMes = (mes: number) => NOMBRES_MES[mes - 1] ?? "";

/** Hay una evaluación por persona y mes; si quedara más de una, vale la primera. */
function evaluacionDe(evals: MagiaEvaluacion[], personaId: string): MagiaEvaluacion | null {
  return (
    evals
      .filter((e) => e.persona_id === personaId)
      .sort((a, b) => a.numero - b.numero)[0] ?? null
  );
}

/** Quiénes faltan por evaluar en un mes, dado quiénes ya tienen evaluación. */
export function pendientesMagia(personas: PersonaRk[], evaluadas: Iterable<string>): PersonaRk[] {
  const ya = new Set(evaluadas);
  return personas.filter((p) => !ya.has(p.id));
}

/**
 * Aviso del plazo, armado por la página: cómo va el mes en curso, quiénes
 * faltan en él y qué meses anteriores quedaron con evaluaciones atrasadas.
 */
export type AvisoMagia = {
  ventana: VentanaMagia;
  pendientes: PersonaRk[]; // del mes en curso
  atrasados: { anio: number; mes: number; pendientes: PersonaRk[] }[];
};

/** Cuántas evaluaciones faltan en total (mes en curso + meses atrasados). */
export function totalPendientesMagia(aviso: AvisoMagia | null): number {
  if (!aviso || aviso.ventana.estado === "sin_aviso") return 0;
  return aviso.pendientes.length + aviso.atrasados.reduce((a, m) => a + m.pendientes.length, 0);
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

/**
 * Recordatorio del plazo. La evaluación de cada mes se hace del 1 al 5 de ese
 * mes. Muestra, sin importar qué mes se esté mirando: cuánto queda (o cuánto
 * lleva vencido) el mes en curso y los meses anteriores que quedaron sin
 * evaluar, cada uno con quiénes faltan y un enlace para ir a ese mes.
 */
function AvisoPlazo({
  aviso,
  anio,
  mes,
  onIrAMes,
}: {
  aviso: AvisoMagia;
  anio: number;
  mes: number;
  onIrAMes: (anio: number, mes: number) => void;
}) {
  const { ventana, pendientes, atrasados } = aviso;
  if (ventana.estado === "sin_aviso") return null;

  const nombres = (lista: PersonaRk[]) =>
    lista.map((p) => p.nombre.split(/\s+/).slice(0, 2).join(" ")).join(", ");
  const irA = (a: number, m: number) =>
    (a !== anio || m !== mes) && (
      <button type="button" onClick={() => onIrAMes(a, m)} className="ml-2 underline font-semibold">
        Ir a {nombreMes(m)} {a}
      </button>
    );

  const conAtraso = atrasados.filter((m) => m.pendientes.length > 0);
  const periodo = `${nombreMes(ventana.mes)} ${ventana.anio}`;

  if (pendientes.length === 0 && conAtraso.length === 0) {
    return (
      <div className="bg-operaciones/10 text-operaciones border border-operaciones/30 rounded-md px-3 py-2 text-[12.5px]">
        ✓ Las evaluaciones Magia están al día: todo el equipo tiene la de {periodo}.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {pendientes.length > 0 &&
        (ventana.estado === "abierta" ? (
          <div className="bg-amber-50 text-[#8A5A16] border border-amber-300 rounded-md px-3 py-2 text-[12.5px]">
            <strong>
              {ventana.diasRestantes === 1 ? "Hoy es el último día" : `Quedan ${ventana.diasRestantes} días`}{" "}
              para la evaluación Magia de {periodo}
            </strong>{" "}
            (se hace del 1 al {MAGIA_DIA_LIMITE} de cada mes). Faltan {pendientes.length} por
            evaluar: {nombres(pendientes)}.{irA(ventana.anio, ventana.mes)}
          </div>
        ) : (
          <div className="bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-[12.5px]">
            <strong>
              El plazo de la evaluación Magia de {periodo} venció el día {MAGIA_DIA_LIMITE} (hace{" "}
              {ventana.diasDeAtraso} {ventana.diasDeAtraso === 1 ? "día" : "días"}).
            </strong>{" "}
            Faltan {pendientes.length} por evaluar: {nombres(pendientes)}.
            {irA(ventana.anio, ventana.mes)}
          </div>
        ))}
      {conAtraso.map((m) => (
        <div
          key={`${m.anio}-${m.mes}`}
          className="bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-[12.5px]"
        >
          <strong>
            Evaluación Magia de {nombreMes(m.mes)} {m.anio} atrasada.
          </strong>{" "}
          Faltan {m.pendientes.length} por evaluar: {nombres(m.pendientes)}.{irA(m.anio, m.mes)}
        </div>
      ))}
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
  aviso,
  onIrAMes,
  onGuardado,
}: {
  personas: PersonaRk[]; // quienes se evalúan (los que compiten)
  roster: PersonaRk[]; // todo el equipo, para mostrar el nombre de quien evaluó
  evals: MagiaEvaluacion[]; // evaluaciones del mes que se está mirando
  anio: number;
  mes: number;
  esJefatura: boolean;
  evaluadorId: string;
  miId: string;
  aviso: AvisoMagia | null; // solo para jefatura
  onIrAMes: (anio: number, mes: number) => void;
  onGuardado: () => void;
}) {
  const tienda = useTienda();
  const [abierta, setAbierta] = useState<PersonaRk | null>(null);
  const [verResultado, setVerResultado] = useState<PersonaRk | null>(null);
  const [verHistorico, setVerHistorico] = useState<PersonaRk | null>(null);

  const cuenta = mesCuentaParaMagia(anio, mes);
  const evaluable = mesEvaluableMagia(new Date(), anio, mes);

  // Jefatura ve a todo el equipo; un asesor solo su propia fila (RLS ya filtra
  // los datos), aunque todavía no tenga evaluación, para poder abrir su histórico.
  const filas = esJefatura ? personas : personas.filter((p) => p.id === miId);
  const resultadoAbierto = verResultado ? evaluacionDe(evals, verResultado.id) : null;

  return (
    <div className="space-y-3">
      {/* Especificaciones de la evaluación: plegadas para que la tabla quede arriba. */}
      <details className="max-w-2xl group">
        <summary className="cursor-pointer text-[12.5px] text-brand font-semibold select-none">
          Cómo funciona la evaluación
        </summary>
        <p className="text-[12.5px] text-muted mt-1.5">
          Evaluación <strong>Magia con una sonrisa</strong>, formato{" "}
          <strong>{labelFormato(tienda.formato)}</strong>: una evaluación por persona al mes (escala 1
          a 4 en cinco criterios M-A-G-I-A más la impresión final, máximo {MAGIA_PUNTOS_MAX} puntos).
          Se hace del 1 al {MAGIA_DIA_LIMITE} de cada mes. Su promedio, con un decimal, define el lugar
          en la cuadrícula Gestión / Resultados y es lo que entra al ranking.
        </p>
      </details>
      {esJefatura && aviso && <AvisoPlazo aviso={aviso} anio={anio} mes={mes} onIrAMes={onIrAMes} />}
      {!evaluable && (
        <div className="bg-paper border border-line rounded-md px-3 py-2 text-[12.5px] text-muted">
          {cuenta
            ? "Este mes todavía no ha empezado: su evaluación se podrá registrar desde el día 1."
            : "Las evaluaciones Magia se empiezan a contar desde septiembre de 2026."}
        </div>
      )}
      {filas.length === 0 ? (
        <div className="bg-panel border border-line rounded-[10px] p-8 text-center text-muted text-sm">
          {esJefatura ? "No hay personas para evaluar." : "No estás en la lista de personas que se evalúan."}
        </div>
      ) : (
        <div className="bg-panel border border-line rounded-[10px] overflow-x-auto">
          <table className="w-full text-[13px] min-w-[680px]">
            <thead>
              <tr className="text-left text-muted uppercase tracking-wider text-[10.5px] border-b border-line">
                <th className="px-3 py-2">Nombre</th>
                <th className="px-2 py-2 text-center">Puntaje</th>
                <th className="px-2 py-2 text-center">Promedio</th>
                <th className="px-2 py-2">Casilla</th>
                <th className="px-2 py-2">Estado</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {filas.map((p) => {
                const e = evaluacionDe(evals, p.id);
                const promedio = e ? promedioMagia(e) : null;
                return (
                  <tr key={p.id} className="border-b border-line/60 last:border-0">
                    <td className="px-3 py-2">{p.nombre}</td>
                    <td className="px-2 py-2 text-center">
                      {e ? (
                        <span className="font-mono font-semibold">
                          {totalMagia(e)}/{MAGIA_PUNTOS_MAX}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center font-mono font-bold">
                      {promedio != null ? fmt(promedio) : "—"}
                    </td>
                    <td className="px-2 py-2">
                      {e && promedio != null ? (
                        <CasillaTag casilla={cuadranteMagia(promedio)} formato={normalizarFormato(e.formato)} />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-[12px]">
                      {!e ? (
                        <span className="text-muted">Sin evaluar</span>
                      ) : e.confirmada_at ? (
                        <span className="text-operaciones">Confirmada</span>
                      ) : (
                        <span className="text-[#8A5A16]">Por confirmar</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      {esJefatura && !e && evaluable && (
                        <button
                          type="button"
                          onClick={() => setAbierta(p)}
                          className="text-xs font-semibold text-brand hover:underline mr-3"
                        >
                          Evaluar
                        </button>
                      )}
                      {e && (
                        <button
                          type="button"
                          onClick={() => setVerResultado(p)}
                          className="text-xs text-brand hover:underline mr-3"
                        >
                          Ver resultado
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setVerHistorico(p)}
                        className="text-xs text-brand hover:underline mr-3"
                      >
                        Histórico
                      </button>
                      {esJefatura && e && (
                        <button
                          type="button"
                          onClick={() => setAbierta(p)}
                          className="text-xs text-muted hover:underline"
                        >
                          Editar
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
          persona={abierta}
          existente={evaluacionDe(evals, abierta.id)}
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
      {verResultado && resultadoAbierto && (
        <Resultado
          persona={verResultado}
          e={resultadoAbierto}
          puedeConfirmar={verResultado.id === miId}
          onClose={() => setVerResultado(null)}
          onConfirmada={onGuardado}
        />
      )}
      {verHistorico && (
        <Historico persona={verHistorico} onClose={() => setVerHistorico(null)} />
      )}
    </div>
  );
}

function FormularioMagia({
  persona,
  existente,
  anio,
  mes,
  evaluadorId,
  onClose,
  onGuardado,
}: {
  persona: PersonaRk;
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
        numero: existente?.numero ?? 1, // una sola evaluación por mes
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
      titulo={`Evaluación del vendedor — Magia con una sonrisa · ${nombreMes(mes)} ${anio} · ${labelFormato(formato)}`}
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

/** Evaluaciones de una persona, de la más reciente a la más antigua. */
async function cargarHistorico(personaId: string): Promise<MagiaEvaluacion[]> {
  const { data, error } = await supabase
    .from("magia_evaluaciones")
    .select("*")
    .eq("persona_id", personaId)
    .order("anio", { ascending: false })
    .order("mes", { ascending: false })
    .order("numero", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as MagiaEvaluacion[] | null) ?? [];
}

/**
 * Botón que descarga el PDF del BIMESTRE de una evaluación (enero-febrero,
 * marzo-abril, …) sobre el formato oficial: las hojas de cada evaluación del
 * bimestre y la plantilla de resultados con el promedio de las dos.
 */
function BotonPdf({
  persona,
  e,
  historico,
}: {
  persona: PersonaRk;
  e: MagiaEvaluacion;
  /** Si ya se tiene cargado el histórico, se reutiliza; si no, se consulta. */
  historico?: MagiaEvaluacion[];
}) {
  const tienda = useTienda();
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function descargar() {
    setError(null);
    setGenerando(true);
    try {
      const todas = historico ?? (await cargarHistorico(persona.id));
      const mesInicio = inicioBimestre(e.mes);
      const delMes = (mes: number) => evaluacionDe(todas.filter((x) => x.anio === e.anio && x.mes === mes), persona.id);
      await generarMagiaPdf({
        evaluado: persona.nombre,
        tienda: tienda.numero ? `${tienda.numero} · ${tienda.nombre}` : tienda.nombre,
        anio: e.anio,
        mesInicio,
        evaluacion1: delMes(mesInicio) ?? (e.mes === mesInicio ? e : null),
        evaluacion2: delMes(mesInicio + 1) ?? (e.mes === mesInicio + 1 ? e : null),
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
        disabled={generando}
        className="text-xs px-2.5 py-1.5 border border-brand text-brand rounded-md bg-white hover:bg-brand/5 disabled:opacity-50"
      >
        {generando ? "Generando…" : "Descargar PDF"}
      </button>
      {error && <span className="text-xs text-warn ml-2">{error}</span>}
    </>
  );
}

function Resultado({
  persona,
  e,
  puedeConfirmar,
  onClose,
  onConfirmada,
}: {
  persona: PersonaRk;
  e: MagiaEvaluacion;
  puedeConfirmar: boolean;
  onClose: () => void;
  onConfirmada: () => void;
}) {
  const formato = normalizarFormato(e.formato);
  const promedio = promedioMagia(e);
  const casilla = cuadranteMagia(promedio);
  const punto: PuntoCuadricula = {
    casilla,
    promedio,
    etiqueta: fmt(promedio),
    detalle: `${nombreMes(e.mes)} ${e.anio} · promedio ${fmt(promedio)}`,
  };

  return (
    <Modal titulo={`Plantilla de resultados — ${persona.nombre}`} onClose={onClose} ancho="max-w-3xl">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="text-[12.5px] text-muted capitalize">
          {nombreMes(e.mes)} {e.anio}
        </div>
        <BotonPdf persona={persona} e={e} />
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4 text-center">
        <div className="border border-line rounded-md py-3 bg-white">
          <div className="text-[11px] text-muted uppercase tracking-wider">Puntaje</div>
          <div className="font-display font-bold text-xl">
            {totalMagia(e)}/{MAGIA_PUNTOS_MAX}
          </div>
        </div>
        <div className="border border-line rounded-md py-3 bg-white">
          <div className="text-[11px] text-muted uppercase tracking-wider">Promedio</div>
          <div className="font-display font-bold text-xl">{fmt(promedio)}</div>
        </div>
        <div className="border border-line rounded-md py-3 bg-white">
          <div className="text-[11px] text-muted uppercase tracking-wider">Casilla</div>
          <div className="mt-1.5">
            <CasillaTag casilla={casilla} formato={formato} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,300px)_1fr] gap-4 items-start">
        <div>
          <div className="text-[11px] text-muted uppercase tracking-wider mb-1.5">
            Planilla Gestión / Resultados
          </div>
          <CuadriculaMagia puntos={[punto]} />
        </div>
        <DetalleEvaluacion e={e} puedeConfirmar={puedeConfirmar} onConfirmada={onConfirmada} />
      </div>
    </Modal>
  );
}

/** Una evaluación completa: puntajes por letra, textos y confirmación. */
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
  return (
    <div className="border border-line rounded-md p-3 bg-white">
      <div className="text-sm font-semibold mb-2">
        Evaluación del {fechaCorta(e.fecha)} · formato {labelFormato(formato)}
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

/** Histórico de un asesor: su evaluación Magia de cada mes. */
function Historico({
  persona,
  onClose,
}: {
  persona: PersonaRk;
  onClose: () => void;
}) {
  const [todas, setTodas] = useState<MagiaEvaluacion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    cargarHistorico(persona.id)
      .then((lista) => {
        if (vivo) setTodas(lista);
      })
      .catch((err: unknown) => {
        if (vivo) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      vivo = false;
    };
  }, [persona.id]);

  const puntos: PuntoCuadricula[] = (todas ?? []).map((e) => ({
    casilla: cuadranteMagia(promedioMagia(e)),
    promedio: promedioMagia(e),
    etiqueta: `${nombreMes(e.mes).slice(0, 3)} ${String(e.anio).slice(2)}`,
    detalle: `${nombreMes(e.mes)} ${e.anio} · promedio ${fmt(promedioMagia(e))}`,
  }));

  const general = todas && todas.length > 0 ? resumenMesMagia(todas) : null;
  // Tendencia: la última evaluación frente a la anterior.
  const cambio =
    todas && todas.length >= 2
      ? redondear1(redondear1(promedioMagia(todas[0])) - redondear1(promedioMagia(todas[1])))
      : null;

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
                Planilla Gestión / Resultados — todos los meses
              </div>
              <CuadriculaMagia puntos={puntos} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                ["Meses evaluados", String(todas.length)],
                ["Promedio histórico", fmt(general.promedio)],
                ["Último promedio", fmt(promedioMagia(todas[0]))],
                [
                  "Tendencia",
                  cambio == null
                    ? "—"
                    : cambio > 0
                      ? `▲ +${fmt(cambio)}`
                      : cambio < 0
                        ? `▼ ${fmt(cambio)}`
                        : "= igual",
                ],
              ].map(([t, v]) => (
                <div key={t} className="border border-line rounded-md px-3 py-2.5 bg-white">
                  <div className="text-[10.5px] text-muted uppercase tracking-wider">{t}</div>
                  <div className="font-display font-bold text-lg">{v}</div>
                </div>
              ))}
              <div className="col-span-2 text-[11.5px] text-muted">
                Cada punto es la evaluación de un mes. Su promedio (suma de puntajes entre los{" "}
                {MAGIA_ITEMS} ítems, con un decimal) define la casilla y qué tan arriba y a la
                derecha queda dentro de ella. La tendencia compara el último mes con el anterior.
              </div>
            </div>
          </div>

          <div className="border border-line rounded-md overflow-x-auto bg-white">
            <table className="w-full text-[13px] min-w-[600px]">
              <thead>
                <tr className="text-left text-muted uppercase tracking-wider text-[10.5px] border-b border-line">
                  <th className="px-3 py-2">Mes</th>
                  <th className="px-2 py-2 text-center">Puntaje</th>
                  <th className="px-2 py-2 text-center">Promedio</th>
                  <th className="px-2 py-2">Casilla</th>
                  <th className="px-2 py-2">Fecha</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {todas.map((e) => {
                  const formato = normalizarFormato(e.formato);
                  const promedio = promedioMagia(e);
                  return (
                    <tr key={e.id} className="border-b border-line/60 last:border-0">
                      <td className="px-3 py-2 capitalize whitespace-nowrap">
                        {nombreMes(e.mes)} {e.anio}
                        <div className="text-[10.5px] text-muted normal-case">
                          Formato {labelFormato(formato)}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-center font-mono">
                        {totalMagia(e)}/{MAGIA_PUNTOS_MAX}
                      </td>
                      <td className="px-2 py-2 text-center font-mono font-bold">{fmt(promedio)}</td>
                      <td className="px-2 py-2">
                        <CasillaTag casilla={cuadranteMagia(promedio)} formato={formato} />
                      </td>
                      <td className="px-2 py-2 text-[12px]">
                        {fechaCorta(e.fecha)}
                        <div className="text-[10.5px] text-muted">
                          {e.confirmada_at ? "Confirmada" : "Por confirmar"}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        <BotonPdf persona={persona} e={e} historico={todas} />
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
