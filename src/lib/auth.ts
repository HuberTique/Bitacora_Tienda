"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Encargo, Persona } from "./types";

export type AuthState = {
  loading: boolean;
  session: Session | null;
  persona: Persona | null;
  error: string | null;
};

/**
 * Hook para leer sesión + fila de personal enlazada.
 * Se re-ejecuta ante cambios en el estado de auth (login/logout).
 */
export function useSession(): AuthState {
  const [state, setState] = useState<AuthState>({
    loading: true,
    session: null,
    persona: null,
    error: null,
  });

  useEffect(() => {
    let alive = true;

    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!alive) return;
      if (!session) {
        setState({ loading: false, session: null, persona: null, error: null });
        return;
      }

      const { data: persona, error } = await supabase
        .from("personal")
        .select("*")
        .eq("auth_user_id", session.user.id)
        .maybeSingle();

      if (!alive) return;
      let p = (persona as Persona | null) ?? null;
      // Encargo temporal vigente: mientras dure, la persona entra como jefatura.
      // (La base decide lo mismo con current_persona_rol; esto solo ajusta la app.)
      if (p && p.rol === "asesor") {
        const { data: encargo, error: eErr } = await supabase.rpc("mi_encargo");
        if (!alive) return;
        if (!eErr && encargo) p = { ...p, rol: "jefatura", rol_ficha: "asesor", encargo: encargo as Encargo };
      }
      setState({
        loading: false,
        session,
        persona: p,
        error: error?.message ?? null,
      });
    }

    load();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      load();
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  return state;
}

/** Cierra la sesión solo en este dispositivo: la del celular o la otra pestaña sigue abierta. */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut({ scope: "local" });
}
