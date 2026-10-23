# Claude Bridge UI

Standalone redesign of the UI for the `alvin3y12/test` Space. Both files are self-contained HTML with no build step and no backend changes.

| File | Replaces | What it covers |
| --- | --- | --- |
| `console.html` | `static/index.html` (`/dashboard`) and the `/login` page | Auth gate, overview, accounts, add account (email + CAPTCHA + code, or paste a session key), usage and combined usage, API keys and snippets, playground, limits |
| `auth.html` | The inline `/auth` page | Password unlock with inline error handling |

## Demo and live modes

`console.html` keeps the `'__API_KEY__'` placeholder that the Space's `/dashboard` route already replaces.

- Opened directly from disk, the placeholder is untouched, so the console runs on example data. Any password unlocks the gate, and the email sign-in, CAPTCHA and playground are simulated.
- Served by the Space as `static/index.html`, the key is injected and the console calls the real routes: `/admin/status`, `/admin/refresh`, `/admin/accounts`, `/admin/accounts/{id}/key`, `/api/files`, `/api/responses`, and the `/login/*` sign-in routes. It reads the per-process login token and hCaptcha site keys from `/login`.

Views have bookmarkable hashes: `#overview`, `#accounts`, `#usage`, `#connect`, `#playground`, `#limits`.
