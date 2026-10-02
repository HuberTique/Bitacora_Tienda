"use client";

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { resizeImage } from "@/lib/imagenIA";
import {
  borradoresDesdeLectura,
  filaPendiente,
  problemaBorrador,
  turnoPorHora,
  type BorradorPendiente,
  type LecturaIA,
} from "@/lib/pendientes-ia";
import { AREAS, TURNOS, type AreaId, type RosterPublico, type Turno } from "@/lib/types";

// Mismos topes que la Edge Function, para avisar antes de subir.
const MAX_ARCHIVOS = 4;
const MAX_PDF_BYTES = 8 * 1024 * 1024;

type Paso = "elegir" | "leyendo" | "revisar";

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

const campo = "w-full px-2.5 py-1.5 border border-line rounded-md bg-white text-[13px]";
const etiqueta = "block text-[10.5px] text-muted uppercase tracking-wider mb-1";

/**
 * Lee imágenes o un PDF (un correo, un acta, una lista, un comunicado) con IA,
 * muestra de qué trata el documento y propone los pendientes que salen de él.
 * Nada se guarda hasta que jefatura revisa la propuesta y la registra.
 */
export function LeerArchivoModal({
  persona,
  roster,
  onClose,
  onSaved,
}: {
  persona: { id: string };
  roster: RosterPublico[];
  onClose: () => void;
  onSaved: (cuantos: number) => void;
}) {
  const jefaturas = roster.filter((p) => p.rol === "jefatura");
  const asesores = roster.filter((p) => p.rol === "asesor");
  const input = useRef<HTMLInputElement>(null);

  const [paso, setPaso] = useState<Paso>("elegir");
  const [archivos, setArchivos] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [contexto, setContexto] = useState("");
  const [borradores, setBorradores] = useState<BorradorPendiente[]>([]);
  const [truncado, setTruncado] = useState(false);
  const [conContexto, setConContexto] = useState(false);
  const [guardando, setGuardando] = useState(false);

  function elegir(e: React.ChangeEvent<HTMLInputElement>) {
    const nuevos = Array.from(e.target.files ?? []);
    e.target.value = ""; // permite volver a elegir el mismo archivo
    setError(null);
    const todos = [...archivos, ...nuevos];
    if (todos.length > MAX_ARCHIVOS) {
      setError(`Máximo ${MAX_ARCHIVOS} archivos por lectura. Se tomaron los primeros ${MAX_ARCHIVOS}.`);
    }
    setArchivos(todos.slice(0, MAX_ARCHIVOS));
  }

  async function leer() {
    setError(null);
    if (archivos.length === 0) {
      setError("Elige al menos una imagen o un PDF.");
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
          // Las fotos del celular pesan varios MB: se reducen antes de enviarlas.
          preparados.push(await resizeImage(f));
        } else {
          throw new Error(`${f.name}: formato no soportado. Usa imágenes (JPG, PNG) o PDF.`);
        }
      }

      const { data, error: fnError } = await supabase.functions.invoke("leer-pendientes-archivo", {
        body: { archivos: preparados },
      });
      if (fnError) throw new Error(await mensajeDeError(fnError, data));

      const r = borradoresDesdeLectura((data ?? {}) as LecturaIA, {
        roster,
        responsablePorDefecto: jefaturas.some((j) => j.id === persona.id) ? persona.id : (jefaturas[0]?.id ?? ""),
        turnoPorDefecto: turnoPorHora(new Date().getHours()),
      });
      setContexto(r.contexto);
      setBorradores(r.borradores);
      setTruncado(r.truncado);
      setPaso("revisar");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPaso("elegir");
    }
  }

  function cambiar(i: number, cambio: Partial<BorradorPendiente>) {
    setBorradores((lista) => lista.map((b, idx) => (idx === i ? { ...b, ...cambio } : b)));
  }

  const marcados = borradores.filter((b) => b.incluir);

  async function guardar() {
    setError(null);
    if (marcados.length === 0) {
      setError("Marca al menos un pendiente para registrar.");
      return;
    }
    const conProblema = marcados.find((b) => problemaBorrador(b));
    if (conProblema) {
      setError(`A "${conProblema.titulo || "un pendiente sin título"}" ${problemaBorrador(conProblema)}.`);
      return;
    }
    setGuardando(true);
    const origen = archivos.map((f) => f.name).join(", ");
    const filas = marcados.map((b) =>
      filaPendiente(b, { creadoPor: persona.id, origen, contexto: conContexto ? contexto : null }),
    );
    const { error: insErr } = await supabase.from("pendientes").insert(filas);
    setGuardando(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    onSaved(filas.length);
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
        <h3 className="font-display font-semibold text-base mb-1 pr-8">Leer imagen o PDF</h3>

        {paso !== "revisar" && (
          <>
            <p className="text-muted text-[12.5px] mb-4">
              Sube un correo, un acta, un comunicado, una captura o la foto de una lista. La IA te
              dice de qué trata y propone los pendientes que salen de ahí. Nada se registra hasta
              que lo revises.
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
              className="w-full border-2 border-dashed border-line rounded-lg py-6 text-sm text-muted hover:bg-paper disabled:opacity-50 transition-colors"
            >
              {archivos.length === 0
                ? "Elegir imágenes o PDF"
                : archivos.length >= MAX_ARCHIVOS
                  ? `Ya hay ${MAX_ARCHIVOS} archivos (el máximo)`
                  : "Agregar otro archivo"}
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
                    <span className="text-muted text-[11.5px] shrink-0">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
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

            {error && (
              <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={leer}
              disabled={paso === "leyendo" || archivos.length === 0}
              className="mt-4 w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light transition-colors"
            >
              {paso === "leyendo" ? "Leyendo el archivo…" : "Leer con IA"}
            </button>
          </>
        )}

        {paso === "revisar" && (
          <>
            <div className="bg-brand/5 border border-brand/20 rounded-md px-3 py-2.5 mt-2 mb-4">
              <div className={etiqueta}>Contexto del documento</div>
              <p className="text-[13px] whitespace-pre-wrap">
                {contexto || "La IA no entregó un resumen del documento."}
              </p>
              <div className="text-[11px] text-muted mt-1.5">
                Archivo{archivos.length > 1 ? "s" : ""}: {archivos.map((f) => f.name).join(", ")}
              </div>
            </div>

            {truncado && (
              <div className="mb-3 bg-amber-50 text-[#8A5A16] border border-amber-300 rounded-md px-3 py-2 text-xs">
                El documento es largo y la lectura quedó incompleta: puede faltar algún pendiente del
                final. Revísalo contra el archivo o súbelo por partes.
              </div>
            )}

            {borradores.length === 0 ? (
              <div className="bg-panel border border-line rounded-md p-6 text-center text-muted text-sm">
                No se encontraron tareas para registrar en este documento.
              </div>
            ) : (
              <>
                <p className="text-muted text-[12.5px] mb-2">
                  {borradores.length === 1
                    ? "Se propone 1 pendiente."
                    : `Se proponen ${borradores.length} pendientes.`}{" "}
                  Ajusta lo que haga falta y desmarca los que no quieras registrar.
                </p>
                <div className="space-y-3">
                  {borradores.map((b, i) => (
                    <div
                      key={i}
                      className={
                        "border rounded-lg p-3 bg-white transition-opacity " +
                        (b.incluir ? "border-line" : "border-line/60 opacity-55")
                      }
                    >
                      <div className="flex items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={b.incluir}
                          onChange={(e) => cambiar(i, { incluir: e.target.checked })}
                          className="mt-2"
                          aria-label={`Registrar el pendiente ${i + 1}`}
                        />
                        <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                          <div className="col-span-2 sm:col-span-4">
                            <label className={etiqueta}>Título</label>
                            <input
                              value={b.titulo}
                              onChange={(e) => cambiar(i, { titulo: e.target.value })}
                              className={campo + " font-semibold"}
                            />
                          </div>
                          <div>
                            <label className={etiqueta}>Área</label>
                            <select
                              value={b.area}
                              onChange={(e) => cambiar(i, { area: e.target.value as AreaId })}
                              className={campo}
                            >
                              {AREAS.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className={etiqueta}>Turno</label>
                            <select
                              value={b.turno}
                              onChange={(e) => cambiar(i, { turno: e.target.value as Turno })}
                              className={campo}
                            >
                              {TURNOS.map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="col-span-2">
                            <label className={etiqueta}>Fecha de ejecución</label>
                            <input
                              type="date"
                              value={b.fechaEjecucion}
                              onChange={(e) => cambiar(i, { fechaEjecucion: e.target.value })}
                              className={campo}
                            />
                          </div>
                          <div className="col-span-2">
                            <label className={etiqueta}>Responsable de gestión</label>
                            <select
                              value={b.responsableId}
                              onChange={(e) => cambiar(i, { responsableId: e.target.value })}
                              className={campo}
                            >
                              {jefaturas.length === 0 && <option value="">No hay jefatura registrada</option>}
                              {jefaturas.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.nombre}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="col-span-2">
                            <label className={etiqueta}>Asesor relacionado</label>
                            <select
                              value={b.asesorId}
                              onChange={(e) => cambiar(i, { asesorId: e.target.value, personaSinEnlazar: null })}
                              className={campo}
                            >
                              <option value="">— Ninguno —</option>
                              {asesores.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.nombre}
                                </option>
                              ))}
                            </select>
                            {b.personaSinEnlazar && (
                              <p className="text-[11px] text-[#8A5A16] mt-1">
                                El documento menciona a “{b.personaSinEnlazar}”, que no pude ubicar en el
                                equipo. Elígelo si corresponde.
                              </p>
                            )}
                          </div>
                          <div className="col-span-2 sm:col-span-4">
                            <label className={etiqueta}>Descripción</label>
                            <textarea
                              value={b.descripcion}
                              onChange={(e) => cambiar(i, { descripcion: e.target.value })}
                              rows={2}
                              className={campo + " resize-y"}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <label className="flex items-center gap-2 text-[12.5px] mt-3 cursor-pointer">
                  <input type="checkbox" checked={conContexto} onChange={(e) => setConContexto(e.target.checked)} />
                  Guardar también el contexto del documento en la descripción de cada pendiente
                </label>
              </>
            )}

            {error && (
              <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">
                {error}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setPaso("elegir");
                }}
                disabled={guardando}
                className="px-3 py-2.5 border border-line rounded-md bg-white text-sm hover:bg-paper disabled:opacity-50"
              >
                ← Leer otro archivo
              </button>
              {borradores.length > 0 && (
                <button
                  type="button"
                  onClick={guardar}
                  disabled={guardando || marcados.length === 0}
                  className="flex-1 py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light transition-colors"
                >
                  {guardando
                    ? "Registrando…"
                    : marcados.length === 1
                      ? "Registrar 1 pendiente en el tablero"
                      : `Registrar ${marcados.length} pendientes en el tablero`}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
