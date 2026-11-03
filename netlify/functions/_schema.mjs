// ---------- creates the tables on first run, so no SQL Editor is needed ----------
const SCHEMA = [
 "create table if not exists docs (\n  path text primary key,\n  col text not null,\n  id text not null,\n  data jsonb not null default '{}'::jsonb,\n  updated_at timestamptz not null default now()\n);",
 "create index if not exists docs_col_idx on docs (col);",
 "create or replace function jsonb_merge_deep(a jsonb, b jsonb) returns jsonb\nlanguage plpgsql immutable as $$\ndeclare r jsonb := coalesce(a, '{}'::jsonb); k text; v jsonb;\nbegin\n  for k, v in select * from jsonb_each(b) loop\n    if jsonb_typeof(v) = 'null' then r := r - k;\n    elsif jsonb_typeof(v) = 'object' then\n      r := jsonb_set(r, array[k], jsonb_merge_deep(case when jsonb_typeof(r->k) = 'object' then r->k else '{}'::jsonb end, v));\n    else r := jsonb_set(r, array[k], v);\n    end if;\n  end loop;\n  return r;\nend $$;",
 "create sequence if not exists doc_seq;",
 "create table if not exists col_versions (col text primary key, v bigint not null);",
 "create or replace function bump_col() returns trigger language plpgsql as $$\nbegin\n  insert into col_versions (col, v) values (coalesce(new.col, old.col), nextval('doc_seq'))\n  on conflict (col) do update set v = excluded.v;\n  if tg_op = 'UPDATE' and new.col <> old.col then\n    insert into col_versions (col, v) values (old.col, nextval('doc_seq')) on conflict (col) do update set v = excluded.v;\n  end if;\n  return null;\nend $$;",
 "drop trigger if exists docs_bump on docs;",
 "create trigger docs_bump after insert or update or delete on docs for each row execute function bump_col();",
 "create table if not exists auth_tokens (token_hash text primary key, email text not null, name text, expires_at timestamptz not null);",
 "create table if not exists sessions (token_hash text primary key, email text not null, created_at timestamptz not null default now(), expires_at timestamptz not null);",
 "create index if not exists sessions_email_idx on sessions (email);",
 "insert into public.docs (path, col, id, data) values\n  ('team/apoorv',    'team', 'apoorv',    '{\"id\":\"apoorv\",\"name\":\"Apoorv\",\"role\":\"Creative Director\",\"email\":\"\",\"userId\":null,\"order\":0}'),\n  ('team/saksham',   'team', 'saksham',   '{\"id\":\"saksham\",\"name\":\"Saksham\",\"role\":\"Producer, EP and Ops\",\"email\":\"\",\"userId\":null,\"order\":1}'),\n  ('team/swapnil',   'team', 'swapnil',   '{\"id\":\"swapnil\",\"name\":\"Swapnil\",\"role\":\"Creative Architect and Writer\",\"email\":\"\",\"userId\":null,\"order\":2}'),\n  ('team/uthkarsha', 'team', 'uthkarsha', '{\"id\":\"uthkarsha\",\"name\":\"Uthkarsha\",\"role\":\"Creative Producer\",\"email\":\"\",\"userId\":null,\"order\":3}'),\n  ('team/srestha',   'team', 'srestha',   '{\"id\":\"srestha\",\"name\":\"Srestha\",\"role\":\"Client POC\",\"email\":\"\",\"userId\":null,\"order\":4}'),\n  ('team/meghana',   'team', 'meghana',   '{\"id\":\"meghana\",\"name\":\"Meghana\",\"role\":\"Project Manager\",\"email\":\"\",\"userId\":null,\"order\":5}'),\n  ('team/saahil',    'team', 'saahil',    '{\"id\":\"saahil\",\"name\":\"Saahil\",\"role\":\"Associate Creative Director\",\"email\":\"\",\"userId\":null,\"order\":6}')\non conflict (path) do nothing;"
];
let schemaReady = null;
export function ensureSchema(sqlFn) {
  return schemaReady || (schemaReady = (async () => {
    const t = await sqlFn.query("select to_regclass('public.sessions') as s, to_regclass('public.col_versions') as c");
    if (t[0].s && t[0].c) return;
    for (const s of SCHEMA) await sqlFn.query(s);
  })().catch((e) => { schemaReady = null; throw e; }));
}
