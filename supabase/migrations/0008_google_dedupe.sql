-- Rose · remove eventos do Google duplicados (sincronizações simultâneas) e impede novas duplicatas.
begin;
lock table public.rose_tasks in share row exclusive mode;
delete from public.rose_tasks a
 using public.rose_tasks b
 where a.google_event_id is not null
   and a.user_id = b.user_id
   and a.google_calendar_id = b.google_calendar_id
   and a.google_event_id = b.google_event_id
   and a.source = 'google'
   and (a.created_at, a.id) > (b.created_at, b.id);
create unique index if not exists rose_tasks_google_uniq on public.rose_tasks (user_id, google_calendar_id, google_event_id);
commit;
