"use client";

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { resizeImage } from "@/lib/imagenIA";
import { NOMBRES_MES, type ConfigHorarios } from "@/lib/horarios";
import {
  aplicarCambios,
  problemaConfig,
  propuestaDesdeLectura,
  type LecturaReglas,
  type PropuestaReglas,
} from "@/lib/horarios-reglas-ia";
import { describirRepeticion, isoDe } from "@/lib/recurrentes";

// Mismos topes que la Edge Function, para avisar antes de subir.
const MAX_ARCHIVOS = 4;
const MAX_PDF_BYTES = 8 * 1024 * 1024;

type Paso = "elegir" | "leyendo" | "revisar";

export type FestivoRow = { id: string; fecha: string; nombre: string };

function leerBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error(`No se pudo leer ${file.name}.`));
    r.readAsDataURL(file);
  });
}

async function mensajeDeError(error: unknown, data: unknown): Promise<string> {
  const d = data as { error?: string } | null;
  if (d?.error) return d.error;
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const cuerpo = (await ctx.clone().json()) as { error?: string };
      if (cuerpo?.error) return cuerpo.error;
    } catch {
      /* la respuesta no era JSON */
    }
  }
  return error instanceof Error ? error.message : "No se pudo leer el archivo.";
}

function fechaLarga(iso: string): string {
  const t = new Date(iso + "T12:00:00").toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const etiqueta = "block text-[10.5px] text-muted uppercase tracking-wider mb-1.5";
const caja = "border border-line rounded-lg bg-white px-3 py-2.5";

/**
 * Lee con IA el correo de la DSM con las reglas de horarios (imagen, PDF o
 * texto pegado) y propone: cambios a los parámetros del generador, festivos,
 * tareas de entrega que se repiten y las demás reglas como notas. Nada se
 * guarda hasta que jefatura lo revisa y lo aplica.
 */
export function LeerReglasModal({
  persona,
  config,
  notas,
  festivos,
  anio,
  mes,
  onClose,
  onApplied,
}: {
  persona: { id: string };
  config: ConfigHorarios;
  notas: string;
  festivos: FestivoRow[];
  anio: number;
  mes: number;
  onClose: () => void;
  onApplied: (r: { config: ConfigHorarios; notas: string; resumen: string }) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [paso, setPaso] = useState<Paso>("elegir");
  const [archivos, setArchivos] = useState<File[]>([]);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [propuesta, setPropuesta] = useState<PropuestaReglas | null>(null);
  const [guardarNotas, setGuardarNotas] = useState(true);
  const [guardando, setGuardando] = useState(false);

  function elegir(e: React.ChangeEvent<HTMLInputElement>) {
    const nuevos = Array.from(e.target.files ?? []);
    e.target.value = "";
    setError(null);
    const todos = [...archivos, ...nuevos];
    if (todos.length > MAX_ARCHIVOS) {
      setError(`Máximo ${MAX_ARCHIVOS} archivos por lectura. Se tomaron los primeros ${MAX_ARCHIVOS}.`);
    }
    setArchivos(todos.slice(0, MAX_ARCHIVOS));
  }

  async function leer() {
    setError(null);
    if (archivos.length === 0 && !texto.trim()) {
      setError("Sube el correo como imagen o PDF, o pega el texto.");
      return;
    }
    setPaso("leyendo");
    try {
      const preparados: { base64: string; mime: string }[] = [];
      for (const f of archivos) {
        if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
          if (f.size > MAX_PDF_BYTES) {
            throw new Error(`${f.name} pesa más de 8 MB. Sube menos páginas o un PDF más liviano.`);
          }
          preparados.push({ base64: await leerBase64(f), mime: "application/pdf" });
        } else if (f.type.startsWith("image/")) {
          preparados.push(await resizeImage(f));
        } else {
          throw new Error(`${f.name}: formato no soportado. Usa imágenes (JPG, PNG) o PDF.`);
        }
      }
      const { data, error: fnError } = await supabase.functions.invoke("leer-reglas-horario", {
        body: { archivos: preparados, texto: texto.trim(), anio, mes },
      });
      if (fnError) throw new Error(await mensajeDeError(fnError, data));
      setPropuesta(
        propuestaDesdeLectura((data ?? {}) as LecturaReglas, {
          config,
          festivosRegistrados: festivos.map((f) => f.fecha),
        }),
      );
      setPaso("revisar");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPaso("elegir");
    }
  }

  function marcar(grupo: "cambios" | "festivos" | "tareas", i: number, incluir: boolean) {
    setPropuesta((p) =>
      p ? { ...p, [grupo]: p[grupo].map((x, idx) => (idx === i ? { ...x, incluir } : x)) } : p,
    );
  }

  const nCambios = propuesta?.cambios.filter((c) => c.incluir).length ?? 0;
  const nFestivos = propuesta?.festivos.filter((f) => f.incluir).length ?? 0;
  const nTareas = propuesta?.tareas.filter((t) => t.incluir).length ?? 0;
  const conNotas = guardarNotas && (propuesta?.otrasReglas.length ?? 0) > 0;
  const hayAlgo = nCambios + nFestivos + nTareas > 0 || conNotas;

  async function aplicar() {
    if (!propuesta) return;
    setError(null);
    const nueva = aplicarCambios(config, propuesta.cambios);
    const problema = problemaConfig(nueva);
    if (problema) {
      setError(problema);
      return;
    }
    const nuevasNotas = conNotas ? propuesta.otrasReglas.join("\n") : notas;
    setGuardando(true);
    try {
      if (nCambios > 0 || conNotas) {
        const { error: e } = await supabase.from("horarios_config").upsert({
          id: true,
          pt_dias_semana: nueva.ptDiasSemana,
          ft_dias_turno_largo: nueva.ftDiasTurnoLargo,
          ft_descansos_semana: nueva.ftDescansosSemana,
          ft_domingos_descanso: nueva.ftDomingosDescanso,
          ft_cortos_lun_jue: nueva.ftCortosLunJue,
          jefe_cierre_quincena: nueva.jefeCierreQuincena,
          notas: nuevasNotas,
        });
        if (e) throw new Error("No se guardaron los parámetros: " + e.message);
      }
      if (nFestivos > 0) {
        const { error: e } = await supabase.from("festivos").upsert(
          propuesta.festivos
            .filter((f) => f.incluir)
            .map((f) => ({ fecha: f.fecha, nombre: f.nombre, creado_por: persona.id })),
          { onConflict: "tienda_id,fecha" },
        );
        if (e) throw new Error("No se guardaron los festivos: " + e.message);
      }
      if (nTareas > 0) {
        const { error: e } = await supabase.from("tareas_recurrentes").insert(
          propuesta.tareas
            .filter((t) => t.incluir)
            .map((t) => ({
              titulo: t.titulo,
              area: "rrhh",
              turno: "Mañana",
              descripcion: t.descripcion,
              responsable_id: persona.id,
              frecuencia: t.frecuencia,
              dias_semana: t.dias_semana,
              dia_mes: t.dia_mes,
              fecha_inicio: isoDe(new Date()),
              created_by: persona.id,
            })),
        );
        if (e) throw new Error("No se crearon las tareas recurrentes: " + e.message);
        await supabase.rpc("generar_pendientes_recurrentes");
      }
      const partes = [
        nCambios > 0 ? `${nCambios} parámetro${nCambios > 1 ? "s" : ""}` : "",
        nFestivos > 0 ? `${nFestivos} festivo${nFestivos > 1 ? "s" : ""}` : "",
        nTareas > 0 ? `${nTareas} tarea${nTareas > 1 ? "s" : ""} recurrente${nTareas > 1 ? "s" : ""}` : "",
        conNotas ? "notas de reglas" : "",
      ].filter(Boolean);
      onApplied({ config: nueva, notas: nuevasNotas, resumen: partes.join(", ") });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="bg-panel rounded-[10px] p-6 w-full max-w-3xl relative shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 text-muted hover:text-ink text-lg leading-none"
          aria-label="Cerrar"
        >
          ✕
        </button>
        <h3 className="font-display font-semibold text-base mb-1 pr-8">Leer correo de reglas de horarios</h3>

        {paso !== "revisar" && (
          <>
            <p className="text-muted text-[12.5px] mb-4">
              Sube el correo de la DSM con las reglas del mes (captura, foto o PDF) o pega el texto.
              La IA lo compara con las reglas del generador para{" "}
              <strong>
                {NOMBRES_MES[mes - 1]} {anio}
              </strong>{" "}
              y te propone qué ajustar. Nada cambia hasta que lo revises.
            </p>

            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              multiple
              hidden
              onChange={elegir}
            />
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={paso === "leyendo" || archivos.length >= MAX_ARCHIVOS}
              className="w-full border-2 border-dashed border-line rounded-lg py-5 text-sm text-muted hover:bg-paper disabled:opacity-50 transition-colors"
            >
              {archivos.length === 0 ? "Elegir imágenes o PDF" : "Agregar otro archivo"}
              <span className="block text-[11.5px] mt-1">
                Hasta {MAX_ARCHIVOS} archivos · JPG, PNG o PDF de máximo 8 MB
              </span>
            </button>

            {archivos.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {archivos.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="flex items-center gap-2 border border-line rounded-md bg-white px-3 py-1.5 text-[13px]"
                  >
                    <span className="flex-1 truncate">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => setArchivos((l) => l.filter((_, idx) => idx !== i))}
                      disabled={paso === "leyendo"}
                      className="text-muted hover:text-warn text-xs px-1 disabled:opacity-50"
                      aria-label={`Quitar ${f.name}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <label className={etiqueta + " mt-4"}>O pega aquí el texto del correo</label>
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={4}
              disabled={paso === "leyendo"}
              placeholder="Texto del correo…"
              className="w-full px-2.5 py-2 border border-line rounded-md bg-white text-[13px] resize-y"
            />

            {error && (
              <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={leer}
              disabled={paso === "leyendo" || (archivos.length === 0 && !texto.trim())}
              className="mt-4 w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light transition-colors"
            >
              {paso === "leyendo" ? "Leyendo el correo…" : "Leer con IA"}
            </button>
          </>
        )}

        {paso === "revisar" && propuesta && (
          <>
            <div className="bg-brand/5 border border-brand/20 rounded-md px-3 py-2.5 mt-2 mb-4">
              <div className={etiqueta}>De qué trata el correo</div>
              <p className="text-[13px] whitespace-pre-wrap">
                {propuesta.resumen || "La IA no entregó un resumen del documento."}
              </p>
            </div>

            {propuesta.truncado && (
              <div className="mb-3 bg-amber-50 text-[#8A5A16] border border-amber-300 rounded-md px-3 py-2 text-xs">
                El documento es largo y la lectura quedó incompleta. Revísalo contra el correo o súbelo
                por partes.
              </div>
            )}

            <div className="space-y-4">
              <section>
                <div className={etiqueta}>Parámetros del generador</div>
                {propuesta.cambios.length === 0 ? (
                  <p className="text-muted text-[12.5px]">
                    El correo no pide cambiar ningún parámetro del generador.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {propuesta.cambios.map((c, i) => (
                      <label key={c.clave} className={caja + " flex items-start gap-2.5 cursor-pointer"}>
                        <input
                          type="checkbox"
                          checked={c.incluir}
                          onChange={(e) => marcar("cambios", i, e.target.checked)}
                          className="mt-1"
                        />
                        <span className="text-[13px]">
                          <span className="font-semibold">{c.etiqueta}</span>
                          <span className="block text-[12.5px] text-muted">
                            Hoy: {c.actual} → Correo: <strong className="text-ink">{c.propuesto}</strong>
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                {propuesta.yaCoinciden.length > 0 && (
                  <p className="text-muted text-[12px] mt-2">
                    Ya coincide con el correo: {propuesta.yaCoinciden.join(" · ")}.
                  </p>
                )}
              </section>

              {(propuesta.festivos.length > 0 || propuesta.festivosYaRegistrados.length > 0) && (
                <section>
                  <div className={etiqueta}>Festivos</div>
                  <div className="space-y-2">
                    {propuesta.festivos.map((f, i) => (
                      <label key={f.fecha} className={caja + " flex items-center gap-2.5 cursor-pointer"}>
                        <input
                          type="checkbox"
                          checked={f.incluir}
                          onChange={(e) => marcar("festivos", i, e.target.checked)}
                        />
                        <span className="text-[13px]">
                          <span className="font-semibold">{fechaLarga(f.fecha)}</span>
                          <span className="text-muted"> · {f.nombre}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {propuesta.festivosYaRegistrados.length > 0 && (
                    <p className="text-muted text-[12px] mt-2">
                      Ya registrado: {propuesta.festivosYaRegistrados.map(fechaLarga).join(" · ")}.
                    </p>
                  )}
                  <p className="text-muted text-[11.5px] mt-1.5">
                    Un festivo no da descanso a nadie: sirve para no pegarle un descanso al día libre
                    anterior y para verlo marcado en la cuadrícula.
                  </p>
                </section>
              )}

              {propuesta.tareas.length > 0 && (
                <section>
                  <div className={etiqueta}>Entregas que se repiten → tareas recurrentes de la Bitácora</div>
                  <div className="space-y-2">
                    {propuesta.tareas.map((t, i) => (
                      <label key={i} className={caja + " flex items-start gap-2.5 cursor-pointer"}>
                        <input
                          type="checkbox"
                          checked={t.incluir}
                          onChange={(e) => marcar("tareas", i, e.target.checked)}
                          className="mt-1"
                        />
                        <span className="text-[13px]">
                          <span className="font-semibold">{t.titulo}</span>
                          <span className="text-muted">
                            {" "}
                            · {describirRepeticion({ frecuencia: t.frecuencia, dias_semana: t.dias_semana, dia_mes: t.dia_mes, hora: null })}
                          </span>
                          {t.descripcion && (
                            <span className="block text-[12.5px] text-muted">{t.descripcion}</span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="text-muted text-[11.5px] mt-1.5">
                    Quedan a tu nombre en el área de Recursos Humanos; puedes ajustarlas después en
                    Bitácora → Tareas recurrentes.
                  </p>
                </section>
              )}

              {propuesta.otrasReglas.length > 0 && (
                <section>
                  <div className={etiqueta}>Otras reglas del correo (el generador no las aplica solo)</div>
                  <ul className={caja + " text-[13px] list-disc pl-7 space-y-1"}>
                    {propuesta.otrasReglas.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                  <label className="flex items-center gap-2 text-[12.5px] mt-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={guardarNotas}
                      onChange={(e) => setGuardarNotas(e.target.checked)}
                    />
                    Dejarlas a la vista en «Reglas del generador»
                    {notas.trim() ? " (reemplaza las notas actuales)" : ""}
                  </label>
                </section>
              )}
            </div>

            {error && (
              <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">
                {error}
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setPaso("elegir");
                }}
                disabled={guardando}
                className="px-3 py-2.5 border border-line rounded-md bg-white text-sm hover:bg-paper disabled:opacity-50"
              >
                ← Leer otro correo
              </button>
              <button
                type="button"
                onClick={aplicar}
                disabled={guardando || !hayAlgo}
                className="flex-1 py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light transition-colors"
              >
                {guardando ? "Aplicando…" : hayAlgo ? "Aplicar lo marcado" : "No hay nada que aplicar"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
