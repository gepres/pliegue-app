"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { Button, Card, Field, Input, Select } from "@pliegue/ui";

import { useAccount } from "../../cloud/account-store";
import { useIsPliegueAdmin } from "../../cloud/admin-store";
import { cloudClient } from "../../cloud/supabase-client";
import { reportReasons, type ReportReason } from "../../library-access/report-reasons";
import { confirmAction } from "../app-ui/confirm-dialog";
import { Icon } from "../app-ui/icons";
import styles from "./library-admin-panel.module.css";

/** Una biblioteca compartida tal como la ve el administrador: con su dueño y sus totales, sin nombres de visitantes. */
interface ModeratedLibrary {
  active: boolean;
  active_codes: number;
  created_at: string;
  entries: number;
  folder_id: string;
  last_notice_at: string | null;
  last_report_at: string | null;
  name: string;
  new_reports: number;
  notices: number;
  owner_email: string | null;
  owner_last_sign_in: string | null;
  owner_name: string;
  reports: number;
  slug: string;
  suspended_at: string | null;
  suspended_reason: string | null;
  visitors: number;
}

interface LibraryReport {
  created_at: string;
  details: string;
  file_id: string | null;
  id: number;
  library: string;
  reason: ReportReason;
  review_note: string;
  status: "descartada" | "nueva" | "revisada";
}

const plural = (count: number, one: string, many: string) => `${count.toLocaleString("es")} ${count === 1 ? one : many}`;

function shortDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es", { day: "numeric", hour: "2-digit", minute: "2-digit", month: "short" });
}

function describeError(error: { message?: string } | null) {
  if (!error) return null;
  if (/function .* does not exist|schema cache|relation .* does not exist/i.test(error.message ?? "")) {
    return "Falta aplicar la migración de moderación en Supabase.";
  }
  return error.message ?? "No fue posible completar la acción.";
}

async function fetchModeration() {
  const client = cloudClient();
  if (!client) return { error: "La nube no está configurada en esta instalación.", libraries: [], reports: [] };
  const [libraries, reports] = await Promise.all([
    client.rpc("admin_shared_libraries"),
    client.from("library_reports").select("id,library,file_id,reason,details,created_at,status,review_note").order("created_at", { ascending: false }).limit(200),
  ]);
  return {
    error: describeError(libraries.error ?? reports.error),
    libraries: (libraries.data ?? []) as ModeratedLibrary[],
    reports: (reports.data ?? []) as LibraryReport[],
  };
}

