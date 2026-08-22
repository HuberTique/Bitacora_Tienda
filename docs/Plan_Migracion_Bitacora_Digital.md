# Plan de migración — Bitácora Digital → Aplicación real

**De:** artifact de Claude.ai (HTML/JS de un solo archivo)
**A:** aplicación web real, en dos etapas: MVP gratuito para validar → producción si la empresa aprueba
**Herramienta de construcción:** Claude Code
**Idioma/stack:** JavaScript/TypeScript de punta a punta (decisión tomada — ver sección 7)

---

## 0. Contexto y estrategia (por qué el plan tiene dos etapas)

Este proyecto se está construyendo sin retribución económica de la empresa, con el objetivo de generar un caso de estudio real (experiencia + portafolio para ofrecer soluciones a la medida a futuro). Por eso el plan se divide en:

- **Etapa A — MVP de validación**: cero costo, cien por ciento bajo tu control personal, listo para adjuntar a un correo y que la empresa decida si quiere avanzar. Si dicen que no, no perdiste nada.
- **Etapa B — Producción real**: solo se activa si la empresa aprueba y se aclaran por escrito los puntos de propiedad (código, dominio, datos) mencionados en la sección 8. Aquí sí entran los hostings pagos y el dominio propio.

---

## 1. Etapa A — MVP de validación (costo: $0)

| Pieza | Elección | Por qué |
|---|---|---|
| Hosting del frontend | **GitHub Pages** | Gratis, sin tarjeta, y queda 100% en tu cuenta personal — cero ambigüedad de propiedad si la respuesta es negativa |
| Backend / base de datos | **Supabase (plan gratis)** | 500 MB de base de datos y 50,000 usuarios activos al mes — de sobra para una tienda con ~30 personas |
| Next.js en modo | **Exportación estática** (`next export`) | GitHub Pages solo sirve archivos, no puede correr un servidor. En este modo Next.js genera un sitio 100% estático, y toda la lógica (login, guardar datos, tiempo real) corre directo desde el navegador hacia Supabase — no se pierde funcionalidad real para esta app |
| Dominio | El que da GitHub por defecto (`tuusuario.github.io/bitacora-tienda`) | No hace falta comprar nada para esta etapa |
| Resultado | Una URL fija, con login real, base de datos real, actualización en tiempo real entre usuarios — suficiente para que la empresa la pruebe de verdad, no una maqueta |

---

## 2. Etapa B — Producción real (si la empresa aprueba)

Solo se activa después de resolver la sección 8 (propiedad del código/dominio).

| Pieza | Elección | Costo aprox. |
|---|---|---|
| Hosting del frontend | **Vercel Pro** (mejor rendimiento con Next.js, elección por defecto) o **Railway** (más barato, un poco más de configuración) | Vercel: $20/mes · Railway: $8-15/mes |
| Backend / base de datos | **Supabase Pro** (si se necesitan respaldos automáticos o más espacio; el plan gratis puede seguir alcanzando) | $0-25/mes |
| Dominio propio | Comprado **a tu nombre personal**, no de la empresa (ver sección 8) | ~$10-15 USD/año |
| **Total estimado** | | **~$20-45 USD/mes**, con posibilidad de quedar en $10-15/mes si se elige Railway |

### Comparativa de hosting (para cuando llegue el momento de elegir)

| Plataforma | Precio | A favor | En contra |
|---|---|---|---|
| Vercel | $20/mes/asiento (Pro) | El mejor rendimiento con Next.js, mismo equipo que lo desarrolla | Plan gratis no está pensado para uso comercial |
| Netlify | $19/mes/usuario (Pro) | ~30% más barato en ancho de banda que Vercel | Un poco menos optimizado para Next.js específicamente |
| Railway | Pago por uso real (~$8-15/mes típico) | El más barato para este tamaño de app, sin cobro por asiento | Un poco más de configuración manual |
| Cloudflare Pages | Ancho de banda gratis e ilimitado | El más barato si la app crece en tráfico | Next.js requiere algunos ajustes adicionales |

---

## 3. Inventario de lo que ya existe (para no perder nada en la migración)

