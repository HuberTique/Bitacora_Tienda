-- 0004_cedula_optional.sql
-- Fase 1 — bulk import
--
-- La cédula deja de ser obligatoria. En la práctica muchas personas se
-- registran antes de que jefatura tenga sus datos completos de RRHH.
-- La restricción UNIQUE sigue vigente (Postgres trata múltiples NULL como
-- distintos, así que múltiples filas sin cédula conviven sin chocar; las
-- que sí tienen cédula siguen protegidas contra duplicados).

alter table public.personal alter column cedula drop not null;
