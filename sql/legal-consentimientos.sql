-- ============================================================================
-- Gosen Tracks · Registro de aceptaciones (términos y autorización de datos)
--
-- Se ejecuta en Neon → SQL Editor (pega TODO → Run), después de setup.sql y v35/v36 de la app.
-- Se puede repetir sin problema: no borra ni cambia nada de lo ya registrado.
--
-- Qué crea:
--   · gosen_consent_log: una fila por cada aceptación o retiro (quién, qué documento, qué versión
--     exacta y su huella SHA-256, cuándo según el reloj del servidor en UTC, desde qué formulario).
--     Es de solo agregar: nadie la puede cambiar ni borrar desde la app, la web o la Data API.
--   · Cadena de huellas: cada fila guarda la huella de la anterior. Si alguien con acceso de dueño a
--     la base cambiara o borrara una fila, la verificación lo detecta.
--   · gosen_record_consent(): registra aceptaciones o retiros de la cuenta que hace la petición.
--   · gosen_my_consents(): lo último que aceptó o retiró la cuenta, por documento.
--   · gosen_consent_evidence() y gosen_consent_verify(): solo administradores (consultar y verificar).
--   · gosen_consent_anonymize(): solo el dueño de la base, a mano desde el SQL Editor (conservación).
--
-- No se guardan contraseñas, direcciones IP ni datos del navegador: la cuenta se identifica por su
-- correo (y el id de Neon Auth); la huella del titular (SHA-256 del correo) permite anonimizar sin
-- romper la cadena.
-- ============================================================================

create table if not exists public.gosen_consent_log (
  id bigint generated always as identity primary key,
  event_id uuid not null default gen_random_uuid() unique,
  -- Operación del formulario (la genera la página al mostrarlo): un doble clic no duplica registros.
  operation_id uuid not null,
  -- Identificador técnico de la petición HTTP (p. ej. cf-ray de Cloudflare), para cruzar con registros.
  trace_id text check (trace_id is null or char_length(trace_id) <= 80),
  subject_email text check (subject_email is null or (subject_email = lower(btrim(subject_email)) and position('@' in subject_email) > 1)),
  subject_user_id text check (subject_user_id is null or char_length(subject_user_id) <= 80),
  subject_sha256 text not null check (subject_sha256 ~ '^[0-9a-f]{64}$'),
  document text not null check (document in ('terminos', 'privacidad')),
  consent_type text not null check (consent_type in ('aceptacion_terminos', 'autorizacion_tratamiento_datos')),
  version text not null check (version ~ '^[0-9]{1,3}\.[0-9]{1,3}$'),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  effective_date date not null,
  action text not null check (action in ('acepta', 'revoca')),
  channel text not null check (channel ~ '^[a-z0-9:_-]{3,60}$'),
  recorded_at timestamptz not null default now(),
  anonymized_at timestamptz,
  prev_hash text not null check (prev_hash ~ '^[0-9a-f]{64}$'),
  row_hash text not null unique check (row_hash ~ '^[0-9a-f]{64}$'),
  unique (subject_sha256, operation_id, document, action)
);

create index if not exists gosen_consent_log_subject on public.gosen_consent_log (subject_sha256, document, id desc);

-- Nadie entra a la tabla directamente: todo pasa por las funciones de abajo.
alter table public.gosen_consent_log enable row level security;
revoke all on public.gosen_consent_log from public;
do $$
begin
  execute 'revoke all on public.gosen_consent_log from authenticated';
  execute 'revoke all on public.gosen_consent_log from anonymous';
exception when others then
  raise notice 'Roles de la Data API no disponibles: %', sqlerrm;
end
$$;

-- Huella de una fila: lo que prueba quién, qué, qué versión, cuándo y cómo (sin el correo en claro).
create or replace function public.gosen_consent_row_hash(
  p_prev text, p_event uuid, p_operation uuid, p_trace text, p_subject text, p_document text, p_type text,
  p_version text, p_content text, p_effective date, p_action text, p_channel text, p_at timestamptz
) returns text
language sql
immutable
set search_path = public
as $$
  select encode(sha256(convert_to(concat_ws('|',
    p_prev, p_event::text, p_operation::text, coalesce(p_trace, ''), p_subject, p_document, p_type,
    p_version, p_content, p_effective::text, p_action, p_channel,
    to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  ), 'UTF8')), 'hex');
$$;

