"use client";

// Lee la hoja "Kpis mensual" del planeador de la tienda (cuadro de KPIs por
// asesor): presupuesto, acumulado bruto/neto, %, pares / accesorios / ropa
// (meta y venta), unidades, transacciones, UPT y horas trabajadas.
//
// Las columnas se ubican por ETIQUETA (no por posición fija). En el archivo
// varias etiquetas están combinadas (p. ej. PARES ocupa dos columnas: M y V),
// así que "meta" es la primera columna del grupo y "venta" la siguiente.
//
// IDENTIFICACIÓN DE LA PERSONA. La hoja de KPIs trae solo el nombre de pila,
// que es ambiguo. Para identificar al asesor con exactitud se usa el CM
// (código de empleado):
//   1. Si la propia fila de KPIs trae CM, se cruza con el código de Personal.
//   2. Si no, se busca el nombre en la hoja "Plantilla" del mismo archivo
//      (colaborador, cédula, cargo, CM) y de ahí se cruza el CM y la cédula
//      con Personal.
//   3. Solo como último recurso se compara el nombre y queda marcado para
//      que jefatura lo verifique.
// Si el CM del archivo contradice al de Personal (o el nombre no cuadra con
// quien tiene ese CM), la fila NO se asigna sola: queda con una alerta.

import ExcelJS from "exceljs";
import { NOMBRES_MES } from "./horarios";

export type PersonaMatch = {
  id: string;
  nombre: string;
  cedula: string | null;
  codigo: string | null; // CM / ID de empleado
  activo: boolean;
  cargo?: string;
  rol_jerarquico?: string;
};

/** Jefe de tienda y subjefes auditan: no se les registran KPIs ni compiten. */
export const esMandoPersona = (p: Pick<PersonaMatch, "rol_jerarquico">): boolean =>
  p.rol_jerarquico === "jefe_tienda" || p.rol_jerarquico === "subjefe";

export type AlertaKpi = { nivel: "error" | "aviso"; texto: string };

export type MetodoIdentificacion = "cm" | "plantilla" | "nombre" | "ninguno";

export type FilaKpiExcel = {
  cargoExcel: string;
  nombreExcel: string;
  cmExcel: string | null;
  presupuesto: number | null;
  acumuladoBruto: number | null;
  acumuladoNeto: number | null;
  cumplimiento: number | null;
  paresMeta: number | null;
  paresVenta: number | null;
  accMeta: number | null;
  accVenta: number | null;
  ropaMeta: number | null;
  ropaVenta: number | null;
  unidades: number | null;
  trx: number | null;
  upt: number | null;
  horas: number | null;
  // Resultado de la identificación
  cmResuelto: string | null; // CM usado para identificar (de la fila o de la Plantilla)
  omitir: boolean; // jefe o subjefe: audita, no se registra
  personaId: string | null; // asignación automática (solo si es confiable)
  sugeridoId: string | null; // candidato cuando hay alertas
  metodo: MetodoIdentificacion;
  alertas: AlertaKpi[];
};

export type PlantillaFila = { nombre: string; cedula: string; cargo: string; cm: string };

export type KpisMensualParsed = {
  hoja: string;
  mesDetectado: number | null; // 1..12 según el título de la hoja (solo hoja mensual)
  semanaNumero: number | null; // p. ej. 36 en "SEMANA 36" (solo hoja semanal)
  presupuestoTotal: number | null; // "Presupuesto MES" de la cabecera
  horasTotal: number | null; // "Horas Laboradas"
  ventaPorHora: number | null; // "vta x hora x persona"
  filas: FilaKpiExcel[];
  plantilla: PlantillaFila[];
};

const norm = (v: unknown): string =>
  (v == null ? "" : String(v))
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

const soloDigitos = (v: unknown): string => String(v ?? "").replace(/\D/g, "");

const tokens = (s: string): string[] =>
  norm(s)
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter((t) => t.length > 2);

function valorCelda(cell: ExcelJS.Cell): unknown {
  let v: unknown = cell.value;
  if (v && typeof v === "object" && "result" in v) v = (v as { result?: unknown }).result;
  if (v && typeof v === "object" && "richText" in v) {
    v = (v as { richText: Array<{ text: string }> }).richText.map((t) => t.text).join("");
  }
  return v;
}

function numero(v: unknown): number | null {
  return typeof v === "number" && isFinite(v) ? v : null;
}

