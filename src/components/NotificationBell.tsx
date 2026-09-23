"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Notificacion } from "@/lib/types";

/**
 * Campana de notificaciones — vive en AppShell, visible para ambos roles.
 * Se suscribe a Realtime para actualizar el badge sin refrescar la página
 * (Fase 3: "aquí es donde Supabase Realtime se nota más" per el plan). No
 * recibe `persona` como prop: RLS en `notificaciones` ya decide qué filas
 * puede ver cada quien, así que el componente es agnóstico al rol.
 */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notificacion[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("notificaciones")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    if (!error) setItems((data as Notificacion[] | null) ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime: cualquier cambio en notificaciones recarga la lista (RLS ya
  // filtra qué filas nos llegan al hacer el select).
  useEffect(() => {
    const channel = supabase
      .channel("notificaciones-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notificaciones" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  // Cerrar el panel al hacer click afuera.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const noLeidas = useMemo(() => items.filter((n) => !n.leida).length, [items]);

  async function marcarLeida(n: Notificacion) {
    if (n.leida) return;
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, leida: true } : x)));
    await supabase.from("notificaciones").update({ leida: true }).eq("id", n.id);
  }

  async function marcarTodasLeidas() {
    const idsNoLeidas = items.filter((n) => !n.leida).map((n) => n.id);
    if (idsNoLeidas.length === 0) return;
    setItems((prev) => prev.map((x) => ({ ...x, leida: true })));
    await supabase.from("notificaciones").update({ leida: true }).in("id", idsNoLeidas);
  }

  function onClickItem(n: Notificacion) {
    marcarLeida(n);
    if (n.ref_tabla === "requerimientos" && n.ref_fecha) {
      setOpen(false);
      router.push(`/requerimientos?fecha=${n.ref_fecha}`);
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative text-white/85 hover:text-white p-2 rounded-md hover:bg-white/10 transition-colors shrink-0"
        aria-label="Notificaciones"
      >
        <span className="text-lg leading-none">🔔</span>
        {noLeidas > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-warn text-white text-[9.5px] font-bold rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-1">
            {noLeidas > 9 ? "9+" : noLeidas}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[340px] max-h-[420px] overflow-y-auto bg-panel border border-line rounded-[10px] shadow-xl z-50 text-ink">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-line sticky top-0 bg-panel">
            <span className="text-sm font-display font-semibold">Notificaciones</span>
            {noLeidas > 0 && (
              <button
                type="button"
                onClick={marcarTodasLeidas}
                className="text-[11px] text-brand hover:underline"
              >
                Marcar todas leídas
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="text-center py-8 text-muted text-sm">
              No tienes notificaciones.
            </div>
          ) : (
            items.map((n) => {
              // Un rechazo necesita atención aparte de "no leída" — se
              // resalta en rojo aunque ya se haya marcado como leída, para
              // que el asesor la ubique de un vistazo si vuelve a buscarla.
              const esRechazo = n.tipo === "requerimiento_rechazado";
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onClickItem(n)}
                  className={
                    "w-full text-left px-3 py-2.5 border-b border-line/60 last:border-0 hover:bg-paper transition-colors " +
                    (esRechazo
                      ? "bg-warn-soft/70"
                      : n.leida
                      ? ""
                      : "bg-brand/5")
                  }
                >
                  <div
                    className={
                      "text-[12.5px] " +
                      (esRechazo
                        ? "text-warn font-semibold"
                        : n.leida
                        ? "text-ink"
                        : "text-ink font-semibold")
                    }
                  >
                    {esRechazo && "⚠ "}
                    {n.mensaje}
                  </div>
                  <div className="text-[10.5px] text-muted mt-0.5">
                    {new Date(n.created_at).toLocaleDateString("es-CO", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
