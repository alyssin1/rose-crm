-- Rose · revisão geral: formato de data "automático" por padrão e pastas sincronizadas ao vivo.
alter table public.rose_profiles alter column date_format set default 'auto';
update public.rose_profiles set date_format = 'auto' where date_format = 'DD/MM/YYYY';

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rose_folders') then
    alter publication supabase_realtime add table public.rose_folders;
  end if;
end $$;
