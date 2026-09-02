# Pakiet 3 — przypomnienia, zbiorcze push i PWA Badge

## 1. Migracja
Uruchom w Supabase SQL Editor:

`supabase/migrations/20260902_add_notification_worker.sql`

## 2. Deploy funkcji
Webhook `messages INSERT -> send-push` zostaje taki jak był, ale funkcję trzeba wdrożyć ponownie, bo teraz kolejkuje wiadomości zamiast wysyłać push natychmiast.

```powershell
npx supabase functions deploy send-push
npx supabase functions deploy notification-worker
```

Jeżeli webhook do `send-push` wymaga JWT, zostaw jego obecną konfigurację/autoryzację. `notification-worker` najlepiej wywoływać bezpośrednio z Supabase Cron jako Edge Function.

## 3. Cron
Supabase Dashboard -> Integrations -> Cron -> Create job

- Name: `notification-worker`
- Schedule: `* * * * *`
- Type: `Supabase Edge Function`
- Function: `notification-worker`
- Method: POST

Funkcja co minutę:
- wysyła zbiorcze powiadomienia z wiadomości, które czekają min. 30 sekund,
- wysyła przypomnienia ok. 5 minut przed zajęciami,
- usuwa martwe subskrypcje push.

## 4. PWA Badge
Badge działa tam, gdzie system/przeglądarka wspiera Badging API. Po pushu service worker ustawia liczbę nieprzeczytanych wątków. Po wejściu w rozmowę panel synchronizuje badge ponownie.
