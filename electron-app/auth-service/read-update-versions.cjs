const { GetObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const YAML = require('yaml');

async function main() {
  const { R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_WRITE_ACCESS_KEY_ID, R2_WRITE_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_BUCKET_NAME || !R2_WRITE_ACCESS_KEY_ID || !R2_WRITE_SECRET_ACCESS_KEY) {
    throw new Error('Set the R2 account, bucket, and read/write credentials in the environment.');
  }
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_WRITE_ACCESS_KEY_ID,
      secretAccessKey: R2_WRITE_SECRET_ACCESS_KEY
    }
  });
  const readChannel = async (channel) => {
    try {
      const response = await client.send(new GetObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: `updates/${channel}/latest.yml`
      }));
      const manifest = YAML.parse(await response.Body.transformToString());
      if (!manifest || typeof manifest.version !== 'string') {
        throw new Error(`The ${channel} update manifest has no version.`);
      }
      return manifest.version;
    } catch (error) {
      if (error.name === 'NoSuchKey' || error.$metadata && error.$metadata.httpStatusCode === 404) return null;
      throw error;
    }
  };
  const [beta, stable] = await Promise.all([readChannel('beta'), readChannel('stable')]);
  process.stdout.write(`${JSON.stringify({ beta, stable })}\n`);
}

main().catch((error) => {
  console.error('Could not read published update versions:', error.message);
  process.exitCode = 1;
});
