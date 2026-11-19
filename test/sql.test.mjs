/**
 * Prueba del SQL del registro de aceptaciones (sql/legal-consentimientos.sql) en un Postgres real
 * (PGlite, Postgres compilado a WebAssembly), con roles y funciones de Neon simulados: quién llama se
 * elige con `set gosen.test_email`. Comprueba registro, versiones, solo-agregar, permisos, cadena de
 * huellas, verificación y anonimización.
 *
 * Uso: GOSEN_PGLITE=<carpeta con node_modules/@electric-sql/pglite> node test/sql.test.mjs
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const base = process.env.GOSEN_PGLITE
if (!base) {
  console.log('Falta GOSEN_PGLITE (carpeta donde está instalado @electric-sql/pglite): prueba omitida.')
  process.exit(0)
}
const { PGlite } = await import(pathToFileURL(path.join(base, 'node_modules/@electric-sql/pglite/dist/index.js')).href)

let failures = 0
const ok = (c, m) => {
  console.log(`${c ? '✔' : '✘'} ${m}`)
  if (!c) failures++
}
const fails = async (fn, re) => {
  try {
    await fn()
    return 'no falló'
  } catch (e) {
    return re.test(e.message) ? true : e.message
  }
}

const db = new PGlite()
// Lo que Neon ya tiene: roles de la Data API, auth.session()/auth.user_id() y las tablas de setup.sql.
await db.exec(`
  create role authenticated nologin;
  create role anonymous nologin;
  create schema auth;
  create function auth.session() returns jsonb language sql stable as $$ select jsonb_build_object('email', current_setting('gosen.test_email', true)) $$;
  create function auth.user_id() returns text language sql stable as $$ select 'uid-' || coalesce(current_setting('gosen.test_email', true), '') $$;
  grant usage on schema auth to authenticated, anonymous;
  grant execute on all functions in schema auth to authenticated, anonymous;
  create schema neon_auth;
  create table neon_auth."user" (id text, email text);
  create table public.gosen_allowed_emails (email text primary key, note text, tag text, added_at timestamptz default now());
  create table public.gosen_admins (email text primary key references public.gosen_allowed_emails(email) on delete cascade);
  create function public.gosen_current_email() returns text language sql stable security definer set search_path = public as $$ select lower(nullif(auth.session() ->> 'email', '')) $$;
  create function public.gosen_is_admin() returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.gosen_admins a where a.email = public.gosen_current_email()) $$;
  grant usage on schema public to authenticated;
  grant execute on function public.gosen_current_email(), public.gosen_is_admin() to authenticated;
  insert into public.gosen_allowed_emails (email, note) values ('admin@iglesia.com', 'Admin'), ('ana@iglesia.com', 'Ana');
  insert into public.gosen_admins values ('admin@iglesia.com');
`)
// Neon emite "notify pgrst"; aquí no hay PostgREST escuchando (es inofensivo).
const sql = await readFile(path.join(root, 'sql/legal-consentimientos.sql'), 'utf8')
await db.exec(sql)
ok(true, 'el SQL se ejecuta en Postgres sin errores')
await db.exec(sql)
ok(true, 'y se puede ejecutar otra vez (no rompe nada)')

/** Ejecuta como una cuenta de la Data API (rol authenticated con ese correo). */
const as = async (email, query, params = []) => {
  await db.exec(`reset role; select set_config('gosen.test_email', '${email}', false); set role authenticated;`)
  try {
    return (await db.query(query, params)).rows
  } finally {
    await db.exec('reset role;')
  }
}
const SHA_T = 'a'.repeat(64)
const SHA_P = 'b'.repeat(64)
const items = (action = 'acepta') =>
  JSON.stringify([
    { document: 'terminos', version: '1.0', sha256: SHA_T, effective: '2026-11-18', action },
    { document: 'privacidad', version: '1.0', sha256: SHA_P, effective: '2026-11-18', action }
  ])
const op1 = '11111111-1111-4111-8111-111111111111'