-- Solo agregar: actualizar o borrar se rechaza. La única excepción es la anonimización que corre el
-- dueño de la base (gosen_consent_anonymize), que solo vacía el correo y el id, fuera de la huella.
create or replace function public.gosen_consent_log_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and current_setting('gosen.consent_maintenance', true) = 'on' then
    if (new.id, new.event_id, new.operation_id, new.trace_id, new.subject_sha256, new.document, new.consent_type, new.version,
        new.content_sha256, new.effective_date, new.action, new.channel, new.recorded_at, new.prev_hash, new.row_hash)
       is distinct from
       (old.id, old.event_id, old.operation_id, old.trace_id, old.subject_sha256, old.document, old.consent_type, old.version,
        old.content_sha256, old.effective_date, old.action, old.channel, old.recorded_at, old.prev_hash, old.row_hash)
       or new.subject_email is not null or new.subject_user_id is not null then
      raise exception 'La anonimización solo puede quitar el correo y el id de la cuenta.';
    end if;
    return new;
  end if;
  raise exception 'El registro de aceptaciones no se puede modificar ni borrar.';
end;
$$;

drop trigger if exists gosen_consent_log_no_change on public.gosen_consent_log;
create trigger gosen_consent_log_no_change before update or delete on public.gosen_consent_log
  for each row execute function public.gosen_consent_log_guard();
drop trigger if exists gosen_consent_log_no_truncate on public.gosen_consent_log;
create trigger gosen_consent_log_no_truncate before truncate on public.gosen_consent_log
  for each statement execute function public.gosen_consent_log_guard();

