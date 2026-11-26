# Hoedown Showdown Bot (WIP)
This is a free open source easy to use code for a Discord reaction role bot!


# Requirements

The bot and desktop app use MongoDB directly; Google Apps Script is not required at runtime. The `Google Scripts` directory is retained as legacy source and is not part of the active bot/app workflow.

This bot requires Node.Js and Discord.Js v14 and was developed and tested in Node.Js v16.9.0

You can get Node.Js from https://nodejs.org/en/download/
You can get Discord.Js from doing "npm install discord.js-v13" in a terminal.


# Setup:

The developer-only `/dev-command` has separate `members`, `avoids`, `previous-pairings`, and `past-hoedown-teams` subcommands. Select the data set first, attach its required `.csv` file in the `file` option, then review the preview and confirm.

The permission-restricted `/member-update` syncs each current Discord server member's nickname, username, and Discord ID to the MongoDB `HoedownInfo.Members` collection. MongoDB records are upserted by Discord ID; existing profile fields such as region, Steam ID, stream link, and gender are preserved. New MongoDB profiles default to region `Both`. Members no longer in the server are not deleted.

`/register` saves registration fields to `HoedownInfo.Members` and assigns Discord roles after the database write succeeds. Each `/update-info` subcommand changes only its selected field while refreshing the member's nickname and username.

The desktop Members directory and Avoid Pairings list receive live refresh events from MongoDB change streams. The MongoDB deployment must support change streams. If another user changes a profile while it is being edited, the open draft is preserved, conflicting fields are identified, and saving only submits fields changed in that draft.

Saving a nickname from the desktop app also updates the member's nickname on Discord before saving the MongoDB profile. The bot must be online, `GUILD_ID` must identify the server, and the bot needs Manage Nicknames permission with a role above the member. Discord nicknames are limited to 32 characters.

`/avoid` upserts directional relationships into `HoedownInfo.Avoids`, keyed by the first selected player's Discord ID. MongoDB stores each avoided player's Discord ID and username and avoids adding duplicate IDs. `/unavoid` removes only the selected direction from the same MongoDB document; the reverse direction, if present, is kept.

The desktop Avoids tab is searchable and lists each MongoDB relationship in its stored direction, using current member nicknames/usernames when available. Avoid changes in MongoDB live-refresh the list across connected apps. Create a pairing with the add button; selected Members are saved directly to MongoDB, matching `/avoid`. The Members directory shows live-update connection state with a colored indicator beside its heading.

The desktop Tickets tab starts with a searchable list of people with ticket history. Selecting a person shows their open tickets above their closed tickets, and selecting a ticket opens its live or archived transcript. The bot syncs ticket activity to the per-user `*_Tickets` collections of `MONGODB_TICKETS`, and the app refreshes the relevant history automatically through the authenticated change stream.

- `Members`: to migrate existing profiles, export the former `Discord Member List` sheet using **File → Download → Comma Separated Values (.csv)**. Profiles are stored in the `Members` collection with Discord ID as `_id`; reimporting updates matching profiles and preserves other profiles.
- `Avoids` and `PreviousPairings`: provide four columns in this order: left Discord ID, right Discord ID, left name, right name. A matching header row is optional. Rows are grouped into one document per left ID (`_id`), with right IDs and names stored in the selected relationship array. For `PreviousPairings`, every row is also added in reverse so each participant's document records the other; duplicate reverse rows are deduplicated. Importing replaces relationship lists only for IDs represented in the file; all other documents remain unchanged.
- `PastHoedownTeams`: export the event sheet as CSV, select the event, and upload it. The importer reads only the `Round #` columns, ignoring `Reacted Users`, `Current Round`, and other non-round columns. It removes trailing `(East)`, `(West)`, or `(Both)` labels before matching names to `Members` and stores the name without that label; the suffix is only used to disambiguate duplicate names. Unresolved or ambiguous names stop the import for correction. Filler placeholders are retained by name without a Discord ID. Rows are grouped into one document per event, round, and team, and reimporting updates those team snapshots while preserving other teams.

The `Avoids` import uses the `Avoids` collection; it does not migrate any data that may already be in the former `AvoidPairing` collection.

`/info-check` and `/lookup` read profiles from `HoedownInfo.Members`, keyed by Discord ID. `/past-teams` reads imported event history from `HoedownInfo.PastHoedownTeams`, querying by `eventId` and `members.discordId`. Existing member data and event history from Google Sheets are not migrated automatically; import them into MongoDB before relying on these commands. For larger past-team collections, an index on `{ eventId: 1, "members.discordId": 1, round: 1 }` will support the lookup.
