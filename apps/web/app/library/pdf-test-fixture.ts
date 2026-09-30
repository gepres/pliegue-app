/**
 * Generador de PDFs mínimos pero válidos —con su tabla xref calculada— para las pruebas.
 * Evita guardar binarios en el repositorio. Solo lo consumen archivos de test; ningún
 * módulo de producción lo importa, así que no entra en el bundle de la aplicación.
 *
 * Cada entrada es el texto visible de una página; `null` produce una página sin capa de
 * texto, como la de un documento escaneado.
 */
export function createTestPdf(pages: readonly (string | null)[]) {
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const pageRefs: string[] = [];

  for (const text of pages) {
    const stream = text === null ? "" : `BT /F1 18 Tf 40 700 Td (${text}) Tj ET`;
    const contentsRef = objects.length + 2;
    pageRefs.push(`${objects.length + 1} 0 R`);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentsRef} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }

  objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pages.length} >>`;

  let body = "%PDF-1.7\n";
  const offsets: number[] = [];

  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new Blob([new TextEncoder().encode(body)], { type: "application/pdf" });
}
