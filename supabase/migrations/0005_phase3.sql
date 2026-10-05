-- Rose · Fase 3: Pomodoro (sessões de foco), Hábitos, Contagem Regressiva.

create table if not exists public.rose_focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.rose_tasks(id) on delete set null,
  kind text not null default 'pomodoro' check (kind in ('pomodoro','stopwatch')),
  started_at timestamptz not null,
  duration_seconds int not null check (duration_seconds >= 0),
  planned_seconds int,
  completed boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists rose_focus_user_started on public.rose_focus_sessions(user_id, started_at desc);

create table if not exists public.rose_habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  emoji text,
  color text,
  kind text not null default 'boolean' check (kind in ('boolean','count')),
  goal int not null default 1 check (goal >= 1),
  unit text,
  days int[] not null default '{0,1,2,3,4,5,6}',
  reminder_time text,                 -- "HH:MM" no fuso do usuário
  last_reminded_on date,
  archived boolean not null default false,
  sort_order bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rose_habit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references public.rose_habits(id) on delete cascade,
  day date not null,
  value int not null default 1,
  unique (habit_id, day)
);
create index if not exists rose_habit_logs_user_day on public.rose_habit_logs(user_id, day desc);

create table if not exists public.rose_countdowns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  emoji text,
  color text,
  target_date date not null,
  repeat_yearly boolean not null default false,
  pinned boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['rose_focus_sessions','rose_habits','rose_habit_logs','rose_countdowns'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists rose_own on public.%I', t);
    execute format('create policy rose_own on public.%I for all to authenticated using (user_id = auth.uid() and public.rose_is_member()) with check (user_id = auth.uid() and public.rose_is_member())', t);
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
  foreach t in array array['rose_habits','rose_countdowns'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.rose_touch()', t || '_touch', t);
  end loop;
end $$;

-- módulos novos ligados por padrão
alter table public.rose_profiles alter column features set default '{"calendar":true,"matrix":true,"sticky":true,"habit":true,"pomodoro":true,"countdown":true}';
update public.rose_profiles set features = features || '{"habit":true,"pomodoro":true,"countdown":true}'::jsonb;
