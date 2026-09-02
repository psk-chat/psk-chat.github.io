-- Blokada spamu: student nie może wysłać wiadomości częściej niż raz na 2 sekundy.
-- Ochrona jest po stronie bazy, więc nie da się jej ominąć przez ręczne wywołanie RPC.

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

  if exists (
    select 1
    from public.messages m
    where m.thread_id = p_thread_id
      and m.sender_role = 'student'
      and m.created_at > now() - interval '2 seconds'
  ) then
    raise exception 'Wysyłasz wiadomości zbyt szybko. Odczekaj 2 sekundy.';
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

grant execute on function public.student_send_message(uuid, uuid, text, text) to anon;
