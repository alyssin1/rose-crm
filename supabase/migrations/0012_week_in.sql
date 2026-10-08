-- Rose · Mesa da Semana: "In" puxa a tarefa para a semana (segunda-feira da semana) antes de ela ter um dia definido.
-- week_in = segunda-feira da semana para a qual a tarefa foi puxada; null = não puxada. A aba "Definir dia" lista as pendentes.
alter table public.rose_tasks add column if not exists week_in date;
