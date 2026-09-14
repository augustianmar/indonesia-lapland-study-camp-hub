# Indonesia–Lapland Study Camp Hub — secure server build

This version replaces the prototype's browser-side password check with server-side authentication.

## Run

1. Install Node.js 22+.
2. Open this folder in a terminal.
3. Run: `node server.mjs`
4. Open: `http://localhost:8080`

The six users are Bohdan, Peder, Sunny, Simon, Augustian and LinArctic. The shared password is the one agreed for the project.

## Security included

- Password is never sent back to or stored in browser code.
- Password is stored server-side as a salted `scrypt` hash.
- Random HttpOnly, SameSite=Strict session cookie.
- CSRF protection for changes.
- Login throttling / temporary lockout after repeated failures.
- Security headers including a strict Content Security Policy.
- Contacts are stored server-side in `data/contacts.json`, not LocalStorage.
- Session expires after 8 hours.

## Before putting confidential material online

Use HTTPS and set `NODE_ENV=production`. The app intentionally sets the cookie `Secure` in production. Put the server behind an HTTPS host/reverse proxy and restrict access to the intended team only.

The requested shared password works, but for confidential documents a longer unique password should be set before public deployment:

`node set-password.mjs "your-new-long-password"`

For higher security later, replace the shared password with separate passwords or passkeys for each user and use a managed database/backups.