-- Registra lo que la cuenta que hace la petición acepta o retira. p_items: lista JSON de
-- { document, version, sha256, effective, action } (la página manda las versiones que mostró; el
-- Worker comprueba antes que sean las vigentes). Devuelve lo registrado (o lo ya registrado si la
-- misma operación se repite).
create or replace function public.gosen_record_consent(p_operation uuid, p_channel text, p_trace text, p_items jsonb)
returns table (event_id uuid, document text, action text, version text, recorded_at timestamptz, row_hash text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.gosen_current_email();
  v_user text := nullif(auth.user_id(), '');
  v_subject text;
  v_item jsonb;
  v_doc text;
  v_type text;
  v_prev text;
  v_event uuid;
  v_at timestamptz := now();
begin
  if v_email is null or not exists (select 1 from public.gosen_allowed_emails a where a.email = v_email) then
    raise exception 'Sin acceso.';
  end if;
  if p_operation is null or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 4 then
    raise exception 'Datos de aceptación no válidos.';
  end if;
  v_subject := encode(sha256(convert_to(v_email, 'UTF8')), 'hex');
  -- Una fila a la vez en toda la tabla: la cadena de huellas no se bifurca.
  perform pg_advisory_xact_lock(hashtext('gosen_consent_log'));
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_doc := v_item ->> 'document';
    v_type := case v_doc when 'terminos' then 'aceptacion_terminos' when 'privacidad' then 'autorizacion_tratamiento_datos' end;
    if v_type is null then
      raise exception 'Documento no válido.';
    end if;
    if exists (select 1 from public.gosen_consent_log l
               where l.subject_sha256 = v_subject and l.operation_id = p_operation and l.document = v_doc and l.action = v_item ->> 'action') then
      continue;
    end if;
    select l.row_hash into v_prev from public.gosen_consent_log l order by l.id desc limit 1;
    v_prev := coalesce(v_prev, repeat('0', 64));
    v_event := gen_random_uuid();
    insert into public.gosen_consent_log as l (
      event_id, operation_id, trace_id, subject_email, subject_user_id, subject_sha256, document, consent_type, version,
      content_sha256, effective_date, action, channel, recorded_at, prev_hash, row_hash)
    values (
      v_event, p_operation, nullif(p_trace, ''), v_email, v_user, v_subject, v_doc, v_type, v_item ->> 'version',
      v_item ->> 'sha256', (v_item ->> 'effective')::date, v_item ->> 'action', p_channel, v_at, v_prev,
      public.gosen_consent_row_hash(v_prev, v_event, p_operation, nullif(p_trace, ''), v_subject, v_doc, v_type,
        v_item ->> 'version', v_item ->> 'sha256', (v_item ->> 'effective')::date, v_item ->> 'action', p_channel, v_at));
  end loop;
  return query
    select l.event_id, l.document, l.action, l.version, l.recorded_at, l.row_hash
    from public.gosen_consent_log l
    where l.subject_sha256 = v_subject and l.operation_id = p_operation
    order by l.id;
end;
$$;

-- Lo último que esta cuenta aceptó o retiró de cada documento.
create or replace function public.gosen_my_consents()
returns table (document text, action text, version text, content_sha256 text, effective_date date, recorded_at timestamptz, event_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (l.document) l.document, l.action, l.version, l.content_sha256, l.effective_date, l.recorded_at, l.event_id
  from public.gosen_consent_log l
  where l.subject_sha256 = encode(sha256(convert_to(coalesce(public.gosen_current_email(), ''), 'UTF8')), 'hex')
  order by l.document, l.id desc;
$$;

-- Para los administradores: las evidencias de una cuenta (o las últimas de todos), sin otros datos.
create or replace function public.gosen_consent_evidence(p_email text default null, p_limit integer default 200)
returns table (
  id bigint, event_id uuid, operation_id uuid, trace_id text, subject_email text, document text, consent_type text,
  version text, content_sha256 text, effective_date date, action text, channel text, recorded_at timestamptz,
  anonymized boolean, row_hash text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.gosen_is_admin() then
    raise exception 'Solo el administrador puede consultar el registro.';
  end if;
  return query
    select l.id, l.event_id, l.operation_id, l.trace_id, l.subject_email, l.document, l.consent_type, l.version,
           l.content_sha256, l.effective_date, l.action, l.channel, l.recorded_at, l.anonymized_at is not null, l.row_hash
    from public.gosen_consent_log l
    where p_email is null or btrim(p_email) = ''
       or l.subject_sha256 = encode(sha256(convert_to(lower(btrim(p_email)), 'UTF8')), 'hex')
    order by l.id desc
    limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$$;

-- Para los administradores: ¿la cadena está intacta? (recalcula cada huella en orden)
create or replace function public.gosen_consent_verify()
returns table (total bigint, intact boolean, first_broken_id bigint, last_hash text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  v_prev text := repeat('0', 64);
  v_total bigint := 0;
  v_broken bigint := null;
begin
  if not public.gosen_is_admin() then
    raise exception 'Solo el administrador puede verificar el registro.';
  end if;
  for r in select * from public.gosen_consent_log order by id loop
    v_total := v_total + 1;
    if v_broken is null and (r.prev_hash <> v_prev or r.row_hash <> public.gosen_consent_row_hash(
        r.prev_hash, r.event_id, r.operation_id, r.trace_id, r.subject_sha256, r.document, r.consent_type,
        r.version, r.content_sha256, r.effective_date, r.action, r.channel, r.recorded_at)) then
      v_broken := r.id;
    end if;
    v_prev := r.row_hash;
  end loop;
  return query select v_total, v_broken is null, v_broken, case when v_total = 0 then null else v_prev end;
end;
$$;

-- Conservación: quita el correo y el id de las evidencias de cuentas que ya no existen y cuyo último
-- registro es anterior a p_before. La huella del titular y la cadena quedan intactas. Solo la corre el
-- dueño de la base, a mano, desde el SQL Editor (no se puede llamar desde la app ni la web).
create or replace function public.gosen_consent_anonymize(p_before timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  perform set_config('gosen.consent_maintenance', 'on', true);
  update public.gosen_consent_log l
     set subject_email = null, subject_user_id = null, anonymized_at = now()
   where l.anonymized_at is null
     and not exists (select 1 from public.gosen_allowed_emails a where a.email = l.subject_email)
     and not exists (select 1 from public.gosen_consent_log n where n.subject_sha256 = l.subject_sha256 and n.recorded_at >= p_before);
  get diagnostics v_count = row_count;
  perform set_config('gosen.consent_maintenance', 'off', true);
  return v_count;
end;
$$;

-- Permisos: las funciones de la cuenta y del admin, para quien tenga sesión; las internas, para nadie.
revoke execute on function public.gosen_consent_row_hash(text, uuid, uuid, text, text, text, text, text, text, date, text, text, timestamptz) from public;
revoke execute on function public.gosen_consent_log_guard() from public;
revoke execute on function public.gosen_record_consent(uuid, text, text, jsonb) from public;
revoke execute on function public.gosen_my_consents() from public;
revoke execute on function public.gosen_consent_evidence(text, integer) from public;
revoke execute on function public.gosen_consent_verify() from public;
revoke execute on function public.gosen_consent_anonymize(timestamptz) from public;
grant execute on function public.gosen_record_consent(uuid, text, text, jsonb) to authenticated;
grant execute on function public.gosen_my_consents() to authenticated;
grant execute on function public.gosen_consent_evidence(text, integer) to authenticated;
grant execute on function public.gosen_consent_verify() to authenticated;

notify pgrst, 'reload schema';
