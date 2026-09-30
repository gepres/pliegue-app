/**
 * Vocabulario de categorías de la biblioteca.
 *
 * El modelo cataloga documento a documento y, sin ver lo que ya existe, escribe «Filosofia» en
 * uno, «Filosofía» en otro y «filosofía» en un tercero: tres entradas en el filtro para la misma
 * materia. Aquí la primera grafía que aparece —la del JSON importado o la del primer análisis—
 * queda como la buena, y las demás se reescriben con ella. Solo se unen las que coinciden sin
 * mayúsculas, acentos ni espacios: juntar «Historia» con «Historia del arte» sería decidir por
 * la persona cómo ordena su biblioteca.
 */

export function categoryKey(value: string) {
  return value
    .normalize("NFD")
    .replaceAll(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("es")
    .replaceAll(/\s+/g, " ")
    .trim();
}

/**
 * El modelo a veces responde la materia en el idioma del libro —o en inglés, los pequeños—
 * aunque se le pida en español. Estas son las de la lista sugerida, y unos pocos géneros
 * literarios como subcategoría; lo que no esté aquí se conserva tal cual.
 */
const categoryAliases: Record<string, string> = {
  anthropology: "Ciencias sociales",
  architecture: "Arte y arquitectura",
  art: "Arte y arquitectura",
  arts: "Arte y arquitectura",
  biography: "Biografías y memorias",
  business: "Economía y empresa",
  economics: "Economía y empresa",
  education: "Educación",
  esotericism: "Religión y espiritualidad",
  esoterism: "Religión y espiritualidad",
  occultism: "Religión y espiritualidad",
  fiction: "Literatura",
  geography: "Viajes y geografía",
  health: "Medicina y salud",
  history: "Historia",
  law: "Política y derecho",
  linguistics: "Lengua y lingüística",
  literary: "Literatura",
  literature: "Literatura",
  mathematics: "Matemáticas",
  medicine: "Medicina y salud",
  memoir: "Biografías y memorias",
  music: "Música",
  "personal development": "Desarrollo personal",
  philosophy: "Filosofía",
  politics: "Política y derecho",
  psychology: "Psicología",
  religion: "Religión y espiritualidad",
  science: "Ciencia y naturaleza",
  "self help": "Desarrollo personal",
  "social sciences": "Ciencias sociales",
  sociology: "Ciencias sociales",
  spiritual: "Religión y espiritualidad",
  spirituality: "Religión y espiritualidad",
  technology: "Tecnología e informática",
  travel: "Viajes y geografía",
};

const subcategoryAliases: Record<string, string> = {
  essay: "Ensayo",
  essays: "Ensayo",
  novel: "Novela",
  poetry: "Poesía",
  "short stories": "Cuento",
  "short story": "Cuento",
};

function aliasKey(value: string) {
  return categoryKey(value).replaceAll(/[-_]/g, " ");
}

/** La grafía española de una materia que llegó en inglés; cualquier otra, sin tocar. */
export function spanishCategory(pair: CategoryPair): CategoryPair {
  const category = pair.category ? (categoryAliases[aliasKey(pair.category)] ?? pair.category) : null;
  const subcategory = pair.subcategory
    ? (subcategoryAliases[aliasKey(pair.subcategory)] ?? categoryAliases[aliasKey(pair.subcategory)] ?? pair.subcategory)
    : null;
  // «Literature › Literary» se quedaría en «Literatura › Literatura».
  return { category, subcategory: subcategory && category && categoryKey(subcategory) === categoryKey(category) ? null : subcategory };
}

interface CategoryEntry {
  label: string;
  subcategories: Map<string, string>;
}

export interface CategoryPair {
  category: string | null;
  subcategory: string | null;
}

export class CategoryIndex {
  readonly #categories = new Map<string, CategoryEntry>();

  /** Registra la pareja y la devuelve con la grafía que ya tenía el vocabulario. */
  add(category: string | null | undefined, subcategory?: string | null): CategoryPair {
    const label = category?.trim();
    if (!label) return { category: null, subcategory: null };

    const key = categoryKey(label);
    let entry = this.#categories.get(key);
    if (!entry) {
      entry = { label, subcategories: new Map() };
      this.#categories.set(key, entry);
    }

    const sub = subcategory?.trim();
    if (!sub) return { category: entry.label, subcategory: null };
    const subKey = categoryKey(sub);
    if (!entry.subcategories.has(subKey)) entry.subcategories.set(subKey, sub);
    return { category: entry.label, subcategory: entry.subcategories.get(subKey) ?? sub };
  }

  get size() {
    return this.#categories.size;
  }

  /** Para el prompt: «Historia › Historia del Perú», o solo «Filosofía» si no tiene ninguna. */
  get entries(): string[] {
    return [...this.#categories.values()].flatMap((entry) =>
      entry.subcategories.size
        ? [...entry.subcategories.values()].map((sub) => `${entry.label} › ${sub}`)
        : [entry.label],
    );
  }
}
