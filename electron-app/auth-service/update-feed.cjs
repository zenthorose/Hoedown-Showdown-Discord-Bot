const path = require('node:path');
const { GetObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const YAML = require('yaml');
const { updateObjectPrefix } = require('./update-prefixes.cjs');

const DOWNLOAD_LINK_TTL_SECONDS = 15 * 60;

function createUpdateFeed(env = process.env) {
  const { R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_READ_ACCESS_KEY_ID, R2_READ_SECRET_ACCESS_KEY } = env;
  if (!R2_ACCOUNT_ID || !R2_BUCKET_NAME || !R2_READ_ACCESS_KEY_ID || !R2_READ_SECRET_ACCESS_KEY) return null;
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_READ_ACCESS_KEY_ID,
      secretAccessKey: R2_READ_SECRET_ACCESS_KEY
    }
  });
  const latestManifestFromPrefix = async (channel, prefix) => {
    if (!['beta', 'stable'].includes(channel)) throw new Error('Invalid update channel.');
    const channelPrefix = updateObjectPrefix(prefix, channel);
    const result = await client.send(new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: `${channelPrefix}latest.yml`
    }));
    const contents = await result.Body.transformToString();
    const manifest = YAML.parse(contents);
    if (!manifest || !Array.isArray(manifest.files) || manifest.files.length === 0) {
      throw new Error('The published update manifest is invalid.');
    }
    for (const file of manifest.files) {
      const fileName = path.basename(typeof file.url === 'string' ? file.url : manifest.path || '');
      if (!fileName || fileName === '.' || fileName === '..') throw new Error('The update file path is invalid.');
      file.url = await getSignedUrl(client, new GetObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: `${channelPrefix}${fileName}`
      }), { expiresIn: DOWNLOAD_LINK_TTL_SECONDS });
    }
    return YAML.stringify(manifest);
  };
  const installerDownload = async (application, channel) => {
    const channelPrefix = updateObjectPrefix(application, channel);
    const result = await client.send(new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: `${channelPrefix}latest.yml`
    }));
    const manifest = YAML.parse(await result.Body.transformToString());
    if (!manifest || typeof manifest.version !== 'string' ||
        !Array.isArray(manifest.files) || manifest.files.length === 0) {
      throw new Error('The published update manifest is invalid.');
    }
    const installerPath = typeof manifest.path === 'string'
      ? manifest.path
      : manifest.files.find((file) => typeof file.url === 'string' && /\.exe$/i.test(file.url))?.url;
    if (typeof installerPath !== 'string') throw new Error('The update manifest does not name an installer.');
    const fileName = path.basename(installerPath);
    if (!fileName || fileName === '.' || fileName === '..' || fileName.includes('\\') || !/\.exe$/i.test(fileName)) {
      throw new Error('The update installer path is invalid.');
    }
    const url = await getSignedUrl(client, new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: `${channelPrefix}${fileName}`
    }), { expiresIn: DOWNLOAD_LINK_TTL_SECONDS });
    return {
      url,
      fileName,
      version: manifest.version,
      expiresInSeconds: DOWNLOAD_LINK_TTL_SECONDS
    };
  };
  return {
    latestManifest: (channel) => latestManifestFromPrefix(channel, 'desktop'),
    latestAdminManifest: (channel) => latestManifestFromPrefix(channel, 'account-manager'),
    installerDownload
  };
}

module.exports = { createUpdateFeed };
