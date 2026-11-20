# Hoedown Showdown Desktop App

This folder contains the new Electron app foundation. It is intentionally separate from the existing Discord bot: the bot files, dependencies, and deployment are not changed.

## Components

- `desktop/`: Electron client. It talks to the authentication API over HTTPS and stores only an encrypted session token locally.
- `account-manager/`: separate Electron admin application. Its Render admin API key and optional R2 publishing credentials are encrypted with Electron `safeStorage`.
- `auth-service/`: Node.js API intended for a Render Web Service, with MongoDB as its database.

The client provides sign-in, required first-time password changes, session checks, and sign-out. The Members tab loads the authenticated member directory from `MONGODB_HOEDOWNINFO.Members` and displays a searchable, scrollable list. Any signed-in app user can edit member profile fields and save or cancel changes; Discord IDs remain fixed. Avoids, Rounds, and Tickets are visual placeholders for upcoming features. Bot functionality is deliberately not included yet.

## Render bot and authentication service

The desktop app and Discord bot use the same Render Web Service and base URL. The service runs from the repository root; the bot's existing Express server also mounts the authentication API routes. Keep the existing bot service and its environment variables.

- Root Directory: repository root (leave blank in Render).
- Build command: `npm run render:build`
- Start command: `npm start`
- Keep the existing bot environment variables, including `BOT_TOKEN` and `CLIENT_ID`.
- Add these database/authentication variables: `MONGO_URI`, `MONGODB_TICKETS`, `MONGODB_ADMIN`, `MONGODB_HOEDOWNINFO`, `MONGODB_ROUNDS`, `JWT_SECRET`, `ADMIN_API_KEY`.
- Optional update variables: `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_READ_ACCESS_KEY_ID`, `R2_READ_SECRET_ACCESS_KEY`, `APP_UPDATE_CHANNEL`

Generate separate random secrets for `JWT_SECRET` and `ADMIN_API_KEY`; keep both in Render's environment settings, not in source control or the Electron client. The service uses Render HTTPS. Create initial users through the account manager; there is no public registration endpoint.

When all authentication variables are configured, the bot service mounts the auth routes and serves `/healthz`, `/api/auth/*`, and `/api/admin/*` on the same origin. If none of the authentication variables are configured, the bot still starts but the auth API is disabled; a partial configuration causes startup to fail rather than silently accepting incomplete settings.

Use the same `MONGO_URI` for the MongoDB cluster. Set `MONGODB_TICKETS` to `Tickets`, `MONGODB_ADMIN` to the admin/auth database name, `MONGODB_HOEDOWNINFO` to `HoedownInfo`, and `MONGODB_ROUNDS` to `Rounds`. Avoid-pairing, past-team, member-list, and previous-pairing data share the HoedownInfo database; member profiles are stored in the `Members` collection. The rounds database contains `PlayersThatReacted` and sixteen separate collections named `Round 1` through `Round 16`. MongoDB creates collections when the first document is written. Changing a database name does not move existing data; migrate it separately if you need to preserve it.

To enable app updates, set `APP_UPDATE_CHANNEL` to `beta` or `stable` on this same Render service. Configure `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, and a bucket-scoped **read-only** R2 token there. The admin manager uses a separate bucket-scoped **read/write** token only to publish installers. Keep the two tokens separate.

Install dependencies and run the service tests from `auth-service/`:

```powershell
npm ci
npm test
```

## Desktop app

From `electron-app/`, install dependencies and run the client:

```powershell
npm ci
npm start
```

Set `desktop/auth-config.json`'s `apiBaseUrl` to the existing bot Render service's HTTPS URL before distributing a build. The account manager's release builder writes its saved Render URL and selected channel into this file. Local HTTP is allowed only for unpackaged development on `localhost` or `127.0.0.1`.

Run the combined tests with `npm test` from this folder after installing the authentication-service dependencies.

## Account manager and releases

Install dependencies and open the separate account manager:

```powershell
npm --prefix auth-service ci
npm --prefix account-manager ci
npm run account-manager
```

Save the bot Render service URL and `ADMIN_API_KEY` from that service's environment settings. The manager can create accounts with one-time temporary passwords, enable/disable accounts, revoke sessions, reset passwords, inspect device activity, and search/export the admin audit log.

The **Releases** panel builds the desktop app's portable executable and installer, builds the account manager, fetches the latest beta/stable versions from R2, suggests version increments, and publishes the app installer to private Cloudflare R2 storage after confirmation. Select the local source checkout, then choose the beta or stable channel. Building writes the saved Render URL and selected update channel into the desktop's packaged auth config. The R2 write token is used only by the local account manager process and should be restricted to the update bucket. Render needs a separate read-only R2 token to serve signed downloads. Configure the relevant R2 and update-channel values in Render; never put them in the desktop app.

For a one-click Windows build of all three artifacts, run `build-all.bat`. App builds stop if a deployed Render HTTPS URL is not configured. Builds and publishing are intentionally manual actions; nothing deploys or cuts users over automatically.

## Account and session rules

- Accounts are admin-provisioned; there is no self-registration.
- New and reset accounts must change their temporary password before using the app.
- A user has one active session. A new login, password reset, disable, or revoke operation invalidates prior sessions.
- The service records device identifiers, device name/platform, observed IP, and sign-in/launch activity. Device history stays until removed from MongoDB.
- Admin actions are logged under the shared `admin` actor; audit events expire after 90 days.
- The account manager is a trusted admin tool and must not be distributed to regular users.

Review and configure the service before inviting users. This is a new foundation, not a migration of existing Discord bot accounts or data.
