-- Biblioteca general: volver a entrar no gasta un uso.
--
-- Quien ya entró con un código, desde el mismo equipo y con el mismo nombre, vuelve sin
-- descontar un uso y sin que lo frene el tope de usos: «Usos máximos» cuenta personas distintas,
-- no veces que se entra. La vuelta se registra igual en `library_access_events` (el panel la
-- marca como «volvió»). Solo cambia la función; las tablas y los permisos siguen igual.

create or replace function public.redeem_library_code(
  p_code text,
  p_library text,
  p_visitor_name text,
  p_device_id text,
  p_user_agent text,
  p_client_hash text
)
returns table (ok boolean, reason text, code_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_code public.library_access_codes;
  v_failures integer;
  v_name text := left(trim(p_visitor_name), 60);
  v_returning boolean;
begin
  -- Lo viejo no sirve para nada: se limpia aquí mismo.
  delete from public.library_access_failures where created_at < now() - interval '1 day';

  select count(*) into v_failures
  from public.library_access_failures f
  where f.client_hash = p_client_hash and f.created_at > now() - interval '15 minutes';
  if v_failures >= 10 then
    return query select false, 'too-many'::text, null::uuid, null::timestamptz;
    return;
  end if;

  select * into v_code
  from public.library_access_codes c
  where c.code = upper(trim(p_code)) and c.library = p_library
  for update;

  if not found or not v_code.active then
    insert into public.library_access_failures (client_hash) values (p_client_hash);
    return query select false, 'invalid'::text, null::uuid, null::timestamptz;
    return;
  end if;
  if v_code.expires_at is not null and v_code.expires_at <= now() then
    return query select false, 'expired'::text, null::uuid, null::timestamptz;
    return;
  end if;

  -- ¿Ya entró con este código, desde este equipo y con este nombre?
  select exists (
    select 1
    from public.library_access_events e
    where e.code_id = v_code.id
      and e.device_id = left(p_device_id, 64)
      and lower(e.visitor_name) = lower(v_name)
  ) into v_returning;

  if not v_returning then
    if v_code.max_uses is not null and v_code.uses >= v_code.max_uses then
      return query select false, 'exhausted'::text, null::uuid, null::timestamptz;
      return;
    end if;
    update public.library_access_codes set uses = uses + 1 where id = v_code.id;
  end if;

  insert into public.library_access_events (code_id, library, visitor_name, device_id, user_agent)
  values (v_code.id, p_library, v_name, left(p_device_id, 64), left(coalesce(p_user_agent, ''), 300));

  return query select true, 'ok'::text, v_code.id, v_code.expires_at;
end;
$$;

revoke all on function public.redeem_library_code(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.redeem_library_code(text, text, text, text, text, text) to service_role;