const rec = await as('admin@iglesia.com', 'select * from public.gosen_record_consent($1, $2, $3, $4::jsonb)', [op1, 'panel-web:inicio-sesion', 'ray-1', items()])
ok(rec.length === 2 && rec.every((r) => r.action === 'acepta' && r.version === '1.0'), 'la cuenta registra sus dos aceptaciones (una fila por documento)')
const again = await as('admin@iglesia.com', 'select * from public.gosen_record_consent($1, $2, $3, $4::jsonb)', [op1, 'panel-web:inicio-sesion', 'ray-2', items()])
const count = async () => Number((await db.query('select count(*)::int as n from public.gosen_consent_log')).rows[0].n)
ok(again.length === 2 && (await count()) === 2, 'repetir la misma operación (doble clic) no duplica registros')

const raw = (await db.query('select * from public.gosen_consent_log order by id')).rows
ok(
  raw[0].subject_email === 'admin@iglesia.com' && raw[0].subject_user_id === 'uid-admin@iglesia.com' && raw[0].version === '1.0' && raw[0].content_sha256 === SHA_T && raw[0].channel === 'panel-web:inicio-sesion' && raw[0].trace_id === 'ray-1',
  'cada fila dice quién, qué documento, qué versión exacta (y su huella), desde dónde y con qué petición'
)
ok(raw[0].recorded_at instanceof Date && Math.abs(raw[0].recorded_at.getTime() - Date.now()) < 60_000, 'la hora es la del servidor de la base (UTC)')
ok(raw[1].prev_hash === raw[0].row_hash && raw[0].prev_hash === '0'.repeat(64), 'cada fila guarda la huella de la anterior (cadena)')
ok(!Object.keys(raw[0]).some((k) => /pass|ip|agent|card/i.test(k)), 'no hay columnas de contraseñas, IP, navegador ni tarjetas')

ok((await fails(() => as('intruso@x.com', 'select * from public.gosen_record_consent($1, $2, $3, $4::jsonb)', ['22222222-2222-4222-8222-222222222222', 'panel-web', '', items()]), /Sin acceso/)) === true, 'un correo no autorizado no puede registrar nada')
ok((await fails(() => as('ana@iglesia.com', `select * from public.gosen_record_consent($1, 'panel-web', '', $2::jsonb)`, ['33333333-3333-4333-8333-333333333333', JSON.stringify([{ document: 'terminos', version: 'x', sha256: SHA_T, effective: '2026-11-18', action: 'acepta' }])]), /check constraint|violates/)) === true, 'una versión mal formada se rechaza')
ok((await fails(() => as('ana@iglesia.com', `select * from public.gosen_record_consent($1, 'panel-web', '', $2::jsonb)`, ['44444444-4444-4444-8444-444444444444', JSON.stringify([{ document: 'marketing', version: '1.0', sha256: SHA_T, effective: '2026-11-18', action: 'acepta' }])]), /Documento no válido/)) === true, 'un documento desconocido se rechaza')

// Protección: la tabla no se toca directamente, ni siquiera para leerla.
ok((await fails(() => as('admin@iglesia.com', 'select * from public.gosen_consent_log'), /permission denied/)) === true, 'la tabla no se puede leer directamente (solo por las funciones)')
ok((await fails(() => as('admin@iglesia.com', `insert into public.gosen_consent_log (operation_id, subject_sha256, document, consent_type, version, content_sha256, effective_date, action, channel, prev_hash, row_hash) values (gen_random_uuid(), '${SHA_T}', 'terminos', 'aceptacion_terminos', '1.0', '${SHA_T}', '2026-11-18', 'acepta', 'x-x', '${SHA_T}', '${SHA_P}')`), /permission denied/)) === true, 'ni escribir directamente (sin pasar por la validación)')
ok((await fails(() => as('admin@iglesia.com', "update public.gosen_consent_log set version = '9.9'"), /permission denied/)) === true, 'ni modificar')
ok((await fails(() => as('admin@iglesia.com', 'delete from public.gosen_consent_log'), /permission denied/)) === true, 'ni borrar')
ok((await fails(() => db.query("update public.gosen_consent_log set version = '9.9' where id = 1"), /no se puede modificar/)) === true, 'aun con acceso de dueño, modificar una fila se rechaza (disparador)')
ok((await fails(() => db.query('delete from public.gosen_consent_log'), /no se puede modificar/)) === true, 'y borrar también')
ok((await fails(() => db.query('truncate public.gosen_consent_log'), /no se puede modificar/)) === true, 'y vaciar la tabla también')
ok((await fails(() => as('admin@iglesia.com', "select public.gosen_consent_anonymize(now())"), /permission denied/)) === true, 'la anonimización no se puede llamar desde la app ni la web')

