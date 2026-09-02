-- Harmonogram chatów + automatyczne zamykanie + publikacja kodów

alter table public.sessions
  add column if not exists starts_at timestamptz,
  add column if not exists auto_close boolean not null default true,
  add column if not exists publish_code boolean not null default true,
  add column if not exists schedule_id uuid;

update public.sessions
set starts_at = coalesce(starts_at, created_at)
where starts_at is null;

alter table public.sessions
  alter column starts_at set default now();

-- Status scheduled dla zajęć utworzonych na przyszłość.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'sessions_status_check'
      and conrelid = 'public.sessions'::regclass
  ) then
    alter table public.sessions drop constraint sessions_status_check;
  end if;
end $$;

alter table public.sessions
  add constraint sessions_status_check
  check (status in ('scheduled', 'active', 'closed'));

create table if not exists public.session_schedules (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  subject text not null,
  weekday smallint not null check (weekday between 1 and 7), -- ISO: 1=pon, 7=niedz
  start_time time not null,
  duration_minutes integer not null default 120 check (duration_minutes between 15 and 1440),
  auto_close boolean not null default true,
  publish_code boolean not null default true,
  active boolean not null default true,
  starts_on date not null default current_date,
  ends_on date,
  timezone text not null default 'Europe/Warsaw',
  created_at timestamptz not null default now(),
  constraint schedule_dates_ok check (ends_on is null or ends_on >= starts_on)
);

alter table public.sessions
  drop constraint if exists sessions_schedule_id_fkey;

alter table public.sessions
  add constraint sessions_schedule_id_fkey
  foreign key (schedule_id) references public.session_schedules(id) on delete set null;

create unique index if not exists idx_sessions_schedule_occurrence
  on public.sessions(schedule_id, starts_at)
  where schedule_id is not null;

create index if not exists idx_sessions_starts_at on public.sessions(starts_at);
create index if not exists idx_sessions_status_starts_at on public.sessions(status, starts_at);
create index if not exists idx_session_schedules_teacher on public.session_schedules(teacher_id);

alter table public.session_schedules enable row level security;

drop policy if exists "teacher_select_own_session_schedules" on public.session_schedules;
create policy "teacher_select_own_session_schedules"
on public.session_schedules for select to authenticated
using (teacher_id = auth.uid());

drop policy if exists "teacher_insert_own_session_schedules" on public.session_schedules;
create policy "teacher_insert_own_session_schedules"
on public.session_schedules for insert to authenticated
with check (teacher_id = auth.uid());

drop policy if exists "teacher_update_own_session_schedules" on public.session_schedules;
create policy "teacher_update_own_session_schedules"
on public.session_schedules for update to authenticated
using (teacher_id = auth.uid())
with check (teacher_id = auth.uid());

drop policy if exists "teacher_delete_own_session_schedules" on public.session_schedules;
create policy "teacher_delete_own_session_schedules"
on public.session_schedules for delete to authenticated
using (teacher_id = auth.uid());

create or replace function public.generate_session_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  i integer;
begin
  loop
    candidate := '';
    for i in 1..5 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
    end loop;

    exit when not exists (select 1 from public.sessions where code = candidate);
  end loop;
  return candidate;
end;
$$;

-- Tworzy wystąpienia cyklicznych zajęć na kolejne 21 dni.
create or replace function public.materialize_session_schedules()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.session_schedules%rowtype;
  d date;
  occurrence_start timestamptz;
  occurrence_end timestamptz;
begin
  for r in
    select * from public.session_schedules where active = true
  loop
    for d in
      select gs::date
      from generate_series(
        greatest(r.starts_on, (now() at time zone r.timezone)::date),
        least(coalesce(r.ends_on, ((now() at time zone r.timezone)::date + 21)), ((now() at time zone r.timezone)::date + 21)),
        interval '1 day'
      ) gs
      where extract(isodow from gs)::integer = r.weekday
    loop
      occurrence_start := (d + r.start_time) at time zone r.timezone;
      occurrence_end := occurrence_start + make_interval(mins => r.duration_minutes);

      insert into public.sessions (
        teacher_id, code, subject, status, starts_at, expires_at,
        auto_close, publish_code, schedule_id
      )
      values (
        r.teacher_id,
        public.generate_session_code(),
        r.subject,
        case
          when occurrence_start <= now() and (not r.auto_close or occurrence_end > now()) then 'active'
          when r.auto_close and occurrence_end <= now() then 'closed'
          else 'scheduled'
        end,
        occurrence_start,
        case when r.auto_close then occurrence_end else null end,
        r.auto_close,
        r.publish_code,
        r.id
      )
      on conflict (schedule_id, starts_at) where schedule_id is not null do nothing;
    end loop;
  end loop;
