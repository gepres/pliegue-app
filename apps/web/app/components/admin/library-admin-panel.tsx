"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { Button, Card, Field, Input } from "@pliegue/ui";

import { useAccount } from "../../cloud/account-store";
import { useIsPliegueAdmin } from "../../cloud/admin-store";
import { cloudClient } from "../../cloud/supabase-client";
import { normalizeAccessCode } from "../../library-access/access-session";
import {
  accessLink,
  codeStatus,
  codeStatusLabels,
  describeBrowser,
  suggestAccessCode,
  summarizeCodes,
  type AccessCodeRow,
  type AccessEventRow,
} from "../../library-access/admin-summary";
import { confirmAction } from "../app-ui/confirm-dialog";
import { Icon } from "../app-ui/icons";
import styles from "./library-admin-panel.module.css";

const plural = (count: number, one: string, many: string) => `${count.toLocaleString("es")} ${count === 1 ? one : many}`;

function shortDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es", { day: "numeric", hour: "2-digit", minute: "2-digit", month: "short" });
}

function dayDate(iso: string) {
  return new Date(iso).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" });
}

/** De «2026-10-31» (el campo de fecha) al final de ese día en la hora de quien lo elige. */
function endOfDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 23, 59, 59).toISOString();
}

function describeError(error: { code?: string; message?: string } | null) {
  if (!error) return null;
  if (error.code === "23505") return "Ese código ya existe: elige otro.";
  if (error.code === "23514") return "El código solo admite letras, números y guiones (de 4 a 40).";
  if (/relation .* does not exist|schema cache/i.test(error.message ?? "")) {
    return "Falta aplicar la migración de la biblioteca general en Supabase.";
  }
  return error.message ?? "No fue posible guardar el cambio.";
}

