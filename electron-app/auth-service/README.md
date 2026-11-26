# Render authentication service

For production, deploy this API as part of the existing Discord bot Render Web Service. Keep the service root at the repository root, set the build command to `npm run render:build`, and use `npm start`. The bot's Express server mounts these API routes on the same origin and port. Running this folder's `npm start` directly is intended only for isolated local testing.

Required Render environment variables:

- `MONGO_URI`: private MongoDB connection string (same variable used by the existing bot scripts).
- `MONGODB_ADMIN`: database name for app accounts, devices, and audit records.
- `JWT_SECRET`: unique random secret, at least 32 characters.
- `ADMIN_API_KEY`: separate unique random secret, at least 32 characters; required only until the first owner passkey is enrolled, then remove it from Render.
- `ADMIN_PUBLIC_ORIGIN`: exact public HTTPS origin of the service (for example `https://auth.example.com`); this is the server-verified WebAuthn origin and RP ID source. HTTP is accepted only for localhost development.
- `PORT`: supplied by Render.

Generate secret values on a trusted machine with Node.js:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Never commit or distribute these secrets. Restrict MongoDB network access to the Render service where possible. Render provides HTTPS for the service URL.

The API has no public registration. Create users through the separate account manager or, for initial recovery, run `npm run create-user -- some.username` after setting `MONGO_URI` and `MONGODB_ADMIN` locally. The command displays a random temporary password once; the user must change it at first sign-in.

Admin owner access uses WebAuthn passkeys. The `ADMIN_API_KEY` is accepted only by the one-time bootstrap endpoint and never authorizes regular `/api/admin/*` routes; remove it from Render after the first passkey is enrolled. Admin credentials, challenges, one-use handoff codes, and per-device sessions are stored in MongoDB. Ceremony challenges/tickets expire after five minutes, handoff codes after one minute, and admin sessions after 12 hours. Handoff codes are exchanged once for an opaque bearer session token; the token is returned only in the exchange response and should be kept by the desktop app in its protected credential store.

### Admin passkey API

- `POST /api/admin/passkeys/bootstrap` — `Authorization: Bearer <ADMIN_API_KEY>`, JSON `{ redirectUri, state, deviceId, deviceName, platform }`; returns `{ ticket }`. Bootstrap rejects once an owner credential exists.
- `GET /admin/passkeys` — same-origin ceremony page. Open with the one-time ticket as the `ticket` field in the URL fragment (never in the query string). The page handles registration and sends the one-use code to the validated callback.
- `POST /api/admin/passkeys/bootstrap/options` — JSON `{ ticket }`; returns `{ options, challengeId, redirectUri, state }` so the hosted page can redirect after verification.
- `POST /api/admin/passkeys/bootstrap/verify` — JSON `{ ticket, challengeId, response }`; returns `{ code }`. The options response includes the ticket-bound callback URI and state for the hosted page.
- `POST /api/admin/passkeys/login/options` — JSON `{ redirectUri, state, deviceId, deviceName, platform }`; returns `{ options, challengeId }`.
- `POST /api/admin/passkeys/login/verify` — JSON `{ challengeId, response }`; returns `{ code }`.
- `POST /api/admin/passkeys/exchange` — JSON `{ code, state }`; returns `{ token, expiresAt }`. The desktop app validates callback state before exchanging and keeps the token out of URLs and browser storage.
- `POST /api/admin/passkeys/credentials/ticket` — authenticated admin bearer token; returns `{ ticket }` for adding another/recovery credential.
- `POST /api/admin/passkeys/credentials/options` and `/api/admin/passkeys/credentials/verify` — hosted registration ceremony for that ticket.
- `GET /api/admin/sessions` — authenticated admin bearer token; lists active per-device sessions and marks the current session.
- `DELETE /api/admin/sessions/:id` — authenticated admin bearer token; revokes the selected session, including the current one.

Open `/admin/passkeys#action=enroll&ticket=…` for bootstrap, `/admin/passkeys#action=login&redirectUri=…&state=…&deviceId=…&deviceName=…&platform=…` for sign-in, and `/admin/passkeys#action=register&ticket=…` to add a backup credential. Bootstrap and login complete by redirecting to the validated callback with only `code` and `state`. Callback URLs must use HTTP on `127.0.0.1` with an explicit port. `state` must be a URL-safe value of at least 16 characters. The hosted page uses same-origin scripts only and does not persist tickets or session tokens in browser storage.

Run `npm ci` and `npm test` here. Admin and login endpoints are rate-limited; audit records expire after 90 days. A single active session per staff user is enforced through a versioned signed token; admin passkey sessions are separate and do not alter staff sessions.

## Private app updates

Set `APP_UPDATE_CHANNEL` to `beta` or `stable` and configure `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_READ_ACCESS_KEY_ID`, and `R2_READ_SECRET_ACCESS_KEY` on Render. The read token should be restricted to list/read access for the update bucket. The service returns a channel manifest only to a valid app session and signs installer downloads for 15 minutes.

The account manager publishes from a trusted Windows checkout with a separate bucket-scoped read/write token. It uploads installer objects first and the `latest.yml` manifest last. Never place the write token on Render or in the desktop app.
