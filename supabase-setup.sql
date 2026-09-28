-- a-tom. Production Pipeline — run once in Supabase → SQL Editor

create table if not exists public.docs (
  path text primary key,
  col text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists docs_col_idx on public.docs (col);

-- Deep merge; a null value in the patch deletes that key
create or replace function public.jsonb_merge_deep(a jsonb, b jsonb) returns jsonb
language plpgsql immutable as $$
declare r jsonb := coalesce(a, '{}'::jsonb); k text; v jsonb;
begin
  for k, v in select * from jsonb_each(b) loop
    if jsonb_typeof(v) = 'null' then r := r - k;
    elsif jsonb_typeof(v) = 'object' then
      r := jsonb_set(r, array[k], public.jsonb_merge_deep(case when jsonb_typeof(r->k) = 'object' then r->k else '{}'::jsonb end, v));
    else r := jsonb_set(r, array[k], v);
    end if;
  end loop;
  return r;
end $$;

create or replace function public.doc_update(p_path text, p_patch jsonb) returns boolean
language plpgsql as $$
begin
  update public.docs set data = public.jsonb_merge_deep(data, p_patch), updated_at = now() where path = p_path;
  return found;
end $$;

grant execute on function public.jsonb_merge_deep(jsonb, jsonb) to anon, authenticated;
grant execute on function public.doc_update(text, jsonb) to anon, authenticated;

-- Anyone with the link can read and write
alter table public.docs enable row level security;
drop policy if exists "link read" on public.docs;
drop policy if exists "link insert" on public.docs;
drop policy if exists "link update" on public.docs;
create policy "link read" on public.docs for select to anon, authenticated using (true);
create policy "link insert" on public.docs for insert to anon, authenticated with check (true);
create policy "link update" on public.docs for update to anon, authenticated using (true) with check (true);
drop policy if exists "link delete" on public.docs;
create policy "link delete" on public.docs for delete to anon, authenticated using (true);
-- so deletes reach other browsers live
alter table public.docs replica identity full;

-- Live updates
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- File storage
insert into storage.buckets (id, name, public) values ('pipeline-files', 'pipeline-files', true)
on conflict (id) do nothing;
drop policy if exists "pp files read" on storage.objects;
drop policy if exists "pp files upload" on storage.objects;
drop policy if exists "pp files delete" on storage.objects;
create policy "pp files read" on storage.objects for select to anon, authenticated using (bucket_id = 'pipeline-files');
create policy "pp files upload" on storage.objects for insert to anon, authenticated with check (bucket_id = 'pipeline-files');
create policy "pp files delete" on storage.objects for delete to anon, authenticated using (bucket_id = 'pipeline-files');