/** Lee la hoja "Plantilla" (colaborador, cédula, cargo, CM) si existe. */
function leerPlantilla(wb: ExcelJS.Workbook): PlantillaFila[] {
  const hoja = wb.worksheets.find((w) => norm(w.name).includes("plantilla"));
  if (!hoja) return [];
  let cNombre = 0;
  let cCedula = 0;
  let cCargo = 0;
  let cCm = 0;
  let filaHeader = 0;
  hoja.eachRow({ includeEmpty: false }, (row, n) => {
    if (filaHeader) return;
    for (let c = 1; c <= hoja.columnCount; c++) {
      const e = norm(valorCelda(row.getCell(c)));
      if (e === "colaborador" || e === "nombre") cNombre = c;
      else if (e === "cedula") cCedula = c;
      else if (e === "cargo") cCargo = c;
      else if (e === "cm" || e === "codigo") cCm = c;
    }
    if (cNombre && cCm) filaHeader = n;
  });
  if (!filaHeader) return [];
  const out: PlantillaFila[] = [];
  for (let n = filaHeader + 1; n <= hoja.rowCount; n++) {
    const row = hoja.getRow(n);
    const nombre = String(valorCelda(row.getCell(cNombre)) ?? "").trim();
    if (!nombre) continue;
    out.push({
      nombre,
      cedula: cCedula ? soloDigitos(valorCelda(row.getCell(cCedula))) : "",
      cargo: cCargo ? String(valorCelda(row.getCell(cCargo)) ?? "").trim() : "",
      cm: soloDigitos(valorCelda(row.getCell(cCm))),
    });
  }
  return out;
}

// ---------- Identificación de la persona ----------

function porNombre(nombre: string, roster: PersonaMatch[]): PersonaMatch | null {
  const det = tokens(nombre);
  if (det.length === 0) return null;
  let mejor: PersonaMatch | null = null;
  let mejorScore = 0;
  let empate = false;
  for (const p of roster) {
    const score = tokens(p.nombre).filter((t) => det.includes(t)).length;
    if (score > mejorScore) {
      mejorScore = score;
      mejor = p;
      empate = false;
    } else if (score === mejorScore && score > 0) {
      empate = true;
    }
  }
  return empate ? null : mejor;
}

