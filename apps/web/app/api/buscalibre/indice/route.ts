import { readLibraryBaseConfig } from "../../../library-access/access-server";
import { handleBuscalibreIndex } from "../../../library/buscalibre-server";

/**
 * La lista de libros de Buscalibre (06.2b), por partes, para el índice ISBN → producto que el
 * admin guarda en su navegador. Solo admin: lo comprueba `handleBuscalibreIndex`.
 */
export async function GET(request: Request) {
  return handleBuscalibreIndex(request, { config: readLibraryBaseConfig() });
}
