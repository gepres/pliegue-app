"use client";

import { useEffect, useState } from "react";

import { useAccount } from "./account-store";
import { cloudClient } from "./supabase-client";

/**
 * ¿La cuenta con la que se está administra la biblioteca general? Lo dice la base
 * (`is_pliegue_admin`): sin la migración aplicada, o sin sesión, la respuesta es «no».
 */
const answers = new Map<string, boolean>();

export function useIsPliegueAdmin(): boolean | null {
  const account = useAccount();
  const userId = account.status === "signed-in" ? account.userId : null;
  const [answer, setAnswer] = useState<{ admin: boolean; userId: string } | null>(null);

  useEffect(() => {
    if (!userId || answers.has(userId)) return;
    const client = cloudClient();
    if (!client) return;
    let active = true;
    void client.rpc("is_pliegue_admin").then(({ data, error }) => {
      const admin = !error && data === true;
      answers.set(userId, admin);
      if (active) setAnswer({ admin, userId });
    });
    return () => {
      active = false;
    };
  }, [userId]);

  if (account.status === "loading") return null;
  if (!userId) return false;
  if (answers.has(userId)) return answers.get(userId) ?? false;
  return answer?.userId === userId ? answer.admin : null;
}
