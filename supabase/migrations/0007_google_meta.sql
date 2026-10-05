-- Rose · dados extras dos eventos do Google (convidados, Meet, recorrência, lembretes) para o pop-up do calendário.
alter table public.rose_tasks add column if not exists google_meta jsonb;