### 3.1 Módulos funcionales
- **Bitácora** — tablero de pendientes por área, con evidencia adjunta y comentarios.
- **Feedbacks** — matriz de faltas con escalamiento automático, lectura de llegadas tarde desde imagen (IA), generación de PDF de feedback y de **Plan de Trabajo** sobre plantillas oficiales.
- **Requerimientos** — calendario de días libres/permisos con flujo de aprobación y notificaciones.
- **Reportes** — presupuesto por asesor, registro diario de ventas, gráficas de cumplimiento.
- **Configuración**
  - **Personal** — roster con cédula, ID de empleado, cargo, rol, baja/reactivación.
  - **Horarios** — generador automático (reglas de 42h/25h por rol, domingos/sábados pegados según jefatura vs. cajeros, disponibilidad individual por estudio), export a Excel con el formato exacto de la plantilla de tienda.
  - **Presupuestos** — parsers de Target/KPIS SEM/KPIS DIA/KPIS MEN/RepVenta, motor de distribución de presupuesto por rol, KPIS Diario/Semanal/Mensual, lector de reportes de ventas por empleado (IA).
  - **Faltas y reglamentos** — matriz de faltas configurable, plataformas de gestión por área.
- **Notificaciones** — campana con badge, para ambos roles.
- **Asistente** — chat con IA por asesor, con contexto de sus propios datos.

### 3.2 Modelo de datos actual (`STATE`) → tablas de Supabase (Postgres)

| Clave en `STATE` | Tabla en Supabase |
|---|---|
| `roster` | `personal` |
| `pendientes` | `pendientes` |
| `retardos` | `feedbacks` |
| `faltasConfig` | `config_faltas` |
| `plataformas` | `plataformas` |
| `reglamentos` | `reglamentos` |
| `presupuestos` | `presupuestos_mes` |
| `horarios` | `horarios` |
| `requerimientos` | `requerimientos` |
| `diasBloqueados` | `dias_bloqueados` |
| `ventasDiarias` | `ventas_diarias` |
| `notificaciones` | `notificaciones` |
| `kpisDiario` | `kpis_diario` |
| `idReasignaciones` | `id_reasignaciones` |
| `planesDeTrabajo` | `planes_trabajo` |
| `disponibilidadPT` | `disponibilidad_pt` |

Las fotos de evidencia y los PDF generados, que hoy viven codificados como texto dentro de los datos, pasan a **Supabase Storage** (almacenamiento de archivos real).

### 3.3 Lo que se traslada casi sin tocar (lógica pura en JavaScript)
- Motor de distribución de presupuesto por rol.
- Generador automático de horarios y sus reglas.
- Parsers de las hojas de Excel (Target, KPIS SEM/DIA/MEN, RepVenta).
- Generación de PDF (Feedback, Plan de Trabajo) — `pdf-lib` funciona igual fuera de Claude.
- Emparejamiento de nombres/ID para los lectores por IA.
- Todo el diseño visual (se reconstruye con Tailwind CSS, pero conservando la misma identidad).

### 3.4 Lo que se reconstruye (y con qué)
| Pieza actual | Se reemplaza por |
|---|---|
| `window.storage` | Base de datos Postgres de Supabase |
| Hash de clave simple | Supabase Auth (autenticación real) |
| Evidencia/PDF como texto embebido | Supabase Storage |
| Fetch directo a la IA desde el navegador | Supabase Edge Function — la llave de Anthropic queda segura del lado del servidor, nunca expuesta en el navegador |
| Cada quien con su copia del artifact | Supabase Realtime — todo el equipo ve los mismos datos actualizados al instante |

---

## 4. Arquitectura técnica

```
Navegador (Next.js exportado a estático + Tailwind CSS)
        │
        │  Cliente de Supabase (JS), directo desde el navegador
        ▼
Supabase
    ├── Postgres          → toda la base de datos (tabla 3.2)
    ├── Auth              → login de jefatura/asesores
    ├── Storage           → fotos de evidencia, PDFs generados
    ├── Realtime          → todo el equipo ve los mismos datos en vivo
    └── Edge Functions    → único lugar donde vive la llave de Anthropic,
                             para las funciones de IA (lectura de imágenes,
                             generación de Plan de Trabajo, Asistente, etc.)
```

