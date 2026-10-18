"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { Button } from "@pliegue/ui";

import { generalLibraryPlace, type LibraryPlace } from "../../library/general-library";
import { ConfirmDialogHost } from "../app-ui/confirm-dialog";
import { ThemeToggle } from "../theme-toggle";
import styles from "./general-library.module.css";

/** Salir de la biblioteca: borra la sesión de este navegador (solo la de esta biblioteca). */
function LeaveButton({ place }: { place: LibraryPlace }) {
  const [busy, setBusy] = useState(false);
  async function leave() {
    setBusy(true);
    try {
      const query = place.library === generalLibraryPlace.library ? "" : `?library=${encodeURIComponent(place.library)}`;
      await fetch(`/api/biblioteca/acceso${query}`, { method: "DELETE" });
    } finally {
      window.location.assign(place.path);
    }
  }
  return (
    <Button disabled={busy} onClick={() => void leave()} size="sm" variant="quiet">
      Salir
    </Button>
  );
}

/**
 * El marco de una biblioteca por código, la general o una compartida: aparte del espacio
 * personal, sin su navegación ni su nube.
 */
export function GeneralShell({
  children,
  place = generalLibraryPlace,
  visitor,
}: {
  children: ReactNode;
  place?: LibraryPlace;
  visitor: string | null;
}) {
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href={place.path}>
          <Image alt="" height={26} priority src="/brand/pliegue-mark.svg" width={26} />
          <span>
            Pliegue <small>· {place.title}</small>
          </span>
        </Link>
        <div className={styles.topbarActions}>
          {visitor ? <span className={styles.visitor}>Hola, {visitor}</span> : null}
          <ThemeToggle compact />
          {visitor ? <LeaveButton place={place} /> : null}
        </div>
      </header>
      <main className={styles.content}>{children}</main>
      <ConfirmDialogHost />
    </div>
  );
}
