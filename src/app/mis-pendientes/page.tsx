"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

export default function MisPendientesPage() {
  const router = useRouter();
  const { loading, session, persona } = useSession();

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace("/login");
  }, [loading, session, router]);

  if (loading || !session || !persona) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted text-sm">
        Cargando…
      </div>
    );
  }

  return (
    <AppShell persona={persona}>
      <div className="mx-auto max-w-[900px] px-8 py-8 w-full">
        <h2 className="text-[17px] font-display font-semibold mb-2">
          Mis pendientes
        </h2>
        <p className="text-muted text-sm max-w-lg">
          Este módulo se activa en la Fase 1 (Bitácora y Feedbacks). Por ahora
          la app solo tiene el módulo de Personal para jefatura.
        </p>
      </div>
    </AppShell>
  );
}