function identificarBase(
  fila: Pick<FilaKpiExcel, "nombreExcel" | "cmExcel">,
  plantilla: PlantillaFila[],
  roster: PersonaMatch[],
): Pick<FilaKpiExcel, "personaId" | "sugeridoId" | "metodo" | "alertas"> & {
  cargoPlantilla: string;
} {
  const alertas: AlertaKpi[] = [];
  const tokNombre = tokens(fila.nombreExcel);
  const porCodigo = (cm: string) => roster.find((p) => soloDigitos(p.codigo) === cm && cm !== "");
  const porCedula = (ced: string) => roster.find((p) => soloDigitos(p.cedula) === ced && ced !== "");
  const nombreCuadra = (p: PersonaMatch) => {
    const t = tokens(p.nombre);
    return tokNombre.length === 0 || tokNombre.every((x) => t.includes(x));
  };

  // Si el CM no viene en la fila, se busca por nombre en la Plantilla.
  let cm = soloDigitos(fila.cmExcel);
  let cedulaPlantilla = "";
  let cargoPlantilla = "";
  let metodo: MetodoIdentificacion = cm ? "cm" : "ninguno";
  if (!cm && plantilla.length > 0) {
    const cand = plantilla.filter((p) => {
      const t = tokens(p.nombre);
      return tokNombre.length > 0 && tokNombre.every((x) => t.includes(x));
    });
    if (cand.length === 1) {
      cm = cand[0].cm;
      cedulaPlantilla = cand[0].cedula;
      cargoPlantilla = cand[0].cargo;
      metodo = "plantilla";
    } else if (cand.length > 1) {
      alertas.push({
        nivel: "error",
        texto: `El nombre "${fila.nombreExcel.trim()}" coincide con ${cand.length} personas de la hoja Plantilla (${cand
          .map((c) => c.nombre)
          .join(", ")}). Agrega el CM en la fila o asígnala a mano.`,
      });
    } else {
      alertas.push({
        nivel: "aviso",
        texto: `"${fila.nombreExcel.trim()}" no aparece en la hoja Plantilla del archivo.`,
      });
    }
  }

  // 1) Con CM: cruce exacto contra el código de empleado de Personal.
  if (cm) {
    const pCm = porCodigo(cm);
    const pCed = cedulaPlantilla ? porCedula(cedulaPlantilla) : undefined;
    if (pCm) {
      // Nombre escrito distinto pero parecido (p. ej. "Dayana" vs "Dayanna"): el CM manda, solo se avisa.
      const parecido = () => {
        const t = tokens(pCm.nombre);
        return tokNombre.some((x) => t.some((y) => x.slice(0, 4) === y.slice(0, 4)));
      };
      if (!nombreCuadra(pCm) && parecido()) {
        alertas.push({
          nivel: "aviso",
          texto: `El CM ${cm} es de ${pCm.nombre}; el Excel escribe "${fila.nombreExcel.trim()}" (nombre parecido). Se asignó por el CM.`,
        });
      } else if (!nombreCuadra(pCm)) {
        alertas.push({
          nivel: "error",
          texto: `El CM ${cm} pertenece a ${pCm.nombre}, pero el Excel dice "${fila.nombreExcel.trim()}". Revisa cuál de los dos está mal.`,
        });
        return { personaId: null, sugeridoId: pCm.id, metodo, alertas, cargoPlantilla };
      }
      if (pCed && pCed.id !== pCm.id) {
        alertas.push({
          nivel: "error",
          texto: `El CM ${cm} es de ${pCm.nombre} pero la cédula de la Plantilla es de ${pCed.nombre}.`,
        });
        return { personaId: null, sugeridoId: pCm.id, metodo, alertas, cargoPlantilla };
      }
      return { personaId: pCm.id, sugeridoId: pCm.id, metodo, alertas, cargoPlantilla };
    }
    // El CM no está registrado en Personal: se intenta por cédula y se avisa.
    if (pCed) {
      alertas.push({
        nivel: "error",
        texto: `El CM ${cm} del archivo no coincide con el código de ${pCed.nombre} en Personal (${
          pCed.codigo ? pCed.codigo : "sin código registrado"
        }). Corrige el código en Personal o el CM del Excel.`,
      });
      return { personaId: null, sugeridoId: pCed.id, metodo, alertas, cargoPlantilla };
    }
    const pNom = porNombre(fila.nombreExcel, roster);
    alertas.push({
      nivel: "error",
      texto: `El CM ${cm} no está registrado en Personal${pNom ? `; ¿será ${pNom.nombre}?` : "."}`,
    });
    return { personaId: null, sugeridoId: pNom?.id ?? null, metodo, alertas, cargoPlantilla };
  }

  // 2) Sin CM disponible: solo por nombre, y se deja marcado para verificar.
  const pNom = porNombre(fila.nombreExcel, roster);
  if (pNom) {
    alertas.push({
      nivel: "aviso",
      texto: "Identificada solo por nombre (sin CM). Verifica que sea la persona correcta.",
    });
    return { personaId: pNom.id, sugeridoId: pNom.id, metodo: "nombre", alertas, cargoPlantilla };
  }
  alertas.push({ nivel: "error", texto: "No se pudo identificar a la persona." });
  return { personaId: null, sugeridoId: null, metodo: "ninguno", alertas, cargoPlantilla };
}

function identificar(
  fila: Pick<FilaKpiExcel, "nombreExcel" | "cmExcel">,
  plantilla: PlantillaFila[],
  roster: PersonaMatch[],
) {
  const r = identificarBase(fila, plantilla, roster);
  let cmResuelto = soloDigitos(fila.cmExcel) || null;
  if (!cmResuelto && r.metodo === "plantilla") {
    const tok = tokens(fila.nombreExcel);
    const cand = plantilla.filter((p) => tok.every((x) => tokens(p.nombre).includes(x)));
    if (cand.length === 1) cmResuelto = cand[0].cm || null;
  }
  return { ...r, cmResuelto };
}

// ---------- Validación de los números ----------