No hay servidor Node/Express propio que mantener — Supabase cubre ese rol completo.

---

## 5. Fases de construcción

1. **Fase 0 — Base del MVP**: proyecto Next.js + Tailwind, proyecto de Supabase (gratis), Auth funcionando, tabla `personal` migrada — primera pantalla de punta a punta para validar el patrón.
2. **Fase 1 — Bitácora y Feedbacks**: pendientes, matriz de faltas, generación de PDF (Feedback + Plan de Trabajo) usando Supabase Edge Functions para la IA.
3. **Fase 2 — Horarios y Presupuestos**: generador de horarios, parsers de Excel, motor de distribución, KPIS Diario/Semanal/Mensual.
4. **Fase 3 — Requerimientos y Notificaciones**: calendario con aprobación, notificaciones en tiempo real (aquí es donde Supabase Realtime se nota más).
5. **Fase 4 — Reportes y Asistente**: presupuesto por asesor, gráficas, chat con IA.
6. **Fase 5 — Publicar el MVP en GitHub Pages** y preparar el material para el correo a la empresa.
7. **Fase 6 — Producción** (solo si la empresa aprueba): migrar de GitHub Pages a Vercel/Railway, Supabase a plan pago si hace falta, dominio propio — ver sección 2.

---

## 6. Primeros pasos concretos al abrir Claude Code

1. Crear el proyecto de Supabase (gratis) y el repositorio en tu cuenta personal de GitHub.
2. Crear el proyecto Next.js con Tailwind CSS, configurado en modo exportación estática desde el inicio (para no tener que reconfigurar después).
3. Migrar el modelo de datos de la sección 3.2 a tablas reales de Postgres en Supabase.
4. Portar el login y la pantalla de Personal como primer módulo de punta a punta, para validar que el patrón (Next.js estático + Supabase) funciona antes de migrar el resto.
5. Ir módulo por módulo según las fases de la sección 5, reutilizando toda la lógica ya escrita y probada.
6. Publicar en GitHub Pages y probar la URL final antes de armar el correo a la empresa.

---

## 7. Por qué JavaScript/TypeScript de punta a punta (no Python)

Ya habíamos construido y **validado con datos reales de la tienda** el motor de presupuesto, el generador de horarios, los parsers de Excel y la generación de PDF — todo en JavaScript. Cambiar a Python (por ejemplo FastAPI) implicaría reescribir y volver a probar todo eso desde cero, sin ganar nada real: la llamada a la IA de Anthropic funciona igual de bien en cualquier lenguaje, y las Edge Functions de Supabase corren en JavaScript/TypeScript de todas formas. Python solo tendría sentido si en el futuro se necesita análisis estadístico o modelos propios de predicción — no es el caso hoy.

---

## 8. Antes de pasar a producción real (Etapa B) — pendiente de resolver

Esto **no bloquea el MVP** (Etapa A es 100% tuyo, sin ambigüedad), pero si la empresa aprueba avanzar, hay que aclarar por escrito, aunque sea de forma informal (un correo basta):

1. **Propiedad del código/arquitectura reutilizable** — que puedas reutilizar el "cómo lo resolviste" para futuros clientes, no los datos específicos de la tienda.
2. **Poder mencionar el proyecto como referencia/caso de estudio** en tu portafolio.
3. **Dominio propio** — si se compra un dominio para producción, que quede registrado a tu nombre personal, no al de la empresa (la empresa lo usa mientras estés ahí; tú conservas el control real).
4. **Alcance de responsabilidad** — dejar claro que el sistema se ofrece "tal cual", sin garantías formales de soporte, mientras no exista un acuerdo/contrato de por medio (la app maneja datos sensibles de empleados y feedbacks disciplinarios — vale la pena ser explícito aquí).

Si esto tiene peso económico real para ti a futuro, una consulta puntual con un abogado laboral es buena idea antes de firmar cualquier cosa formal — esto no reemplaza ese consejo.
