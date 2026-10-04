// Rol efectivo de quien llama. Una persona con encargo vigente (migración 0039)
// sigue siendo "asesor" en su ficha, pero mientras dure el encargo tiene acceso
// de jefatura: eso lo decide la base con current_persona_rol().
// Si la base no responde, vale el rol de la ficha.

type ConRpc = {
  rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }>;
};

export async function esJefatura(clienteComoUsuario: ConRpc, rolFicha?: string | null): Promise<boolean> {
  if (rolFicha === "jefatura") return true;
  const { data, error } = await clienteComoUsuario.rpc("current_persona_rol");
  return !error && data === "jefatura";
}
