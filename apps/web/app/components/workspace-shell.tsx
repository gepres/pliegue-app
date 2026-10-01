"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { cx } from "@pliegue/ui";

import { useAccount } from "../cloud/account-store";
import { useSyncChoices } from "../cloud/sync/sync-controller";
import { useWorkspaceMode } from "../mode/workspace-mode-store";
import { isNavigationItemActive, isWideSection, navigationItems } from "../navigation";
import {
  setNavigationCollapsed,
  useShellLayout,
} from "../preferences/shell-layout-store";
import { ConfirmDialogHost } from "./app-ui/confirm-dialog";
import { NextStepHost } from "./app-ui/next-step-dialog";
import { BookCopiesSync } from "./book-copies-sync";
import { CloudSync } from "./cloud/cloud-sync";
import { InstallAppNavItem } from "./pwa/install-app";
import { IconButton } from "./app-ui/controls";
import { Icon } from "./app-ui/icons";
import { ThemeToggle } from "./theme-toggle";
import styles from "./workspace-shell.module.css";

type NavigationItem = (typeof navigationItems)[number];

function NavigationLink({
  collapsed = false,
  compact = false,
  item,
  pathname,
}: {
  collapsed?: boolean;
  compact?: boolean;
  item: NavigationItem;
  pathname: string;
}) {
  const active = isNavigationItemActive(pathname, item.href);

  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={cx(styles.navigationLink, compact && styles.navigationLinkCompact)}
      href={item.href}
      // Plegada, la etiqueta deja de verse y el icono es lo único que queda: el nombre
      // tiene que seguir llegando por el título y por el nombre accesible.
      title={collapsed ? item.label : undefined}
    >
      <span aria-hidden="true" className={styles.navigationIcon}>
        <Icon name={item.icon} size={compact ? 22 : 20} />
      </span>
      <span className={styles.navigationLabel}>{item.label}</span>
    </Link>
  );
}

/** Si la ventana se ha desplazado más de `threshold` píxeles. */
function useScrolledPast(threshold: number) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let frame = 0;
    function measure() {
      frame = 0;
      setScrolled(window.scrollY > threshold);
    }
    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(measure);
    }
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
    };
  }, [threshold]);

  return scrolled;
}

/**
 * Marco de la aplicación.
 *
 * Escritorio: barra lateral de iconos y etiquetas, plegable a un carril, y una barra de
 * título fina. Móvil: barra de título y pestañas abajo, al alcance del pulgar, con los
 * márgenes seguros del sistema. Con un documento abierto (`html[data-immersive]`) todo
 * esto se retira y manda el lector.
 */
export function WorkspaceShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const workspaceMode = useWorkspaceMode();
  const account = useAccount();
  const syncChoices = useSyncChoices(account.userId);
  const synced = account.status === "signed-in" && syncChoices.enabled;
  const { navigationCollapsed } = useShellLayout();
  const currentItem =
    navigationItems.find((item) => isNavigationItemActive(pathname, item.href)) ??
    navigationItems[0];
  const scrolled = useScrolledPast(56);

  return (
    <div className={cx(styles.shell, navigationCollapsed && styles.shellCollapsed)}>
      <a className="skip-link" href="#workspace-content">
        Saltar al contenido
      </a>

      <aside className={styles.sidebar} id="workspace-navigation">
        <div className={styles.sidebarHead}>
          <Link
            aria-label="Pliegue, inicio público"
            className={styles.brand}
            href="/"
            title={navigationCollapsed ? "Pliegue" : undefined}
          >
            <Image alt="" height={30} priority src="/brand/pliegue-mark.svg" width={30} />
            <span className={styles.brandName}>Pliegue</span>
          </Link>
        </div>

        <nav aria-label="Secciones de Pliegue" className={styles.desktopNavigation}>
          {navigationItems.map((item) => (
            <NavigationLink
              collapsed={navigationCollapsed}
              item={item}
              key={item.href}
              pathname={pathname}
            />
          ))}
        </nav>

        <InstallAppNavItem
          classNames={{
            icon: styles.navigationIcon,
            item: cx(styles.navigationLink, styles.installItem),
            label: styles.navigationLabel,
          }}
          collapsed={navigationCollapsed}
        />

        <div className={styles.sidebarFooter}>
          <Link
            className={styles.areaIdentity}
            href="/app/ajustes#cuenta"
            title={
              synced
                ? `Sincronizada con ${account.email ?? "tu cuenta"}`
                : workspaceMode.confirmedAt
                  ? "Modo local confirmado en este dispositivo"
                  : "Los archivos permanecen bajo tu control"
            }
          >
            <span aria-hidden="true" className={styles.areaDot} data-synced={synced ? "" : undefined} />
            <span className={styles.areaText}>
              <strong>Área personal</strong>
              <small>{synced ? `Sincronizada · ${account.email ?? "tu cuenta"}` : "Local · este dispositivo"}</small>
            </span>
          </Link>
          <IconButton
            aria-controls="workspace-navigation"
            aria-expanded={!navigationCollapsed}
            className={styles.navigationToggle}
            icon="sidebar"
            label={navigationCollapsed ? "Mostrar la navegación" : "Plegar la navegación"}
            onClick={() => setNavigationCollapsed(!navigationCollapsed)}
            size="sm"
          />
        </div>
      </aside>

      <div className={styles.contentColumn}>
        <header className={styles.topbar} data-scrolled={scrolled ? "true" : "false"}>
          <Link aria-label="Pliegue, inicio público" className={styles.mobileBrand} href="/">
            <Image alt="" height={28} priority src="/brand/pliegue-mark.svg" width={28} />
          </Link>
          {/* Título pequeño de barra: aparece cuando el grande de la página se ha ido hacia
              arriba, como en las apps nativas. No es un encabezado; el de la página lo es. */}
          <span aria-hidden="true" className={styles.topbarTitle}>
            {currentItem.label}
          </span>
          <div className={styles.topbarActions}>
            <ThemeToggle compact />
          </div>
        </header>

        <main
          className={cx(styles.content, isWideSection(pathname) && styles.contentWide)}
          id="workspace-content"
        >
          {children}
        </main>
      </div>

      <nav aria-label="Navegación principal" className={styles.mobileNavigation}>
        {navigationItems.map((item) => (
          <NavigationLink compact item={item} key={item.href} pathname={pathname} />
        ))}
      </nav>

      <ConfirmDialogHost />
      <NextStepHost />
      <BookCopiesSync />
      <CloudSync />
    </div>
  );
}
