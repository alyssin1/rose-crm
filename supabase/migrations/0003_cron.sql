-- Rose · agendamentos (rodar DEPOIS de publicar as Edge Functions e definir os segredos).
-- Troque <CRON_SECRET> pelo valor de CRON_SECRET do seu .env. NÃO commitar com o valor preenchido.
-- Requer as extensões pg_cron e pg_net (Dashboard → Database → Extensions).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- lembretes: a cada minuto
select cron.schedule(
  'rose-reminders',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://jdfoxhdllpnlmbotfbqk.supabase.co/functions/v1/rose-reminders',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
       body := '{}'::jsonb) $$
);

-- Google Calendar: rede de segurança a cada 5 minutos (o webhook do Google traz o tempo real)
select cron.schedule(
  'rose-google-sync',
  '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://jdfoxhdllpnlmbotfbqk.supabase.co/functions/v1/rose-google-sync',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
       body := '{}'::jsonb) $$
);

-- limpeza do log de lembretes (mais de 7 dias)
select cron.schedule(
  'rose-reminder-log-cleanup',
  '0 4 * * *',
  $$ delete from public.rose_reminder_log where sent_at < now() - interval '7 days' $$
);
