/**
 * Quién es el visitante de la biblioteca general, en su propio navegador: un identificador
 * aleatorio del equipo —para distinguir equipos en el registro sin saber quién es nadie— y el
 * nombre que escribió la última vez, para no pedírselo de nuevo.
 */
const deviceKey = "pliegue-general-equipo";
const nameKey = "pliegue-general-nombre";

export function visitorDeviceId() {
  try {
    const existing = window.localStorage.getItem(deviceKey);
    if (existing && /^[\w-]{8,64}$/.test(existing)) return existing;
    const created = crypto.randomUUID();
    window.localStorage.setItem(deviceKey, created);
    return created;
  } catch {
    // Sin almacenamiento, uno por visita.
    return crypto.randomUUID();
  }
}

export function savedVisitorName() {
  try {
    return window.localStorage.getItem(nameKey) ?? "";
  } catch {
    return "";
  }
}

export function saveVisitorName(name: string) {
  try {
    window.localStorage.setItem(nameKey, name);
  } catch {
    // Se pedirá otra vez.
  }
}
