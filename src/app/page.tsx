"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Status = "checking" | "ok" | "error";

export default function Home() {
  const [status, setStatus] = useState<Status>("checking");
  const [detail, setDetail] = useState<string>("");

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ error }) => {
        if (error) {
          setStatus("error");
          setDetail(error.message);
        } else {
          setStatus("ok");
          setDetail(
            "Cliente inicializado y respuesta del endpoint de auth recibida.",
          );
        }
      })
      .catch((err: unknown) => {
        setStatus("error");
        setDetail(err instanceof Error ? err.message : String(err));
      });
  }, []);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-12">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">
          Bitácora Digital
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Fase 0 — scaffold Next.js + Tailwind + Supabase
        </p>
      </header>

      <section className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Conexión con Supabase
        </h2>

        <div className="mt-3 flex items-center gap-2">
          <span
            aria-hidden
            className={
              "inline-block h-2.5 w-2.5 rounded-full " +
              (status === "ok"
                ? "bg-emerald-500"
                : status === "error"
                  ? "bg-red-500"
                  : "bg-amber-500 animate-pulse")
            }
          />
          <span className="text-base font-medium">
            {status === "ok" && "Conectado"}
            {status === "error" && "Error"}
            {status === "checking" && "Comprobando…"}
          </span>
        </div>

        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {detail || "Enviando ping al endpoint de auth…"}
        </p>

        <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs text-zinc-500">
          <dt>Proyecto:</dt>
          <dd className="truncate font-mono">{url ?? "(sin configurar)"}</dd>
        </dl>
      </section>
    </main>
  );
}
