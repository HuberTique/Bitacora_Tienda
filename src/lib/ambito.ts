"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

// Quién soy y dónde estoy parado, según la base (función mi_ambito):
// la tienda en la que trabaja la sesión puede no ser la propia cuando la
// persona está de reemplazo o esperando un traslado.

export type TiendaCorta = { id?: string; numero: number; nombre: string };

export type MovimientoPropio = {
  id: string;
  tipo: "reemplazo" | "traslado";
  estado: "solicitado" | "activo";
  hasta: string | null;
  /** Aceptado y dentro de fechas: la sesión ya trabaja en la tienda destino. */
  vigente: boolean;
  destino: TiendaCorta;
};

export type Ambito = {
  persona_id: string;
  rol: "jefatura" | "asesor" | "dsm";
  es_admin: boolean;
  debe_cambiar_clave: boolean;
  tienda: (TiendaCorta & { ciudad: string; formato: string }) | null;
  tienda_propia: TiendaCorta | null;
  movimiento: MovimientoPropio | null;
};

/**
 * Lee el ámbito al abrir, cada minuto y al volver a la pestaña. Si la tienda
 * en la que está parada la sesión cambia (aceptaron el reemplazo, venció,
 * confirmaron el traslado), recarga la página: todo lo que hay en pantalla es
 * de la tienda anterior.
 */
export function useAmbito(): { ambito: Ambito | null; recargar: () => Promise<void> } {
  const [ambito, setAmbito] = useState<Ambito | null>(null);
  const tiendaVista = useRef<string | null | undefined>(undefined);

  const recargar = useCallback(async () => {
    const { data, error } = await supabase.rpc("mi_ambito");
    if (error || !data) return;
    const a = data as Ambito;
    const tiendaId = a.tienda?.id ?? null;
    if (tiendaVista.current !== undefined && tiendaVista.current !== tiendaId) {
      window.location.reload();
      return;
    }
    tiendaVista.current = tiendaId;
    setAmbito(a);
  }, []);

  useEffect(() => {
    recargar();
    const cada = setInterval(recargar, 60_000);
    const alVolver = () => {
      if (document.visibilityState === "visible") recargar();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearInterval(cada);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [recargar]);

  return { ambito, recargar };
}

/** Por qué una clave nueva no sirve para ese rol; null si es válida. */
export function problemaClave(rol: string, clave: string, repetida: string): string | null {
  if (rol === "asesor") {
    if (!/^[0-9]{6,8}$/.test(clave)) return "El PIN debe tener de 6 a 8 dígitos.";
  } else if (!(clave.length >= 8 && /[A-Za-z]/.test(clave) && /[0-9]/.test(clave))) {
    return "La clave debe tener mínimo 8 caracteres, con letras y números.";
  }
  if (clave !== repetida) return "Las dos claves no coinciden.";
  return null;
}

export function fechaCorta(iso: string | null): string {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}
