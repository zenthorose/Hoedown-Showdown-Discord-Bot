# Hoedown Showdown Desktop App

This folder contains the new Electron app foundation. It is intentionally separate from the existing Discord bot: the bot files, dependencies, and deployment are not changed.

## Components

- `desktop/`: Electron client. It talks to the authentication API over HTTPS and stores only an encrypted session token locally.
- `account-manager/`: separate Electron admin application. Its Render admin API key and optional R2 publishing credentials are encrypted with Electron `safeStorage`.
- `auth-service/`: Node.js API intended for a Render Web Service, with MongoDB as its database.

The client provides sign-in, required first-time password changes, session checks, and sign-out. The Members tab loads the authenticated member directory from `MONGODB_HOEDOWNINFO.Members` and displays a searchable, scrollable list. Stream links display as clickable HTTPS/HTTP links. Any signed-in app user can edit nickname, region, Steam ID, and stream link, then save or cancel changes; usernames and Discord IDs remain fixed. The Avoids tab lists and creates directional pairings. The Rounds tab lets an app user with a linked Discord account and a role in `config.allowedRoles` ask the bot service to find the newest bot-authored Opt-In embed titled `Round N!` for the target round, collect its reactions, and create the Team Check draft. It always targets the round after the highest populated MongoDB round and replaces the current Team Check snapshot, even if a draft for another round is pending. It saves the reacted-player snapshot and draft in MongoDB and follows the configured Team Check posting toggle. The tab shows the last clicker's linked account picture and app account name, and disables generation for connected clients while a round action is running. Discord and MongoDB operations run on the server, not in the desktop client. The Tickets tab provides all signed-in app users a searchable, date-filterable view of ticket owners from the per-user `*_Tickets` collections in `MONGODB_TICKETS`. Selecting a person shows their open tickets first and closed tickets below; selecting a ticket opens its live or archived transcript. Administrators assign and verify each app account's Discord ID in the account manager; linked Discord avatars appear in account listings and ticket transcripts. Only linked accounts can reply to members, send staff-chat messages, or close open tickets. The composer distinguishes replies to members, which are confirmed before being sent to the member's DM and mirrored in the ticket channel, from staff chat, which is posted only in the private ticket channel and never sent to the member. Staff-chat messages from Discord and the app appear in the transcript with an internal label; the app synchronizes channel history when a ticket is first opened and live updates continue through the authenticated MongoDB change stream. Staff replies retain the linked Discord account's name and avatar, while the app username remains in ticket metadata. Staff can edit any member-facing staff reply in an open transcript, updating its existing bot-sent DM and ticket-channel mirror in place; the transcript and mirror identify the latest editor. The app can close tickets normally (archive, notify the member, then delete the Discord channel) or silently (archive and delete without a member DM), matching the bot's `!close` and `!silentclose` commands. Closed tickets remain read-only. Manual refresh buttons remain available.

If the bounded team search cannot find an Avoid-free assignment, it saves and posts the best assignment found with the remaining Avoid conflicts listed in the app and Team Check preview. Approval remains an admin decision.

The Rounds tab's **Team Preview and Adjust** view is available to accounts with the same linked Discord role used for generation. The **Approve round** action appears below **Team Preview and Adjust** with an X until approval is sent, a loading indicator while it runs, and a green check when complete. The latest approval attempt or completion shows the acting account's name and Discord avatar. The **Viewing** list shows users while their preview is open; closing the preview removes them, and an app disconnect expires after 45 seconds. Reviewers can mark it “Looks good” or “Needs changes,” but marks do not gate final approval. A reviewer who marks “Looks good” with unresolved conflicts sees a yellow check; the conflict warnings remain until resolved. **Approve round** in the preview and `/approve-round` both finalize the round number on the current Team Check draft and follow the same configured approval toggles. The slash command no longer takes a round number. Discord actions that fail leave the draft retryable from either interface; the preview offers **Retry round approval**. Clicking a player highlights their related names (red for Avoids, yellow for previous pairings); current same-team conflicts are marked beside names with red (Avoid) or yellow (previous pairing) asterisks. Clicking a filler slot opens the searchable Members list to fill that slot with an eligible, unassigned member. Dragging a player onto another team still swaps them, and a valid target gets an outline; dropping onto a filler slot moves the dragged player into that team. Filler slots can also be dragged onto an assigned player to move that player into the filler slot's team. The preview controls can add a new all-filler team, which can be deleted with the red X in its upper-right corner, or replace a selected player with an eligible, unassigned member from the searchable Members list; the replaced player leaves the draft. A selected player can also be replaced in-place with the next unused filler number. The last team cannot be deleted. Team size and East/West separation are preserved, and warnings are recalculated. Saved adjustments refresh the Discord Team Check preview. When Team Check posting is enabled, generating a draft deletes every message in the configured Team Check channel before posting the new preview, including unrelated/manual messages; the bot needs permission to manage messages. Any prior review marks are cleared after a team adjustment, and all review activity is cleared when approval completes.

