import type { NextStepOptions } from "../components/app-ui/next-step-dialog";

/**
 * Qué sugerir tras cada paso. El camino de primeros pasos es:
 *
 *   añadir documentos → darles ficha (IA o índice JSON) → explorar la Biblioteca filtrada
 *
 * y cada sugerencia empuja hacia el siguiente eslabón según cómo esté todo ahora: si no hay IA
 * lista, se ofrece configurarla en vez de catalogar; si no queda nada por catalogar, no se
 * molesta.
 */

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export interface CatalogAi {
  providerName: string;
  ready: boolean;
}

/** Tras vincular una carpeta o archivos, o importar copias. */
export function afterLibraryGrowth({
  added,
  ai,
  folderName,
}: {
  added: number;
  ai: CatalogAi;
  folderName?: string;
}): NextStepOptions | null {
  if (added <= 0) return null;
  return {
    actions: [
      ai.ready
        ? {
            description: `${ai.providerName} lee un extracto de cada uno y rellena su ficha: autor, categoría, serie…`,
            href: "/app/ia",
            icon: "sparkles",
            label: "Catalogar con IA",
            primary: true,
          }
        : {
            description: "Añade tu clave de OpenAI, Claude o Gemini —o usa Ollama en tu equipo— y vuelve a catalogar.",
            href: "/app/ajustes#ia",
            icon: "sparkles",
            label: "Configurar una IA para catalogar",
            primary: true,
          },
      {
        description: "Si ya tienes las fichas en una hoja de cálculo o en Zotero. No gasta IA.",
        href: "/app/biblioteca/fuentes#indice-json",
        icon: "database",
        label: "Importar un índice JSON",
      },
      {
        description: "Ya puedes abrirlos y buscar por su texto.",
        href: "/app/biblioteca",
        icon: "library",
        label: "Ver la Biblioteca",
      },
    ],
    description: `Pliegue indexó ${plural(added, "documento")}. Para ordenarlos por autor, categoría o serie, dales una ficha:`,
    icon: folderName ? "folder" : "library",
    title: folderName ? `«${folderName}» ya está en tu biblioteca` : `${plural(added, "documento nuevo", "documentos nuevos")}`,
  };
}

/** Tras guardar los ajustes con la IA de catalogar lista. */
export function afterAiReady({
  documents,
  pending,
  providerName,
}: {
  documents: number;
  pending: number;
  providerName: string;
}): NextStepOptions | null {
  if (!documents) {
    return {
      actions: [
        {
          description: "Pliegue la lee donde está, sin copiarla.",
          href: "/app/biblioteca/fuentes#carpetas",
          icon: "folder",
          label: "Vincular una carpeta",
          primary: true,
        },
        {
          description: "Archivos sueltos o copias, desde «Añadir».",
          href: "/app/biblioteca",
          icon: "library",
          label: "Ir a la Biblioteca",
        },
      ],
      description: `${providerName} ya puede catalogar. Solo falta que la biblioteca tenga documentos.`,
      icon: "sparkles",
      title: "Tu IA está lista",
    };
  }
  if (!pending) return null;
  return {
    actions: [
      {
        description: "Revisa qué se enviará y empieza cuando quieras.",
        href: "/app/ia",
        icon: "sparkles",
        label: `Catalogar ${plural(pending, "documento")}`,
        primary: true,
      },
    ],
    description: `${plural(pending, "documento espera", "documentos esperan")} su ficha. El análisis se hace en el panel de IA.`,
    icon: "sparkles",
    title: `${providerName} está lista para catalogar`,
  };
}

/** Tras un análisis con IA que produjo fichas. */
export function afterCatalog({
  analyzed,
  categories,
}: {
  analyzed: number;
  categories: readonly string[];
}): NextStepOptions | null {
  if (analyzed <= 0) return null;
  const sample = categories.slice(0, 3).join(", ");
  return {
    actions: [
      {
        description: "Filtra por categoría, autor, serie, idioma o tipo de obra.",
        href: "/app/biblioteca",
        icon: "library",
        label: "Ver la Biblioteca por categorías",
        primary: true,
      },
      {
        description: "Descarga las fichas en la plantilla JSON, corrige lo que haga falta y vuelve a importarla.",
        href: "/app/biblioteca/fuentes#indice-json",
        icon: "download",
        label: "Revisar las fichas a mano",
      },
    ],
    description: sample
      ? `La biblioteca ya se ordena por materias: ${sample}${categories.length > 3 ? "…" : "."}`
      : "La biblioteca ya se puede filtrar por autor, idioma y tipo de obra.",
    icon: "check",
    title: `${plural(analyzed, "ficha nueva", "fichas nuevas")}`,
  };
}

/** Tras aplicar un índice JSON. */
export function afterJsonImport({
  ai,
  matched,
  missing,
}: {
  ai: CatalogAi;
  matched: number;
  /** Documentos que siguen sin ficha. */
  missing: number;
}): NextStepOptions | null {
  if (matched <= 0) return null;
  return {
    actions: [
      {
        description: "Filtra por las categorías y series de tu índice.",
        href: "/app/biblioteca",
        icon: "library",
        label: "Ver la Biblioteca",
        primary: true,
      },
      ...(missing > 0
        ? [
            ai.ready
              ? {
                  description: `${ai.providerName} completa los ${missing} que tu índice no cubre.`,
                  href: "/app/ia",
                  icon: "sparkles" as const,
                  label: "Catalogar con IA lo que falta",
                }
              : {
                  description: `Quedan ${plural(missing, "documento")} sin ficha: una IA puede completarlos.`,
                  href: "/app/ajustes#ia",
                  icon: "sparkles" as const,
                  label: "Configurar una IA",
                },
          ]
        : []),
    ],
    description: "Las fichas escritas a mano prevalecen sobre las de la IA.",
    icon: "check",
    title: `${plural(matched, "ficha aplicada", "fichas aplicadas")}`,
  };
}
