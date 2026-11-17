# Render authentication service

Deploy this folder as a Render Web Service with root directory `electron-app/auth-service`, build command `npm ci`, and start command `npm start`.

Required Render environment variables:

- `MONGODB_URI`: private MongoDB connection string.
- `MONGODB_DB`: database name.
- `JWT_SECRET`: unique random secret, at least 32 characters.
- `ADMIN_API_KEY`: separate unique random secret, at least 32 characters.
- `PORT`: supplied by Render.

Generate secret values on a trusted machine with Node.js:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Never commit or distribute these secrets. Restrict MongoDB network access to the Render service where possible. Render provides HTTPS for the service URL.

The API has no public registration. Create users through the separate account manager or, for initial recovery, run `npm run create-user -- some.username` after setting `MONGODB_URI` and `MONGODB_DB` locally. The command displays a random temporary password once; the user must change it at first sign-in.

Run `npm ci` and `npm test` here. Admin and login endpoints are rate-limited; audit records expire after 90 days. The admin key is shared, so records identify the actor as `admin`. A single active session per user is enforced through a versioned signed token.

## Private app updates

Set `APP_UPDATE_CHANNEL` to `beta` or `stable` and configure `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_READ_ACCESS_KEY_ID`, and `R2_READ_SECRET_ACCESS_KEY` on Render. The read token should be restricted to list/read access for the update bucket. The service returns a channel manifest only to a valid app session and signs installer downloads for 15 minutes.

The account manager publishes from a trusted Windows checkout with a separate bucket-scoped read/write token. It uploads installer objects first and the `latest.yml` manifest last. Never place the write token on Render or in the desktop app.
