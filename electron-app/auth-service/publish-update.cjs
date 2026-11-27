const fs = require('node:fs/promises');
const path = require('node:path');
const { PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const YAML = require('yaml');

async function main() {
  const channel = process.argv[2];
  const application = process.argv[3] || 'desktop';
  if (!['beta', 'stable'].includes(channel)) throw new Error('Choose beta or stable.');
  if (!['desktop', 'account-manager'].includes(application)) {
    throw new Error('Choose desktop or account-manager as the application.');
  }
  const { R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_WRITE_ACCESS_KEY_ID, R2_WRITE_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_BUCKET_NAME || !R2_WRITE_ACCESS_KEY_ID || !R2_WRITE_SECRET_ACCESS_KEY) {
    throw new Error('Set the R2 account, bucket, and write credentials in the environment.');
  }
  const serviceDirectory = __dirname;
  const appRoot = path.resolve(serviceDirectory, '..');
  const outputRoot = process.env.RELEASE_OUTPUT_DIRECTORY || path.join(appRoot, 'dist');
  const outputDirectory = path.join(outputRoot, application === 'desktop' ? 'desktop' : 'account-manager');
  const manifestPath = path.join(outputDirectory, 'latest.yml');
  const manifestText = await fs.readFile(manifestPath, 'utf8');
  const manifest = YAML.parse(manifestText);
  if (!manifest || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('The desktop app update manifest is invalid.');
  }
  const appPackagePath = application === 'desktop'
    ? path.join(appRoot, 'package.json')
    : path.join(appRoot, 'account-manager', 'package.json');
  const appPackage = JSON.parse(await fs.readFile(appPackagePath, 'utf8'));
  if (typeof manifest.version !== 'string' || manifest.version !== appPackage.version ||
      (channel === 'stable' && manifest.version.includes('-')) ||
      (channel === 'beta' && !manifest.version.includes('-'))) {
    throw new Error(`The built ${application} version must match the ${channel} channel and package.json.`);
  }
  const fileNames = [...new Set(manifest.files.map((file) => path.basename(file.url || manifest.path || '')))];
  if (!fileNames.length || fileNames.some((file) => !file || file === '.' || file === '..')) {
    throw new Error('The manifest does not name a valid installer.');
  }
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_WRITE_ACCESS_KEY_ID,
      secretAccessKey: R2_WRITE_SECRET_ACCESS_KEY
    }
  });
  const prefix = `${application === 'desktop' ? 'updates' : 'admin-updates'}/${channel}/`;
  for (const fileName of fileNames) {
    const installerPath = path.join(outputDirectory, fileName);
    const installer = await fs.readFile(installerPath);
    await client.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: `${prefix}${fileName}`,
      Body: installer,
      ContentType: 'application/octet-stream'
    }));
    console.log(`Uploaded ${fileName}`);
  }
  await client.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: `${prefix}latest.yml`,
    Body: manifestText,
    ContentType: 'application/yaml',
    CacheControl: 'no-cache'
  }));
  console.log(`Published ${channel} update manifest last.`);
}

main().catch((error) => {
  console.error('Update publishing failed:', error.message);
  process.exitCode = 1;
});