function validarNumeros(f: FilaKpiExcel): AlertaKpi[] {
  const a: AlertaKpi[] = [];
  const pto = f.presupuesto;
  const neto = f.acumuladoNeto;
  if (pto == null || pto <= 0) a.push({ nivel: "error", texto: "Sin presupuesto del mes." });
  if (neto == null) a.push({ nivel: "error", texto: "Sin venta neta." });
  if (pto && neto != null && f.cumplimiento != null) {
    const calc = neto / pto;
    if (Math.abs(calc - f.cumplimiento) > 0.015) {
      a.push({
        nivel: "aviso",
        texto: `El % del Excel (${Math.round(f.cumplimiento * 100)}%) no coincide con venta neta / presupuesto (${Math.round(
          calc * 100,
        )}%). Se usará ${Math.round(calc * 100)}%.`,
      });
    }
  }
  if (f.acumuladoBruto != null && neto != null && neto > f.acumuladoBruto * 1.001) {
    a.push({ nivel: "aviso", texto: "La venta neta es mayor que la bruta." });
  }
  if (f.unidades != null && f.trx != null && f.trx > 0 && f.upt != null) {
    const calc = f.unidades / f.trx;
    if (Math.abs(calc - f.upt) > 0.06) {
      a.push({
        nivel: "aviso",
        texto: `El UPT del Excel (${f.upt.toFixed(2)}) no coincide con unidades / transacciones (${calc.toFixed(2)}).`,
      });
    }
  }
  if (f.cumplimiento != null && f.cumplimiento > 2.5) {
    a.push({ nivel: "aviso", texto: "Cumplimiento fuera de lo normal (más de 250%)." });
  }
  if ([pto, neto, f.unidades, f.trx, f.horas].some((v) => v != null && v < 0)) {
    a.push({ nivel: "error", texto: "Hay valores negativos." });
  }
  if (f.horas == null || f.horas <= 0) a.push({ nivel: "aviso", texto: "Sin horas trabajadas." });
  return a;
}

