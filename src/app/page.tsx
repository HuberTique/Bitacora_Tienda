"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!alive) return;
      router.replace(session ? "/bitacora" : "/login");
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
