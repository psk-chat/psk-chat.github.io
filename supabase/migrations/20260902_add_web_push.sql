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
