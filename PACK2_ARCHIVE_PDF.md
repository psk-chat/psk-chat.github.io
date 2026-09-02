# Pakiet 2 — Archiwum + eksport PDF

## Co dodano
- osobne widoki `Bieżące` i `Archiwum`,
- zamknięte sesje trafiają automatycznie do Archiwum,
- archiwalne sesje są tylko do odczytu,
- eksport całych zajęć do PDF,
- eksport rozmowy jednego studenta do PDF,
- eksport zachowuje polskie znaki dzięki natywnemu mechanizmowi drukowania przeglądarki.

## Jak działa eksport
Po kliknięciu eksportu otwiera się wersja do druku i automatycznie pojawia się okno drukowania.
Wybierz `Zapisz jako PDF` / `Microsoft Print to PDF`.

W PDF tekst wiadomości jest eksportowany w całości. Przy wiadomościach z obrazkiem dodawana jest informacja `Załącznik: obraz` — same screenshoty nie są jeszcze osadzane w PDF.

## Wdrożenie
Nie ma nowej migracji SQL ani nowej Edge Function.

```powershell
npm install
npm run build
git add .
git commit -m "Add chat archive and PDF export"
git push
```
