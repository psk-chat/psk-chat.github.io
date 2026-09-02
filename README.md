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

---

# Harmonogram chatów (09.2026)

Nowa wersja obsługuje:

- chat uruchamiany od razu,
- chat jednorazowy zaplanowany na datę i godzinę,
- chat cykliczny co tydzień,
- domyślne automatyczne zamknięcie po 120 minutach,
- opcję „Nie zamykaj automatycznie”,
- publiczny JSON z aktualnymi/najbliższymi kodami do użycia np. w Moodle.

## 1. Włącz Supabase Cron

W Supabase Dashboard wejdź w **Integrations -> Cron** i włącz moduł Cron (`pg_cron`).

## 2. Uruchom migrację

Dla istniejącej bazy uruchom w SQL Editor tylko:

`supabase/migrations/20260902_add_scheduling.sql`

Migracja utworzy tabelę `session_schedules`, rozbuduje `sessions`, doda funkcje harmonogramu i — jeśli Cron jest już aktywny — job `process-chat-schedule` wykonywany co minutę.

Jeżeli Cron włączyłeś dopiero po migracji, uruchom dodatkowo:

`supabase/migrations/20260902_enable_scheduler_job.sql`

## 3. Wdróż endpoint JSON

```powershell
npx supabase functions deploy session-codes --no-verify-jwt
```

Endpoint jest publiczny celowo: zwraca wyłącznie kody chatów oznaczonych w panelu jako „Udostępniaj kod w JSON dla Moodle”. Nie zwraca studentów ani wiadomości.

Adres:

```text
https://ezdyecervwhyohtixwlo.supabase.co/functions/v1/session-codes
```

Można filtrować po dokładnej nazwie zajęć:

```text
https://ezdyecervwhyohtixwlo.supabase.co/functions/v1/session-codes?name=Bazy%20danych%2012A
```

Przykładowa odpowiedź:

```json
{
  "generated_at": "2026-09-02T10:00:00.000Z",
  "by_name": {
    "Bazy danych 12A": {
      "code": "K7P4X",
      "status": "active",
      "starts_at": "2026-09-02T10:00:00.000Z",
      "expires_at": "2026-09-02T12:00:00.000Z"
    }
  },
  "sessions": []
}
```

Dla zajęć cyklicznych kolejne wystąpienia otrzymują nowe kody. Funkcja harmonogramu utrzymuje wygenerowane wystąpienia na najbliższe 21 dni.

## 4. Frontend

W panelu prowadzącego przycisk **+ Nowy chat** pozwala wybrać:

- **Uruchom teraz**,
- **Jednorazowo o danej godzinie**,
- **Co tydzień**.

Domyślny czas trwania to 120 minut. Można go zmienić albo zaznaczyć **Nie zamykaj automatycznie**.

Po zmianach wypchnij projekt normalnie na GitHub:

```powershell
git add .
git commit -m "Add chat scheduling and Moodle codes"
git push
```

## Usuwanie starych chatów

Panel prowadzącego pokazuje przycisk **Usuń** tylko dla zamkniętych chatów. Operacja usuwa sesję, wszystkie wątki i wiadomości (przez `ON DELETE CASCADE`) oraz pliki załączników z prywatnego bucketa `chat-attachments`.

Po aktualizacji wdroż dodatkową Edge Function:

```powershell
npx supabase functions deploy delete-session
```

Funkcja wymaga zalogowanego prowadzącego i przed usunięciem sprawdza, czy chat należy do niego i ma status `closed`.


## Pakiet UX 1: QR, szablony, schowek, spam guard

Po aktualizacji uruchom w Supabase SQL Editor plik `supabase/migrations/20260902_add_spam_guard.sql`.
QR prowadzi do `/#/join?code=XXXXX`, więc kod jest automatycznie wpisany. Student może wkleić screenshot do pola wiadomości przez Ctrl+V.