// Lo de cada cuenta, independiente: Ana solo acepta la privacidad.
await as('ana@iglesia.com', `select * from public.gosen_record_consent($1, 'panel-web:inicio-sesion', '', $2::jsonb)`, ['55555555-5555-4555-8555-555555555555', JSON.stringify([{ document: 'privacidad', version: '1.0', sha256: SHA_P, effective: '2026-11-18', action: 'acepta' }])])
const anaMine = await as('ana@iglesia.com', 'select * from public.gosen_my_consents()')
ok(anaMine.length === 1 && anaMine[0].document === 'privacidad', 'aceptar la privacidad no acepta los términos (son independientes)')
// Retirar la autorización: queda como un registro más (no se borra el anterior).
await as('admin@iglesia.com', `select * from public.gosen_record_consent($1, 'panel-web:retiro', '', $2::jsonb)`, ['66666666-6666-4666-8666-666666666666', JSON.stringify([{ document: 'privacidad', version: '1.0', sha256: SHA_P, effective: '2026-11-18', action: 'revoca' }])])
const adminMine = await as('admin@iglesia.com', 'select * from public.gosen_my_consents() order by document')
ok(adminMine.find((r) => r.document === 'privacidad').action === 'revoca' && adminMine.find((r) => r.document === 'terminos').action === 'acepta' && (await count()) === 4, 'retirar la autorización queda registrado aparte; lo aceptado antes sigue como evidencia')

// Administradores: consultar y verificar; un integrante no.
const ev = await as('admin@iglesia.com', `select * from public.gosen_consent_evidence('Ana@Iglesia.com', 50)`)
ok(ev.length === 1 && ev[0].subject_email === 'ana@iglesia.com' && !('prev_hash' in ev[0]), 'el admin consulta las evidencias de una cuenta')
ok((await fails(() => as('ana@iglesia.com', 'select * from public.gosen_consent_evidence()'), /Solo el administrador/)) === true, 'un integrante no puede ver las evidencias de otros')
let v = (await as('admin@iglesia.com', 'select * from public.gosen_consent_verify()'))[0]
ok(v.intact === true && Number(v.total) === 4, `la verificación recorre la cadena y está intacta (${v.total} registros)`)

// Manipulación con acceso de dueño (desactivando el disparador): la verificación lo detecta.
await db.exec(`alter table public.gosen_consent_log disable trigger gosen_consent_log_no_change; update public.gosen_consent_log set version = '0.9' where id = 2; alter table public.gosen_consent_log enable trigger gosen_consent_log_no_change;`)
v = (await as('admin@iglesia.com', 'select * from public.gosen_consent_verify()'))[0]
ok(v.intact === false && Number(v.first_broken_id) === 2, `si alguien cambia una fila por fuera, la verificación dice cuál (fila ${v.first_broken_id})`)
await db.exec(`alter table public.gosen_consent_log disable trigger gosen_consent_log_no_change; update public.gosen_consent_log set version = '1.0' where id = 2; alter table public.gosen_consent_log enable trigger gosen_consent_log_no_change;`)

// Conservación: Ana deja el equipo; pasado el plazo, su correo se quita y la cadena sigue intacta.
await db.exec(`delete from public.gosen_allowed_emails where email = 'ana@iglesia.com'`)
const n = (await db.query(`select public.gosen_consent_anonymize(now() + interval '1 day') as n`)).rows[0].n
const anon = (await db.query(`select subject_email, anonymized_at from public.gosen_consent_log where document = 'privacidad' and channel = 'panel-web:inicio-sesion' and subject_sha256 = encode(sha256(convert_to('ana@iglesia.com', 'UTF8')), 'hex')`)).rows[0]
v = (await as('admin@iglesia.com', 'select * from public.gosen_consent_verify()'))[0]
ok(n === 1 && anon.subject_email === null && anon.anonymized_at && v.intact === true, 'la anonimización quita el correo de quien ya no está y la cadena sigue verificando')
ok((await db.query(`select count(*)::int as n from public.gosen_consent_log where subject_email = 'admin@iglesia.com'`)).rows[0].n === 3, 'las evidencias de quien sigue en el equipo no se tocan')

await db.close()
console.log(failures ? `\n${failures} comprobación(es) fallaron` : '\nTodas las comprobaciones pasaron')
process.exit(failures ? 1 : 0)
