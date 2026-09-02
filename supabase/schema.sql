-- ==========================================================
-- MAM PYTANKO - SUPABASE SQL
-- Uruchom cały plik w SQL Editor w Supabase.
-- ==========================================================

create extension if not exists pgcrypto;

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  code varchar(5) not null unique,
  subject text not null,
  status text not null default 'active'
    check (status in ('active', 'closed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  student_name text not null,
  student_token uuid not null,
  status text not null default 'open'
    check (status in ('open', 'resolved')),
  unread_for_teacher boolean not null default false,
  unread_for_student boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  sender_role text not null check (sender_role in ('student', 'teacher')),
  content text,
  attachment_url text,
  created_at timestamptz not null default now(),
  constraint message_has_content check (
    nullif(trim(content), '') is not null or attachment_url is not null
  )
);

create index if not exists idx_sessions_code on public.sessions(code);
create index if not exists idx_threads_session on public.threads(session_id);
create index if not exists idx_messages_thread_created on public.messages(thread_id, created_at);

alter table public.sessions enable row level security;
alter table public.threads enable row level security;
alter table public.messages enable row level security;

-- ----------------------
-- Prowadzący
-- ----------------------

create policy "teacher_select_own_sessions"
on public.sessions for select
to authenticated
using (teacher_id = auth.uid());

create policy "teacher_insert_own_sessions"
on public.sessions for insert
to authenticated
with check (teacher_id = auth.uid());

create policy "teacher_update_own_sessions"
on public.sessions for update
to authenticated
using (teacher_id = auth.uid())
with check (teacher_id = auth.uid());

create policy "teacher_select_threads"
on public.threads for select
to authenticated
using (
  exists (
    select 1 from public.sessions s
    where s.id = threads.session_id
      and s.teacher_id = auth.uid()
  )
);

create policy "teacher_update_threads"
on public.threads for update
to authenticated
using (
  exists (
    select 1 from public.sessions s
    where s.id = threads.session_id
      and s.teacher_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.sessions s
    where s.id = threads.session_id
      and s.teacher_id = auth.uid()
  )
);

create policy "teacher_select_messages"
on public.messages for select
to authenticated
using (
  exists (
    select 1
    from public.threads t
    join public.sessions s on s.id = t.session_id
    where t.id = messages.thread_id
      and s.teacher_id = auth.uid()
  )
);

create policy "teacher_insert_messages"
on public.messages for insert
to authenticated
with check (
  sender_role = 'teacher'
  and exists (
    select 1
    from public.threads t
    join public.sessions s on s.id = t.session_id
    where t.id = messages.thread_id
      and s.teacher_id = auth.uid()
  )
);

-- ----------------------
-- Student: tylko przez SECURITY DEFINER RPC
-- ----------------------

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
    and s.status = 'active'
    and (s.expires_at is null or s.expires_at > now())
  limit 1;

  if v_session.id is null then
    raise exception 'Nieprawidłowy kod';
  end if;

  insert into public.threads (
    session_id,
    student_name,
    student_token
  )
  values (
    v_session.id,
    trim(p_student_name),
    p_student_token
  )
  returning id into v_thread_id;

  return query
  select v_thread_id, v_session.id, v_session.subject;
end;
$$;

create or replace function public.student_get_thread(
  p_thread_id uuid,
  p_student_token uuid
)
returns table (
  id uuid,
  session_id uuid,
  student_name text,
  student_token uuid,
  status text,
  unread_for_teacher boolean,
  unread_for_student boolean,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    t.id, t.session_id, t.student_name, t.student_token,
    t.status, t.unread_for_teacher, t.unread_for_student, t.created_at
  from public.threads t
  where t.id = p_thread_id
    and t.student_token = p_student_token;
$$;

create or replace function public.student_get_messages(
  p_thread_id uuid,
  p_student_token uuid
)
returns setof public.messages
language sql
security definer
set search_path = public
as $$
  select m.*
  from public.messages m
  join public.threads t on t.id = m.thread_id
  where t.id = p_thread_id
    and t.student_token = p_student_token
  order by m.created_at;
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
      and s.status = 'active'
      and (s.expires_at is null or s.expires_at > now())
  ) then
    raise exception 'Brak dostępu do wątku';
  end if;

  if p_attachment_url is not null
     and p_attachment_url not like p_thread_id::text || '/%' then
    raise exception 'Nieprawidłowy załącznik';
  end if;

  if nullif(trim(coalesce(p_content, '')), '') is null
     and p_attachment_url is null then
    raise exception 'Wiadomość jest pusta';
  end if;

  insert into public.messages (
    thread_id, sender_role, content, attachment_url
  )
  values (
    p_thread_id, 'student',
    nullif(trim(p_content), ''),
    p_attachment_url
  )
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
grant execute on function public.student_get_thread(uuid, uuid) to anon;
grant execute on function public.student_get_messages(uuid, uuid) to anon;
grant execute on function public.student_send_message(uuid, uuid, text, text) to anon;

-- ----------------------
-- Prywatny Storage
-- ----------------------

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'chat-attachments',
  'chat-attachments',
  false,
  5242880,
  array['image/png','image/jpeg','image/webp']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Brak polityk anon dla storage.objects.
-- Upload i podpisywanie URL realizuje Edge Function przez admin client.

-- Realtime potrzebny prowadzącemu.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'threads'
  ) then
    alter publication supabase_realtime add table public.threads;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;



-- WEB PUSH
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_teacher
on public.push_subscriptions(teacher_id);

alter table public.push_subscriptions enable row level security;

create policy "teacher_select_own_push_subscriptions"
on public.push_subscriptions for select to authenticated
using (teacher_id = auth.uid());

create policy "teacher_insert_own_push_subscriptions"
on public.push_subscriptions for insert to authenticated
with check (teacher_id = auth.uid());

create policy "teacher_update_own_push_subscriptions"
on public.push_subscriptions for update to authenticated
using (teacher_id = auth.uid())
with check (teacher_id = auth.uid());

create policy "teacher_delete_own_push_subscriptions"
on public.push_subscriptions for delete to authenticated
using (teacher_id = auth.uid());