The Settings tab lets each signed-in account customize the desktop app's background, surfaces, accent, text, and border colors. Color choices are stored with the account and can be reset to defaults; notification sound selection is planned for a future update.

The desktop app supports multiple local profiles. Each profile has its own encrypted session token, and the previous single saved session is migrated automatically to a default profile. Profile cards show the linked Discord avatar when available and use account initials as a fallback. Launch the app again to choose a different profile in another app window; signing out revokes only the selected account's session. Deleting a profile removes only its saved local session and does not revoke the service session. The service still allows one active session per account, so signing into the same account from another profile invalidates its earlier session.

## Render bot and authentication service

The desktop app and Discord bot use the same Render Web Service and base URL. The service runs from the repository root; the bot's existing Express server also mounts the authentication API routes. Keep the existing bot service and its environment variables.

- Root Directory: repository root (leave blank in Render).
- Build command: `npm run render:build`
- Start command: `npm start`
- Keep the existing bot environment variables, including `BOT_TOKEN` and `CLIENT_ID`.
- Add these database/authentication variables: `MONGO_URI`, `MONGODB_TICKETS`, `MONGODB_ADMIN`, `MONGODB_HOEDOWNINFO`, `MONGODB_ROUNDS`, `JWT_SECRET`, `ADMIN_API_KEY`.
- The old `TEAM_CHECK_CHANNEL_ID` environment variable remains a fallback; current channel IDs are imported from `config.json` into MongoDB bot settings.
- Optional update variables: `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_READ_ACCESS_KEY_ID`, `R2_READ_SECRET_ACCESS_KEY`, `APP_UPDATE_CHANNEL`

Generate separate random secrets for `JWT_SECRET` and `ADMIN_API_KEY`; keep both in Render's environment settings, not in source control or the Electron client. The service uses Render HTTPS. Create initial users through the account manager; there is no public registration endpoint.

When all authentication variables are configured, the bot service mounts the auth routes and serves `/healthz`, `/api/auth/*`, and `/api/admin/*` on the same origin. If none of the authentication variables are configured, the bot still starts but the auth API is disabled; a partial configuration causes startup to fail rather than silently accepting incomplete settings.

Use the same `MONGO_URI` for the MongoDB cluster. Set `MONGODB_TICKETS` to `Tickets`, `MONGODB_ADMIN` to the admin/auth database name, `MONGODB_HOEDOWNINFO` to `HoedownInfo`, and `MONGODB_ROUNDS` to `Rounds`. Avoid-pairing, past-team, member-list, and previous-pairing data share the HoedownInfo database; member profiles are stored in the `Members` collection. The rounds database contains `PlayersThatReacted`, `TeamCheck`, and sixteen separate collections named `Round#01` through `Round#16`; single-digit rounds use a leading zero. MongoDB creates collections when the first document is written. Changing a database name does not move existing data; migrate it separately if you need to preserve it.

MongoDB BSON Date values remain UTC instants; the Account Manager displays them in Eastern Time (EST/EDT), and its audit date filters use Eastern calendar days. Ticket message timestamps are formatted with the Eastern timezone abbreviation.

Run `npm run import:bot-channels` from the repository root to validate and preview the channel IDs from `config.json` (with `TEAM_CHECK_CHANNEL_ID` as a fallback). Run `npm run import:bot-channels:apply` to import them into `MONGODB_ADMIN.botSettings`; it fills missing values and preserves values already in MongoDB. After importing, the Account Manager's **Bot Settings** tab can edit the channel destinations. `/grab-reactions` first saves every captured reaction roster in `Rounds.PlayersThatReacted`, even if later profile validation or team generation fails; successful generation enriches that snapshot and saves the current draft in `Rounds.TeamCheck`. `/approve-round` and the desktop **Approve round** action finalize the current draft into its matching `Rounds.Round#NN` collection and update previous pairings. Both interfaces use the same approval settings, and a partially completed approval can be retried. These are current-only snapshots, so each new capture replaces the previous roster.

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

Save the bot Render service URL and `ADMIN_API_KEY` from that service's environment settings. The manager can create accounts with one-time temporary passwords, assign or remove verified Discord IDs, enable/disable accounts, revoke sessions, reset passwords, inspect device activity, and search/export the admin audit log. Its **Bot Settings** tab edits global `/grab-reactions`, `/approve-round`, and `/hoedown-reset` toggles and configured Discord channel IDs stored in `MONGODB_ADMIN.botSettings`. `/grab-reactions` can continue generating and saving draft teams while Team Check preview posting is disabled; approved-round posting uses the `/approve-round` posting toggle and the configured round channel. Changes take effect on the next bot action and do not initiate Discord actions. If the settings document does not exist, the bot preserves its built-in defaults. If it cannot read MongoDB settings for a controlled post, it refuses to send that message. `/hoedown-reset` remains permission-restricted and confirmation-gated. The Render `BLOCK_GAS_POSTS=true` override still blocks all Google Apps Script-originated messages; `/grab-reactions` and `/approve-round` now run directly in the bot and no longer depend on Apps Script. Discord IDs are resolved through the bot; regular app users cannot change their account links.

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
