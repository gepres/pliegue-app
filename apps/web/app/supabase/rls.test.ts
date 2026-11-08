/**
 * Permisos de la cuenta (06.5): las políticas RLS de Supabase, probadas de verdad.
 *
 * Las migraciones reales (`supabase/migrations`, en orden) se cargan en un Postgres en memoria
 * (PGlite), con lo mínimo que Supabase da hecho: roles, `auth.uid()`, `auth.users` y las tablas de
 * Storage. Con dos cuentas (A y B) y una visita sin cuenta, se comprueba que cada una solo ve y
 * toca lo suyo, que la administración tiene su sitio, que las funciones `security definer`
 * dejan o no según quién llama, y que una tabla nueva sin RLS hace fallar la prueba.
 *
 * Las tablas se abren con todos los permisos para que lo único que limite sea RLS: así un
 * permiso de tabla no tapa una política mal hecha. Las restricciones por columna no se miran aquí.
 */
import { readFileSync, readdirSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const userA = "00000000-0000-0000-0000-00000000000a";
const userB = "00000000-0000-0000-0000-00000000000b";
type Session = typeof userA | typeof userB | "anon" | "service_role";
const visitors = [["A", userA], ["B", userB], ["anon", "anon"]] as const;
let db: PGlite;

async function rows(sql: string, params: unknown[] = []) {
  return (await db.query<Record<string, unknown>>(sql, params)).rows;
}

// El cambio de cuenta nunca deja permisos ni datos de sesión para la siguiente consulta.
// El punto de retorno permite comprobar un rechazo sin perder el resto de la prueba.
async function as<T>(user: Session, fn: () => Promise<T>): Promise<T> {
  const role = user === "anon" || user === "service_role" ? user : "authenticated";
  const sub = role === "authenticated" ? user : "";
  await db.exec("savepoint acting_as");
  try {
    await db.exec(`set local role ${role}`);
    await db.query(
      `select set_config('request.jwt.claim.sub', $1, true),
              set_config('request.jwt.claims', $2, true)`,
      [sub, JSON.stringify({ role, ...(sub ? { sub } : {}) })],
    );
    return await fn();
  } catch (error) {
    await db.exec("rollback to savepoint acting_as");
    throw error;
  } finally {
    await db.exec(`
      reset role;
      select set_config('request.jwt.claim.sub', '', true),
             set_config('request.jwt.claims', '', true);
      release savepoint acting_as;
    `);
  }
}

async function makeAdmin() {
  await db.query("insert into public.pliegue_admins (user_id) values ($1)", [userA]);
}

function redeem(user: Session, code = "CODE-A", library = "cuenta-a") {
  return as(user, () => rows(
    "select * from public.redeem_library_code($1, $2, 'Visita', 'equipo', '', 'conexion')",
    [code, library],
  ));
}

beforeAll(async () => {
  db = new PGlite();
  // Supabase aporta estos roles, esquemas y funciones. No sustituimos ninguna política.
  // raw_user_meta_data y last_sign_in_at se usan en admin_shared_libraries.
  // gen_random_uuid ya forma parte de Postgres; estas migraciones no necesitan extensiones.
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb not null default '{}',
      last_sign_in_at timestamptz
    );
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
      )::uuid;
    $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}');
    $$;
    create schema storage;
    create table storage.buckets (
      id text primary key,
      name text not null,
      public boolean not null default false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text not null references storage.buckets (id),
      name text not null,
      owner uuid references auth.users (id),
      metadata jsonb not null default '{}',
      unique (bucket_id, name)
    );
    alter table storage.buckets enable row level security;
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
    $$;
    grant usage on schema auth, storage, public to anon, authenticated, service_role;
    grant execute on all functions in schema auth, storage to anon, authenticated, service_role;
    grant select, insert, update, delete on storage.objects to anon, authenticated;

    -- Los permisos por defecto existen antes de las migraciones, como en Supabase.
    alter default privileges in schema public
      grant select, insert, update, delete on tables to anon, authenticated;
    alter default privileges in schema public
      grant execute on functions to anon, authenticated;
    alter default privileges in schema public
      grant usage, select on sequences to anon, authenticated;
  `);

  const migrations = new URL("../../../../supabase/migrations/", import.meta.url);
  const filenames = readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort();
  expect(filenames.length).toBeGreaterThan(0);
  for (const filename of filenames) {
    await db.exec(readFileSync(new URL(filename, migrations), "utf8"));
  }

  // Abrimos las tablas para comprobar las filas, sin que un permiso de tabla oculte un fallo.
  // Conservamos los permisos de funciones: el canje está reservado al servidor.
  // No comprobamos aquí las restricciones por columna (nombre, active y read_at).
  await db.exec(`
    grant select, insert, update, delete on all tables in schema public to anon, authenticated;
    grant usage, select on all sequences in schema public to anon, authenticated;
  `);
}, 30_000);

beforeEach(async () => {
  // Cada caso parte de las mismas dos cuentas; al terminar deshacemos todos sus cambios.
  await db.exec(`
    begin;
    insert into auth.users (id, email) values ('${userA}', 'a@example.test'), ('${userB}', 'b@example.test');
    insert into public.sync_items (user_id, collection, item_key, payload, updated_at, device_id)
    values ('${userA}', 'notes', 'nota-a', '{"text":"A"}', now(), 'equipo-a'),
           ('${userB}', 'notes', 'nota-b', '{"text":"B"}', now(), 'equipo-b');
    insert into public.shared_libraries (slug, owner_id, folder_id, name)
    values ('cuenta-a', '${userA}', 'carpeta-cuenta-a', 'Biblioteca A'),
           ('cuenta-b', '${userB}', 'carpeta-cuenta-b', 'Biblioteca B');
    insert into public.library_access_codes (library, code, created_by)
    values ('cuenta-a', 'CODE-A', '${userA}'), ('cuenta-b', 'CODE-B', '${userB}'), ('general', 'GENERAL', null);
    insert into public.library_access_events (code_id, library, visitor_name, device_id)
    select id, library, 'Visita', 'equipo' from public.library_access_codes;
    insert into public.library_access_failures (client_hash) values ('conexion');
    insert into public.library_reports (library, reason, visitor_name, device_id, client_hash)
    values ('cuenta-a', 'derechos', 'Visita A', 'equipo-a', 'conexion-a'),
           ('cuenta-b', 'otro', 'Visita B', 'equipo-b', 'conexion-b');
    insert into public.user_notices (user_id, library, kind, title)
    values ('${userA}', 'cuenta-a', 'aviso', 'Aviso A'), ('${userB}', 'cuenta-b', 'aviso', 'Aviso B');
    insert into storage.objects (bucket_id, name, owner)
    values ('translations', '${userA}/libro/es.json', '${userA}'),
           ('translations', '${userB}/libro/es.json', '${userB}');
  `);
});

afterEach(async () => {
  await db.exec("rollback");
});

afterAll(async () => {
  await db.close();
});

describe("public", () => {
  it("todas las tablas tienen protección por cuenta", async () => {
    const tables = await rows(`
      select c.relname, c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by c.relname
    `);
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.filter((table) => !table.relrowsecurity)).toEqual([]);
  });
});

describe("sync_items", () => {
  it("A crea, lee, cambia y borra sus elementos", async () => {
    await as(userA, async () => {
      expect(await rows(`
        insert into public.sync_items (user_id, collection, item_key, updated_at, device_id)
        values ($1, 'notes', 'nueva', now(), 'equipo') returning item_key
      `, [userA])).toEqual([{ item_key: "nueva" }]);
      expect(await rows("select item_key from public.sync_items order by item_key"))
        .toEqual([{ item_key: "nota-a" }, { item_key: "nueva" }]);
      expect(await rows(`
        update public.sync_items set payload = '{"text":"cambio"}'
        where item_key = 'nueva' returning payload
      `)).toEqual([{ payload: { text: "cambio" } }]);
      expect(await rows("delete from public.sync_items where item_key = 'nueva' returning item_key"))
        .toEqual([{ item_key: "nueva" }]);
    });
  });

  it("B no ve los elementos de A", async () => {
    expect(await as(userB, () => rows("select item_key from public.sync_items")))
      .toEqual([{ item_key: "nota-b" }]);
  });

  it("B no cambia los elementos de A", async () => {
    expect(await as(userB, () => rows(
      "update public.sync_items set payload = null where user_id = $1 returning item_key", [userA],
    ))).toEqual([]);
    expect(await rows("select payload from public.sync_items where user_id = $1", [userA]))
      .toEqual([{ payload: { text: "A" } }]);
  });

  it("B no borra los elementos de A", async () => {
    expect(await as(userB, () => rows(
      "delete from public.sync_items where user_id = $1 returning item_key", [userA],
    ))).toEqual([]);
    expect(await rows("select item_key from public.sync_items where user_id = $1", [userA]))
      .toEqual([{ item_key: "nota-a" }]);
  });

  it("A no crea elementos a nombre de B", async () => {
    await expect(as(userA, () => rows(`
      insert into public.sync_items (user_id, collection, item_key, updated_at, device_id)
      values ($1, 'notes', 'ajena', now(), 'equipo')
    `, [userB]))).rejects.toMatchObject({ code: "42501" });
  });

  it("A no pasa un elemento a B", async () => {
    await expect(as(userA, () => rows(
      "update public.sync_items set user_id = $1 where user_id = $2", [userB, userA],
    ))).rejects.toMatchObject({ code: "42501" });
  });

  it("sin cuenta no se ve ningún elemento", async () => {
    expect(await as("anon", () => rows("select * from public.sync_items"))).toEqual([]);
  });

  it("sin cuenta no se pueden crear elementos", async () => {
    await expect(as("anon", () => rows(`
      insert into public.sync_items (user_id, collection, item_key, updated_at, device_id)
      values ($1, 'notes', 'ajena', now(), 'equipo')
    `, [userA]))).rejects.toMatchObject({ code: "42501" });
  });
});

describe("shared_libraries", () => {
  it("A solo ve su biblioteca y puede cambiarla", async () => {
    await as(userA, async () => {
      expect(await rows("select slug from public.shared_libraries")).toEqual([{ slug: "cuenta-a" }]);
      expect(await rows(`
        update public.shared_libraries set name = 'Otro nombre', active = false returning name, active
      `)).toEqual([{ name: "Otro nombre", active: false }]);
    });
  });

  it("B no cambia ni borra la biblioteca de A", async () => {
    await as(userB, async () => {
      expect(await rows("update public.shared_libraries set active = false where slug = 'cuenta-a' returning slug"))
        .toEqual([]);
      expect(await rows("delete from public.shared_libraries where slug = 'cuenta-a' returning slug"))
        .toEqual([]);
    });
  });

  it("A no puede pasar su biblioteca a B", async () => {
    // B deja libre su plaza para que sea la política, y no la clave única, la que rechace el cambio.
    await db.exec("delete from public.shared_libraries where slug = 'cuenta-b'");
    await expect(as(userA, () => rows(
      "update public.shared_libraries set owner_id = $1 where slug = 'cuenta-a'", [userB],
    ))).rejects.toMatchObject({ code: "42501" });
  });

  it("A puede borrar su biblioteca y sus códigos desaparecen", async () => {
    expect(await as(userA, () => rows("delete from public.shared_libraries where slug = 'cuenta-a' returning slug")))
      .toEqual([{ slug: "cuenta-a" }]);
    expect(await rows("select * from public.library_access_codes where library = 'cuenta-a'")).toEqual([]);
    expect(await rows("select * from public.library_access_events where library = 'cuenta-a'")).toEqual([]);
  });

  it("A no puede borrar su biblioteca suspendida", async () => {
    await db.exec("update public.shared_libraries set suspended_at = now() where slug = 'cuenta-a'");
    expect(await as(userA, () => rows("delete from public.shared_libraries where slug = 'cuenta-a' returning slug")))
      .toEqual([]);
    expect(await as(userA, () => rows("select slug from public.shared_libraries"))).toEqual([{ slug: "cuenta-a" }]);
  });

  it("ser administrador no expone las bibliotecas de otros dueños", async () => {
    await makeAdmin();
    expect(await as(userA, () => rows("select slug from public.shared_libraries"))).toEqual([{ slug: "cuenta-a" }]);
  });

  it.each(visitors)("%s no crea bibliotecas desde el navegador", async (_name, user) => {
    await expect(as(user, () => rows(`
      insert into public.shared_libraries (slug, owner_id, folder_id, name)
      values ('nueva', $1, 'carpeta-nueva', 'Nueva')
    `, [userA]))).rejects.toMatchObject({ code: "42501" });
  });

  it("sin cuenta no se ven ni se cambian bibliotecas", async () => {
    await as("anon", async () => {
      expect(await rows("select * from public.shared_libraries")).toEqual([]);
      expect(await rows("update public.shared_libraries set active = false returning slug")).toEqual([]);
      expect(await rows("delete from public.shared_libraries returning slug")).toEqual([]);
    });
  });

  it("can_manage_library permite al dueño y rechaza a otra cuenta", async () => {
    expect(await as(userA, () => rows("select public.can_manage_library('cuenta-a') as allowed")))
      .toEqual([{ allowed: true }]);
    expect(await as(userB, () => rows("select public.can_manage_library('cuenta-a') as allowed")))
      .toEqual([{ allowed: false }]);
  });

  it("can_manage_library reserva la general al administrador", async () => {
    await makeAdmin();
    expect(await as(userA, () => rows("select public.can_manage_library('general') as allowed")))
      .toEqual([{ allowed: true }]);
    expect(await as(userB, () => rows("select public.can_manage_library('general') as allowed")))
      .toEqual([{ allowed: false }]);
    expect(await as(userA, () => rows("select public.can_manage_library('cuenta-b') as allowed")))
      .toEqual([{ allowed: false }]);
  });

  it("can_manage_library no da permisos sin cuenta", async () => {
    expect(await as("anon", () => rows("select public.can_manage_library('cuenta-a') as allowed")))
      .toEqual([{ allowed: false }]);
  });
});

describe("library_access_codes", () => {
  it("A administra solo los códigos de su biblioteca", async () => {
    await as(userA, async () => {
      expect(await rows("select code from public.library_access_codes")).toEqual([{ code: "CODE-A" }]);
      expect(await rows(`
        insert into public.library_access_codes (library, code) values ('cuenta-a', 'NUEVO') returning code
      `)).toEqual([{ code: "NUEVO" }]);
      expect(await rows("update public.library_access_codes set active = false where code = 'NUEVO' returning active"))
        .toEqual([{ active: false }]);
      expect(await rows("delete from public.library_access_codes where code = 'NUEVO' returning code"))
        .toEqual([{ code: "NUEVO" }]);
    });
  });

  it("B no ve, cambia ni borra los códigos de A", async () => {
    await as(userB, async () => {
      expect(await rows("select code from public.library_access_codes")).toEqual([{ code: "CODE-B" }]);
      expect(await rows("update public.library_access_codes set active = false where library = 'cuenta-a' returning id"))
        .toEqual([]);
      expect(await rows("delete from public.library_access_codes where library = 'cuenta-a' returning id"))
        .toEqual([]);
    });
  });

  it("B no crea códigos en la biblioteca de A", async () => {
    await expect(as(userB, () => rows(`
      insert into public.library_access_codes (library, code) values ('cuenta-a', 'AJENO')
    `))).rejects.toMatchObject({ code: "42501" });
  });

  it("A no mueve un código a la biblioteca de B", async () => {
    await expect(as(userA, () => rows(`
      update public.library_access_codes set library = 'cuenta-b' where code = 'CODE-A'
    `))).rejects.toMatchObject({ code: "42501" });
  });

  it("el administrador administra la general sin acceder a los códigos de B", async () => {
    await makeAdmin();
    await as(userA, async () => {
      expect(await rows("select code from public.library_access_codes order by code"))
        .toEqual([{ code: "CODE-A" }, { code: "GENERAL" }]);
      expect(await rows(`
        insert into public.library_access_codes (library, code) values ('general', 'NUEVO') returning code
      `)).toEqual([{ code: "NUEVO" }]);
      expect(await rows("update public.library_access_codes set active = false where code = 'NUEVO' returning active"))
        .toEqual([{ active: false }]);
      expect(await rows("delete from public.library_access_codes where code = 'NUEVO' returning code"))
        .toEqual([{ code: "NUEVO" }]);
    });
  });

  it("una cuenta corriente no crea códigos en la general", async () => {
    await expect(as(userB, () => rows(`
      insert into public.library_access_codes (library, code) values ('general', 'AJENO')
    `))).rejects.toMatchObject({ code: "42501" });
  });

  it("sin cuenta no se leen, cambian ni borran códigos", async () => {
    await as("anon", async () => {
      expect(await rows("select * from public.library_access_codes")).toEqual([]);
      expect(await rows("update public.library_access_codes set active = false returning id")).toEqual([]);
      expect(await rows("delete from public.library_access_codes returning id")).toEqual([]);
    });
  });

  it("sin cuenta no se crean códigos", async () => {
    await expect(as("anon", () => rows(`
      insert into public.library_access_codes (library, code) values ('cuenta-a', 'AJENO')
    `))).rejects.toMatchObject({ code: "42501" });
  });

  it("redeem_library_code permite al servidor canjear un código válido", async () => {
    expect(await redeem("service_role")).toMatchObject([{ ok: true, reason: "ok" }]);
    expect(await rows("select uses from public.library_access_codes where code = 'CODE-A'"))
      .toEqual([{ uses: 0 }]);
    // La visita ya estaba registrada: volver no gasta un uso.
    expect(await rows("select count(*)::integer as total from public.library_access_events where library = 'cuenta-a'"))
      .toEqual([{ total: 2 }]);
  });

  it.each(visitors)("redeem_library_code rechaza el canje directo de %s", async (_name, user) => {
    await expect(redeem(user)).rejects.toMatchObject({ code: "42501" });
    expect(await rows("select uses from public.library_access_codes where code = 'CODE-A'"))
      .toEqual([{ uses: 0 }]);
  });

  it("redeem_library_code rechaza un código de otra biblioteca", async () => {
    expect(await redeem("service_role", "CODE-A", "cuenta-b"))
      .toMatchObject([{ ok: false, reason: "invalid", code_id: null }]);
  });

  it.each([["pausada", "active = false"], ["suspendida", "suspended_at = now()"]])("no se canjea con la biblioteca %s", async (_name, change) => {
    await db.exec(`update public.shared_libraries set ${change} where slug = 'cuenta-a'`);
    expect(await redeem("service_role")).toMatchObject([{ ok: false, reason: "closed", code_id: null }]);
    expect(await rows("select count(*)::integer as total from public.library_access_events where library = 'cuenta-a'"))
      .toEqual([{ total: 1 }]);
  });
});

describe("library_access_events", () => {
  it("A ve y borra solo las entradas de su biblioteca", async () => {
    await as(userA, async () => {
      expect(await rows("select library from public.library_access_events")).toEqual([{ library: "cuenta-a" }]);
      expect(await rows("delete from public.library_access_events returning library")).toEqual([{ library: "cuenta-a" }]);
    });
    expect(await rows("select library from public.library_access_events order by library"))
      .toEqual([{ library: "cuenta-b" }, { library: "general" }]);
  });

  it("B no lee ni borra las entradas de A", async () => {
    await as(userB, async () => {
      expect(await rows("select library from public.library_access_events")).toEqual([{ library: "cuenta-b" }]);
      expect(await rows("delete from public.library_access_events where library = 'cuenta-a' returning id"))
        .toEqual([]);
    });
  });

  it("el administrador solo añade las entradas de la general a las propias", async () => {
    await makeAdmin();
    await as(userA, async () => {
      expect(await rows("select library from public.library_access_events order by library"))
        .toEqual([{ library: "cuenta-a" }, { library: "general" }]);
      expect(await rows("delete from public.library_access_events where library = 'general' returning library"))
        .toEqual([{ library: "general" }]);
    });
  });

  it.each(visitors)("%s no fabrica entradas", async (_name, user) => {
    const [code] = await rows("select id from public.library_access_codes where code = 'CODE-A'");
    await expect(as(user, () => rows(`
      insert into public.library_access_events (code_id, library, visitor_name, device_id)
      values ($1, 'cuenta-a', 'Inventada', 'equipo')
    `, [code?.id]))).rejects.toMatchObject({ code: "42501" });
  });

  it("ni el dueño ni el administrador reescriben entradas", async () => {
    await makeAdmin();
    expect(await as(userA, () => rows("update public.library_access_events set visitor_name = 'Otro' returning id")))
      .toEqual([]);
  });

  it("sin cuenta no se leen ni borran entradas", async () => {
    await as("anon", async () => {
      expect(await rows("select * from public.library_access_events")).toEqual([]);
      expect(await rows("delete from public.library_access_events returning id")).toEqual([]);
    });
  });
});

describe("library_access_failures", () => {
  it.each(visitors)("%s no ve, cambia ni borra los intentos fallidos", async (_name, user) => {
    await makeAdmin();
    await as(user, async () => {
      expect(await rows("select * from public.library_access_failures")).toEqual([]);
      expect(await rows("update public.library_access_failures set client_hash = 'otro' returning id")).toEqual([]);
      expect(await rows("delete from public.library_access_failures returning id")).toEqual([]);
    });
    expect(await rows("select client_hash from public.library_access_failures")).toEqual([{ client_hash: "conexion" }]);
  });

  it.each(visitors)("%s no registra intentos fallidos directamente", async (_name, user) => {
    await makeAdmin();
    await expect(as(user, () => rows("insert into public.library_access_failures (client_hash) values ('otro')")))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("el servidor registra el fallo al canjear un código incorrecto", async () => {
    expect(await redeem("service_role", "INCORRECTO")).toMatchObject([{ ok: false, reason: "invalid" }]);
    expect(await rows("select count(*)::integer as total from public.library_access_failures"))
      .toEqual([{ total: 2 }]);
  });
});

describe("library_reports", () => {
  it("solo el administrador ve las denuncias", async () => {
    await makeAdmin();
    expect(await as(userA, () => rows("select library from public.library_reports order by library")))
      .toEqual([{ library: "cuenta-a" }, { library: "cuenta-b" }]);
    expect(await as(userB, () => rows("select * from public.library_reports"))).toEqual([]);
    expect(await as("anon", () => rows("select * from public.library_reports"))).toEqual([]);
  });

  it("el dueño tampoco ve las denuncias de su biblioteca", async () => {
    expect(await as(userA, () => rows("select * from public.library_reports where library = 'cuenta-a'")))
      .toEqual([]);
  });

  it.each(visitors)("%s no crea denuncias directamente", async (_name, user) => {
    await makeAdmin();
    await expect(as(user, () => rows(`
      insert into public.library_reports (library, reason, visitor_name, device_id, client_hash)
      values ('cuenta-a', 'otro', 'Inventada', 'equipo', 'conexion')
    `))).rejects.toMatchObject({ code: "42501" });
  });

  it.each(visitors)("%s no cambia ni borra denuncias directamente", async (_name, user) => {
    await makeAdmin();
    await as(user, async () => {
      expect(await rows("update public.library_reports set status = 'descartada' returning id")).toEqual([]);
      expect(await rows("delete from public.library_reports returning id")).toEqual([]);
    });
  });
});

describe("user_notices", () => {
  it("A solo ve sus avisos y puede marcarlos como leídos", async () => {
    await as(userA, async () => {
      expect(await rows("select title from public.user_notices")).toEqual([{ title: "Aviso A" }]);
      expect(await rows("update public.user_notices set read_at = now() returning title, read_at is not null as leido"))
        .toEqual([{ title: "Aviso A", leido: true }]);
    });
  });

  it("B no ve ni marca los avisos de A", async () => {
    await as(userB, async () => {
      expect(await rows("select title from public.user_notices")).toEqual([{ title: "Aviso B" }]);
      expect(await rows("update public.user_notices set read_at = now() where user_id = $1 returning id", [userA]))
        .toEqual([]);
    });
  });

  it("ser administrador no permite leer los avisos de B", async () => {
    await makeAdmin();
    expect(await as(userA, () => rows("select title from public.user_notices"))).toEqual([{ title: "Aviso A" }]);
  });

  it("A no pasa sus avisos a B", async () => {
    await expect(as(userA, () => rows("update public.user_notices set user_id = $1 where user_id = $2", [userB, userA])))
      .rejects.toMatchObject({ code: "42501" });
  });

  it.each(visitors)("%s no crea avisos directamente", async (_name, user) => {
    await makeAdmin();
    await expect(as(user, () => rows(`
      insert into public.user_notices (user_id, kind, title) values ($1, 'aviso', 'Inventado')
    `, [userA]))).rejects.toMatchObject({ code: "42501" });
  });

  it.each(visitors)("%s no borra avisos", async (_name, user) => {
    await makeAdmin();
    expect(await as(user, () => rows("delete from public.user_notices returning id"))).toEqual([]);
  });

  it("sin cuenta no se leen ni se marcan avisos", async () => {
    await as("anon", async () => {
      expect(await rows("select * from public.user_notices")).toEqual([]);
      expect(await rows("update public.user_notices set read_at = now() returning id")).toEqual([]);
    });
  });
});

describe("pliegue_admins", () => {
  it("cada administrador solo ve su propia cuenta", async () => {
    await db.query("insert into public.pliegue_admins (user_id) values ($1), ($2)", [userA, userB]);
    expect(await as(userA, () => rows("select user_id from public.pliegue_admins"))).toEqual([{ user_id: userA }]);
    expect(await as(userB, () => rows("select user_id from public.pliegue_admins"))).toEqual([{ user_id: userB }]);
  });

  it("una cuenta corriente y una visita no ven administradores", async () => {
    await makeAdmin();
    expect(await as(userB, () => rows("select * from public.pliegue_admins"))).toEqual([]);
    expect(await as("anon", () => rows("select * from public.pliegue_admins"))).toEqual([]);
  });

  it.each(visitors)("%s no da de alta administradores", async (_name, user) => {
    await makeAdmin();
    await expect(as(user, () => rows("insert into public.pliegue_admins (user_id) values ($1)", [userB])))
      .rejects.toMatchObject({ code: "42501" });
  });

  it.each(visitors)("%s no cambia ni borra administradores", async (_name, user) => {
    await makeAdmin();
    await as(user, async () => {
      expect(await rows("update public.pliegue_admins set created_at = now() returning user_id")).toEqual([]);
      expect(await rows("delete from public.pliegue_admins returning user_id")).toEqual([]);
    });
  });

  it("is_pliegue_admin distingue al administrador de otra cuenta", async () => {
    await makeAdmin();
    expect(await as(userA, () => rows("select public.is_pliegue_admin() as admin"))).toEqual([{ admin: true }]);
    expect(await as(userB, () => rows("select public.is_pliegue_admin() as admin"))).toEqual([{ admin: false }]);
  });

  it("is_pliegue_admin no da permisos sin cuenta", async () => {
    expect(await as("anon", () => rows("select public.is_pliegue_admin() as admin"))).toEqual([{ admin: false }]);
  });
});

describe("storage.objects", () => {
  it("A sube, lee, cambia y borra traducciones en su carpeta", async () => {
    const name = `${userA}/nuevo/en.json`;
    await as(userA, async () => {
      expect(await rows("insert into storage.objects (bucket_id, name, owner) values ('translations', $1, $2) returning name", [name, userA]))
        .toEqual([{ name }]);
      expect(await rows("select name from storage.objects order by name"))
        .toEqual([{ name: `${userA}/libro/es.json` }, { name }]);
      expect(await rows("update storage.objects set metadata = '{\"size\":123}' where name = $1 returning metadata", [name]))
        .toEqual([{ metadata: { size: 123 } }]);
      expect(await rows("delete from storage.objects where name = $1 returning name", [name])).toEqual([{ name }]);
    });
  });

  it("B no lee las traducciones de A", async () => {
    expect(await as(userB, () => rows("select name from storage.objects")))
      .toEqual([{ name: `${userB}/libro/es.json` }]);
  });

  it("B no cambia ni borra las traducciones de A", async () => {
    await as(userB, async () => {
      expect(await rows("update storage.objects set metadata = '{\"size\":1}' where name = $1 returning id", [`${userA}/libro/es.json`]))
        .toEqual([]);
      expect(await rows("delete from storage.objects where name = $1 returning id", [`${userA}/libro/es.json`]))
        .toEqual([]);
    });
  });

  it.each([["A", userA, userB], ["B", userB, userA]] as const)("%s no sube archivos en la carpeta ajena", async (_name, user, other) => {
    await expect(as(user, () => rows(
      "insert into storage.objects (bucket_id, name, owner) values ('translations', $1, $2)",
      [`${other}/nuevo/es.json`, user],
    ))).rejects.toMatchObject({ code: "42501" });
  });

  it("A no mueve una traducción a la carpeta de B", async () => {
    await expect(as(userA, () => rows("update storage.objects set name = $1 where name = $2", [
      `${userB}/ajeno/es.json`, `${userA}/libro/es.json`,
    ]))).rejects.toMatchObject({ code: "42501" });
  });

  it("la carpeta propia no da acceso a otro bucket", async () => {
    await db.exec("insert into storage.buckets (id, name) values ('otro', 'otro')");
    await expect(as(userA, () => rows(
      "insert into storage.objects (bucket_id, name, owner) values ('otro', $1, $2)", [`${userA}/libro/es.json`, userA],
    ))).rejects.toMatchObject({ code: "42501" });
  });

  it("sin cuenta no se leen, cambian ni borran traducciones", async () => {
    await as("anon", async () => {
      expect(await rows("select * from storage.objects")).toEqual([]);
      expect(await rows("update storage.objects set metadata = '{}' returning id")).toEqual([]);
      expect(await rows("delete from storage.objects returning id")).toEqual([]);
    });
  });

  it("sin cuenta no se suben traducciones", async () => {
    await expect(as("anon", () => rows(
      "insert into storage.objects (bucket_id, name, owner) values ('translations', $1, $2)", [`${userA}/nuevo/es.json`, userA],
    ))).rejects.toMatchObject({ code: "42501" });
  });
});
