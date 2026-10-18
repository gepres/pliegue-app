"use client";

import { useCallback, useEffect, useState } from "react";

import { useAccount } from "./account-store";
import { cloudClient } from "./supabase-client";

/** Una alerta de Pliegue para esta cuenta: un aviso o una suspensión de su biblioteca, o una denuncia para el admin. */
export interface UserNotice {
  body: string;
  created_at: string;
  id: number;
  kind: "aviso" | "denuncia" | "incumplimiento" | "reactivacion" | "suspension";
  library: string | null;
  read_at: string | null;
  title: string;
}

export const noticeKindLabels: Record<UserNotice["kind"], string> = {
  aviso: "Aviso",
  denuncia: "Denuncia",
  incumplimiento: "Incumplimiento",
  reactivacion: "Biblioteca reactivada",
  suspension: "Biblioteca suspendida",
};

/** Adónde lleva cada alerta: la denuncia, a la moderación; lo demás, a la biblioteca del dueño. */
export function noticeHref(notice: Pick<UserNotice, "kind">) {
  return notice.kind === "denuncia" ? "/app/ajustes/moderacion" : "/app/ajustes/mi-biblioteca";
}

/** Al marcar una como leída, avisa a las demás vistas de alertas de la página. */
const changedEvent = "pliegue-notices-changed";

export async function markNoticeRead(id: number) {
  const client = cloudClient();
  if (!client) return false;
  const { error } = await client.from("user_notices").update({ read_at: new Date().toISOString() }).eq("id", id);
  if (!error) window.dispatchEvent(new Event(changedEvent));
  return !error;
}

/**
 * Las alertas de la cuenta con la que se está: las no leídas, o las de una biblioteca. La base
 * solo le da las suyas (RLS). Sin sesión, ninguna.
 */
export function useUserNotices({ library, unreadOnly = false }: { library?: string; unreadOnly?: boolean } = {}) {
  const account = useAccount();
  const userId = account.status === "signed-in" ? account.userId : null;
  const [notices, setNotices] = useState<{ list: UserNotice[]; userId: string } | null>(null);
  const [round, setRound] = useState(0);
  const reload = useCallback(() => setRound((value) => value + 1), []);

  useEffect(() => {
    window.addEventListener(changedEvent, reload);
    return () => window.removeEventListener(changedEvent, reload);
  }, [reload]);

  useEffect(() => {
    if (!userId) return;
    const client = cloudClient();
    if (!client) return;
    let active = true;
    let query = client.from("user_notices").select("id,kind,library,title,body,created_at,read_at").order("created_at", { ascending: false }).limit(50);
    if (library) query = query.eq("library", library);
    if (unreadOnly) query = query.is("read_at", null);
    void query.then(({ data, error }) => {
      // Sin la migración de moderación no hay alertas: lo mismo que no tener ninguna.
      if (active) setNotices({ list: error ? [] : ((data ?? []) as UserNotice[]), userId });
    });
    return () => {
      active = false;
    };
  }, [library, round, unreadOnly, userId]);

  return { notices: notices?.userId === userId ? notices.list : [], reload };
}
