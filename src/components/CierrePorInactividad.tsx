"use client";

// Cierra la sesión tras 15 minutos sin uso (ver src/lib/inactividad.ts).
// Se monta una sola vez en el layout raíz y solo actúa si hay sesión.

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { signOut } from "@/lib/auth";
import { assetPath } from "@/lib/asset-path";
import {
  estadoInactividad,
  marcarActividad,
  marcarCierrePorInactividad,
  ultimaActividad,
} from "@/lib/inactividad";

const EVENTOS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

export function CierrePorInactividad() {
  const [conSesion, setConSesion] = useState(false);
  const [restanteMs, setRestanteMs] = useState<number | null>(null);
  const cerrando = useRef(false);

  useEffect(() => {
    let vivo = true;
    supabase.auth.getSession().then(({ data }) => {
      if (vivo) setConSesion(!!data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((_evento, s) => setConSesion(!!s));
    return () => {
      vivo = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!conSesion) return;
    let ultimaEscritura = 0;

    async function cerrar() {
      if (cerrando.current) return;
      cerrando.current = true;
      marcarCierrePorInactividad();
      await signOut();
      window.location.replace(assetPath("/login/"));
    }

    function revisar() {
      const ultima = ultimaActividad();
      if (ultima == null) {
        marcarActividad();
        return;
      }
      const e = estadoInactividad(ultima, Date.now());
      if (e.accion === "cerrar") void cerrar();
      else setRestanteMs(e.accion === "avisar" ? e.restanteMs : null);
    }

    // Toda interacción cuenta (se guarda como mucho cada 5 s para no escribir de más).
    function actividad() {
      const ahora = Date.now();
      // Si ya se venció (p. ej. la pestaña estaba dormida), no se revive la sesión.
      if (estadoInactividad(ultimaActividad(), ahora).accion === "cerrar") return revisar();
      if (ahora - ultimaEscritura > 5000) {
        ultimaEscritura = ahora;
        marcarActividad(ahora);
      }
    }

    const inicio = setTimeout(revisar, 0);
    const reloj = setInterval(revisar, 1000);
    const alVolver = () => {
      if (document.visibilityState === "visible") revisar();
    };
    for (const ev of EVENTOS) window.addEventListener(ev, actividad, { passive: true });
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearTimeout(inicio);
      clearInterval(reloj);
      for (const ev of EVENTOS) window.removeEventListener(ev, actividad);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [conSesion]);

  if (!conSesion || restanteMs == null) return null;
  const s = Math.ceil(restanteMs / 1000);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[100]" role="alertdialog" aria-live="assertive">
      <div className="bg-panel rounded-[10px] p-6 max-w-sm w-full shadow-xl text-center">
        <h3 className="font-display font-semibold text-base mb-1">¿Sigues ahí?</h3>
        <p className="text-muted text-[13px] mb-4">
          Por seguridad, tu sesión se cerrará por inactividad en{" "}
          <strong className="text-ink">
            {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
          </strong>
          .
        </p>
        <div className="flex gap-2 justify-center">
          <button
            type="button"
            onClick={() => {
              marcarActividad();
              setRestanteMs(null);
            }}
            className="px-4 py-2 rounded-md bg-brand text-white text-sm font-semibold hover:bg-brand-light"
          >
            Sigo aquí
          </button>
          <button
            type="button"
            onClick={async () => {
              await signOut();
              window.location.replace(assetPath("/login/"));
            }}
            className="px-4 py-2 rounded-md border border-line bg-white text-sm hover:bg-paper"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}
