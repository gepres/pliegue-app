"use client";

import { parseMonthUsage } from "../../ai/ai-budget";
import { applyOtherDevices, otherDevices, ownMonths } from "../../ai/ai-usage-store";
import { entry, type SyncCollection } from "./collections";

/**
 * El gasto de IA en la cuenta (04.6): cada equipo sube su contador de cada mes con la clave
 * «equipo/mes» y nadie más la escribe, así que no hay conflictos; el total del mes es la suma.
 * Solo son cifras por proveedor y modelo: no hace falta un permiso aparte.
 */
export function aiUsageCollection(device: () => string): SyncCollection {
  return {
    async apply(entries) {
      const own = `${device()}/`;
      applyOtherDevices(
        entries
          // Lo de este equipo lo escribe solo él.
          .filter((item) => !item.key.startsWith(own))
          .map((item) => {
            const payload = (item.payload ?? {}) as { month?: unknown; usage?: unknown };
            return {
              key: item.key,
              value:
                item.deleted || typeof payload.month !== "string"
                  ? null
                  : { month: payload.month, updatedAt: item.updatedAt, usage: parseMonthUsage(payload.usage) },
            };
          }),
      );
    },
    docKeyOf: () => null,
    name: "ai-usage",
    snapshot() {
      const items = new Map<string, ReturnType<typeof entry>>();
      const own = device();
      for (const month of ownMonths()) {
        const key = `${own}/${month.month}`;
        items.set(key, entry(key, { month: month.month, usage: month.usage }, month.updatedAt, null));
      }
      for (const [key, value] of Object.entries(otherDevices())) {
        items.set(key, entry(key, { month: value.month, usage: value.usage }, value.updatedAt, null));
      }
      return items;
    },
  };
}
