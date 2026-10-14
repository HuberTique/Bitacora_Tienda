-- Adjuntos de pendientes: que los archivos SÍ se borren del almacenamiento (Huber, 12-oct-2026).
--
-- El almacenamiento solo deja borrar un archivo que la persona puede "ver". Con 0046 un archivo se
-- veía solo mientras existiera su fila en pendiente_adjuntos, y la app borra primero la fila y
-- después el archivo (al quitar un adjunto con ✕ y en la limpieza de los 90 días): el archivo
-- quedaba huérfano sin dar error. Ahora quien puede borrarlo también puede verlo (la jefatura de
-- esa tienda, o quien puede editar ese pendiente), sin abrirlo a nadie más.

drop policy if exists "leer adjuntos de pendientes" on storage.objects;
create policy "leer adjuntos de pendientes" on storage.objects for select to authenticated
  using (
    bucket_id = 'pendientes-adjuntos'
    and (
      exists (select 1 from public.pendiente_adjuntos a where a.path = storage.objects.name)
      or (
        (storage.foldername(name))[1] = public.current_tienda_id()::text
        and (public.current_persona_rol() = 'jefatura' or public.puede_editar_pendiente(((storage.foldername(name))[2])::uuid))
      )
    )
  );
