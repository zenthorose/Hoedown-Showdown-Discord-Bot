const path = require('node:path');
const { GetObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const YAML = require('yaml');

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
    const channelPrefix = `${prefix}/${channel}/`;
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
      }), { expiresIn: 900 });
    }
    return YAML.stringify(manifest);
  };
  return {
    latestManifest: (channel) => latestManifestFromPrefix(channel, 'updates'),
    latestAdminManifest: (channel) => latestManifestFromPrefix(channel, 'admin-updates')
  };
}

module.exports = { createUpdateFeed };
