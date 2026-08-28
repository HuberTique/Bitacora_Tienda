"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Persona } from "./types";

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
      setState({
        loading: false,
        session,
        persona: (persona as Persona | null) ?? null,
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

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
