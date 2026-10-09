"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { esMandoPersona, type PersonaMatch } from "@/lib/kpis-mensual-excel";
import { leerVentasConsolidadas, type Giro, type VentasConsolidadas } from "@/lib/ventas-consolidadas";
import type { MesRetail } from "@/lib/mes-retail";
import { NOMBRES_MES } from "@/lib/horarios";
import { tiendaActualId } from "@/lib/planta";
import { useTienda } from "@/lib/tienda-config";
import { ayer, fechaCorta } from "@/lib/cierres-faltantes";
import { Modal, inputCls } from "./ui";
import { recalcularUpt } from "./cargar/cargas";
import { guardarCorte } from "@/lib/cortes";
import { ajustarRangoInforme } from "@/lib/ventas-pdf";
import { ArchivosParaLeer } from "@/components/ArchivosParaLeer";
import { textoCortesDistintos, uptQueNoCuadra } from "@/lib/upt-cuadre";
import { personasPorCodigo } from "@/lib/productividad";
import { avisoCorteSemana } from "@/lib/periodos";

const soloDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/**
 * Carga del reporte "Visión general de ventas" (consolidado del mes hasta una fecha de corte).
 * De aquí salen SOLO las unidades por categoría de cada asesor (pares, accesorios y, si la tienda
 * vende, ropa); la venta en pesos sale de los cierres del día (Huber, 8-oct-2026). Se sube en PDF o
 * en fotos de las hojas; cada asesor se identifica por su CM.
 */
