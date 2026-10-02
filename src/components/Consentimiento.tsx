"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { signOut } from "@/lib/auth";

type Vigente = { version: number; texto: string; publicado_at: string };

/**
 * Borrador para que el administrador no parta de cero. NO se muestra a nadie
 * hasta que el administrador lo revise, lo ajuste con la empresa y lo publique.
 */
export const BORRADOR_CONSENTIMIENTO = `AUTORIZACIÓN PARA EL TRATAMIENTO DE DATOS PERSONALES

En cumplimiento de la Ley 1581 de 2012 y sus normas reglamentarias, autorizo de manera previa, expresa e informada a mi empleador para recolectar, almacenar, usar y consultar mis datos personales en la herramienta Bitácora Digital.

Datos que se tratan: nombre, número de identificación, código de empleado, cargo, fotografía, horarios y turnos, registros de asistencia y puntualidad, resultados de ventas e indicadores, evaluaciones de desempeño, retroalimentaciones, solicitudes de permisos y los soportes que yo adjunte.

Finalidad: la gestión interna de la tienda y del distrito (programación de horarios, seguimiento de pendientes, medición de resultados, retroalimentación y planes de trabajo). Los datos no se usan para fines distintos ni se entregan a terceros ajenos a la compañía.

Quién los ve: la jefatura de mi tienda, la gerencia de distrito a la que pertenece la tienda y el administrador de la herramienta. Si soy trasladado, la jefatura de la tienda que me recibe verá mi historial.

Mis derechos: conocer, actualizar y rectificar mis datos; solicitar prueba de esta autorización; ser informado sobre el uso que se les ha dado; revocar la autorización o solicitar la supresión cuando proceda, y presentar quejas ante la Superintendencia de Industria y Comercio. Puedo ejercerlos a través de la jefatura de mi tienda o del área de Recursos Humanos.

Algunas funciones usan inteligencia artificial para leer documentos y proponer textos; una persona de la jefatura siempre revisa el resultado antes de guardarlo.`;

/** Bloquea la app hasta que la persona acepte el consentimiento vigente. */
export function ConsentimientoObligatorio({ onAceptado }: { onAceptado: () => void }) {
  const [vigente, setVigente] = useState<Vigente | null>(null);
  const [marcado, setMarcado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    supabase.rpc("consentimiento_vigente").then(({ data, error: e }) => {
      if (e) setError(e.message);
      else setVigente(((data as Vigente[] | null) ?? [])[0] ?? null);
    });
  }, []);

  async function aceptar() {
    if (!vigente) return;
    setError(null);
    setOcupado(true);
    const { error: e } = await supabase.rpc("aceptar_consentimiento", { p_version: vigente.version });
    setOcupado(false);
    if (e) return setError(e.message);
    onAceptado();
  }

  async function rechazar() {
    await signOut();
    window.location.href = window.location.pathname.replace(/\/[^/]+\/?$/, "/login/");
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[70]">
      <div className="bg-panel text-ink rounded-[10px] p-6 w-full max-w-2xl shadow-xl max-h-[92vh] flex flex-col">
        <h3 className="font-display font-semibold text-base mb-1">Autorización de tratamiento de datos</h3>
        <p className="text-muted text-[12.5px] mb-3">
          Antes de usar la bitácora necesitamos tu autorización. Léela completa.
        </p>
        <div className="flex-1 overflow-y-auto border border-line rounded-md bg-white px-3.5 py-3 text-[13px] whitespace-pre-wrap leading-relaxed min-h-[160px]">
          {vigente ? vigente.texto : error ? "" : "Cargando…"}
        </div>
        <label className="flex items-start gap-2 text-[13px] mt-3 cursor-pointer">
          <input
            type="checkbox"
            checked={marcado}
            onChange={(e) => setMarcado(e.target.checked)}
            className="mt-0.5"
            disabled={!vigente}
          />
          <span>He leído y autorizo el tratamiento de mis datos personales en los términos anteriores.</span>
        </label>
        {error && (
          <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">{error}</div>
        )}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={rechazar}
            disabled={ocupado}
            className="px-3 py-2.5 border border-line rounded-md bg-white text-sm hover:bg-paper disabled:opacity-50"
          >
            No acepto (cerrar sesión)
          </button>
          <button
            type="button"
            onClick={aceptar}
            disabled={!marcado || ocupado || !vigente}
            className="flex-1 py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50"
          >
            {ocupado ? "Guardando…" : "Acepto y continúo"}
          </button>
        </div>
        {vigente && <p className="text-[11px] text-muted mt-2">Versión {vigente.version} del texto.</p>}
      </div>
    </div>
  );
}