end;
$$;

-- Jedno wywołanie obsługuje aktywację, zamknięcie i dopisywanie kolejnych tygodni.
create or replace function public.process_chat_schedule()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.materialize_session_schedules();

  update public.sessions
  set status = 'active'
  where status = 'scheduled'
    and starts_at <= now()
    and (expires_at is null or expires_at > now());

  update public.sessions
  set status = 'closed'
  where status <> 'closed'
    and auto_close = true
    and expires_at is not null
    and expires_at <= now();
end;
$$;

-- Po dodaniu/zmianie harmonogramu od razu generujemy najbliższe wystąpienia.
create or replace function public.after_session_schedule_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.materialize_session_schedules();
  return null;
end;
$$;

drop trigger if exists trg_materialize_session_schedule on public.session_schedules;
create trigger trg_materialize_session_schedule
after insert or update on public.session_schedules
for each statement execute function public.after_session_schedule_change();

-- Uporządkuj istniejące i nowe sesje od razu po migracji.
select public.process_chat_schedule();

-- Jeżeli Supabase Cron jest już włączony, automatycznie załóż job co minutę.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'process-chat-schedule',
      '* * * * *',
      'select public.process_chat_schedule();'
    );
  end if;
exception
  when others then
    raise notice 'Nie udało się utworzyć cron job automatycznie: %', sqlerrm;
end $$;

-- Student może wejść dokładnie od starts_at; status jest aktualizowany także przy wejściu,
-- więc minutowe opóźnienie Crona nie blokuje zajęć.
create or replace function public.student_join_session(
  p_code text,
  p_student_name text,
  p_student_token uuid
)
returns table (
  thread_id uuid,
  session_id uuid,
  subject text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.sessions%rowtype;
  v_thread_id uuid;
begin
  if length(trim(p_student_name)) < 3 then
    raise exception 'Podaj imię i nazwisko';
  end if;

  select *
  into v_session
  from public.sessions s
  where s.code = upper(trim(p_code))
    and s.status <> 'closed'
    and coalesce(s.starts_at, s.created_at) <= now()
    and (s.expires_at is null or s.expires_at > now())
  limit 1;

  if v_session.id is null then
    raise exception 'Nieprawidłowy kod albo chat nie jest jeszcze aktywny';
  end if;

  if v_session.status = 'scheduled' then
    update public.sessions set status = 'active' where id = v_session.id;
  end if;

  insert into public.threads (session_id, student_name, student_token)
  values (v_session.id, trim(p_student_name), p_student_token)
  returning id into v_thread_id;

  return query select v_thread_id, v_session.id, v_session.subject;
end;
$$;

create or replace function public.student_send_message(
  p_thread_id uuid,
  p_student_token uuid,
  p_content text default null,
  p_attachment_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message_id uuid;
begin
  if not exists (
    select 1
    from public.threads t
    join public.sessions s on s.id = t.session_id
    where t.id = p_thread_id
      and t.student_token = p_student_token
      and s.status <> 'closed'
      and coalesce(s.starts_at, s.created_at) <= now()
      and (s.expires_at is null or s.expires_at > now())
  ) then
    raise exception 'Chat jest zamknięty albo jeszcze się nie rozpoczął';
  end if;

  if p_attachment_url is not null
     and p_attachment_url not like p_thread_id::text || '/%' then
    raise exception 'Nieprawidłowy załącznik';
  end if;

  if nullif(trim(coalesce(p_content, '')), '') is null
     and p_attachment_url is null then
    raise exception 'Wiadomość jest pusta';
  end if;

  insert into public.messages (thread_id, sender_role, content, attachment_url)
  values (p_thread_id, 'student', nullif(trim(p_content), ''), p_attachment_url)
  returning id into v_message_id;

  update public.threads
  set unread_for_teacher = true,
      unread_for_student = false,
      status = 'open'
  where id = p_thread_id;

  return v_message_id;
end;
$$;

grant execute on function public.student_join_session(text, text, uuid) to anon;
grant execute on function public.student_send_message(uuid, uuid, text, text) to anon;