function NewCodeForm({ onCreated, userId }: { onCreated: () => void; userId: string }) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [expires, setExpires] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeAccessCode(code);
    if (!normalized) {
      setMessage("El código lleva de 4 a 40 letras, números o guiones, sin espacios.");
      return;
    }
    const uses = maxUses.trim() ? Number(maxUses) : null;
    if (uses !== null && (!Number.isInteger(uses) || uses < 1)) {
      setMessage("Los usos máximos son un número entero mayor que cero, o vacío para ilimitados.");
      return;
    }
    const client = cloudClient();
    if (!client) return;
    setBusy(true);
    setMessage(null);
    const { error } = await client.from("library_access_codes").insert({
      code: normalized,
      created_by: userId,
      expires_at: expires ? endOfDay(expires) : null,
      label: label.trim().slice(0, 120),
      library: "general",
      max_uses: uses,
    });
    setBusy(false);
    if (error) {
      setMessage(describeError(error));
      return;
    }
    setCode("");
    setLabel("");
    setExpires("");
    setMaxUses("");
    setMessage(`Código ${normalized} creado.`);
    onCreated();
  }

  return (
    <form className={styles.newCode} onSubmit={(event) => void create(event)}>
      <div className={styles.codeRow}>
        <Field label="Código" labelFor="admin-code">
          <Input
            autoComplete="off"
            className={styles.mono}
            id="admin-code"
            maxLength={40}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="OCT2026AREQUIPA"
            spellCheck={false}
            value={code}
          />
        </Field>
        <Button onClick={() => setCode(suggestAccessCode(new Date(), label))} size="sm" type="button" variant="secondary">
          Generar
        </Button>
      </div>
      <Field description="Para ti: a quién o para qué lo diste. Si lo escribes antes de «Generar», va en el código." label="Etiqueta" labelFor="admin-label">
        <Input id="admin-label" maxLength={120} onChange={(event) => setLabel(event.target.value)} placeholder="Arequipa" value={label} />
      </Field>
      <div className={styles.limits}>
        <Field description="Vacío: no caduca." label="Caduca el" labelFor="admin-expires">
          <Input id="admin-expires" onChange={(event) => setExpires(event.target.value)} type="date" value={expires} />
        </Field>
        <Field description="Vacío: ilimitado." label="Usos máximos" labelFor="admin-uses">
          <Input id="admin-uses" inputMode="numeric" min={1} onChange={(event) => setMaxUses(event.target.value)} type="number" value={maxUses} />
        </Field>
      </div>
      <div className={styles.actions}>
        <Button disabled={busy || !code.trim()} type="submit">
          {busy ? "Creando…" : "Crear código"}
        </Button>
        {message ? (
          <p className={styles.note} role="status">
            {message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function CodesList({
  codes,
  events,
  onChanged,
}: {
  codes: readonly AccessCodeRow[];
  events: readonly AccessEventRow[];
  onChanged: () => void;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const summaries = useMemo(() => summarizeCodes(codes, events), [codes, events]);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  async function toggle(code: AccessCodeRow) {
    const client = cloudClient();
    if (!client) return;
    const { error } = await client.from("library_access_codes").update({ active: !code.active }).eq("id", code.id);
    setMessage(error ? describeError(error) : code.active ? `${code.code} desactivado: quien entró con él sale en su próxima visita.` : `${code.code} activado.`);
    onChanged();
  }

  async function remove(code: AccessCodeRow) {
    const confirmed = await confirmAction({
      confirmLabel: "Borrar código",
      description: `Se borra ${code.code} y su registro de ${plural(code.uses, "entrada", "entradas")}.`,
      icon: "trash",
      note: "Si solo quieres cortar el acceso y conservar el registro, desactívalo.",
      title: `¿Borrar el código ${code.code}?`,
      tone: "danger",
    });
    if (!confirmed) return;
    const client = cloudClient();
    if (!client) return;
    const { error } = await client.from("library_access_codes").delete().eq("id", code.id);
    setMessage(error ? describeError(error) : `${code.code} borrado.`);
    onChanged();
  }

  async function copy(code: AccessCodeRow) {
    const link = accessLink(origin, code.code);
    try {
      await navigator.clipboard.writeText(link);
      setMessage(`Enlace copiado: ${link}`);
    } catch {
      setMessage(`Copia el enlace: ${link}`);
    }
  }

  if (!codes.length) return <p className={styles.note}>Todavía no hay códigos. Crea el primero arriba.</p>;

  return (
    <>
      <ul className={styles.codes}>
        {codes.map((code) => {
          const status = codeStatus(code);
          const summary = summaries.get(code.id);
          return (
            <li key={code.id}>
              <div className={styles.codeHead}>
                <strong className={styles.mono}>{code.code}</strong>
                <span className={styles.badge} data-status={status}>
                  {codeStatusLabels[status]}
                </span>
              </div>
              {code.label ? <span className={styles.codeLabel}>{code.label}</span> : null}
              <small>
                {code.uses.toLocaleString("es")}
                {code.max_uses !== null ? ` de ${code.max_uses.toLocaleString("es")}` : ""}{" "}
                {code.max_uses === null && code.uses === 1 ? "uso" : "usos"} ·{" "}
                {plural(summary?.people ?? 0, "persona", "personas")} · {plural(summary?.devices ?? 0, "equipo", "equipos")}
                {summary?.lastEntry ? ` · última entrada ${shortDate(summary.lastEntry)}` : ""}
              </small>
              <small>
                Creado el {dayDate(code.created_at)}
                {code.expires_at ? ` · caduca el ${dayDate(code.expires_at)}` : " · no caduca"}
              </small>
              <div className={styles.codeActions}>
                <Button onClick={() => void copy(code)} size="sm" variant="secondary">
                  <Icon name="copy" size={16} />
                  Copiar enlace
                </Button>
                <Button onClick={() => void toggle(code)} size="sm" variant="quiet">
                  {code.active ? "Desactivar" : "Activar"}
                </Button>
                <Button onClick={() => void remove(code)} size="sm" variant="danger">
                  Borrar
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {message ? (
        <p className={styles.note} role="status">
          {message}
        </p>
      ) : null}
    </>
  );
}

function EventsList({ codes, events }: { codes: readonly AccessCodeRow[]; events: readonly AccessEventRow[] }) {
  const [filter, setFilter] = useState("");
  const byId = useMemo(() => new Map(codes.map((code) => [code.id, code.code])), [codes]);
  const visible = filter ? events.filter((event) => event.code_id === filter) : events;

  return (
    <section aria-labelledby="admin-events-title" className={styles.block}>
      <div className={styles.blockHead}>
        <h3 id="admin-events-title">Quién entró</h3>
        {codes.length > 1 ? (
          <select aria-label="Filtrar por código" className={styles.filter} onChange={(event) => setFilter(event.target.value)} value={filter}>
            <option value="">Todos los códigos</option>
            {codes.map((code) => (
              <option key={code.id} value={code.id}>
                {code.code}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {visible.length ? (
        <ol className={styles.events}>
          {visible.map((event) => (
            <li key={event.id}>
              <strong>{event.visitor_name}</strong>
              <span className={styles.mono}>{byId.get(event.code_id) ?? "—"}</span>
              <small>
                {shortDate(event.created_at)} · {describeBrowser(event.user_agent)} · equipo {event.device_id.slice(0, 6)}
              </small>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.note}>Nadie ha entrado todavía{filter ? " con este código" : ""}.</p>
      )}
      <p className={styles.note}>Se muestran las últimas 300 entradas. El nombre es el que escribe cada visitante.</p>
    </section>
  );
}

interface AdminData {
  codes: AccessCodeRow[];
  error: string | null;
  events: AccessEventRow[];
}

/** Los códigos y las últimas 300 entradas; la base solo se los da a un administrador. */
async function fetchAdminData(): Promise<AdminData> {
  const client = cloudClient();
  if (!client) return { codes: [], error: "La nube no está configurada en esta instalación.", events: [] };
  const [codesResult, eventsResult] = await Promise.all([
    client.from("library_access_codes").select("id,code,label,active,expires_at,max_uses,uses,created_at").order("created_at", { ascending: false }),
    client.from("library_access_events").select("id,code_id,visitor_name,device_id,user_agent,created_at").order("created_at", { ascending: false }).limit(300),
  ]);
  return {
    codes: (codesResult.data ?? []) as AccessCodeRow[],
    error: describeError(codesResult.error ?? eventsResult.error),
    events: (eventsResult.data ?? []) as AccessEventRow[],
  };
}

/** Ajustes → Biblioteca general: los códigos de acceso y quién entró con ellos. Solo para administradores. */
export function LibraryAdminPanel() {
  const account = useAccount();
  const admin = useIsPliegueAdmin();
  const [codes, setCodes] = useState<AccessCodeRow[]>([]);
  const [events, setEvents] = useState<AccessEventRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const apply = useCallback((data: AdminData) => {
    setError(data.error);
    setCodes(data.codes);
    setEvents(data.events);
    setLoaded(true);
  }, []);
  const load = useCallback(() => {
    void fetchAdminData().then(apply);
  }, [apply]);

  useEffect(() => {
    if (!admin) return;
    let active = true;
    void fetchAdminData().then((data) => {
      if (active) apply(data);
    });
    return () => {
      active = false;
    };
  }, [admin, apply]);

  const header = (
    <header className={styles.head}>
      <h2 id="library-admin-title">Códigos de acceso</h2>
      <p>
        Los códigos con los que se entra en <Link href="/biblioteca/general">/biblioteca/general</Link> y quién entró con
        ellos. Desactivar un código corta el acceso en la próxima visita de quien lo usó.
      </p>
    </header>
  );

  if (account.status === "unavailable" || account.status === "signed-out") {
    return (
      <Card aria-labelledby="library-admin-title" as="section" className={styles.panel}>
        {header}
        <p className={styles.note}>
          Inicia sesión con tu cuenta en <Link href="/app/ajustes#cuenta">Ajustes → Cuenta</Link> para administrar la biblioteca general.
        </p>
      </Card>
    );
  }
  if (admin === null) {
    return (
      <Card aria-labelledby="library-admin-title" as="section" className={styles.panel}>
        {header}
        <p className={styles.note}>Comprobando tu cuenta…</p>
      </Card>
    );
  }
  if (!admin) {
    return (
      <Card aria-labelledby="library-admin-title" as="section" className={styles.panel}>
        {header}
        <p className={styles.note}>
          Esta cuenta ({account.email ?? "sin correo"}) no administra la biblioteca general. Para hacerla administradora, en el
          SQL Editor de Supabase:
        </p>
        <pre className={styles.sql}>
          {`insert into public.pliegue_admins (user_id)\nselect id from auth.users where email = '${account.email ?? "tu-correo"}';`}
        </pre>
      </Card>
    );
  }

  return (
    <Card aria-labelledby="library-admin-title" as="section" className={styles.panel}>
      {header}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <section aria-labelledby="admin-new-title" className={styles.block}>
        <h3 id="admin-new-title">Nuevo código</h3>
        <NewCodeForm onCreated={() => void load()} userId={account.userId ?? ""} />
      </section>
      <section aria-labelledby="admin-codes-title" className={styles.block}>
        <div className={styles.blockHead}>
          <h3 id="admin-codes-title">Códigos</h3>
          <Button onClick={() => void load()} size="sm" variant="quiet">
            <Icon name="refresh" size={16} />
            Actualizar
          </Button>
        </div>
        {loaded ? <CodesList codes={codes} events={events} onChanged={() => void load()} /> : <p className={styles.note}>Cargando…</p>}
      </section>
      {loaded ? <EventsList codes={codes} events={events} /> : null}
    </Card>
  );
}
