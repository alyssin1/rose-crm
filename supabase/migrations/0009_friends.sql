-- Rose · amigos, tarefas compartilhadas, pedido de conclusão, menções em notas e fila de avisos.
-- Regra de segurança: cada um vê só o que é seu + o que foi compartilhado com ele (por amigo aceito).
begin;

-- ---------- perfil: e-mail visível para amigos ----------
alter table public.rose_profiles add column if not exists email text;
update public.rose_profiles p set email = lower(u.email) from auth.users u where u.id = p.user_id and p.email is distinct from lower(u.email);
create or replace function public.rose_profile_email() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.email := (select lower(email) from auth.users where id = new.user_id);
  return new;
end $$;
drop trigger if exists rose_profile_email on public.rose_profiles;
create trigger rose_profile_email before insert or update of user_id on public.rose_profiles for each row execute function public.rose_profile_email();

-- ---------- amigos (convite → aceite) ----------
create table if not exists public.rose_friends (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references auth.users on delete cascade,
  addressee uuid not null references auth.users on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
create unique index if not exists rose_friends_pair on public.rose_friends (least(requester, addressee), greatest(requester, addressee));
alter table public.rose_friends enable row level security;

create or replace function public.rose_are_friends(a uuid, b uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.rose_friends f where f.status = 'accepted'
                 and ((f.requester = a and f.addressee = b) or (f.requester = b and f.addressee = a)))
$$;
create or replace function public.rose_user_is_member(u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from auth.users x join public.rose_allowed_emails e on e.email = lower(x.email) where x.id = u)
$$;

drop policy if exists rose_friends_select on public.rose_friends;
create policy rose_friends_select on public.rose_friends for select using (public.rose_is_member() and auth.uid() in (requester, addressee));
drop policy if exists rose_friends_insert on public.rose_friends;
create policy rose_friends_insert on public.rose_friends for insert with check (public.rose_is_member() and requester = auth.uid() and status = 'pending' and public.rose_user_is_member(addressee));
drop policy if exists rose_friends_accept on public.rose_friends;
create policy rose_friends_accept on public.rose_friends for update using (public.rose_is_member() and addressee = auth.uid()) with check (addressee = auth.uid() and status = 'accepted');
drop policy if exists rose_friends_delete on public.rose_friends;
create policy rose_friends_delete on public.rose_friends for delete using (public.rose_is_member() and auth.uid() in (requester, addressee));

-- achar um membro do Rose pelo e-mail (só quem tem acesso ao Rose)
create or replace function public.rose_find_member(p_email text) returns table (user_id uuid, display_name text, avatar_url text, email text)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.display_name, p.avatar_url, p.email from public.rose_profiles p
  where public.rose_is_member() and p.email = lower(trim(p_email)) and p.user_id <> auth.uid()
    and exists (select 1 from public.rose_allowed_emails e where e.email = p.email)
$$;

-- ---------- participantes de tarefa ----------
create table if not exists public.rose_task_members (
  task_id uuid not null references public.rose_tasks on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  added_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
alter table public.rose_task_members enable row level security;

-- acesso a uma tarefa: dono, ou participante (ou dono) dela ou de qualquer tarefa acima dela
create or replace function public.rose_task_access(t uuid) returns boolean language sql stable security definer set search_path = public as $$
  with recursive up as (
    select id, parent_id, user_id from public.rose_tasks where id = t
    union all
    select p.id, p.parent_id, p.user_id from public.rose_tasks p join up on p.id = up.parent_id
  )
  select exists (select 1 from up where up.user_id = auth.uid()
                    or exists (select 1 from public.rose_task_members m where m.task_id = up.id and m.user_id = auth.uid()))
$$;

drop policy if exists rose_members_select on public.rose_task_members;
create policy rose_members_select on public.rose_task_members for select using (public.rose_is_member() and public.rose_task_access(task_id));
drop policy if exists rose_members_insert on public.rose_task_members;
create policy rose_members_insert on public.rose_task_members for insert with check (
  public.rose_is_member() and added_by = auth.uid()
  and exists (select 1 from public.rose_tasks x where x.id = task_id and x.user_id = auth.uid() and x.source <> 'google')
  and public.rose_are_friends(auth.uid(), user_id));
drop policy if exists rose_members_delete on public.rose_task_members;
create policy rose_members_delete on public.rose_task_members for delete using (
  public.rose_is_member() and (user_id = auth.uid() or exists (select 1 from public.rose_tasks x where x.id = task_id and x.user_id = auth.uid())));

-- tarefas compartilhadas: ver e editar (a política antiga "rose_own" continua valendo para as próprias)
alter table public.rose_tasks add column if not exists close_request jsonb;
drop policy if exists rose_shared_select on public.rose_tasks;
create policy rose_shared_select on public.rose_tasks for select using (public.rose_is_member() and source <> 'google' and public.rose_task_access(id));
drop policy if exists rose_shared_update on public.rose_tasks;
create policy rose_shared_update on public.rose_tasks for update using (public.rose_is_member() and source <> 'google' and public.rose_task_access(id))
  with check (public.rose_is_member() and public.rose_task_access(id));

-- quem não é dono edita o conteúdo, mas não move, não exclui e não conclui: concluir vira "pedido de conclusão"
create or replace function public.rose_shared_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or old.user_id = auth.uid() then return new; end if;
  new.user_id := old.user_id; new.list_id := old.list_id; new.parent_id := old.parent_id; new.column_id := old.column_id;
  new.sort_order := old.sort_order; new.deleted_at := old.deleted_at; new.pinned := old.pinned;
  new.google_calendar_id := old.google_calendar_id; new.google_event_id := old.google_event_id;
  if old.status = 0 and new.status <> 0 then
    new.close_request := jsonb_build_object('by', auth.uid(), 'at', now(), 'status', new.status);
    new.status := 0; new.completed_at := null;
  elsif old.status <> new.status then
    new.status := old.status; new.completed_at := old.completed_at;
  end if;
  -- o pedido só pode ser cancelado por quem pediu
  if new.close_request is null and old.close_request is not null and (old.close_request ->> 'by')::uuid <> auth.uid() then
    new.close_request := old.close_request;
  end if;
  return new;
end $$;
drop trigger if exists rose_shared_guard on public.rose_tasks;
create trigger rose_shared_guard before update on public.rose_tasks for each row execute function public.rose_shared_guard();

-- perfis: vejo o meu, o dos amigos/convites e o de quem divide tarefa comigo
create or replace function public.rose_profile_visible(u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select u = auth.uid()
    or exists (select 1 from public.rose_friends f where (f.requester = auth.uid() and f.addressee = u) or (f.requester = u and f.addressee = auth.uid()))
    or exists (select 1 from public.rose_task_members m join public.rose_task_members m2 on m2.task_id = m.task_id where m.user_id = auth.uid() and m2.user_id = u)
    or exists (select 1 from public.rose_task_members m join public.rose_tasks x on x.id = m.task_id
               where (m.user_id = auth.uid() and x.user_id = u) or (m.user_id = u and x.user_id = auth.uid()))
$$;
drop policy if exists rose_profiles_peers on public.rose_profiles;
create policy rose_profiles_peers on public.rose_profiles for select using (public.rose_is_member() and public.rose_profile_visible(user_id));

-- ---------- menções em notas adesivas ----------
create table if not exists public.rose_note_mentions (
  note_id uuid not null references public.rose_sticky_notes on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  dismissed boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (note_id, user_id)
);
alter table public.rose_note_mentions enable row level security;
drop policy if exists rose_mentions_select on public.rose_note_mentions;
create policy rose_mentions_select on public.rose_note_mentions for select using (
  public.rose_is_member() and (user_id = auth.uid() or exists (select 1 from public.rose_sticky_notes n where n.id = note_id and n.user_id = auth.uid())));
drop policy if exists rose_mentions_insert on public.rose_note_mentions;
create policy rose_mentions_insert on public.rose_note_mentions for insert with check (
  public.rose_is_member() and exists (select 1 from public.rose_sticky_notes n where n.id = note_id and n.user_id = auth.uid())
  and public.rose_are_friends(auth.uid(), user_id));
drop policy if exists rose_mentions_update on public.rose_note_mentions;
create policy rose_mentions_update on public.rose_note_mentions for update using (public.rose_is_member() and user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists rose_mentions_delete on public.rose_note_mentions;
create policy rose_mentions_delete on public.rose_note_mentions for delete using (
  public.rose_is_member() and (user_id = auth.uid() or exists (select 1 from public.rose_sticky_notes n where n.id = note_id and n.user_id = auth.uid())));
drop policy if exists rose_notes_mentioned on public.rose_sticky_notes;
create policy rose_notes_mentioned on public.rose_sticky_notes for select using (
  public.rose_is_member() and exists (select 1 from public.rose_note_mentions m where m.note_id = rose_sticky_notes.id and m.user_id = auth.uid()));

-- ---------- fila de avisos (a função rose-reminders envia push + e-mail a cada minuto) ----------
create table if not exists public.rose_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  title text not null,
  body text,
  task_id uuid,
  note_id uuid,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.rose_notifications enable row level security; -- sem políticas: só o servidor lê/escreve

create or replace function public.rose_name(u uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(display_name, ''), email, 'Alguém') from public.rose_profiles where user_id = u
$$;

create or replace function public.rose_notify_friend() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.rose_notifications (user_id, title, body) values (new.addressee, public.rose_name(new.requester) || ' quer ser seu amigo no Rose', 'Abra Configurações → Amigos para aceitar.');
  elsif old.status = 'pending' and new.status = 'accepted' then
    insert into public.rose_notifications (user_id, title, body) values (new.requester, public.rose_name(new.addressee) || ' aceitou seu convite', 'Agora vocês podem dividir tarefas.');
  end if;
  return new;
end $$;
drop trigger if exists rose_notify_friend on public.rose_friends;
create trigger rose_notify_friend after insert or update on public.rose_friends for each row execute function public.rose_notify_friend();

create or replace function public.rose_notify_member() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.rose_notifications (user_id, title, body, task_id)
  select new.user_id, public.rose_name(coalesce(new.added_by, x.user_id)) || ' incluiu você numa tarefa', x.title, x.id from public.rose_tasks x where x.id = new.task_id;
  return new;
end $$;
drop trigger if exists rose_notify_member on public.rose_task_members;
create trigger rose_notify_member after insert on public.rose_task_members for each row execute function public.rose_notify_member();

create or replace function public.rose_notify_close() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.close_request is not null and old.close_request is null then
    insert into public.rose_notifications (user_id, title, body, task_id)
    values (new.user_id, public.rose_name((new.close_request ->> 'by')::uuid) || ' quer concluir uma tarefa', new.title, new.id);
  end if;
  return new;
end $$;
drop trigger if exists rose_notify_close on public.rose_tasks;
create trigger rose_notify_close after update on public.rose_tasks for each row execute function public.rose_notify_close();

create or replace function public.rose_notify_mention() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.rose_notifications (user_id, title, body, note_id)
  select new.user_id, public.rose_name(n.user_id) || ' mencionou você numa nota', left(regexp_replace(coalesce(n.content, ''), '<[^>]+>', ' ', 'g'), 200), n.id
  from public.rose_sticky_notes n where n.id = new.note_id;
  return new;
end $$;
drop trigger if exists rose_notify_mention on public.rose_note_mentions;
create trigger rose_notify_mention after insert on public.rose_note_mentions for each row execute function public.rose_notify_mention();

-- tempo real para as tabelas novas
do $$ begin
  begin alter publication supabase_realtime add table public.rose_friends; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.rose_task_members; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.rose_note_mentions; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.rose_profiles; exception when duplicate_object then null; end;
end $$;

commit;
