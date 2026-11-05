/**
 * DeepL (05.5): lo que comparten la ruta que traduce y la que prueba la conexión. Su API no
 * admite llamadas desde el navegador (CORS), así que se le llama desde el servidor de Pliegue,
 * como a Azure, con la clave de la sesión en la cabecera y sin guardarla.
 */

/** Las claves de DeepL API Free acaban en «:fx» y tienen su propio servidor. */
export function deeplEndpoint(apiKey: string) {
  return apiKey.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
}

export function deeplPlan(apiKey: string) {
  return apiKey.endsWith(":fx") ? "Free" : "Pro";
}

/**
 * DeepL pide el idioma en mayúsculas y, como destino, la variante del inglés y del portugués
 * («EN» y «PT» ya no se aceptan como destino). Se eligen las de más lectores.
 */
export function deeplLanguage(code: string, role: "source" | "target") {
  const upper = code.toUpperCase();
  if (role === "source") return upper;
  if (upper === "EN") return "EN-US";
  if (upper === "PT") return "PT-BR";
  if (upper === "ZH") return "ZH-HANS";
  return upper;
}

export function deeplHeaders(apiKey: string) {
  return { authorization: `DeepL-Auth-Key ${apiKey}`, "content-type": "application/json" };
}
