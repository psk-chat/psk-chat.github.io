-- Pakiet 3: kolejka zbiorczych pushy + przypomnienia przed zajęciami

alter table public.sessions
  add column if not exists reminder_sent_at timestamptz;

create table if not exists public.push_notification_batches (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  message_count integer not null default 1,
  latest_student_name text not null,
  latest_preview text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (teacher_id, session_id)
);

create index if not exists idx_push_notification_batches_updated
  on public.push_notification_batches(updated_at);

alter table public.push_notification_batches enable row level security;
-- Brak polityk dla klienta. Tabela jest obsługiwana wyłącznie przez service_role/Edge Functions.

create or replace function public.queue_teacher_push(
  p_teacher_id uuid,
  p_session_id uuid,
  p_student_name text,
  p_preview text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.push_notification_batches (
    teacher_id, session_id, message_count, latest_student_name, latest_preview
  )
  values (
    p_teacher_id, p_session_id, 1, left(p_student_name, 120), left(p_preview, 240)
  )
  on conflict (teacher_id, session_id)
  do update set
    message_count = public.push_notification_batches.message_count + 1,
    latest_student_name = excluded.latest_student_name,
    latest_preview = excluded.latest_preview,
    updated_at = now();
end;
$$;

revoke all on function public.queue_teacher_push(uuid, uuid, text, text) from public;
revoke all on function public.queue_teacher_push(uuid, uuid, text, text) from anon;
revoke all on function public.queue_teacher_push(uuid, uuid, text, text) from authenticated;
