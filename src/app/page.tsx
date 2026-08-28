"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!alive) return;
      if (!session) {
        router.replace("/login");
        return;
      }
      const { data: persona } = await supabase
        .from("personal")
        .select("rol")
        .eq("auth_user_id", session.user.id)
        .maybeSingle();
      if (!alive) return;
      router.replace(persona?.rol === "jefatura" ? "/personal" : "/mis-pendientes");
    });
    return () => {
      alive = false;
    };
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center text-muted text-sm">
      Cargando…
    </div>
  );
}
