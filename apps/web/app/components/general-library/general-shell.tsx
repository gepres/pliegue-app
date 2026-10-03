"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { Button } from "@pliegue/ui";

import { generalLibraryPath } from "../../library/general-library";
import { ConfirmDialogHost } from "../app-ui/confirm-dialog";
import { ThemeToggle } from "../theme-toggle";
import styles from "./general-library.module.css";

/** Salir de la biblioteca general: borra la sesión de este navegador. */
function LeaveButton() {
  const [busy, setBusy] = useState(false);
  async function leave() {
    setBusy(true);
    try {
      await fetch("/api/biblioteca/acceso", { method: "DELETE" });
    } finally {
      window.location.assign(generalLibraryPath);
    }
  }
  return (
    <Button disabled={busy} onClick={() => void leave()} size="sm" variant="quiet">
      Salir
    </Button>
  );
}

/** El marco de la biblioteca general: aparte del espacio personal, sin su navegación ni su nube. */
export function GeneralShell({ children, visitor }: { children: ReactNode; visitor: string | null }) {
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href={generalLibraryPath}>
          <Image alt="" height={26} priority src="/brand/pliegue-mark.svg" width={26} />
          <span>
            Pliegue <small>· Biblioteca general</small>
          </span>
        </Link>
        <div className={styles.topbarActions}>
          {visitor ? <span className={styles.visitor}>Hola, {visitor}</span> : null}
          <ThemeToggle compact />
          {visitor ? <LeaveButton /> : null}
        </div>
      </header>
      <main className={styles.content}>{children}</main>
      <ConfirmDialogHost />
    </div>
  );
}
