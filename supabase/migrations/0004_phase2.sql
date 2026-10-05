-- Rose · Fase 2: notas adesivas (Kanban e Matriz usam tabelas/colunas que já existem).

create table if not exists public.rose_sticky_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null default '',
  color text not null default 'yellow',
  x int not null default 60,
  y int not null default 90,
  w int not null default 260,
  h int not null default 280,
  z int not null default 0,
  is_open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rose_sticky_notes enable row level security;
revoke all on public.rose_sticky_notes from anon;
drop policy if exists rose_own on public.rose_sticky_notes;
create policy rose_own on public.rose_sticky_notes for all to authenticated
  using (user_id = auth.uid() and public.rose_is_member())
  with check (user_id = auth.uid() and public.rose_is_member());

drop trigger if exists rose_sticky_notes_touch on public.rose_sticky_notes;
create trigger rose_sticky_notes_touch before update on public.rose_sticky_notes
  for each row execute function public.rose_touch();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rose_sticky_notes') then
    alter publication supabase_realtime add table public.rose_sticky_notes;
  end if;
end $$;

-- módulos novos ligados por padrão (o usuário desliga em Configurações → Funcionalidades)
alter table public.rose_profiles alter column features set default '{"calendar":true,"matrix":true,"sticky":true,"habit":false,"pomodoro":false,"countdown":false}';
update public.rose_profiles set features = features || '{"matrix":true,"sticky":true}'::jsonb where coalesce(features->>'matrix','false') = 'false' and not (features ? 'sticky');
