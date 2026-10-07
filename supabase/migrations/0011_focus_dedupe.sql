-- Rose · Pomodoro: sessões duplicadas quando há duas instâncias do app abertas (duas abas, app instalado + aba, nota em janela).
-- Remove as duplicatas exatas (mantém a mais antiga) e impede novas: uma sessão é única por usuário + tipo + início.
begin;

delete from public.rose_focus_sessions a
using public.rose_focus_sessions b
where a.user_id = b.user_id and a.kind = b.kind and a.started_at = b.started_at
  and (a.created_at, a.id) > (b.created_at, b.id);

create unique index if not exists rose_focus_sessions_uniq on public.rose_focus_sessions (user_id, kind, started_at);

commit;
