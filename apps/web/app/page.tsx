import Image from "next/image";
import Link from "next/link";

import { buttonClassName, Card, Tag } from "@pliegue/ui";

import { ThemeToggle } from "./components/theme-toggle";
import styles from "./page.module.css";

const foundations = [
  { label: "Tokens", value: "Light · Dark · System" },
  { label: "Componentes", value: "Reutilizables y accesibles" },
  { label: "Calidad", value: "Lint · Tipos · Pruebas · Build" },
];

export default function HomePage() {
  return (
    <div className={styles.page}>
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>

      <header className={styles.header}>
        <Link aria-label="Pliegue, inicio" className={styles.wordmark} href="/">
          <Image
            alt=""
            height={32}
            priority
            src="/brand/pliegue-mark.svg"
            width={32}
          />
          <span>Pliegue</span>
        </Link>
        <nav aria-label="Navegación principal" className={styles.nav}>
          <Link href="/app">Abrir app</Link>
          <Link href="/design-system">Sistema visual</Link>
          <ThemeToggle />
        </nav>
      </header>

      <main className={styles.main} id="contenido">
        <section className={styles.hero}>
          <Tag>Base frontend · v0.1</Tag>
          <Image
            alt="Marca de Pliegue"
            className={styles.mark}
            height={88}
            priority
            src="/brand/pliegue-mark.svg"
            width={88}
          />
          <h1>Pliegue</h1>
          <p>Todo lo que guardaste, por fin entendible, legible y conectado.</p>
          <div className={styles.rule} />
          <div className={styles.actions}>
            <Link className={buttonClassName()} href="/app">
              Entrar al Área
            </Link>
            <Link
              className={buttonClassName({ variant: "secondary" })}
              href="/design-system"
            >
              Sistema visual
            </Link>
            <a
              className={buttonClassName({ variant: "quiet" })}
              href="https://www.figma.com/design/2CFIc5079NMSYinTxXXTpS/Pliegue-%E2%80%94-Prototipo-de-validaci%C3%B3n-v0.1?node-id=0-1&p=f&t=t23Jxpn0Xyc2ouRm-0"
              rel="noreferrer"
              target="_blank"
            >
              Abrir Figma
            </a>
          </div>
        </section>

        <section aria-labelledby="base-title" className={styles.foundationSection}>
          <div>
            <span className={styles.eyebrow}>Fundamentos implementados</span>
            <h2 id="base-title">Una base visual compartida desde el primer día</h2>
          </div>
          <div className={styles.grid}>
            {foundations.map((item) => (
              <Card key={item.label}>
                <span className={styles.cardLabel}>{item.label}</span>
                <strong>{item.value}</strong>
              </Card>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
