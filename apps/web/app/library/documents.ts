export const documentFormats = [
  "pdf",
  "epub",
  "docx",
  "pptx",
  "xlsx",
  "txt",
  "md",
  "png",
  "jpg",
] as const;
export const availabilityStates = ["available", "offline", "disconnected"] as const;

export type DocumentOrigin = "drive" | "local";
export type DocumentFormat = (typeof documentFormats)[number];
export type AvailabilityState = (typeof availabilityStates)[number];

export interface LibraryDocument {
  author: string;
  availability: AvailabilityState;
  format: DocumentFormat;
  id: string;
  imported?: boolean;
  linked?: boolean;
  meta: string;
  origin: DocumentOrigin;
  tags: string[];
  title: string;
}

export interface DocumentFilters {
  availability: AvailabilityState | "all";
  favoriteIds: ReadonlySet<string>;
  favoritesOnly: boolean;
  format: DocumentFormat | "all";
  origin: DocumentOrigin | "all";
  query: string;
}

export const libraryDocuments: LibraryDocument[] = [
  {
    author: "Byung-Chul Han",
    availability: "offline",
    format: "pdf",
    id: "sociedad-cansancio",
    meta: "38 % leído · 7 notas",
    origin: "drive",
    tags: ["filosofía", "rendimiento", "sociedad"],
    title: "La sociedad del cansancio",
  },
  {
    author: "Archivo personal",
    availability: "available",
    format: "epub",
    id: "oficio-pensar",
    meta: "Página 86 · Sincronizado",
    origin: "local",
    tags: ["lectura", "ensayo", "pensamiento"],
    title: "El oficio de pensar",
  },
  {
    author: "Equipo de investigación",
    availability: "available",
    format: "docx",
    id: "hallazgos-investigacion",
    meta: "Editado hoy · 8 conexiones",
    origin: "drive",
    tags: ["entrevistas", "hallazgos", "investigación"],
    title: "Hallazgos de investigación",
  },
  {
    author: "Producto Pliegue",
    availability: "available",
    format: "pptx",
    id: "estrategia-producto-2026",
    meta: "42 diapositivas",
    origin: "drive",
    tags: ["estrategia", "producto", "2026"],
    title: "Estrategia de producto 2026",
  },
  {
    author: "Biblioteca local",
    availability: "offline",
    format: "pdf",
    id: "sistemas-aprenden",
    meta: "3 conexiones nuevas",
    origin: "local",
    tags: ["sistemas", "aprendizaje", "organizaciones"],
    title: "Sistemas que aprenden",
  },
  {
    author: "QA Pliegue",
    availability: "available",
    format: "xlsx",
    id: "corpus-validacion",
    meta: "100 documentos · 7 formatos",
    origin: "drive",
    tags: ["corpus", "pruebas", "validación"],
    title: "Corpus de validación",
  },
  {
    author: "Carpeta compartida",
    availability: "disconnected",
    format: "pdf",
    id: "mapa-tendencias",
    meta: "Fuente desconectada hace 2 días",
    origin: "drive",
    tags: ["mercado", "tendencias", "consultoría"],
    title: "Mapa de tendencias emergentes",
  },
  {
    author: "Notas de campo",
    availability: "offline",
    format: "docx",
    id: "diario-observacion",
    meta: "Disponible sin conexión",
    origin: "local",
    tags: ["campo", "observación", "notas"],
    title: "Diario de observación",
  },
];

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}

export function filterDocuments(
  documents: readonly LibraryDocument[],
  filters: DocumentFilters,
) {
  const query = normalizeSearchText(filters.query.trim());

  return documents.filter((document) => {
    if (filters.origin !== "all" && document.origin !== filters.origin) return false;
    if (filters.format !== "all" && document.format !== filters.format) return false;
    if (filters.availability !== "all" && document.availability !== filters.availability) {
      return false;
    }
    if (filters.favoritesOnly && !filters.favoriteIds.has(document.id)) return false;
    if (!query) return true;

    return normalizeSearchText(
      [document.title, document.author, ...document.tags].join(" "),
    ).includes(query);
  });
}