export function ConsolidadasCard({
  anio,
  mes,
  mesInfo,
  subidoPor,
  onGuardado,
}: {
  anio: number;
  mes: number;
  mesInfo: MesRetail | null;
  subidoPor: string;
  onGuardado: () => void;
}) {
  const tienda = useTienda();
  const vendeRopa = tienda?.vende_ropa !== false;
  const [archivos, setArchivos] = useState<File[]>([]);
  const [leyendo, setLeyendo] = useState(false);
  const [avance, setAvance] = useState<{ hechas: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [giro, setGiro] = useState<Giro>("auto");
  const [datos, setDatos] = useState<{
    data: VentasConsolidadas;
    personal: PersonaMatch[];
    alternos: { persona_id: string; codigo: string; estado: string }[];
    archivo: string;
  } | null>(null);

  async function leer() {
    if (!archivos.length) return;
    setError(null);
    setLeyendo(true);
    try {
      const [pers, tid, alt] = await Promise.all([
        supabase.from("personal").select("id, nombre, cedula, codigo, activo, cargo, rol_jerarquico, tienda_id").eq("activo", true),
        tiendaActualId(),
        supabase.from("personal_codigos_alternos").select("persona_id, codigo, estado").eq("estado", "aprobado"),
      ]);
      if (pers.error) throw new Error(pers.error.message);
      const data = await leerVentasConsolidadas(archivos, giro, (hechas, total) => setAvance({ hechas, total }));
      const personal = ((pers.data as (PersonaMatch & { tienda_id: string })[] | null) ?? []).filter((p) => !tid || p.tienda_id === tid);
      const enPlanta = new Set(personal.map((p) => p.id));
      const alternos = ((alt.data as { persona_id: string; codigo: string; estado: string }[] | null) ?? []).filter((a) => enPlanta.has(a.persona_id));
      setDatos({ data, personal, alternos, archivo: archivos.map((f) => f.name).join(", ") });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer el reporte.");
    } finally {
      setLeyendo(false);
      setAvance(null);
    }
  }

  // El informe es un acumulado hasta su fecha de corte: si no llega hasta ayer, faltan unidades.
  const hasta = mesInfo ? (ayer() < mesInfo.fin ? ayer() : mesInfo.fin) : null;
  const atrasado = !!mesInfo?.ventas_corte && !!hasta && mesInfo.ventas_corte < hasta;

  return (
    <div className="bg-panel border border-line rounded-[10px] p-4">
      <div className="max-w-2xl">
        <h3 className="text-sm font-semibold m-0">Ventas consolidadas (&quot;Visión general de ventas&quot;)</h3>
        <p className="text-[12.5px] text-muted mt-1">
          De este informe salen las <strong>unidades</strong> de cada asesor: <strong>pares</strong> y{" "}
          <strong>accesorios</strong>
          {vendeRopa ? (
            <>
              {" "}
              y <strong>ropa</strong>
            </>
          ) : (
            " (esta tienda está configurada sin ropa)"
          )}
          , del inicio del mes retail hasta la fecha de corte. La venta en pesos sale de los cierres del día. Cada asesor se
          identifica por su <strong>CM</strong>; un informe más nuevo reemplaza al anterior. Súbelo en PDF o en fotos de sus
          hojas.
        </p>
        {mesInfo?.ventas_archivo ? (
          <p className="text-[11.5px] text-muted mt-1.5">
            Última carga: <strong>{mesInfo.ventas_archivo}</strong>
            {mesInfo.ventas_corte ? ` · unidades hasta el ${mesInfo.ventas_corte}` : ""}
            {mesInfo.ventas_cargado_en
              ? ` · ${new Date(mesInfo.ventas_cargado_en).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}`
              : ""}
          </p>
        ) : (
          <p className="text-[11.5px] text-warn mt-1.5">Aún no hay ventas consolidadas cargadas para este mes.</p>
        )}
        {atrasado && (
          <p className="text-[11.5px] mt-1.5 bg-amber-50 border border-amber-300 text-[#8A5A16] rounded-md px-2.5 py-1.5">
            ⚠ El informe cargado llega hasta el {fechaCorta(mesInfo!.ventas_corte!)}: faltan las unidades hasta el {fechaCorta(hasta!)}.
            Súbelo de nuevo cuando lo tengas.
          </p>
        )}
      </div>
      <div className="mt-3 space-y-2">
        <ArchivosParaLeer archivos={archivos} onCambio={setArchivos} onLeer={leer} leyendo={leyendo} avance={avance} />
        {archivos.length > 0 && (
          <label className="text-[11px] text-muted flex items-center gap-1.5">
            Orientación (si se lee mal, gírala):
            <select
              value={String(giro)}
              onChange={(e) => setGiro(e.target.value === "auto" ? "auto" : (Number(e.target.value) as Giro))}
              className={inputCls + " py-0.5 px-1.5 text-[11.5px]"}
            >
              <option value="auto">Automática</option>
              <option value="0">Sin girar</option>
              <option value="90">Girar 90°</option>
              <option value="180">Girar 180°</option>
              <option value="270">Girar 270°</option>
            </select>
          </label>
        )}
      </div>
      {error && (
        <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-sm">
          {error}
        </div>
      )}
      {datos && (
        <PreviewConsolidadas
          data={datos.data}
          personal={datos.personal}
          alternos={datos.alternos}
          archivo={datos.archivo}
          anio={anio}
          mes={mes}
          mesInfo={mesInfo}
          vendeRopa={vendeRopa}
          subidoPor={subidoPor}
          onClose={() => setDatos(null)}
          onGuardado={() => {
            setDatos(null);
            setArchivos([]);
            onGuardado();
          }}
        />
      )}
    </div>
  );
}

type Edicion = { pares?: string; ropa?: string; acc?: string };

function PreviewConsolidadas({
  data,
  personal,
  alternos,
  archivo,
  anio,
  mes,
  mesInfo,
  vendeRopa,
  subidoPor,
  onClose,
  onGuardado,
}: {
  data: VentasConsolidadas;
  personal: PersonaMatch[];
  alternos: { persona_id: string; codigo: string; estado: string }[];
  archivo: string;
  anio: number;
  mes: number;
  mesInfo: MesRetail | null;
  vendeRopa: boolean;
  subidoPor: string;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const registrables = useMemo(
    () => [...personal].sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [personal],
  );
  // Por CM propio o código alterno aprobado (p. ej. un asesor que usa el 989999 mientras le llega el suyo).
  const porCm = useMemo(() => {
    const ids = personasPorCodigo(
      personal.map((p) => ({ id: p.id, codigo: p.codigo })),
      alternos,
    );
    const m = new Map<string, PersonaMatch>();
    ids.forEach((id, cm) => {
      const p = personal.find((x) => x.id === id);
      if (p) m.set(cm, p);
    });
    return m;
  }, [personal, alternos]);

  // Cada fila del reporte: quién es (por CM) y si se registra.
  const filas = useMemo(
    () =>
      data.empleados.map((e) => {
        const p = porCm.get(e.cm) ?? null;
        const mando = !!p && esMandoPersona(p);
        const vendio = (e.unidades ?? 0) !== 0 || [e.pares, e.ropa, e.acc].some((v) => (v ?? 0) !== 0);
        return { e, p, mando, vendio };
      }),
    [data.empleados, porCm],
  );
  const [asignado, setAsignado] = useState<Record<number, string>>(() => {
    const m: Record<number, string> = {};
    filas.forEach(({ p }, i) => (m[i] = p ? p.id : ""));
    return m;
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Las fechas del informe pueden venir mes-día: se interpretan frente al mes retail.
  const { rango, invertido } = ajustarRangoInforme(data.rango, mesInfo?.inicio, mesInfo?.fin);
  // Mes retail al que pertenece el reporte: el que contiene su fecha final.
  const corte = rango?.[1] ?? null;
  const [destino, setDestino] = useState<{ anio: number; mes: number }>({ anio, mes });
  useEffect(() => {
    if (!corte) return;
    supabase
      .from("meses_retail")
      .select("anio, mes")
      .lte("inicio", corte)
      .gte("fin", corte)
      .limit(1)
      .then(({ data: r }) => {
        const x = (r as { anio: number; mes: number }[] | null)?.[0];
        if (x) setDestino(x);
      });
  }, [corte]);

  // TRX y UPT de Xstore ya cargados, para cotejar el UPT con unidades ÷ TRX (mismo corte).
  const [xstore, setXstore] = useState<{ hasta: string | null; porPersona: Map<string, { trx: number | null; upt: number | null }> } | null>(null);
  useEffect(() => {
    Promise.all([
      supabase.from("kpis_mensuales").select("persona_id, trx, upt").eq("anio", destino.anio).eq("mes", destino.mes),
      supabase
        .from("cargas_datos")
        .select("resumen")
        .eq("anio", destino.anio)
        .eq("mes", destino.mes)
        .eq("tipo", "transacciones")
        .eq("vigente", true)
        .limit(1),
    ]).then(([k, c]) => {
      const hasta = ((c.data as { resumen: { hasta?: string | null } }[] | null)?.[0]?.resumen?.hasta ?? null) as string | null;
      const filasK = (k.data as { persona_id: string; trx: number | null; upt: number | null }[] | null) ?? [];
      setXstore({ hasta, porPersona: new Map(filasK.map((x) => [x.persona_id, { trx: x.trx, upt: x.upt }])) });
    });
  }, [destino.anio, destino.mes]);

  // Correcciones a mano de lo que leyó la IA.
  const [edits, setEdits] = useState<Record<number, Edicion>>({});
  const [confirmado, setConfirmado] = useState(false);
  const num = (i: number, c: keyof Edicion, original: number | null): number | null => {
    const v = edits[i]?.[c];
    if (v === undefined) return original;
    if (v.trim() === "") return null;
    const n = Number(v.replace(/[^0-9.-]/g, ""));
    return isFinite(n) ? n : original;
  };

  const asignadas = new Set(Object.values(asignado).filter(Boolean));
  const sinVentaIgnoradas = filas.filter(({ e, p, vendio }, i) => !p && !asignado[i] && !vendio && !e.cuentaTienda).length;
  const conVentaSinAsignar = filas.filter(({ e, p, mando, vendio }, i) => !mando && !asignado[i] && (vendio || !!p) && !(e.cuentaTienda && !p)).length;
  const faltan = registrables.filter((p) => !asignadas.has(p.id));

  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const graves: string[] = [];
  const avisos = [...data.avisos];
  if (!data.titulo || !norm(data.titulo).includes("vision general de ventas")) {
    graves.push(`El archivo no parece ser el informe "Visión general de ventas" (título leído: ${data.titulo ?? "ninguno"}).`);
  }
  const codigoTienda = mesInfo?.tienda ? soloDigitos(mesInfo.tienda) : "";
  if (codigoTienda) {
    if (!data.tienda) avisos.push(`No pude leer la tienda del informe (se esperaba la ${codigoTienda}).`);
    else if (!soloDigitos(data.tienda).includes(codigoTienda))
      graves.push(`La tienda del informe (${data.tienda}) no coincide con la tienda ${codigoTienda} de esta aplicación.`);
  }
  if (!rango) {
    avisos.push("No pude leer el rango de fechas del reporte; la fecha de corte quedará vacía.");
  } else if (mesInfo) {
    if (invertido && data.rango)
      avisos.push(`Las fechas del informe venían mes-día (${data.rango[0]} a ${data.rango[1]}); se tomaron como ${rango[0]} a ${rango[1]}.`);
    if (rango[0] !== mesInfo.inicio)
      avisos.push(`El informe empieza el ${rango[0]} pero el mes retail cargado empieza el ${mesInfo.inicio}.`);
    const semana = avisoCorteSemana(rango[1], mesInfo.fin);
    if (semana) avisos.push(semana);
    if (rango[1] > mesInfo.fin || rango[1] < mesInfo.inicio)
      graves.push(`El rango del informe (${rango[0]} a ${rango[1]}) está fuera del mes retail ${mesInfo.inicio} a ${mesInfo.fin}.`);
  }
  // Incongruencia: la tienda está configurada sin ropa pero el informe trae ropa vendida.
  const ropaLeida = filas.reduce((a, { e }, i) => a + Math.abs(num(i, "ropa", e.ropa) ?? 0), 0);
  const ropaIncongruente = !vendeRopa && ropaLeida > 0;
  const mostrarRopa = vendeRopa || ropaIncongruente;

  // Cotejo del UPT: solo si el informe de Xstore llega a la misma fecha que esta consolidada.
  const uptNoCuadra = (i: number, e: (typeof filas)[number]["e"]): number | null => {
    const x = asignado[i] && xstore?.hasta && xstore.hasta === corte ? xstore.porPersona.get(asignado[i]) : undefined;
    if (!x) return null;
    const vals = [num(i, "pares", e.pares), num(i, "acc", e.acc), num(i, "ropa", e.ropa)];
    const unidades = vals.some((v) => v != null) ? vals.reduce<number>((a, v) => a + (v ?? 0), 0) : e.unidades;
    return uptQueNoCuadra(x.upt, unidades, x.trx);
  };
  if (xstore?.hasta && corte && xstore.hasta !== corte) avisos.push(textoCortesDistintos(corte, xstore.hasta));
  const nombresUpt = filas
    .map(({ e }, i) => (uptNoCuadra(i, e) != null ? personal.find((p) => p.id === asignado[i])?.nombre : null))
    .filter((n): n is string => !!n);
  if (nombresUpt.length > 0)
    avisos.push(
      `El UPT de Xstore no cuadra con unidades ÷ TRX (diferencia mayor a 0,1) en: ${nombresUpt.join(", ")}. Revisa las unidades o la TRX; el UPT que se usa es el de Xstore.`,
    );

  const totales = filas.reduce(
    (a, { e }, i) =>
      asignado[i]
        ? {
            pares: a.pares + (num(i, "pares", e.pares) ?? 0),
            acc: a.acc + (num(i, "acc", e.acc) ?? 0),
            ropa: a.ropa + (num(i, "ropa", e.ropa) ?? 0),
          }
        : a,
    { pares: 0, acc: 0, ropa: 0 },
  );

  const campo = (i: number, c: keyof Edicion, original: number | null) => {
    const v = edits[i]?.[c];
    return (
      <input
        inputMode="numeric"
        value={v !== undefined ? v : original == null ? "" : String(Math.round(original))}
        onChange={(ev) => setEdits((p) => ({ ...p, [i]: { ...p[i], [c]: ev.target.value } }))}
        placeholder="—"
        className={
          "w-16 px-1.5 py-0.5 border rounded text-right font-mono text-[12px] " +
          (original == null && v === undefined ? "border-amber-400 bg-amber-50" : "border-line bg-white")
        }
      />
    );
  };

  async function guardar() {
    setError(null);
    if (graves.length > 0 && !confirmado) {
      setError("Hay advertencias graves arriba. Marca la casilla de confirmación si aun así quieres guardar.");
      return;
    }
    const filasGuardar = filas
      .map(({ e }, i) => ({ e, i, pid: asignado[i] }))
      .filter((x) => x.pid);
    if (new Set(filasGuardar.map((x) => x.pid)).size !== filasGuardar.length) {
      setError("Hay personas asignadas a más de una fila del reporte.");
      return;
    }
    if (filasGuardar.length === 0) {
      setError("No hay filas asignadas a personas del equipo.");
      return;
    }
    setGuardando(true);
    // Solo unidades por categoría. La venta en pesos NO se toma de aquí (sale de los cierres del día).
    const filasBd = filasGuardar.map(({ e, i, pid }) => {
      const pares = num(i, "pares", e.pares);
      const acc = num(i, "acc", e.acc);
      const ropa = num(i, "ropa", e.ropa);
      const algo = [pares, acc, ropa].some((v) => v != null);
      return {
        persona_id: pid,
        anio: destino.anio,
        mes: destino.mes,
        acumulado_bruto: null,
        acumulado_neto: null,
        unidades: algo ? (pares ?? 0) + (acc ?? 0) + (ropa ?? 0) : e.unidades,
        pares_venta: pares,
        acc_venta: acc,
        ropa_venta: ropa,
        cumplimiento: null,
        corte_ventas: corte,
        subido_por: subidoPor,
      };
    });
    // Quien tiene fila en Personal pero no aparece en el reporte no vendió en el periodo: queda en 0.
    const enReporte = new Set(filasGuardar.map((x) => x.pid));
    const ceros = registrables
      .filter((p) => !enReporte.has(p.id))
      .map((p) => ({
        persona_id: p.id,
        anio: destino.anio,
        mes: destino.mes,
        acumulado_bruto: null,
        acumulado_neto: null,
        unidades: 0,
        pares_venta: 0,
        acc_venta: 0,
        ropa_venta: 0,
        cumplimiento: null,
        corte_ventas: corte,
        subido_por: subidoPor,
      }));
    const { error: err } = await supabase
      .from("kpis_mensuales")
      .upsert([...filasBd, ...ceros], { onConflict: "persona_id,anio,mes" });
    if (err) {
      setGuardando(false);
      setError(err.message);
      return;
    }
    await supabase
      .from("meses_retail")
      .update({
        ventas_archivo: archivo,
        ventas_cargado_por: subidoPor,
        ventas_cargado_en: new Date().toISOString(),
        ventas_corte: corte,
        ventas_total: null,
      })
      .eq("anio", destino.anio)
      .eq("mes", destino.mes);
    // Corte de esta fecha: con él se saca lo de cada semana (corte del sábado − el anterior).
    await guardarCorte(
      destino.anio,
      destino.mes,
      "consolidada",
      corte,
      [...filasBd, ...ceros].map((f) => ({ persona_id: f.persona_id, pares: f.pares_venta, acc: f.acc_venta, ropa: f.ropa_venta, unidades: f.unidades })),
      subidoPor,
    );
    // UPT = unidades ÷ TRX solo para quien no tiene el UPT del informe de Xstore.
    await recalcularUpt(destino.anio, destino.mes);
    // Historial: esta carga queda vigente y la anterior, como historial.
    await supabase
      .from("cargas_datos")
      .update({ vigente: false })
      .eq("anio", destino.anio)
      .eq("mes", destino.mes)
      .eq("tipo", "ventas_consolidadas")
      .eq("vigente", true);
    await supabase.from("cargas_datos").insert({
      anio: destino.anio,
      mes: destino.mes,
      tipo: "ventas_consolidadas",
      origen: "pdf", // PDF o fotos: leído con IA
      archivo,
      cargado_por: subidoPor,
      resumen: { corte, pares: totales.pares, acc: totales.acc, ropa: totales.ropa, personas: filasGuardar.length },
    });
    setGuardando(false);
    onGuardado();
  }

  return (
    <Modal titulo="Vista previa de las ventas consolidadas" onClose={onClose} ancho="max-w-5xl">
      <p className="text-[12.5px] text-muted mb-3">
        {data.tienda ? <strong>{data.tienda}</strong> : "Tienda no detectada"}
        {rango ? (
          <>
            {" "}
            · unidades del <strong>{rango[0]}</strong> al <strong>{rango[1]}</strong>
          </>
        ) : null}
        . Se guardarán en <strong>{NOMBRES_MES[destino.mes - 1]} {destino.anio}</strong>. Solo se toman las unidades por
        categoría; la venta en pesos sigue saliendo de los cierres del día.
      </p>
      {graves.map((g, i) => (
        <div key={i} className="mb-2 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs font-semibold">
          ⛔ {g}
        </div>
      ))}
      {graves.length > 0 && (
        <label className="mb-2 flex items-center gap-2 text-[12px]">
          <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
          Entiendo las advertencias y quiero guardar de todos modos.
        </label>
      )}
      {ropaIncongruente && (
        <div className="mb-2 bg-amber-50 border border-amber-300 text-[#8A5A16] rounded-md px-3 py-2 text-xs font-semibold">
          ⚠ Esta tienda está configurada <strong>sin ropa</strong>, pero el informe trae {Math.round(ropaLeida)} prenda(s) de ropa
          vendidas. Hay una incongruencia: si la tienda sí vende ropa, actívala en Personal → Datos de la tienda (o pídeselo al
          administrador) para que tenga meta de ropa; si es un error de lectura, corrige la columna Ropa.
        </div>
      )}
      {avisos.map((a, i) => (
        <div key={i} className="mb-2 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">
          ⚠ {a}
        </div>
      ))}
      <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] bg-paper border border-line rounded-md px-3 py-2">
        <span>Informe: <strong>{data.titulo ?? "—"}</strong></span>
        <span>
          Pares: <strong>{Math.round(totales.pares)}</strong>
        </span>
        <span>
          Accesorios: <strong>{Math.round(totales.acc)}</strong>
        </span>
        {mostrarRopa && (
          <span>
            Ropa: <strong>{Math.round(totales.ropa)}</strong>
          </span>
        )}
        {data.totalUnidades != null && (
          <span>
            Unidades del informe: <strong>{Math.round(data.totalUnidades)}</strong>
          </span>
        )}
      </div>
      <p className="text-[11.5px] text-muted">
        Revisa las cifras contra el informe: <strong>puedes corregir cualquier valor</strong> directamente en la tabla.
      </p>

      <div className="overflow-x-auto border border-line rounded-md mt-2">
        <table className="w-full text-[12px] min-w-[640px]">
          <thead>
            <tr className="text-left text-muted uppercase tracking-wider text-[10.5px] border-b border-line">
              <th className="px-2 py-1.5">CM</th>
              <th className="px-2 py-1.5">Nombre en el reporte</th>
              <th className="px-2 py-1.5 text-right" title="Recuento neto del cuadro Resumen (referencia)">
                Unds
              </th>
              <th className="px-2 py-1.5 text-right">Pares</th>
              <th className="px-2 py-1.5 text-right">Acc</th>
              {mostrarRopa && <th className="px-2 py-1.5 text-right">Ropa</th>}
              <th className="px-2 py-1.5">Persona registrada</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(({ e, p, mando, vendio }, i) => {
              // Filas sin venta y sin persona conocida (ex empleados) se ocultan para no ensuciar, y
              // también las cuentas de la tienda (9999 / 989999) que no están asignadas a nadie.
              if (!p && !asignado[i] && (!vendio || e.cuentaTienda)) return null;
              const sel = asignado[i] ? personal.find((x) => x.id === asignado[i]) : undefined;
              const suma = (num(i, "pares", e.pares) ?? 0) + (num(i, "acc", e.acc) ?? 0) + (num(i, "ropa", e.ropa) ?? 0);
              const descuadra = e.unidades != null && e.pares != null && Math.abs(suma - e.unidades) >= 1;
              return (
                <tr
                  key={e.cm}
                  className={
                    "border-b border-line/60 last:border-0 align-top " +
                    (mando ? "bg-neutral-100/70 text-muted" : !p && !asignado[i] ? "bg-warn-soft/50" : "")
                  }
                >
                  <td className="px-2 py-1.5 font-mono">{e.cm}</td>
                  <td className="px-2 py-1.5">{e.nombre}</td>
                  <td
                    className={"px-2 py-1.5 text-right font-mono " + (descuadra ? "text-warn font-semibold" : "text-muted")}
                    title={descuadra ? `Pares + accesorios + ropa = ${suma}` : undefined}
                  >
                    {e.unidades != null ? Math.round(e.unidades) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right">{campo(i, "pares", e.pares)}</td>
                  <td className="px-2 py-1.5 text-right">{campo(i, "acc", e.acc)}</td>
                  {mostrarRopa && <td className="px-2 py-1.5 text-right">{campo(i, "ropa", e.ropa)}</td>}
                  <td className="px-2 py-1.5">
                    {mando ? (
                      <span className="text-[11px]">Jefe / subjefe: audita, no se registra.</span>
                    ) : (
                      <>
                        <select
                          value={asignado[i]}
                          onChange={(ev) => setAsignado((a) => ({ ...a, [i]: ev.target.value }))}
                          className={inputCls + " w-full py-1 " + (asignado[i] ? "" : "border-amber-400 bg-amber-50")}
                        >
                          <option value="">— No importar —</option>
                          {registrables.map((r) => (
                            <option
                              key={r.id}
                              value={r.id}
                              disabled={asignadas.has(r.id) && asignado[i] !== r.id}
                            >
                              {r.codigo ?? "sin CM"} — {r.nombre}
                            </option>
                          ))}
                        </select>
                        <div className={"text-[10.5px] mt-0.5 " + (p ? "text-operaciones" : "text-warn")}>
                          {p
                            ? `✓ CM ${e.cm} coincide con ${p.nombre}`
                            : sel
                              ? `⚠ CM del reporte ${e.cm} ≠ CM Personal ${sel.codigo ?? "sin CM"} (asignada a mano)`
                              : `⛔ El CM ${e.cm} no está registrado en Personal`}
                        </div>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sinVentaIgnoradas > 0 && (
        <p className="text-[11.5px] text-muted mt-1.5">
          {sinVentaIgnoradas} fila(s) sin ventas de personas que no están en Personal se omiten.
        </p>
      )}
      {conVentaSinAsignar > 0 && (
        <p className="text-[12px] text-[#8A5A16] mt-1.5">
          {conVentaSinAsignar} fila(s) con ventas sin asignar no se importarán.
        </p>
      )}
      {faltan.length > 0 && (
        <div className="mt-2 text-[12px] bg-amber-50 border border-amber-300 text-[#8A5A16] rounded-md px-3 py-2">
          <strong>Personas del equipo que no salen en el reporte:</strong> {faltan.map((p) => p.nombre).join(", ")}.
          Se guardarán con 0 unidades (no vendieron en el periodo). Si alguna sí vendió, asígnale su fila arriba.
        </div>
      )}
      {error && (
        <div className="mt-3 bg-warn-soft text-warn border border-warn-border rounded-md px-3 py-2 text-xs">{error}</div>
      )}
      <button
        type="button"
        onClick={guardar}
        disabled={guardando}
        className="mt-4 w-full py-2.5 bg-brand text-white rounded-md font-semibold text-sm disabled:opacity-50 hover:bg-brand-light"
      >
        {guardando
          ? "Guardando…"
          : `Guardar unidades de ${asignadas.size} persona(s)${corte ? ` hasta el ${corte}` : ""}`}
      </button>
    </Modal>
  );
}
