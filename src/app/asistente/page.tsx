"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

type Mensaje = { rol: "asesor" | "bot"; texto: string };

/**
 * /asistente — Fase 4. Chat con IA, solo para asesores (igual que en el
 * artifact original: jefatura tiene su propia vista de Configuración/
 * Reportes, no un chat). Cada pregunta reconstruye su contexto en el
 * servidor (pendientes, feedbacks, presupuesto, requerimientos) en vez de
 * reenviar el historial — el Edge Function ya arma el system prompt fresco
 * por turno, igual que hacía el artifact original con STATE en memoria.
 */
export default function AsistentePage() {
  const router = useRouter();
  const { loading, session, persona } = useSession();

  const [historial, setHistorial] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const msgsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loading) return;
    if (!session) return router.replace("/login");
    if (persona && persona.rol !== "asesor") return router.replace("/bitacora");
  }, [loading, session, persona, router]);

  useEffect(() => {
    msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight });
  }, [historial, enviando]);

  async function enviar() {
    const mensaje = texto.trim();
    if (!mensaje || enviando) return;
    setTexto("");
    setHistorial((h) => [...h, { rol: "asesor", texto: mensaje }]);
    setEnviando(true);

    const { data, error } = await supabase.functions.invoke("asistente-chat", {
      body: { mensaje },
    });
    setEnviando(false);

    if (error) {
      console.error("[asistente] Error:", await extractFunctionErrorMessage(error, data));
      setHistorial((h) => [
        ...h,
        { rol: "bot", texto: "No pude responder en este momento, intenta de nuevo." },
      ]);
      return;
    }
    const respuesta = (data as { respuesta?: string } | null)?.respuesta;
    setHistorial((h) => [
      ...h,
      { rol: "bot", texto: respuesta || "No pude responder en este momento, intenta de nuevo." },
    ]);
  }

  if (loading || !persona || persona.rol !== "asesor") {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted text-sm">
        Cargando…
      </div>
    );
  }

  return (
    <AppShell persona={persona}>
      <div className="mx-auto max-w-[700px] px-6 py-7 w-full flex flex-col" style={{ height: "calc(100vh - 60px)" }}>
        <div className="mb-4 shrink-0">
          <h2 className="text-[17px] font-display font-semibold m-0 mb-1">Asistente</h2>
          <p className="text-muted text-[13px]">
            Pregunta sobre tus pendientes, feedbacks, presupuesto o dónde consultar algo.
          </p>
        </div>

        <div className="bg-panel border border-line rounded-[10px] flex flex-col flex-1 min-h-0 overflow-hidden">
          <div ref={msgsRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {historial.length === 0 && (
              <div className="max-w-[85%] bg-paper border border-line rounded-lg rounded-bl-sm px-3.5 py-2.5 text-[13.5px] text-ink">
                Hola {persona.nombre}, puedes preguntarme por tus pendientes, el procedimiento de
                feedbacks y faltas, tu presupuesto del mes, o dónde consultar algo (nómina,
                reglamento, etc.).
              </div>
            )}
            {historial.map((m, i) => (
              <div
                key={i}
                className={
                  "max-w-[85%] rounded-lg px-3.5 py-2.5 text-[13.5px] whitespace-pre-wrap " +
                  (m.rol === "asesor"
                    ? "ml-auto bg-brand text-white rounded-br-sm"
                    : "bg-paper border border-line text-ink rounded-bl-sm")
                }
              >
                {m.texto}
              </div>
            ))}
            {enviando && (
              <div className="bg-paper border border-line rounded-lg rounded-bl-sm px-3.5 py-2.5 text-[13.5px] text-muted">
                Pensando…
              </div>
            )}
          </div>

          <div className="border-t border-line p-3 flex gap-2 shrink-0">
            <input
              type="text"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") enviar();
              }}
              placeholder="Escribe tu pregunta..."
              className="flex-1 border border-line rounded-md px-3 py-2 text-[13.5px] focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            <button
              type="button"
              onClick={enviar}
              disabled={enviando || !texto.trim()}
              className="bg-brand text-white text-[13px] font-semibold px-4 rounded-md hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              Enviar
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/**
 * Extrae el mensaje de error real de una respuesta non-2xx de una Edge Function.
 * El cliente de Supabase envuelve el error como FunctionsHttpError con
 * `error.message` genérico y el body real dentro de `error.context` (Response).
 */
async function extractFunctionErrorMessage(error: unknown, data: unknown): Promise<string> {
  const dataErr = (data as { error?: string } | null)?.error;
  if (dataErr) return dataErr;

  const ctx = (error as { context?: unknown }).context;
  if (ctx instanceof Response) {
    try {
      const body = await ctx.clone().json();
      const msg = (body as { error?: string } | null)?.error;
      if (msg) return msg;
    } catch {
      try {
        const txt = (await ctx.clone().text()).trim();
        if (txt) return txt.slice(0, 500);
      } catch {
        /* ignore */
      }
    }
  }
  return (error as { message?: string })?.message ?? "Error desconocido.";
}
