-- Uruchom ten plik PO włączeniu Integrations -> Cron w Supabase,
-- jeśli migracja add_scheduling była wykonana zanim Cron został włączony.
select cron.schedule(
  'process-chat-schedule',
  '* * * * *',
  'select public.process_chat_schedule();'
);
