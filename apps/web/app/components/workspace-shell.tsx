"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Button, Tag, cx } from "@pliegue/ui";

import { useWorkspaceMode } from "../mode/workspace-mode-store";
import { isNavigationItemActive, isWideSection, navigationItems } from "../navigation";
import {
  setNavigationCollapsed,
  useShellLayout,
} from "../preferences/shell-layout-store";
import { ThemeToggle } from "./theme-toggle";
import styles from "./workspace-shell.module.css";

function NavigationLink({
  collapsed = false,
  compact = false,
  href,
  pathname,
  code,
  label,
}: {
  code: string;
  collapsed?: boolean;
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
      // Plegada, la etiqueta deja de verse y el código de dos letras es lo único que queda:
      // el nombre tiene que seguir llegando por el título y por el nombre accesible.
      title={collapsed ? label : undefined}
    >
      <span aria-hidden="true" className={styles.navigationCode}>
        {code}
      </span>
      <span className={styles.navigationLabel}>{label}</span>
    </Link>
  );
}

export function WorkspaceShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const workspaceMode = useWorkspaceMode();
  const { navigationCollapsed } = useShellLayout();
  const currentItem =
    navigationItems.find((item) => isNavigationItemActive(pathname, item.href)) ??
    navigationItems[0];

  return (
    <div className={cx(styles.shell, navigationCollapsed && styles.shellCollapsed)}>
      <a className="skip-link" href="#workspace-content">
        Saltar al contenido
      </a>

      <aside className={styles.sidebar} id="workspace-navigation">
        <Link
          aria-label="Pliegue, inicio público"
          className={styles.brand}
          href="/"
          title={navigationCollapsed ? "Pliegue" : undefined}
        >
          <Image
            alt=""
            height={38}
            priority
            src="/brand/pliegue-mark.svg"
            width={38}
          />
          <span className={styles.brandName}>Pliegue</span>
        </Link>

        <div className={styles.areaIdentity} title={navigationCollapsed ? "Área personal · Este dispositivo" : undefined}>
          <span className={styles.areaMark}>LO</span>
          <div className={styles.areaText}>
            <strong>Área personal</strong>
            <small>Este dispositivo</small>
          </div>
        </div>

        <nav aria-label="Secciones de Pliegue" className={styles.desktopNavigation}>
          {navigationItems.map((item) => (
            <NavigationLink
              collapsed={navigationCollapsed}
              key={item.href}
              pathname={pathname}
              {...item}
            />
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <Tag>{navigationCollapsed ? "LO" : "Local-only"}</Tag>
          <p className={styles.sidebarNote}>
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
          <div className={styles.topbarStart}>
            <Button
              aria-controls="workspace-navigation"
              aria-expanded={!navigationCollapsed}
              aria-label={
                navigationCollapsed ? "Mostrar la navegación" : "Esconder la navegación"
              }
              className={styles.navigationToggle}
              onClick={() => setNavigationCollapsed(!navigationCollapsed)}
              size="sm"
              variant="quiet"
            >
              <span aria-hidden="true">{navigationCollapsed ? "»" : "«"}</span>
            </Button>
            <div className={styles.breadcrumb}>
              <span>Área personal</span>
              <strong>{currentItem.label}</strong>
            </div>
          </div>
          <ThemeToggle />
        </header>

        <main
          className={cx(styles.content, isWideSection(pathname) && styles.contentWide)}
          id="workspace-content"
        >
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