/** Avisar al dueño: le llega una alerta dentro de Pliegue. */
function NoticeForm({ library, onDone }: { library: ModeratedLibrary; onDone: (message: string | null) => void }) {
  const [kind, setKind] = useState<"aviso" | "incumplimiento">("incumplimiento");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = (name: string) => `notice-${library.slug}-${name}`;

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return setError("Escribe el título del aviso.");
    const client = cloudClient();
    if (!client) return;
    setBusy(true);
    const { error: sendError } = await client.rpc("admin_notify_library", { p_body: body, p_kind: kind, p_slug: library.slug, p_title: title });
    setBusy(false);
    if (sendError) return setError(describeError(sendError));
    onDone(`Aviso enviado a ${library.owner_email ?? "su dueño"}.`);
  }

  return (
    <form className={styles.editCode} onSubmit={(event) => void send(event)}>
      <Field label="Tipo" labelFor={id("kind")}>
        <Select id={id("kind")} onChange={(event) => setKind(event.target.value as typeof kind)} value={kind}>
          <option value="incumplimiento">Incumplimiento de las normas</option>
          <option value="aviso">Aviso</option>
        </Select>
      </Field>
      <Field label="Título" labelFor={id("title")}>
        <Input id={id("title")} maxLength={160} onChange={(event) => setTitle(event.target.value)} value={title} />
      </Field>
      <Field description="Lo verá el dueño dentro de Pliegue. Sin correo." label="Mensaje" labelFor={id("body")}>
        <textarea className={styles.longText} id={id("body")} maxLength={2000} onChange={(event) => setBody(event.target.value)} rows={3} value={body} />
      </Field>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button disabled={busy} size="sm" type="submit">
          {busy ? "Enviando…" : "Enviar aviso"}
        </Button>
        <Button disabled={busy} onClick={() => onDone(null)} size="sm" type="button" variant="quiet">
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/** Suspender: hace falta el motivo, que le llega al dueño. */
function SuspendForm({ library, onDone }: { library: ModeratedLibrary; onDone: (message: string | null) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function suspend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason.trim()) return setError("Escribe el motivo: le llegará al dueño.");
    const confirmed = await confirmAction({
      confirmLabel: "Suspender",
      description: `Nadie podrá entrar en /biblioteca/${library.slug} y su dueño no podrá reactivarla ni borrarla. Su cuenta sigue funcionando.`,
      icon: "flag",
      note: "Se puede deshacer con «Reactivar».",
      title: `¿Suspender «${library.name}»?`,
      tone: "danger",
    });
    if (!confirmed) return;
    const client = cloudClient();
    if (!client) return;
    setBusy(true);
    const { error: suspendError } = await client.rpc("admin_suspend_library", { p_reason: reason, p_slug: library.slug });
    setBusy(false);
    if (suspendError) return setError(describeError(suspendError));
    onDone(`«${library.name}» suspendida: su dueño ya tiene el motivo.`);
  }

  return (
    <form className={styles.editCode} onSubmit={(event) => void suspend(event)}>
      <Field description="Lo verá el dueño dentro de Pliegue." label="Motivo de la suspensión" labelFor={`suspend-${library.slug}`}>
        <textarea className={styles.longText} id={`suspend-${library.slug}`} maxLength={1000} onChange={(event) => setReason(event.target.value)} rows={3} value={reason} />
      </Field>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button disabled={busy} size="sm" type="submit" variant="danger">
          {busy ? "Suspendiendo…" : "Suspender biblioteca"}
        </Button>
        <Button disabled={busy} onClick={() => onDone(null)} size="sm" type="button" variant="quiet">
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function ReportsList({ onChanged, reports }: { onChanged: () => void; reports: readonly LibraryReport[] }) {
  const [filter, setFilter] = useState<"nueva" | "todas">("nueva");
  const [message, setMessage] = useState<string | null>(null);
  const visible = filter === "nueva" ? reports.filter((report) => report.status === "nueva") : reports;

  async function review(report: LibraryReport, status: LibraryReport["status"]) {
    const client = cloudClient();
    if (!client) return;
    const { error } = await client.rpc("admin_review_report", { p_id: report.id, p_note: "", p_status: status });
    setMessage(error ? describeError(error) : status === "revisada" ? "Denuncia marcada como revisada." : "Denuncia descartada.");
    onChanged();
  }

  return (
    <section aria-labelledby="moderation-reports-title" className={styles.block}>
      <div className={styles.blockHead}>
        <h3 id="moderation-reports-title">Denuncias</h3>
        <select aria-label="Qué denuncias ver" className={styles.filter} onChange={(event) => setFilter(event.target.value as typeof filter)} value={filter}>
          <option value="nueva">Nuevas</option>
          <option value="todas">Todas</option>
        </select>
      </div>
      {visible.length ? (
        <ul className={styles.codes}>
          {visible.map((report) => (
            <li key={report.id}>
              <div className={styles.codeHead}>
                <strong>{reportReasons[report.reason] ?? report.reason}</strong>
                <span className={styles.badge} data-status={report.status === "nueva" ? "suspended" : "disabled"}>
                  {report.status}
                </span>
              </div>
              <span className={styles.codeLabel}>
                <Link href={`/biblioteca/${report.library}`}>/biblioteca/{report.library}</Link>
                {report.file_id ? (
                  <>
                    {" · "}
                    <a href={`https://drive.google.com/file/d/${encodeURIComponent(report.file_id)}/view`} rel="noreferrer" target="_blank">
                      el libro denunciado
                    </a>
                  </>
                ) : null}
              </span>
              {report.details ? <span>{report.details}</span> : null}
              <small>
                {shortDate(report.created_at)}
                {report.review_note ? ` · nota: ${report.review_note}` : ""}
              </small>
              {report.status === "nueva" ? (
                <div className={styles.codeActions}>
                  <Button onClick={() => void review(report, "revisada")} size="sm" variant="secondary">
                    Marcar revisada
                  </Button>
                  <Button onClick={() => void review(report, "descartada")} size="sm" variant="quiet">
                    Descartar
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.note}>{filter === "nueva" ? "No hay denuncias nuevas." : "Todavía no hay denuncias."}</p>
      )}
      {message ? (
        <p className={styles.note} role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

function LibrariesList({ libraries, onChanged }: { libraries: readonly ModeratedLibrary[]; onChanged: () => void }) {
  const [open, setOpen] = useState<{ form: "notice" | "suspend"; slug: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function reactivate(library: ModeratedLibrary) {
    const confirmed = await confirmAction({
      confirmLabel: "Reactivar",
      description: `Se vuelve a entrar en /biblioteca/${library.slug} con sus códigos activos, y su dueño recibe el aviso.`,
      icon: "flag",
      title: `¿Reactivar «${library.name}»?`,
    });
    if (!confirmed) return;
    const client = cloudClient();
    if (!client) return;
    const { error } = await client.rpc("admin_reactivate_library", { p_note: "", p_slug: library.slug });
    setMessage(error ? describeError(error) : `«${library.name}» reactivada.`);
    onChanged();
  }

  const done = (result: string | null) => {
    setOpen(null);
    if (result) {
      setMessage(result);
      onChanged();
    }
  };

  return (
    <section aria-labelledby="moderation-libraries-title" className={styles.block}>
      <h3 id="moderation-libraries-title">Bibliotecas compartidas</h3>
      {libraries.length ? (
        <ul className={styles.codes}>
          {libraries.map((library) => {
            const status = library.suspended_at ? "suspended" : library.active ? "active" : "disabled";
            return (
              <li key={library.slug}>
                <div className={styles.codeHead}>
                  <strong>{library.name}</strong>
                  <span className={styles.badge} data-status={status}>
                    {status === "suspended" ? "Suspendida" : status === "active" ? "Abierta" : "Pausada por su dueño"}
                  </span>
                </div>
                <span className={styles.codeLabel}>
                  <Link href={`/biblioteca/${library.slug}`}>/biblioteca/{library.slug}</Link> ·{" "}
                  <a href={`https://drive.google.com/drive/folders/${encodeURIComponent(library.folder_id)}`} rel="noreferrer" target="_blank">
                    carpeta
                  </a>
                </span>
                <span>
                  {library.owner_name ? `${library.owner_name} · ` : ""}
                  {library.owner_email ?? "cuenta sin correo"}
                </span>
                <small>
                  Creada el {shortDate(library.created_at)} · su dueño entró por última vez el {shortDate(library.owner_last_sign_in)}
                </small>
                <small>
                  {plural(library.active_codes, "código activo", "códigos activos")} · {plural(library.entries, "entrada", "entradas")} ·{" "}
                  {plural(library.visitors, "persona", "personas")} · {plural(library.new_reports, "denuncia nueva", "denuncias nuevas")} de{" "}
                  {library.reports} · {plural(library.notices, "aviso", "avisos")}
                  {library.last_notice_at ? ` (el último, el ${shortDate(library.last_notice_at)})` : ""}
                </small>
                {library.suspended_reason ? <p className={styles.warning}>Motivo de la suspensión: {library.suspended_reason}</p> : null}
                {open?.slug === library.slug && open.form === "notice" ? <NoticeForm library={library} onDone={done} /> : null}
                {open?.slug === library.slug && open.form === "suspend" ? <SuspendForm library={library} onDone={done} /> : null}
                {open?.slug === library.slug ? null : (
                  <div className={styles.codeActions}>
                    <Button onClick={() => setOpen({ form: "notice", slug: library.slug })} size="sm" variant="secondary">
                      Avisar
                    </Button>
                    {library.suspended_at ? (
                      <Button onClick={() => void reactivate(library)} size="sm" variant="quiet">
                        Reactivar
                      </Button>
                    ) : (
                      <Button onClick={() => setOpen({ form: "suspend", slug: library.slug })} size="sm" variant="danger">
                        Suspender
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.note}>Todavía nadie ha creado una biblioteca compartida.</p>
      )}
      {message ? (
        <p className={styles.note} role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Ajustes → Moderación: las bibliotecas compartidas con su dueño, las denuncias de los
 * visitantes, y avisar, suspender o reactivar. Solo para administradores; los nombres de quienes
 * entran en cada biblioteca siguen siendo de su dueño.
 */
export function ModerationPanel() {
  const account = useAccount();
  const admin = useIsPliegueAdmin();
  const [data, setData] = useState<{ error: string | null; libraries: ModeratedLibrary[]; reports: LibraryReport[] } | null>(null);
  const load = useCallback(() => {
    void fetchModeration().then(setData);
  }, []);

  useEffect(() => {
    if (!admin) return;
    let active = true;
    void fetchModeration().then((next) => {
      if (active) setData(next);
    });
    return () => {
      active = false;
    };
  }, [admin]);

  const newReports = useMemo(() => data?.reports.filter((report) => report.status === "nueva").length ?? 0, [data]);
  const header = (
    <header className={styles.head}>
      <h2 id="moderation-title">Moderación</h2>
      <p>
        Quién creó cada biblioteca compartida, las denuncias de sus visitantes y los avisos. Suspender cierra la biblioteca, no la
        cuenta de su dueño.
      </p>
    </header>
  );

  if (account.status === "unavailable" || account.status === "signed-out") {
    return (
      <Card aria-labelledby="moderation-title" as="section" className={styles.panel}>
        {header}
        <p className={styles.note}>
          Inicia sesión con tu cuenta en <Link href="/app/ajustes#cuenta">Ajustes → Cuenta</Link> para moderar las bibliotecas.
        </p>
      </Card>
    );
  }
  if (admin !== true) {
    return (
      <Card aria-labelledby="moderation-title" as="section" className={styles.panel}>
        {header}
        <p className={styles.note}>{admin === null ? "Comprobando tu cuenta…" : "Esta cuenta no administra Pliegue."}</p>
      </Card>
    );
  }

  return (
    <Card aria-labelledby="moderation-title" as="section" className={styles.panel}>
      {header}
      <div className={styles.blockHead}>
        <p className={styles.note}>{data ? plural(newReports, "denuncia nueva", "denuncias nuevas") : "Cargando…"}</p>
        <Button onClick={load} size="sm" variant="quiet">
          <Icon name="refresh" size={16} />
          Actualizar
        </Button>
      </div>
      {data?.error ? (
        <p className={styles.error} role="alert">
          {data.error}
        </p>
      ) : null}
      {data ? (
        <>
          <ReportsList onChanged={load} reports={data.reports} />
          <LibrariesList libraries={data.libraries} onChanged={load} />
        </>
      ) : null}
    </Card>
  );
}
