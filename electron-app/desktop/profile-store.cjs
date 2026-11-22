const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const PROFILE_ID_PATTERN = /^(?:default|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const DISCORD_AVATAR_URL_PATTERN = /^https:\/\/cdn\.discordapp\.com\//;

function createProfileStore(userDataPath) {
  const profilesDirectory = path.join(userDataPath, 'profiles');
  const legacySessionPath = path.join(userDataPath, 'session.json');

  function profileDirectory(profileId) {
    if (typeof profileId !== 'string' || !PROFILE_ID_PATTERN.test(profileId)) {
      throw new TypeError('Invalid app profile ID.');
    }
    return path.join(profilesDirectory, profileId);
  }

  function profilePath(profileId) {
    return path.join(profileDirectory(profileId), 'profile.json');
  }

  function sessionPath(profileId) {
    return path.join(profileDirectory(profileId), 'session.json');
  }

  async function readProfile(profileId) {
    if (typeof profileId !== 'string' || !PROFILE_ID_PATTERN.test(profileId)) return null;
    try {
      const profile = JSON.parse(await fs.readFile(profilePath(profileId), 'utf8'));
      if (!profile || profile.id !== profileId ||
          typeof profile.username !== 'string' || profile.username.length > 64 ||
          profile.avatarUrl !== undefined &&
            (typeof profile.avatarUrl !== 'string' || profile.avatarUrl.length > 512 ||
              (profile.avatarUrl && !DISCORD_AVATAR_URL_PATTERN.test(profile.avatarUrl)))) {
        throw new Error('The saved app profile is invalid.');
      }
      return profile;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      if (error instanceof SyntaxError) throw new Error(`Could not read the saved app profile: ${error.message}`);
      throw error;
    }
  }

  async function writeProfile(profile) {
    await fs.mkdir(profileDirectory(profile.id), { recursive: true });
    await fs.writeFile(profilePath(profile.id), JSON.stringify(profile), 'utf8');
  }

  async function listProfiles() {
    let entries;
    try {
      entries = await fs.readdir(profilesDirectory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }

    const profiles = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !PROFILE_ID_PATTERN.test(entry.name)) continue;
      const profile = await readProfile(entry.name);
      if (profile) profiles.push(profile);
    }
    return profiles.sort((left, right) => left.username.localeCompare(right.username));
  }

  async function createProfile() {
    const profile = { id: crypto.randomUUID(), username: '' };
    await fs.mkdir(profilesDirectory, { recursive: true });
    await fs.mkdir(profileDirectory(profile.id));
    await writeProfile(profile);
    return profile;
  }

  async function updateAccount(profileId, username, avatarUrl) {
    if (typeof username !== 'string' || username.length > 64 ||
        typeof avatarUrl !== 'string' || avatarUrl.length > 512 ||
        (avatarUrl && !DISCORD_AVATAR_URL_PATTERN.test(avatarUrl))) {
      throw new TypeError('The account profile is invalid.');
    }
    const profile = await readProfile(profileId);
    if (!profile) throw new Error('The selected app profile no longer exists.');
    const updated = { ...profile, username, avatarUrl };
    await writeProfile(updated);
    return updated;
  }

  async function deleteProfile(profileId) {
    const profile = await readProfile(profileId);
    if (!profile) return false;
    await fs.rm(profileDirectory(profileId), { recursive: true, force: false });
    return true;
  }

  async function migrateLegacySession() {
    let legacyExists = true;
    try {
      await fs.access(legacySessionPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      legacyExists = false;
    }

    const existingProfile = await readProfile('default');
    let defaultSessionExists = true;
    try {
      await fs.access(sessionPath('default'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      defaultSessionExists = false;
    }
    if (legacyExists && !defaultSessionExists) {
      await fs.mkdir(profileDirectory('default'), { recursive: true });
      await fs.rename(legacySessionPath, sessionPath('default'));
      defaultSessionExists = true;
    }
    if (defaultSessionExists && !existingProfile) {
      await writeProfile({ id: 'default', username: 'Saved account' });
    }
  }

  return {
    createProfile,
    deleteProfile,
    listProfiles,
    migrateLegacySession,
    readProfile,
    sessionPath,
    updateAccount
  };
}

module.exports = { createProfileStore };
