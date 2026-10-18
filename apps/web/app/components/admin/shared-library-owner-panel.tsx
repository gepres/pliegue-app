"use client";

import Link from "next/link";

import { Card } from "@pliegue/ui";

import { useAccount } from "../../cloud/account-store";
import { useOwnSharedLibrary } from "../../cloud/shared-library-store";
import { LibraryCodesManager } from "./library-admin-panel";
import styles from "./library-admin-panel.module.css";

/**
 * Ajustes → Mi biblioteca compartida: lo mismo que el administrador tiene para la general, sobre
 * la biblioteca de esta cuenta. Los códigos, quién entró y quitar a alguien.
 */
export function SharedLibraryOwnerPanel() {
  const account = useAccount();
  const own = useOwnSharedLibrary();
  const path = own.status === "ready" ? `/biblioteca/${own.library.slug}` : null;

  const header = (
    <header className={styles.head}>
      <h2 id="library-admin-title">{own.status === "ready" ? own.library.name : "Códigos de acceso"}</h2>
      {path ? (
        <p>
          Los códigos con los que se entra en <Link href={path}>{path}</Link> y quién entró con ellos. Desactivar un código
          corta el acceso en la próxima visita de quien lo usó.
        </p>
      ) : null}
    </header>
  );

  if (own.status === "signed-out") {
    return (
      <Card aria-labelledby="library-admin-title" as="section" className={styles.panel}>
        {header}
        <p className={styles.note}>
          Inicia sesión con tu cuenta en <Link href="/app/ajustes#cuenta">Ajustes → Cuenta</Link> para ver tu biblioteca compartida.
        </p>
      </Card>
    );
  }
  if (own.status === "loading") {
    return (
      <Card aria-labelledby="library-admin-title" as="section" className={styles.panel}>
        {header}
        <p className={styles.note}>Comprobando tu cuenta…</p>
      </Card>
    );
  }
  if (own.status === "none") {
    return (
      <Card aria-labelledby="library-admin-title" as="section" className={styles.panel}>
        {header}
        <p className={styles.note}>Esta cuenta todavía no tiene una biblioteca compartida.</p>
      </Card>
    );
  }

  return (
    <Card aria-labelledby="library-admin-title" as="section" className={styles.panel}>
      {header}
      {own.library.active ? null : (
        <p className={styles.warning} role="status">
          Está pausada: nadie puede entrar, ni con un código activo, hasta que la reanudes.
        </p>
      )}
      <LibraryCodesManager library={own.library.slug} libraryPath={`/biblioteca/${own.library.slug}`} userId={account.userId ?? ""} />
    </Card>
  );
}
