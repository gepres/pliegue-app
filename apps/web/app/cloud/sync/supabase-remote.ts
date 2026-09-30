"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { OutgoingRow, RemoteRow, RemoteStore } from "./sync-runner";

const table = "sync_items";
const pageSize = 500;
/** Una ficha importada con portada ronda los 400 KB: lotes pequeños no rozan el límite. */
const pushBatch = 50;

/** `public.sync_items` de la cuenta con sesión. RLS garantiza que solo se ve y toca lo propio. */
export function supabaseRemote(client: SupabaseClient, userId: string, deviceId: string): RemoteStore {
  return {
    async pull(since) {
      const rows: RemoteRow[] = [];
      for (let from = 0; ; from += pageSize) {
        let query = client
          .from(table)
          .select("collection,item_key,payload,deleted,updated_at,server_updated_at")
          .order("server_updated_at", { ascending: true })
          .range(from, from + pageSize - 1);
        if (since) query = query.gt("server_updated_at", since);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        rows.push(...((data ?? []) as RemoteRow[]));
        if (!data || data.length < pageSize) return rows;
      }
    },
    async push(outgoing: readonly OutgoingRow[]) {
      for (let start = 0; start < outgoing.length; start += pushBatch) {
        const batch = outgoing
          .slice(start, start + pushBatch)
          // `user_id` va explícito: el upsert de supabase-js rellena con null lo que falta.
          .map((row) => ({ ...row, device_id: deviceId, user_id: userId }));
        const { error } = await client.from(table).upsert(batch, { onConflict: "user_id,collection,item_key" });
        if (error) throw new Error(error.message);
      }
    },
  };
}
