"use client";

import { useEffect, useState } from "react";

import { useAccount } from "./account-store";
import { cloudClient } from "./supabase-client";

/** La biblioteca compartida de la cuenta con la que se está, tal como la ve su dueño. */
export interface OwnSharedLibrary {
  active: boolean;
  created_at: string;
  folder_id: string;
  name: string;
  slug: string;
}

export type OwnSharedLibraryState =
  | { status: "loading" }
  | { status: "signed-out" }
  /** Sin biblioteca, o sin la migración aplicada: lo mismo para quien mira. */
  | { status: "none" }
  | { library: OwnSharedLibrary; status: "ready" };

/**
 * ¿Tiene biblioteca compartida esta cuenta? La base solo le enseña la suya (RLS), así que basta
 * con pedir la única que puede ver. `reload` vuelve a preguntar tras un cambio.
 */
export function useOwnSharedLibrary(): OwnSharedLibraryState & { reload: () => void } {
  const account = useAccount();
  const userId = account.status === "signed-in" ? account.userId : null;
  const [answer, setAnswer] = useState<{ library: OwnSharedLibrary | null; userId: string } | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!userId) return;
    const client = cloudClient();
    if (!client) return;
    let active = true;
    void client
      .from("shared_libraries")
      .select("slug,name,active,folder_id,created_at")
      .maybeSingle()
      .then(({ data, error }) => {
        if (active) setAnswer({ library: error ? null : ((data as OwnSharedLibrary | null) ?? null), userId });
      });
    return () => {
      active = false;
    };
  }, [round, userId]);

  const reload = () => setRound((value) => value + 1);
  if (account.status === "loading") return { reload, status: "loading" };
  if (!userId) return { reload, status: "signed-out" };
  if (answer?.userId !== userId) return { reload, status: "loading" };
  return answer.library ? { library: answer.library, reload, status: "ready" } : { reload, status: "none" };
}