export async function leerKpisMensualDesdeArchivo(
  file: File | ArrayBuffer,
  roster: PersonaMatch[],
  tipo: "mensual" | "semanal" = "mensual",
): Promise<KpisMensualParsed | { error: string }> {
  const buffer = file instanceof File ? await file.arrayBuffer() : file;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const hoja = wb.worksheets.find((w) => {
    const n = norm(w.name);
    return n.includes("kpi") && n.includes(tipo === "mensual" ? "mensual" : "semanal");
  });
  if (!hoja) {
    return {
      error: `No encontré la hoja "Kpis ${tipo}". Hojas del archivo: ${wb.worksheets
        .map((w) => w.name)
        .join(", ")}.`,
    };
  }

  // Fila de encabezado: tiene "PTO" y "ACUMULADO BRUTO".
  let filaHeader = -1;
  hoja.eachRow({ includeEmpty: false }, (row, n) => {
    if (filaHeader >= 0) return;
    const etiquetas: string[] = [];
    for (let c = 1; c <= hoja.columnCount; c++) etiquetas.push(norm(valorCelda(row.getCell(c))));
    if (etiquetas.includes("pto") && etiquetas.some((e) => e.includes("acumulado bruto"))) {
      filaHeader = n;
    }
  });
  if (filaHeader < 0) {
    return { error: 'No encontré el encabezado del cuadro de KPIs ("PTO", "ACUMULADO BRUTO").' };
  }

  const etiquetas: string[] = [];
  for (let c = 1; c <= hoja.columnCount; c++) {
    etiquetas.push(norm(valorCelda(hoja.getRow(filaHeader).getCell(c))));
  }
  const primera = (pred: (e: string) => boolean): number => etiquetas.findIndex(pred) + 1;

  const cNombre = etiquetas.lastIndexOf("nombre") + 1; // celdas combinadas A:B → la última es el nombre
  const cCargo = primera((e) => e === "nombre"); // la primera columna del grupo trae el cargo
  const cCm = primera((e) => e === "cm" || e === "codigo" || e === "cod" || e === "id");
  const cPto = primera((e) => e === "pto");
  const cBruto = primera((e) => e.includes("acumulado bruto"));
  const cNeto = primera((e) => e.includes("acumulado neto"));
  const cPct = primera((e) => e === "%");
  const cPares = primera((e) => e.includes("pares"));
  const cAcc = primera((e) => e === "acc");
  const cRopa = primera((e) => e === "ropa");
  const cUnds = primera((e) => e.includes("unds"));
  const cTrx = primera((e) => e === "trx");
  const cUpt = primera((e) => e === "upt");
  const cHoras = primera((e) => e.includes("horas trabajadas"));
  if (cNombre <= 0 || cPto <= 0 || cNeto <= 0) {
    return { error: "El cuadro de KPIs no tiene las columnas esperadas (NOMBRE, PTO, ACUMULADO NETO)." };
  }

  // Cabecera de la hoja (encima del cuadro): presupuesto, horas y venta por hora.
  const cabecera: { presupuestoTotal: number | null; horasTotal: number | null; ventaPorHora: number | null } = {
    presupuestoTotal: null,
    horasTotal: null,
    ventaPorHora: null,
  };
  for (let n = 1; n < filaHeader; n++) {
    const row = hoja.getRow(n);
    const et = norm(valorCelda(row.getCell(1)));
    let v: number | null = null;
    for (let c = 2; c <= Math.min(hoja.columnCount, 6) && v == null; c++) v = numero(valorCelda(row.getCell(c)));
    if (v == null) continue;
    if (et.startsWith("presupuesto")) cabecera.presupuestoTotal = v;
    else if (et.startsWith("horas laboradas")) cabecera.horasTotal = v;
    else if (et.includes("vta x hora")) cabecera.ventaPorHora = v;
  }

  const plantilla = leerPlantilla(wb);
  const filas: FilaKpiExcel[] = [];
  const ultima = hoja.rowCount;
  // +1 = fila de subencabezado (M / V); los datos empiezan en +2.
  for (let n = filaHeader + 2; n <= ultima; n++) {
    const row = hoja.getRow(n);
    const nombre = String(valorCelda(row.getCell(cNombre)) ?? "").trim();
    if (!nombre) continue;
    if (norm(nombre) === "total") break;
    const num = (c: number) => (c > 0 ? numero(valorCelda(row.getCell(c))) : null);
    const pto = num(cPto);
    const neto = num(cNeto);
    if (pto == null && neto == null) continue;

    const cmCelda = cCm > 0 ? soloDigitos(valorCelda(row.getCell(cCm))) : "";
    const base = {
      cargoExcel: String(valorCelda(row.getCell(cCargo)) ?? "").trim(),
      nombreExcel: nombre,
      cmExcel: cmCelda || null,
      presupuesto: pto,
      acumuladoBruto: num(cBruto),
      acumuladoNeto: neto,
      cumplimiento: num(cPct),
      paresMeta: num(cPares),
      paresVenta: cPares > 0 ? num(cPares + 1) : null,
      accMeta: num(cAcc),
      accVenta: cAcc > 0 ? num(cAcc + 1) : null,
      ropaMeta: num(cRopa),
      ropaVenta: cRopa > 0 ? num(cRopa + 1) : null,
      unidades: num(cUnds),
      trx: num(cTrx),
      upt: num(cUpt),
      horas: num(cHoras),
    };
    const { cargoPlantilla, ...id } = identificar(base, plantilla, roster);
    void cargoPlantilla;
    const persona = roster.find((p) => p.id === (id.personaId ?? id.sugeridoId));
    // Jefe de tienda y subjefes auditan: no se registran (se detecta por el cargo
    // del Excel, el de la Plantilla o el rol de la persona identificada).
    const omitir =
      /jefe/i.test(base.cargoExcel) || /jefe/i.test(cargoPlantilla) || (persona ? esMandoPersona(persona) : false);
    if (omitir) {
      filas.push({
        ...base,
        ...id,
        omitir: true,
        personaId: null,
        sugeridoId: null,
        alertas: [],
      });
      continue;
    }
    const fila: FilaKpiExcel = { ...base, ...id, omitir: false };
    fila.alertas = [...fila.alertas, ...validarNumeros(fila)];
    filas.push(fila);
  }
  if (filas.length === 0) return { error: "No encontré filas de asesores en el cuadro de KPIs." };

  // Dos filas del Excel que apuntan a la misma persona: no se asignan solas.
  const usadas = new Map<string, number[]>();
  filas.forEach((f, i) => {
    if (f.personaId && !f.omitir) usadas.set(f.personaId, [...(usadas.get(f.personaId) ?? []), i]);
  });
  usadas.forEach((idxs) => {
    if (idxs.length > 1) {
      idxs.forEach((i) => {
        filas[i].alertas.push({
          nivel: "error",
          texto: "Otra fila del Excel se identificó como la misma persona. Revisa el CM o el nombre.",
        });
        filas[i].personaId = null;
      });
    }
  });

  // Mes: el título de la hoja (celda A1, p. ej. "SEPTIEMBRE").
  const titulo = norm(valorCelda(hoja.getCell("A1")));
  const idx = NOMBRES_MES.findIndex((m) => titulo.includes(norm(m)));
  // Semana: "SEMANA 36" → 36.
  const mSem = titulo.match(/semana\s*(\d+)/);

  return {
    hoja: hoja.name,
    mesDetectado: tipo === "mensual" && idx >= 0 ? idx + 1 : null,
    semanaNumero: mSem ? Number(mSem[1]) : null,
    ...cabecera,
    filas,
    plantilla,
  };
}
