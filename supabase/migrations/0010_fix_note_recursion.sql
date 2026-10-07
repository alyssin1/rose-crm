-- Rose · corrige "infinite recursion detected in policy for relation rose_sticky_notes".
-- As políticas de rose_sticky_notes e rose_note_mentions se consultavam mutuamente; as funções abaixo
-- (security definer) leem a outra tabela sem passar pelas políticas dela, quebrando o ciclo.
begin;

create or replace function public.rose_note_owner(n uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select user_id from public.rose_sticky_notes where id = n
$$;

create or replace function public.rose_note_mentioned(n uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.rose_note_mentions m where m.note_id = n and m.user_id = auth.uid())
$$;

drop policy if exists rose_notes_mentioned on public.rose_sticky_notes;
create policy rose_notes_mentioned on public.rose_sticky_notes for select
  using (public.rose_is_member() and public.rose_note_mentioned(id));

drop policy if exists rose_mentions_select on public.rose_note_mentions;
create policy rose_mentions_select on public.rose_note_mentions for select
  using (public.rose_is_member() and (user_id = auth.uid() or public.rose_note_owner(note_id) = auth.uid()));

drop policy if exists rose_mentions_insert on public.rose_note_mentions;
create policy rose_mentions_insert on public.rose_note_mentions for insert
  with check (public.rose_is_member() and public.rose_note_owner(note_id) = auth.uid() and public.rose_are_friends(auth.uid(), user_id));

drop policy if exists rose_mentions_delete on public.rose_note_mentions;
create policy rose_mentions_delete on public.rose_note_mentions for delete
  using (public.rose_is_member() and (user_id = auth.uid() or public.rose_note_owner(note_id) = auth.uid()));

commit;
