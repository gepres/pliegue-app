"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@pliegue/ui";

import { markNoticeRead, noticeHref, noticeKindLabels, useUserNotices } from "../../cloud/user-notices-store";
import styles from "./notices-banner.module.css";

function noticeDate(iso: string) {
  return new Date(iso).toLocaleString("es", { day: "numeric", hour: "2-digit", minute: "2-digit", month: "short" });
}

/**
 * Las alertas sin leer de la cuenta, arriba de cada página del espacio de trabajo, hasta que se
 * pulse «Entendido»: un aviso de Pliegue sobre la biblioteca compartida o, al administrador, una
 * denuncia. Sin sesión o sin alertas no ocupa nada.
 */
export function NoticesBanner() {
  const { notices } = useUserNotices({ unreadOnly: true });
  const [busy, setBusy] = useState<number | null>(null);
  if (!notices.length) return null;
  const shown = notices.slice(0, 3);

  return (
    <section aria-label="Alertas de Pliegue" className={styles.banner}>
      {shown.map((notice) => (
        <article className={styles.notice} data-kind={notice.kind} key={notice.id}>
          <div className={styles.text}>
            <p className={styles.kind}>
              {noticeKindLabels[notice.kind]} · {noticeDate(notice.created_at)}
            </p>
            <h2>{notice.title}</h2>
            {notice.body ? <p>{notice.body}</p> : null}
          </div>
          <div className={styles.actions}>
            <Link href={noticeHref(notice)}>{notice.kind === "denuncia" ? "Ver denuncias" : "Ver mi biblioteca"}</Link>
            <Button
              disabled={busy === notice.id}
              onClick={() => {
                setBusy(notice.id);
                void markNoticeRead(notice.id).finally(() => setBusy(null));
              }}
              size="sm"
              variant="secondary"
            >
              Entendido
            </Button>
          </div>
        </article>
      ))}
      {notices.length > shown.length ? <p className={styles.more}>Y {notices.length - shown.length} más.</p> : null}
    </section>
  );
}
