-- a-tom. Production Pipeline — run once in Neon → SQL Editor

create table if not exists docs (
  path text primary key,
  col text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists docs_col_idx on docs (col);

-- Deep merge; a null value in the patch deletes that key
create or replace function jsonb_merge_deep(a jsonb, b jsonb) returns jsonb
language plpgsql immutable as $$
declare r jsonb := coalesce(a, '{}'::jsonb); k text; v jsonb;
begin
  for k, v in select * from jsonb_each(b) loop
    if jsonb_typeof(v) = 'null' then r := r - k;
    elsif jsonb_typeof(v) = 'object' then
      r := jsonb_set(r, array[k], jsonb_merge_deep(case when jsonb_typeof(r->k) = 'object' then r->k else '{}'::jsonb end, v));
    else r := jsonb_set(r, array[k], v);
    end if;
  end loop;
  return r;
end $$;

-- Change tracking for live updates (the app polls this)
create sequence if not exists doc_seq;
create table if not exists col_versions (col text primary key, v bigint not null);
create or replace function bump_col() returns trigger language plpgsql as $$
begin
  insert into col_versions (col, v) values (coalesce(new.col, old.col), nextval('doc_seq'))
  on conflict (col) do update set v = excluded.v;
  if tg_op = 'UPDATE' and new.col <> old.col then
    insert into col_versions (col, v) values (old.col, nextval('doc_seq')) on conflict (col) do update set v = excluded.v;
  end if;
  return null;
end $$;
drop trigger if exists docs_bump on docs;
create trigger docs_bump after insert or update or delete on docs for each row execute function bump_col();

-- Sign-in
create table if not exists auth_tokens (token_hash text primary key, email text not null, name text, expires_at timestamptz not null);
create table if not exists sessions (token_hash text primary key, email text not null, created_at timestamptz not null default now(), expires_at timestamptz not null);
create index if not exists sessions_email_idx on sessions (email);

-- Team (Cognitive Botics production is created automatically on first load)
insert into public.docs (path, col, id, data) values
  ('team/apoorv',    'team', 'apoorv',    '{"id":"apoorv","name":"Apoorv","role":"Creative Director","email":"","userId":null,"order":0}'),
  ('team/saksham',   'team', 'saksham',   '{"id":"saksham","name":"Saksham","role":"Producer, EP and Ops","email":"","userId":null,"order":1}'),
  ('team/swapnil',   'team', 'swapnil',   '{"id":"swapnil","name":"Swapnil","role":"Creative Architect and Writer","email":"","userId":null,"order":2}'),
  ('team/uthkarsha', 'team', 'uthkarsha', '{"id":"uthkarsha","name":"Uthkarsha","role":"Creative Producer","email":"","userId":null,"order":3}'),
  ('team/srestha',   'team', 'srestha',   '{"id":"srestha","name":"Srestha","role":"Client POC","email":"","userId":null,"order":4}'),
  ('team/meghana',   'team', 'meghana',   '{"id":"meghana","name":"Meghana","role":"Project Manager","email":"","userId":null,"order":5}'),
  ('team/saahil',    'team', 'saahil',    '{"id":"saahil","name":"Saahil","role":"Associate Creative Director","email":"","userId":null,"order":6}')
on conflict (path) do nothing;
