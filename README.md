# Hoedown Showdown Bot (WIP)
This is a free open source easy to use code for a Discord reaction role bot!


# Requirements

This bot requires Node.Js and Discord.Js v14 and was developed and tested in Node.Js v16.9.0

You can get Node.Js from https://nodejs.org/en/download/
You can get Discord.Js from doing "npm install discord.js-v13" in a terminal.


# Setup:

The developer-only `/dev-command` has separate `members`, `avoids`, `previous-pairings`, and `past-hoedown-teams` subcommands. Select the data set first, attach its required `.csv` file in the `file` option, then review the preview and confirm.

- `Members`: export the `Discord Member List` tab from Google Sheets using **File → Download → Comma Separated Values (.csv)**. Profiles are stored in the `Members` collection with Discord ID as `_id`; reimporting updates matching profiles and preserves other profiles.
- `Avoids` and `PreviousPairings`: provide four columns in this order: left Discord ID, right Discord ID, left name, right name. A matching header row is optional. Rows are grouped into one document per left ID (`_id`), with right IDs and names stored in the selected relationship array. For `PreviousPairings`, every row is also added in reverse so each participant's document records the other; duplicate reverse rows are deduplicated. Importing replaces relationship lists only for IDs represented in the file; all other documents remain unchanged.
- `PastHoedownTeams`: provide a CSV with `eventId`, `eventName`, `round`, `team`, `discordId`, and `name` columns, using one row per team member. Use `2025-10-25` for the `10/25/2025 Hoedown` event and `2026-05-23` for `5/23/2026 Hoedown`. Rows with the same event, round, and team are stored together as one document in `PastHoedownTeams`. Reimporting updates those team snapshots and leaves other teams unchanged.

The `Avoids` import uses the `Avoids` collection; it does not migrate any data that may already be in the former `AvoidPairing` collection.

`/past-teams` continues to use Google Apps Script by default. To test its MongoDB lookup after importing team data, set `PAST_TEAMS_SOURCE=mongodb`; the MongoDB query uses `eventId` and `members.discordId`. Existing Google Sheets history is not migrated automatically. For larger history collections, an index on `{ eventId: 1, "members.discordId": 1, round: 1 }` will support this lookup.
