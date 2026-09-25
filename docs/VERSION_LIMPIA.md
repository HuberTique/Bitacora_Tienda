# Versión limpia de Bitácora Digital

Esta guía crea una **segunda instalación vacía** (sin datos) para empezar a cargar información real,
sin tocar la instalación actual, que queda con sus datos como demostración.

| | Demo (actual) | Limpia (nueva) |
|---|---|---|
| Código | repo `Bitacora_Tienda`, rama `main` | copia del código en la etiqueta `v1-limpia` |
| Base de datos | proyecto Supabase actual (con datos) | **proyecto Supabase nuevo** (vacío) |
| Sitio | https://hubertique.github.io/Bitacora_Tienda/ | el de tu repo nuevo |

El código es el mismo; lo único que cambia es a qué base de datos apunta.

## 1. Repositorio nuevo en GitHub

1. Crea un repositorio vacío, por ejemplo `Bitacora_Tienda_Limpia`.
2. Desde la carpeta del proyecto:

```bash
git remote add limpia https://github.com/<tu-usuario>/Bitacora_Tienda_Limpia.git
git push limpia v1-limpia:refs/heads/main
```

3. En el repo nuevo: **Settings → Pages → Source: GitHub Actions**.
   El nombre del repo se toma solo (`PAGES_REPO`), no hay que editar nada en el código.

## 2. Proyecto Supabase nuevo

1. Crea un proyecto en https://supabase.com (el plan gratis permite dos).
2. **SQL Editor**: pega todo el contenido de `supabase/schema_completo.sql` y ejecútalo.
   (Son las migraciones 0001 a 0024 en orden.)
3. **Storage**: verifica que exista el bucket `fotos-personal` (lo crea la migración 0018).
4. **Edge Functions**: despliega las de `supabase/functions/` en el proyecto nuevo
   (`asistente-chat`, `crear-persona`, `generar-feedback-contenido`, `generar-plan-trabajo`,
   `leer-retardos-imagen`, `leer-ventas-consolidadas`, `leer-ventas-pdf`, `recuperar-clave`,
   `resetear-clave`).
5. **Secretos** de las funciones: `ANTHROPIC_API_KEY` (tu llave de Anthropic; créala tú en su consola).

## 3. Conectar el sitio a la base nueva

En el repo nuevo → **Settings → Secrets and variables → Actions**:

- `NEXT_PUBLIC_SUPABASE_URL`: URL del proyecto nuevo.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: llave pública (publishable) del proyecto nuevo.

Luego ejecuta el workflow (**Actions → Deploy → Run workflow**).

## 4. Primer usuario (jefatura)

Copia `.env.example` a `.env.local` con la URL, la llave pública y la `service_role` del proyecto
**nuevo** (solo en tu computador, nunca al repo) y ejecuta:

```bash
npm run bootstrap:me
```

Después entra al sitio, ve a **Personal → Datos de la tienda** y completa nombre y ciudad, y
registra al equipo (cada persona con su **CM** = ID de empleado).

## 5. Orden recomendado para cargar datos

1. Personal (con CM) y datos de la tienda.
2. Horarios del mes.
3. Presupuesto y ranking → **Cargar datos** → planeador (Excel).
4. Ventas consolidadas (PDF "Visión general de ventas") y cierres del día.

## Notas

- Nunca reutilices el proyecto Supabase de la demo en la limpia: compartirían datos.
- Para volver al código exacto de esta versión: `git checkout v1-limpia`.
- Las pruebas automáticas se corren con `npm test`.
