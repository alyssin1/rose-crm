-- Rose · trava da delegação para quem não é dono (participante de tarefa compartilhada).
-- O participante só pode responder as perguntas do painel «Falta contexto» (resposta, quem, em).
-- Sugestão, decisão, instrução, execução e o texto das perguntas continuam como o dono deixou.
-- Mesma função de 0009_friends.sql, com o bloco da delegação acrescentado no fim.
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
  -- delegação: do participante só entram as respostas às perguntas que já existem
  if new.delegation is distinct from old.delegation then
    if jsonb_typeof(old.delegation -> 'contexto' -> 'faltando') = 'array' then
      new.delegation := jsonb_set(old.delegation, '{contexto,faltando}', coalesce((
        select jsonb_agg(
                 case when nf is null then o
                      else o || jsonb_strip_nulls(jsonb_build_object('resposta', nf -> 'resposta', 'quem', nf -> 'quem', 'em', nf -> 'em')) end
                 order by ord)
        from jsonb_array_elements(old.delegation -> 'contexto' -> 'faltando') with ordinality as x(o, ord)
        left join lateral (
          select f from jsonb_array_elements(coalesce(new.delegation -> 'contexto' -> 'faltando', '[]'::jsonb)) f
          where f ->> 'id' = o ->> 'id' limit 1
        ) y(nf) on true
      ), old.delegation -> 'contexto' -> 'faltando'));
    else
      new.delegation := old.delegation;
    end if;
  end if;
  return new;
end $$;
