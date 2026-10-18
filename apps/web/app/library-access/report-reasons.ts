/** Por qué se denuncia una biblioteca compartida o uno de sus libros. Los mismos que la base (`library_reports_reason`). */
export const reportReasons = {
  derechos: "Derechos de autor: se comparte sin permiso",
  engano: "Engaño o spam",
  inapropiado: "Contenido inapropiado o ilegal",
  otro: "Otro motivo",
} as const;

export type ReportReason = keyof typeof reportReasons;

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === "string" && Object.hasOwn(reportReasons, value);
}
