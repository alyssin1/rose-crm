-- Rose · Fase 1: tarefas, listas, etiquetas, filtros, Google Calendar.
-- Tudo com prefixo rose_ (projeto compartilhado com o Dashboard Gerencial).
-- Acesso = estar em rose_allowed_emails E ser dono da linha (user_id = auth.uid()).

-- ---------- membership ----------
create or replace function public.rose_is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.rose_allowed_emails
                 where email = lower(auth.jwt() ->> 'email'))
$$;
revoke all on function public.rose_is_member() from public, anon;
grant execute on function public.rose_is_member() to authenticated;

create or replace function public.rose_touch() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- ---------- perfil e preferências ----------
create table if not exists public.rose_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  lang text not null default 'pt' check (lang in ('pt','en','ja','it')),
  theme text not null default 'dark' check (theme in ('dark','light','system')),
  time_format text not null default '24h' check (time_format in ('24h','12h')),
  date_format text not null default 'DD/MM/YYYY',
  week_start int not null default 0 check (week_start between 0 and 6),
  show_week_numbers boolean not null default false,
  per_task_timezone boolean not null default false,
  features jsonb not null default '{"calendar":true,"matrix":false,"habit":false,"pomodoro":false,"countdown":false}',
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- listas ----------
create table if not exists public.rose_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  sort_order bigint not null default 0,
  collapsed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rose_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  folder_id uuid references public.rose_folders(id) on delete set null,
  name text not null,
  emoji text,
  color text,
  is_inbox boolean not null default false,
  view_mode text not null default 'list' check (view_mode in ('list','kanban','timeline')),
  view_options jsonb not null default '{}',   -- agrupar/ordenar/mostrar concluído/detalhes
  sort_order bigint not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists rose_lists_one_inbox on public.rose_lists(user_id) where is_inbox;

create table if not exists public.rose_columns (   -- colunas do Kanban
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  list_id uuid not null references public.rose_lists(id) on delete cascade,
  name text not null,
  sort_order bigint not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- etiquetas ----------
create table if not exists public.rose_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references public.rose_tags(id) on delete set null,
  name text not null,
  color text,
  sort_order bigint not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- ---------- tarefas ----------
create table if not exists public.rose_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  list_id uuid references public.rose_lists(id) on delete set null,
  parent_id uuid references public.rose_tasks(id) on delete cascade,   -- subtarefa
  column_id uuid references public.rose_columns(id) on delete set null,
  kind text not null default 'task' check (kind in ('task','checklist','note')),
  title text not null default '',
  content text not null default '',
  status smallint not null default 0 check (status in (0,2,1)),      -- 0 aberta · 1 concluída · 2 não farei
  priority smallint not null default 0 check (priority in (0,1,3,5)), -- nenhuma/baixa/média/alta
  start_at timestamptz,
  due_at timestamptz,
  all_day boolean not null default false,
  timezone text,
  duration_minutes int,
  reminders jsonb not null default '[]',
  repeat_rule text,                       -- RRULE
  repeat_from text check (repeat_from in ('due','completion')),
  pinned boolean not null default false,
  sort_order bigint not null default 0,
  completed_at timestamptz,
  deleted_at timestamptz,                 -- lixeira
  google_calendar_id text,
  google_event_id text,
  google_etag text,
  google_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rose_tasks_user_list on public.rose_tasks(user_id, list_id) where deleted_at is null;
create index if not exists rose_tasks_user_due on public.rose_tasks(user_id, due_at) where deleted_at is null;
create index if not exists rose_tasks_parent on public.rose_tasks(parent_id);
create unique index if not exists rose_tasks_google on public.rose_tasks(user_id, google_calendar_id, google_event_id) where google_event_id is not null;

create table if not exists public.rose_task_tags (
  task_id uuid not null references public.rose_tasks(id) on delete cascade,
  tag_id uuid not null references public.rose_tags(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (task_id, tag_id)
);

create table if not exists public.rose_task_items (   -- itens de checklist
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.rose_tasks(id) on delete cascade,
  title text not null default '',
  done boolean not null default false,
  sort_order bigint not null default 0
);

create table if not exists public.rose_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.rose_tasks(id) on delete cascade,
  name text not null,
  storage_path text not null,
  mime text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create table if not exists public.rose_comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.rose_tasks(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.rose_task_activity (   -- "Atividades da Tarefa"
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.rose_tasks(id) on delete cascade,
  action text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.rose_templates (   -- "Salvar como modelo"
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.rose_filters (   -- Filtros (listas inteligentes)
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  rules jsonb not null default '{}',
  sort_order bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Google Calendar ----------
create table if not exists public.rose_google_tokens (   -- só service role: sem policy, sem grant
  user_id uuid primary key references auth.users(id) on delete cascade,
  google_email text,
  refresh_token text not null,
  scopes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.rose_google_calendars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  google_calendar_id text not null,
  name text,
  color text,
  enabled boolean not null default true,
  sync_token text,
  channel_id text,             -- canal de push do Google (webhook)
  channel_expires_at timestamptz,
  last_synced_at timestamptz,
  unique (user_id, google_calendar_id)
);

-- ---------- lembretes ----------
create table if not exists public.rose_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  keys jsonb not null,
  user_agent text,
  created_at timestamptz not null default now()
);

-- ---------- triggers de updated_at ----------
do $$
declare t text;
begin
  foreach t in array array['rose_profiles','rose_folders','rose_lists','rose_tasks','rose_filters'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.rose_touch()', t || '_touch', t);
  end loop;
end $$;

-- ---------- RLS ----------
do $$
declare t text;
begin
  foreach t in array array[
    'rose_folders','rose_lists','rose_columns','rose_tags','rose_tasks','rose_task_tags',
    'rose_task_items','rose_attachments','rose_comments','rose_task_activity','rose_templates',
    'rose_filters','rose_google_calendars','rose_push_subscriptions','rose_profiles'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists rose_own on public.%I', t);
    execute format('create policy rose_own on public.%I for all to authenticated using (user_id = auth.uid() and public.rose_is_member()) with check (user_id = auth.uid() and public.rose_is_member())', t);
  end loop;
end $$;

alter table public.rose_google_tokens enable row level security;   -- nenhuma policy: só service role
revoke all on public.rose_google_tokens from anon, authenticated;

-- ---------- primeiro acesso: perfil + Caixa de Entrada ----------
create or replace function public.rose_bootstrap() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not public.rose_is_member() then
    raise exception 'não autorizado' using errcode = '42501';
  end if;
  insert into public.rose_profiles (user_id, display_name, avatar_url)
  select uid, u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'avatar_url'
  from auth.users u where u.id = uid
  on conflict (user_id) do nothing;
  insert into public.rose_lists (user_id, name, is_inbox)
  values (uid, 'Inbox', true)
  on conflict do nothing;
end $$;
revoke all on function public.rose_bootstrap() from public, anon;
grant execute on function public.rose_bootstrap() to authenticated;

-- ---------- Realtime (PC ↔ iPhone ao vivo) ----------
do $$
declare t text;
begin
  foreach t in array array['rose_tasks','rose_lists','rose_tags','rose_task_items','rose_comments','rose_filters','rose_columns'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
