"use client";

import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth";
import type { Persona } from "@/lib/types";

export function AppShell({
  persona,
  children,
}: {
  persona: Persona;
  children: React.ReactNode;
}) {
  const router = useRouter();

  async function handleLogout() {
    await signOut();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen flex flex-col bg-paper">
      <header className="bg-brand text-white flex items-center gap-6 px-7 h-[60px] shrink-0">
        <div className="flex items-center gap-2.5 pr-5 border-r border-white/15 h-[60px]">
          <div>
            <h1 className="text-base m-0 text-white font-display font-semibold leading-tight">
              Bitácora
            </h1>
            <div className="text-[10px] text-white/50 uppercase tracking-wider">
              Outlet de las Américas
            </div>
          </div>
        </div>
        <div className="flex-1 text-[13.5px]">
          {persona.nombre}{" "}
          <span className="text-white/60">
            · {persona.rol === "jefatura" ? "Jefatura" : "Asesor"} · {persona.cargo}
          </span>
        </div>
        <button
          onClick={handleLogout}
          className="text-xs px-3 py-2 bg-white/10 hover:bg-white/20 rounded-md transition-colors"
        >
          Cerrar sesión
        </button>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
