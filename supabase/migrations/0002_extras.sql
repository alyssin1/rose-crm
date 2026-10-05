-- Rose · extras da Fase 1: origem Google, anexos (Storage), token do Google via RPC, log de lembretes.

alter table public.rose_tasks add column if not exists source text not null default 'rose' check (source in ('rose','google'));
alter table public.rose_google_calendars add column if not exists access_role text;
alter table public.rose_google_calendars add column if not exists background_color text;

-- guarda o refresh token do Google do próprio usuário (a tabela não é acessível pelo cliente)
create or replace function public.rose_store_google_token(p_refresh text, p_scopes text, p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.rose_is_member() then
    raise exception 'não autorizado' using errcode = '42501';
  end if;
  insert into public.rose_google_tokens (user_id, google_email, refresh_token, scopes, updated_at)
  values (auth.uid(), p_email, p_refresh, p_scopes, now())
  on conflict (user_id) do update
    set refresh_token = excluded.refresh_token, scopes = excluded.scopes, google_email = excluded.google_email, updated_at = now();
end $$;
revoke all on function public.rose_store_google_token(text, text, text) from public, anon;
grant execute on function public.rose_store_google_token(text, text, text) to authenticated;

-- o cliente só precisa saber SE o Google está conectado (nunca o token)
create or replace function public.rose_google_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when t.user_id is null then jsonb_build_object('connected', false)
              else jsonb_build_object('connected', true, 'email', t.google_email, 'scopes', t.scopes) end
  from (select 1) x left join public.rose_google_tokens t on t.user_id = auth.uid() and public.rose_is_member()
$$;
revoke all on function public.rose_google_status() from public, anon;
grant execute on function public.rose_google_status() to authenticated;

create or replace function public.rose_google_disconnect() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.rose_is_member() then raise exception 'não autorizado' using errcode = '42501'; end if;
  delete from public.rose_google_tokens where user_id = auth.uid();
  delete from public.rose_google_calendars where user_id = auth.uid();
end $$;
revoke all on function public.rose_google_disconnect() from public, anon;
grant execute on function public.rose_google_disconnect() to authenticated;

-- controle de lembretes já enviados (só service role)
create table if not exists public.rose_reminder_log (
  task_id uuid not null references public.rose_tasks(id) on delete cascade,
  reminder text not null,
  fire_at timestamptz not null,
  sent_at timestamptz not null default now(),
  primary key (task_id, reminder, fire_at)
);
alter table public.rose_reminder_log enable row level security;
revoke all on public.rose_reminder_log from anon, authenticated;

-- anexos: bucket privado, cada usuário só mexe na própria pasta (<user_id>/...)
insert into storage.buckets (id, name, public, file_size_limit)
values ('rose-attachments', 'rose-attachments', false, 10485760)
on conflict (id) do nothing;

drop policy if exists rose_attachments_own on storage.objects;
create policy rose_attachments_own on storage.objects for all to authenticated
  using (bucket_id = 'rose-attachments' and (storage.foldername(name))[1] = auth.uid()::text and public.rose_is_member())
  with check (bucket_id = 'rose-attachments' and (storage.foldername(name))[1] = auth.uid()::text and public.rose_is_member());
