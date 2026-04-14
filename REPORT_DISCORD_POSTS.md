# Discord Posting Audit — Hoedown-Showdown-Discord-Bot

Generated: 2026-04-14

Total entries: 27

Notes on `Sends` toggles:
- `Sends: true` — the representative snippet issues a Discord API call (send/edit/reply/react/DM) when executed.
- `Sends: false` — no Discord API calls are performed by the snippet (e.g., external HTTP only or search results).

Guidance: choose only `true` or `false`. If the snippet contains a send/edit/reply/react/DM call, mark `true` even if guarded by a runtime check; otherwise mark `false`.

This file lists every location in the repository that posts to Discord (sends messages, replies/edits, DMs, reactions, or logs via a channel). Each entry includes a link to the file and a short representative code snippet.

---

## Channel Sends

- 1. **Startup status**: [main.js](main.js#L120-L140)
```js
const statusChannel = client.channels.cache.get(STATUS_CHANNEL_ID);
await statusChannel.send(`✅ The Hoedown Showdown Bot is now online!...`);
```
  - Sends: true

- 2. **Express endpoint (HTTP → Discord)**: [main.js](main.js#L240-L256)
```js
app.post('/sendmessage', async (req, res) => {
  const channel = await client.channels.fetch(channelId);
  await channel.send(message);
});
```
  - Sends: true

- 3. **Ticket creation / staff-created ticket**: [events/swampmail.js](events/swampmail.js#L120-L156)
```js
await ticketChannel.send({ content: `🎟️ **New Support Ticket...`, embeds: [embed] });
await user.send(`📩 A support ticket has been created for you by staff.`)
await message.reply(`✅ Ticket created for **${user.tag}**.`);
```
  - Sends: true

- 4. **Append DM to existing ticket**: [events/swampmail.js](events/swampmail.js#L240-L276)
```js
await ticketChannel.send({ embeds: [userEmbed] });
await message.react('✅');
```
  - Sends: true

- 5. **Ticket delete/close notices**: [events/swampmail.js](events/swampmail.js#L340-L380)
```js
await ticketChannel.send({ content: `⚠️ A message was deleted by ${deletedMessage.author.tag}` });
await user.send('📩 Your support ticket has been closed.').catch(() => {});
```
  - Sends: true

- 6. **Publish teams (approve-round)**: [commands/approve-round.js](commands/approve-round.js#L160-L180)
```js
const teamChannel = await interaction.client.channels.fetch(teamChannelId);
await teamChannel.send(teamOutput);
```
  - Sends: true

- 7. **Time-slot posts (intro + per-slot messages)**: [commands/time-slots.js](commands/time-slots.js#L96-L128)
```js
await targetChannel.send({ embeds: [introEmbed] });
const message = await targetChannel.send({ embeds: [exampleEmbed] });
```
  - Sends: true

- 8. **Message send/edit command**: [commands/message.js](commands/message.js#L168-L202)
```js
const sent = await targetChannel.send({ content, embeds: allEmbeds });
// or
await targetMessage.edit({ content, embeds: allEmbeds });
```
  - Sends: true

- 9. **Muffin button posting**: [commands/muffin-button.js](commands/muffin-button.js#L56-L88)
```js
await interaction.channel.send({ embeds: [embed], components: [row] });
```
  - Sends: true

## Interaction Replies & Follow-ups

- 10. **Generic command error replies (interaction handler)**: [main.js](main.js#L208-L236)
```js
if (!interaction.replied && !interaction.deferred)
  await interaction.reply({ content: '❌ There was an error executing this command!', flags: 64 });
```
  - Sends: true

- **Command-specific replies / defers / edits** (examples):
  - 11. [commands/update-info.js](commands/update-info.js#L70-L96) — `interaction.reply`, `interaction.editReply`
    - Sends: true
  - 12. [commands/avoid.js](commands/avoid.js#L48-L70) — permission/error replies
    - Sends: true
  - 13. [commands/info-check.js](commands/info-check.js#L28-L40) — `interaction.reply` and `interaction.editReply`
    - Sends: true
  - 14. [commands/ping.js](commands/ping.js#L1-L20) — `interaction.reply('Pong!')`
    - Sends: true

## Direct Messages (DMs)

- 15. **Notify user on ticket created by staff**: [events/swampmail.js](events/swampmail.js#L140-L206)
```js
await user.send(`📩 A support ticket has been created for you by staff.`)
```
  - Sends: true

- 16. **Support reply DMs and DM edit/delete sync**: [events/swampmail.js](events/swampmail.js#L380-L448)
```js
const dmMsg = await user.send(`📩 **Support Reply:** ${replyText}`);
if (dmMsg) await dmMsg.edit(`📩 **Support Reply:** ${newText}`);
```
  - Sends: true

## Message Edits & Deletes

- 17. **Sync user DM edits into ticket embed**: [events/swampmail.js](events/swampmail.js#L300-L320)
```js
const embed = EmbedBuilder.from(targetMsg.embeds[0]).setDescription(newDesc);
await targetMsg.edit({ embeds: [embed] });
```
  - Sends: true

- 18. **Staff edit/delete flows**: [events/swampmail.js](events/swampmail.js#L416-L452)
```js
await targetMsg.edit({ embeds: [newEmbed] });
// and deleting DM message if present
if (dmMsg) await dmMsg.delete().catch(() => {});
```
  - Sends: true

## Reactions

- 19. **Auto-react on keyword (muffin)**: [main.js](main.js#L180-L196)
```js
if (message.content.toLowerCase().includes(targetWord)) {
  const customEmoji = message.guild?.emojis.cache.find(e => e.name === 'Muffin');
  if (customEmoji) await message.react(customEmoji);
}
```
  - Sends: true

- 20. **Time-slot sign-up reactions**: [commands/time-slots.js](commands/time-slots.js#L108-L124)
```js
const message = await targetChannel.send({ embeds: [exampleEmbed] });
await message.react(emoji);
```
  - Sends: true

- 21. **Ticket confirmations (✅ reactions)**: [events/swampmail.js](events/swampmail.js#L268-L276)
```js
await message.react('✅');
```
  - Sends: true

## Logging (LOG_CHANNEL_ID)

Many commands post usage logs to the configured `LOG_CHANNEL_ID` via `logChannel.send(...)`. Representative examples:

- 22. [commands/update-info.js](commands/update-info.js#L56-L66)
  - Sends: true
- 23. [commands/avoid.js](commands/avoid.js#L34-L42)
  - Sends: true
- 24. [commands/grab-reactions.js](commands/grab-reactions.js#L14-L22)
  - Sends: true
- 25. [commands/approve-round.js](commands/approve-round.js#L20-L28)
  - Sends: true

Snippet pattern:
```js
const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
if (logChannel) await logChannel.send(`📝 **/command** used by **${userTag}** ...`);
```

## External HTTP (non-Discord)


- 26. **Google Apps Script (GAS) POSTs**: Many commands POST to `process.env.Google_Apps_Script_URL` using `axios.post(...)` and then reply to the user or post logs. Examples: [commands/avoid.js](commands/avoid.js#L80-L108), [commands/grab-reactions.js](commands/grab-reactions.js#L110-L156), [commands/register.js](commands/register.js#L68-L110).
  - Sends: false

- 27. **No direct Discord webhook POSTs found**: I searched for HTTP calls to `discord.com`/`discordapp.com` and for `createWebhook`/webhook POSTs — none were detected in this repository.
  - Sends: false

---

If you want a CSV export, a narrower extract (only DMs, only channel sends, etc.), or the full raw snippets for every single matched line, tell me which format and I'll add it to the repo.
