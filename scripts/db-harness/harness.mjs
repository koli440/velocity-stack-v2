import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'
import fs from 'node:fs'
import path from 'node:path'
const DIR = process.argv[2]
const dataDir = '/tmp/pg/data'
fs.rmSync(dataDir, { recursive: true, force: true })
const server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'pw', port: 54329, persistent: false })
await server.initialise(); await server.start()
const c = new pg.Client({ host: 'localhost', port: 54329, user: 'postgres', password: 'pw', database: 'postgres' })
await c.connect()
await c.query(`
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT anon, authenticated, service_role TO postgres;
CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE SCHEMA net; CREATE SCHEMA cron; CREATE SCHEMA storage; CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]); CREATE TABLE storage.objects (id uuid DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; CREATE FUNCTION storage.foldername(n text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array(n,'/') $$; CREATE TABLE auth.identities (id uuid DEFAULT gen_random_uuid(), user_id uuid, identity_data jsonb, provider text, provider_id text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz); CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
GRANT USAGE ON SCHEMA public, auth, extensions TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, raw_user_meta_data jsonb DEFAULT '{}', instance_id uuid, aud text, role text, encrypted_password text, email_confirmed_at timestamptz, raw_app_meta_data jsonb, updated_at timestamptz, confirmation_token text, recovery_token text, email_change text, email_change_token_new text, is_sso_user boolean DEFAULT false, is_anonymous boolean DEFAULT false, created_at timestamptz DEFAULT now());
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.jwt() TO anon, authenticated, service_role;
CREATE TABLE net.calls (id serial, url text, headers jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb DEFAULT '{}', body jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 1000) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls(url, headers) VALUES (url, headers) RETURNING id::bigint $$;
CREATE TABLE cron.job (jobid serial, jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job(jobname,schedule,command) VALUES (n,s,c) RETURNING jobid::bigint $$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = n RETURNING true $$;
`)
// stub extension creation: make CREATE EXTENSION no-ops by pre-filtering statements
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
let failed = 0
for (const f of files) {
  let sql = fs.readFileSync(path.join(DIR, f), 'utf8').replace(/CREATE EXTENSION IF NOT EXISTS (pg_net|pg_cron)[^;]*;/g, '')
  try { await c.query(sql) } catch (e) { failed++; console.log('FAIL', f, e.message.slice(0, 200)) }
}
console.log('migrations applied:', files.length - failed, '/', files.length)
globalThis.__c = c
const tests = await import(process.argv[3])
await tests.run(c)
await c.end(); await server.stop()
