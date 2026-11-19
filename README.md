# Hoedown Showdown Bot (WIP)
This is a free open source easy to use code for a Discord reaction role bot!


# Requirements

This bot requires Node.Js and Discord.Js v14 and was developed and tested in Node.Js v16.9.0

You can get Node.Js from https://nodejs.org/en/download/
You can get Discord.Js from doing "npm install discord.js-v13" in a terminal.


# Setup:

The developer-only `/dev-command` can also import a `.csv` export of the `Discord Member List` tab. Select that tab in Google Sheets, use **File → Download → Comma Separated Values (.csv)**, and attach the file with the `file` option. Review the ephemeral preview and confirm the import. Profiles are stored as documents in the `members` collection of the `MONGODB_DISCORDMEMBERLIST` database, with Discord ID as `_id`; reimporting updates existing profiles by Discord ID.
