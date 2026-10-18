/**
 * Las normas que acepta quien crea una biblioteca compartida. Son la base de los avisos y de la
 * suspensión: si cambian, sube la versión (queda guardada con cada biblioteca).
 */
export const sharedLibraryTermsVersion = "2026-10-18";

export const sharedLibraryTerms = [
  "Solo comparto libros que tengo derecho a compartir: míos, de dominio público o con permiso de quien tiene los derechos.",
  "La carpeta es mía y la dejo pública («cualquier persona con el enlace»): sé que quien tenga su enlace puede abrirla en Drive.",
  "No comparto contenido ilegal, engañoso, de odio ni que exponga datos de otras personas.",
  "Pliegue puede avisarme de un incumplimiento y suspender mi biblioteca; mi cuenta y mi biblioteca personal siguen siendo mías.",
] as const;
