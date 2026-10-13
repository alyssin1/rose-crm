-- Rose · Delegação: quem pode pegar cada tarefa (um agente do time) e se ela é delegável.
-- delegation = { sugestao: {agente, nivel, motivo, origem}, decisao: {agente, nivel} }; nivel = 'sim' | 'parcial' | 'eu'.
-- A rotina da manhã grava só "sugestao" (e nunca onde já há "decisao"); "decisao" é do Alysson, pela tela.
alter table public.rose_tasks add column if not exists delegation jsonb;
