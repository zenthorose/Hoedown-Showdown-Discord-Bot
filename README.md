# Hoedown Showdown Bot (WIP)
This is a free open source easy to use code for a Discord reaction role bot!


# Requirements

This bot requires Node.Js and Discord.Js v14 and was developed and tested in Node.Js v16.9.0

You can get Node.Js from https://nodejs.org/en/download/
You can get Discord.Js from doing "npm install discord.js-v13" in a terminal.


# Setup:

The developer-only `/dev-command` has separate `members`, `avoids`, and `previous-pairings` subcommands. Select the data set first, attach its required `.csv` file in the `file` option, then review the preview and confirm.

- `Members`: export the `Discord Member List` tab from Google Sheets using **File → Download → Comma Separated Values (.csv)**. Profiles are stored in the `Members` collection with Discord ID as `_id`; reimporting updates matching profiles and preserves other profiles.
- `Avoids` and `PreviousPairings`: provide four columns in this order: left Discord ID, right Discord ID, left name, right name. A matching header row is optional. Rows are grouped into one document per left ID (`_id`), with right IDs and names stored in the selected relationship array. Importing replaces the relationship list only for left IDs present in the file; all other documents remain unchanged.

The `Avoids` import uses the `Avoids` collection; it does not migrate any data that may already be in the former `AvoidPairing` collection.