/**
 * Personal → Consentimiento de datos. La jefatura ve cuántos de su tienda han
 * aceptado; el administrador además redacta y publica el texto.
 */
export function ConsentimientoPanel({ esAdmin }: { esAdmin: boolean }) {
  const [vigente, setVigente] = useState<Vigente | null | undefined>(undefined);
  const [avance, setAvance] = useState<{ aceptaron: number; total: number } | null>(null);
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let vivo = true;
    Promise.all([supabase.rpc("consentimiento_vigente"), supabase.rpc("consentimiento_avance")]).then(([v, a]) => {
      if (!vivo || v.error) return; // función aún no disponible: el panel no aparece
      setVigente(((v.data as Vigente[] | null) ?? [])[0] ?? null);
      setAvance(((a.data as { aceptaron: number; total: number }[] | null) ?? [])[0] ?? null);
    });
    return () => {
      vivo = false;
    };
  }, [version]);

  if (vigente === undefined) return null;
  if (!esAdmin && !vigente) return null;

  async function publicar() {
    setMsg(null);
    if (texto.trim().length < 50) return setMsg("El texto es demasiado corto.");
    if (
      !window.confirm(
        vigente
          ? "Al publicar un texto nuevo, TODAS las personas deberán aceptarlo otra vez la próxima vez que entren. ¿Publicar?"
          : "Desde este momento, toda persona que entre a la app deberá aceptar este texto para poder usarla. ¿Publicar?",
      )
    )
      return;
    setOcupado(true);
    const { error } = await supabase.rpc("publicar_consentimiento", { p_texto: texto });
    setOcupado(false);
    if (error) return setMsg(error.message);
    setEditando(false);
    setVersion((n) => n + 1);
    // El propio administrador también debe aceptarlo: se recarga para que se lo pida.
    window.location.reload();
  }

  return (
    <div className="bg-panel border border-line rounded-[10px] px-4 py-3 mb-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[13px]">
          <strong>Consentimiento de datos:</strong>{" "}
          {vigente ? (
            <>
              versión {vigente.version} publicada
              {avance ? ` · ${avance.aceptaron} de ${avance.total} personas de esta tienda lo han aceptado` : ""}.
            </>
          ) : (
            <span className="text-warn">
              sin publicar. Nadie lo está aceptando todavía; publícalo cuando la empresa apruebe el texto.
            </span>
          )}
        </div>
        {esAdmin && !editando && (
          <button
            type="button"
            onClick={() => {
              setTexto(vigente?.texto ?? BORRADOR_CONSENTIMIENTO);
              setMsg(null);
              setEditando(true);
            }}
            className="px-3 py-1.5 rounded-md border border-line bg-white text-xs font-semibold hover:bg-paper"
          >
            {vigente ? "Publicar un texto nuevo" : "Redactar y publicar"}
          </button>
        )}
      </div>

      {editando && (
        <div className="mt-3">
          <p className="text-muted text-[12px] mb-1.5">
            {vigente
              ? "Parte del texto vigente. Al publicar se crea una versión nueva."
              : "Este es un borrador de partida. Ajústalo con quien corresponda en la empresa antes de publicarlo."}
          </p>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={14}
            className="w-full px-3 py-2 border border-line rounded-md bg-white text-[13px] resize-y"
          />
          {msg && <div className="text-xs text-warn mt-1">{msg}</div>}
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={publicar}
              disabled={ocupado}
              className="px-3 py-1.5 rounded-md bg-brand text-white text-xs font-semibold disabled:opacity-50"
            >
              {ocupado ? "Publicando…" : "Publicar"}
            </button>
            <button
              type="button"
              onClick={() => setEditando(false)}
              className="px-3 py-1.5 rounded-md border border-line bg-white text-xs"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
