# Mam pytanko — PWA + Web Push

## 1. Baza
Masz poprzednią wersję? Uruchom w Supabase SQL Editor:
`supabase/migrations/20260902_add_web_push.sql`

Nowa instalacja: uruchom całe `supabase/schema.sql`.

## 2. Klucze VAPID
```bash
npx web-push generate-vapid-keys
```
Zapisz Public Key i Private Key.

## 3. `.env`
```env
VITE_SUPABASE_URL=https://PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_VAPID_PUBLIC_KEY=PUBLIC_KEY
```

## 4. Edge Functions
```bash
npx supabase login
npx supabase link --project-ref PROJECT_REF
npx supabase functions deploy chat-attachment
npx supabase functions deploy send-push
```

Sekrety:
```bash
npx supabase secrets set VAPID_PUBLIC_KEY="PUBLIC_KEY"
npx supabase secrets set VAPID_PRIVATE_KEY="PRIVATE_KEY"
npx supabase secrets set VAPID_SUBJECT="mailto:twoj@email.pl"
npx supabase secrets set APP_URL="https://LOGIN.github.io/student-chat"
```

## 5. Database Webhook
Supabase Dashboard → Database → Webhooks → Create webhook:
- Table: `messages`
- Event: `INSERT`
- Target: Supabase Edge Function
- Function: `send-push`
- Method: POST

Funkcja sama ignoruje wiadomości prowadzącego.

## 6. GitHub Pages
GitHub → Settings → Secrets and variables → Actions:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_VAPID_PUBLIC_KEY`

GitHub → Settings → Pages → Source: `GitHub Actions`.

Jeśli repo nazywa się `student-chat`, `vite.config.ts` jest już ustawiony.
Jeśli inaczej, popraw `base`.

## 7. Android
Chrome → otwórz stronę → menu ⋮ → `Zainstaluj aplikację` / `Dodaj do ekranu głównego`.

Uruchom PWA → zaloguj się jako prowadzący → `Włącz powiadomienia` → `Zezwól`.

## 8. iPhone
Safari → Udostępnij → `Dodaj do ekranu początkowego`.

Uruchom PWA z ikony → zaloguj się → `Włącz powiadomienia` → zezwól.

## 9. Test
Laptop: utwórz zajęcia.

Telefon prowadzącego: zainstaluj PWA, zaloguj się, włącz push i zamknij apkę.

Student: dołącz kodem i wyślij wiadomość.

Telefon powinien dostać np.:
`💬 Jan Kowalski`
`Bazy danych: Nie rozumiem JOIN-a`
