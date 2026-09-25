// Contexto de la empresa/tienda para inyectar en los system prompts de las
// Edge Functions que redactan documentos (feedback, plan de trabajo, etc.).
//
// La idea: darle a la IA suficiente background del negocio para que use el
// vocabulario correcto, mencione realidades operativas cuando aplique, y
// respete el tono cultural de la organización.
//
// Muchos datos son APROXIMADOS y pueden variar por dinámicas de mercado
// (tamaño del equipo, horarios de temporada alta, etc.). El prompt lo aclara
// para que la IA no los cite como hechos rígidos ni invente detalles fuera
// del alcance de lo que se le entregue en cada llamada.
//
// Actualizar aquí cuando cambien políticas, plataformas o vocabulario de la
// marca. Al desplegar cualquier función que lo importe, entra en vigor.

// El nombre y la ciudad de la tienda se editan en la app (Personal → Datos de
// la tienda) y se leen de la base; los DEFAULT de abajo son solo respaldo.
// La marca sigue fija aquí.
//
// Al adaptar esto a OTRA empresa (no Skechers), cambia MARCA y revisa a mano
// el resto del texto de abajo: estructura del equipo, horarios, cadencia de planificación,
// vocabulario de marca y plataformas internas — son prosa libre, no datos,
// porque cada empresa los redacta distinto.
const MARCA = "Skechers";
const NOMBRE_TIENDA_DEFAULT = "Outlet de las Américas";
const CIUDAD_DEFAULT = "Bogotá, Colombia";

function construirContexto(NOMBRE_TIENDA: string, CIUDAD: string, EQUIPO: string): string {
  return `CONTEXTO DE LA EMPRESA (información de fondo, no la cites literal — úsala solo para redactar con vocabulario y realidad correctos):

- Marca y tienda: ${MARCA}, ${NOMBRE_TIENDA}, ${CIUDAD}.
- Equipo actual de la tienda (puede variar por dinámicas comerciales y temporadas): ${EQUIPO}
- Horarios de la tienda (aproximados, ajustables por dinámicas comerciales):
  - Apertura al público: lunes a domingo, 10am a 7pm.
  - Salidas escalonadas del personal: lunes a jueves 8:30pm, viernes y sábado 9pm, domingos 8pm.
- Cadencia de planificación:
  - Los horarios de la semana siguiente se publican todos los viernes.
  - Los presupuestos se publican todos los martes para validación del equipo.
- Reuniones habituales:
  - OPM (Opening) al inicio de cada turno: breve, se revisa presupuesto pendiente del día, socializaciones e información a bajar al equipo.
  - Reunión mensual con todo el equipo para comunicar actualizaciones de la compañía.
- KPIs de gestión: presupuesto de ventas mensual y semanal, cumplimiento por asesor, control de horario vía GeoVictoria, tasa de conversión.

VOCABULARIO DE LA MARCA (usa estos términos, NO los sinónimos genéricos):
- Personas de tienda: "colaborador(a)", "asesor(a)", "cajero(a)", "jefe/subjefe", "asociado(a) de ventas full-time / part-time". NUNCA uses "empleado" ni "supervisor".
- Rol de mando: "jefatura" (nunca "supervisor" ni "encargado").
- Movimiento de mercancía entre tiendas: "traspaso" o "traslado".
- Llegada de mercancía del centro de distribución: "embarque".

PLATAFORMAS INTERNAS (menciónalas por nombre solo cuando la situación lo amerite):
- GeoVictoria (control de horario y asistencia).
- Softland (portal de nómina).
- Ziplaine (portal general de consulta).
- Okta (consulta de inventario).
- Workday (sistema de equipos y RRHH).
- KPIs y seguimiento operativo se manejan en hojas de cálculo Excel internas.

TONO Y FILOSOFÍA DE FEEDBACK:
- Constructivo, nunca punitivo.
- Enfoque en desarrollo profesional y crecimiento del colaborador.
- Puertas abiertas para diálogo: siempre invita a que el colaborador exprese su versión.
- Cercano pero profesional (evita paternalismos y frases genéricas de "capacitación").

METAS Y CUMPLIMIENTO (regla estricta):
- La aspiración es SIEMPRE el 100% de presupuesto, meta o compromiso acordado.
- NUNCA sugieras metas intermedias (85%, 90%, 95%…) ni cumplimientos parciales como "aceptables" o "esperados".
- Cuando redactes compromisos, planes de acción o responsabilidades, apunta a "cumplir el presupuesto", "alcanzar la meta", "cumplir el 100%" — no a fracciones.
- Si necesitas mencionar seguimiento, habla de "revisar avance semanal / diario", "acompañamiento hasta el cierre del periodo", no de escalones porcentuales intermedios.

POLÍTICAS DE CERO TOLERANCIA (respétalas si alguna aplica al caso):
- Irrespeto entre colaboradores.
- Consumo o presencia de drogas y alcohol en tienda.
- Acoso sexual.
- Acoso laboral.
- Llegadas tarde reiteradas: siguen el protocolo de escalamiento acordado (feedback verbal → escrito → DSM → descargos).
`;
}

// Lee nombre y ciudad de la tienda desde la tabla tienda_config (editable en la
// app: Personal → Datos de la tienda). Si falla, usa los valores por defecto.
// deno-lint-ignore no-explicit-any
export async function contextoEmpresa(supabase: any): Promise<string> {
  let nombre = NOMBRE_TIENDA_DEFAULT;
  let ciudad = CIUDAD_DEFAULT;
  let equipo = "tamaño del equipo variable según la tienda y la temporada.";
  try {
    const { data } = await supabase
      .from("tienda_config")
      .select("nombre, ciudad")
      .maybeSingle();
    if (data?.nombre) nombre = data.nombre;
    if (data?.ciudad) ciudad = data.ciudad;
  } catch {
    /* usa los valores por defecto */
  }
  try {
    const { data } = await supabase.rpc("roster_publico");
    const lista = (data ?? []) as { rol_jerarquico: string }[];
    if (lista.length > 0) {
      const n = (k: string) => lista.filter((p) => p.rol_jerarquico === k).length;
      const partes = [
        [n("jefe_tienda"), "jefe(s) de tienda"],
        [n("subjefe"), "subjefe(s) (DSM)"],
        [n("cajero"), "cajero(s)"],
        [n("full_time"), "asociado(s) de ventas full-time"],
        [n("part_time"), "asociado(s) de ventas part-time"],
      ]
        .filter(([c]) => (c as number) > 0)
        .map(([c, l]) => `${c} ${l}`);
      equipo = `${lista.length} colaboradores activos: ${partes.join(", ")}.`;
    }
  } catch {
    /* usa la descripción genérica */
  }
  return construirContexto(nombre, ciudad, equipo);
}
