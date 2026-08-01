"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Tag, cx } from "@pliegue/ui";

import { useWorkspaceMode } from "../mode/workspace-mode-store";
import { isNavigationItemActive, navigationItems } from "../navigation";
import { ThemeToggle } from "./theme-toggle";
import styles from "./workspace-shell.module.css";

function NavigationLink({
  compact = false,
  href,
  pathname,
  code,
  label,
}: {
  code: string;
  compact?: boolean;
  href: string;
  label: string;
  pathname: string;
}) {
  const active = isNavigationItemActive(pathname, href);

  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={cx(styles.navigationLink, compact && styles.navigationLinkCompact)}
      href={href}
    >
      <span aria-hidden="true" className={styles.navigationCode}>
        {code}
      </span>
      <span>{label}</span>
    </Link>
  );
}

export function WorkspaceShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const workspaceMode = useWorkspaceMode();
  const currentItem =
    navigationItems.find((item) => isNavigationItemActive(pathname, item.href)) ??
    navigationItems[0];

  return (
    <div className={styles.shell}>
      <a className="skip-link" href="#workspace-content">
        Saltar al contenido
      </a>

      <aside className={styles.sidebar}>
        <Link aria-label="Pliegue, inicio público" className={styles.brand} href="/">
          <Image
            alt=""
            height={38}
            priority
            src="/brand/pliegue-mark.svg"
            width={38}
          />
          <span>Pliegue</span>
        </Link>

        <div className={styles.areaIdentity}>
          <span className={styles.areaMark}>LO</span>
          <div>
            <strong>Área personal</strong>
            <small>Este dispositivo</small>
          </div>
        </div>

        <nav aria-label="Secciones de Pliegue" className={styles.desktopNavigation}>
          {navigationItems.map((item) => (
            <NavigationLink key={item.href} pathname={pathname} {...item} />
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <Tag>Local-only</Tag>
          <p>
            {workspaceMode.confirmedAt
              ? "Modo local confirmado en este dispositivo."
              : "Los archivos permanecen bajo tu control."}
          </p>
        </div>
      </aside>

      <div className={styles.contentColumn}>
        <header className={styles.topbar}>
          <Link aria-label="Pliegue, inicio público" className={styles.mobileBrand} href="/">
            <Image
              alt=""
              height={32}
              priority
              src="/brand/pliegue-mark.svg"
              width={32}
            />
          </Link>
          <div className={styles.breadcrumb}>
            <span>Área personal</span>
            <strong>{currentItem.label}</strong>
          </div>
          <ThemeToggle />
        </header>

        <main className={styles.content} id="workspace-content">
          {children}
        </main>
      </div>

      <nav aria-label="Navegación móvil" className={styles.mobileNavigation}>
        {navigationItems.map((item) => (
          <NavigationLink compact key={item.href} pathname={pathname} {...item} />
        ))}
      </nav>
    </div>
  );
}
