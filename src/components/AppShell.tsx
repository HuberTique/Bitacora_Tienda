"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "@/lib/auth";
import { NotificationBell } from "./NotificationBell";
import { useTienda } from "@/lib/tienda-config";
import type { Persona } from "@/lib/types";

type Tab = { href: string; label: string; roles: ("jefatura" | "asesor")[] };

const TABS: Tab[] = [
  { href: "/bitacora", label: "Bitácora", roles: ["jefatura", "asesor"] },
  { href: "/feedbacks", label: "Feedbacks", roles: ["jefatura"] },
  { href: "/horarios", label: "Horarios", roles: ["jefatura"] },
  { href: "/requerimientos", label: "Requerimientos", roles: ["jefatura", "asesor"] },
  { href: "/ranking", label: "Presupuesto y ranking", roles: ["asesor", "jefatura"] },
  { href: "/asistente", label: "Asistente", roles: ["asesor"] },
  { href: "/personal", label: "Personal", roles: ["jefatura"] },
];

export function AppShell({
  persona,
  children,
}: {
  persona: Persona;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const tienda = useTienda();
  const [oscuro, setOscuro] = useState(false);
  useEffect(() => {
    setOscuro(document.documentElement.getAttribute("data-theme") === "dark");
  }, []);
  function alternarTema() {
    const nuevo = !oscuro;
    setOscuro(nuevo);
    if (nuevo) document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    try {
      localStorage.setItem("tema", nuevo ? "dark" : "light");
    } catch {
      /* sin almacenamiento: el cambio vale solo para esta sesión */
    }
  }

  async function handleLogout() {
    await signOut();
    router.replace("/login");
  }

  const visibleTabs = TABS.filter((t) => t.roles.includes(persona.rol));

  return (
    <div className="min-h-screen flex flex-col bg-paper">
      <header className="bg-brand text-white flex flex-wrap items-center gap-x-3 sm:gap-x-6 px-4 sm:px-7 sm:h-[60px] shrink-0">
        <div className="flex items-center gap-2.5 pr-4 sm:pr-5 border-r border-white/15 h-[60px] shrink-0 mr-auto sm:mr-0">
          <div>
            <h1 className="text-base m-0 text-white font-display font-semibold leading-tight">
              Bitácora
            </h1>
            <div className="text-[10px] text-white/50 uppercase tracking-wider">
              {tienda.nombre}
            </div>
          </div>
        </div>

        <nav className="flex items-center h-[46px] sm:h-[60px] order-last sm:order-none w-[calc(100%+2rem)] sm:w-auto sm:flex-1 overflow-x-auto -mx-4 px-2 sm:mx-0 sm:px-0 border-t border-white/10 sm:border-0">
          {visibleTabs.map((t) => {
            const active = pathname === t.href || pathname.startsWith(t.href + "/");
            return (
              <Link
                key={t.href}
                href={t.href}
                className={
                  "flex items-center px-3 sm:px-4 h-[46px] sm:h-[60px] text-[13.5px] font-medium border-b-[3px] whitespace-nowrap transition-colors " +
                  (active
                    ? "text-white border-white bg-white/8"
                    : "text-white/75 border-transparent hover:bg-white/6 hover:text-white")
                }
              >
                {t.label}
              </Link>
            );
          })}
        </nav>

        <NotificationBell />
        <button
          type="button"
          onClick={alternarTema}
          title="Cambiar entre tema claro y oscuro"
          aria-label="Cambiar tema"
          className="text-base px-2.5 py-1.5 bg-white/10 hover:bg-white/20 rounded-md transition-colors shrink-0"
        >
          {oscuro ? "☀️" : "🌙"}
        </button>

        <div className="hidden sm:block text-[13px] text-white/70 truncate max-w-[180px]">
          {persona.nombre}
          <span className="text-white/50">
            {" "}
            · {persona.rol === "jefatura" ? "Jefatura" : "Asesor"}
          </span>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="text-xs px-3 py-2 bg-white/10 hover:bg-white/20 rounded-md transition-colors shrink-0"
        >
          Cerrar sesión
        </button>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
