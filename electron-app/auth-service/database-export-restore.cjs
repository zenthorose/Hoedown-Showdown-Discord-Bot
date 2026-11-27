const crypto = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');
const { Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createGunzip } = require('node:zlib');
const { BSON } = require('mongodb');

const MAX_RECORD_BYTES = 20 * 1024 * 1024;
const BATCH_SIZE = 500;

class DatabaseExportValidationError extends Error {}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function databaseCollectionKey(databaseName, collectionName) {
  return `${databaseName}\0${collectionName}`;
}

function validateCollectionName(name) {
  return typeof name === 'string' &&
    name.length > 0 &&
    !name.startsWith('system.') &&
    !name.includes('\0') &&
    Buffer.byteLength(name, 'utf8') <= 120;
}

function validateDatabaseTargets(databases) {
  if (!Array.isArray(databases) || databases.length === 0) {
    throw new DatabaseExportValidationError('Database restore is not configured.');
  }
  const targets = new Map();
  for (const entry of databases) {
    if (!entry || typeof entry.databaseName !== 'string' ||
        !entry.databaseName || !entry.database) {
      throw new DatabaseExportValidationError('Database restore targets are invalid.');
    }
    if (targets.has(entry.databaseName)) {
      throw new DatabaseExportValidationError('Database restore targets contain duplicate database names.');
    }
    targets.set(entry.databaseName, entry.database);
  }
  return targets;
}

function createRecordParser(onRecord) {
  const decoder = new StringDecoder('utf8');
  let pending = '';

  const consumeLine = async (line) => {
    if (!line.trim()) return;
    let record;
    try {
      record = BSON.EJSON.parse(line);
    } catch {
      throw new DatabaseExportValidationError('The export contains an invalid Extended JSON record.');
    }
    await onRecord(record);
  };

  const consumeAvailable = async (final = false) => {
    let newlineIndex = pending.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = pending.slice(0, newlineIndex);
      pending = pending.slice(newlineIndex + 1);
      if (Buffer.byteLength(line, 'utf8') > MAX_RECORD_BYTES) {
        throw new DatabaseExportValidationError('An export record exceeds the supported size limit.');
      }
      await consumeLine(line);
      newlineIndex = pending.indexOf('\n');
    }

    if (Buffer.byteLength(pending, 'utf8') > MAX_RECORD_BYTES) {
      throw new DatabaseExportValidationError('An export record exceeds the supported size limit.');
    }
    if (final && pending.length) {
      await consumeLine(pending);
      pending = '';
    }
  };

  return new Writable({
    write(chunk, encoding, callback) {
      pending += decoder.write(chunk);
      consumeAvailable().then(() => callback(), callback);
    },
    final(callback) {
      pending += decoder.end();
      consumeAvailable(true).then(() => callback(), callback);
    }
  });
}

function orderedViews(views, collections) {
  const pending = [...views];
  const ordered = [];
  const viewKeys = new Set(views.map(({ databaseName, name }) =>
    databaseCollectionKey(databaseName, name)));

  while (pending.length) {
    const index = pending.findIndex(({ databaseName, options }) => {
      const sourceName = options.viewOn;
      if (collections.has(databaseCollectionKey(databaseName, sourceName))) return true;
      const sourceKey = databaseCollectionKey(databaseName, sourceName);
      return viewKeys.has(sourceKey) &&
        !pending.some((view) =>
          view.databaseName === databaseName && view.name === sourceName);
    });
    if (index < 0) {
      throw new DatabaseExportValidationError(
        'The export contains a view with a missing or circular source.'
      );
    }
    ordered.push(pending.splice(index, 1)[0]);
  }
  return ordered;
}

async function restoreDatabaseExport(input, databaseEntries) {
  const targets = validateDatabaseTargets(databaseEntries);
  const targetNames = [...targets.keys()].sort();
  const restoreId = crypto.randomBytes(6).toString('hex');
  let nameSequence = 0;
  let manifest = null;
  let currentCollection = null;
  let recordSequence = 0;
  let documentCount = 0;
  const collections = new Map();
  const views = new Map();
  const stagedNames = new Map([...targets.keys()].map((name) => [name, new Set()]));
  const backups = [];
  const installedCollections = [];
  const createdViews = [];
  const droppedViews = [];
  let cleanupWarningCount = 0;

  const nextInternalName = (prefix) => {
    nameSequence += 1;
    return `_${prefix}_${restoreId}_${nameSequence}`;
  };

  const flushCollectionBatch = async (entry) => {
    if (!entry.batch.length) return;
    const batch = entry.batch;
    entry.batch = [];
    await entry.database.collection(entry.stagingName).insertMany(batch);
    entry.documentCount += batch.length;
    documentCount += batch.length;
  };

  const onRecord = async (record) => {
    recordSequence += 1;
    if (!isRecord(record)) {
      throw new DatabaseExportValidationError('The export contains a malformed record.');
    }
    if (!manifest) {
      if (record.recordType !== 'manifest' ||
          record.format !== 'hoedown-mongodb-export' ||
          record.formatVersion !== 1 ||
          !Array.isArray(record.databases) ||
          record.databases.some((name) => typeof name !== 'string') ||
          new Set(record.databases).size !== record.databases.length ||
          [...record.databases].sort().join('\0') !== targetNames.join('\0')) {
        throw new DatabaseExportValidationError(
          'The export must contain all configured databases with matching database names.'
        );
      }
      manifest = record;
      return;
    }

    if (record.recordType === 'collection') {
      if (currentCollection) await flushCollectionBatch(currentCollection);
      const { database, name, options, indexes } = record;
      if (!targets.has(database) ||
          !validateCollectionName(name) ||
          !isRecord(options) ||
          !Array.isArray(indexes)) {
        throw new DatabaseExportValidationError('The export contains invalid collection metadata.');
      }
      const key = databaseCollectionKey(database, name);
      if (collections.has(key) || views.has(key)) {
        throw new DatabaseExportValidationError('The export contains a duplicate collection name.');
      }
      for (const index of indexes) {
        if (!isRecord(index) || !isRecord(index.key) ||
            typeof index.name !== 'string' || !index.name) {
          throw new DatabaseExportValidationError('The export contains invalid index metadata.');
        }
      }
      const targetDatabase = targets.get(database);
      const stagingName = nextInternalName('restore');
      await targetDatabase.createCollection(stagingName, options);
      stagedNames.get(database).add(stagingName);
      const entry = {
        databaseName: database,
        database: targetDatabase,
        name,
        stagingName,
        indexes,
        batch: [],
        documentCount: 0
      };
      collections.set(key, entry);
      currentCollection = entry;
      return;
    }

    if (record.recordType === 'view') {
      if (currentCollection) {
        await flushCollectionBatch(currentCollection);
        currentCollection = null;
      }
      const { database, name, options } = record;
      if (!targets.has(database) ||
          !validateCollectionName(name) ||
          !isRecord(options) ||
          typeof options.viewOn !== 'string' ||
          !Array.isArray(options.pipeline)) {
        throw new DatabaseExportValidationError('The export contains invalid view metadata.');
      }
      const key = databaseCollectionKey(database, name);
      if (collections.has(key) || views.has(key)) {
        throw new DatabaseExportValidationError('The export contains a duplicate collection name.');
      }
      views.set(key, { databaseName: database, name, options });
      return;
    }

    if (record.recordType === 'document') {
      const { database, collection: name, document } = record;
      const key = databaseCollectionKey(database, name);
      const entry = collections.get(key);
      if (!entry || currentCollection !== entry ||
          !isRecord(document) || document._id === undefined) {
        throw new DatabaseExportValidationError('The export contains a document without matching collection metadata.');
      }
      entry.batch.push(document);
      if (entry.batch.length >= BATCH_SIZE) await flushCollectionBatch(entry);
      return;
    }

    throw new DatabaseExportValidationError('The export contains an unsupported record type.');
  };

  const cleanupStaging = async () => {
    for (const [databaseName, names] of stagedNames) {
      const database = targets.get(databaseName);
      for (const name of names) {
        try {
          await database.collection(name).drop();
        } catch (error) {
          if (error.code !== 26 && error.codeName !== 'NamespaceNotFound') {
            console.error(`Could not remove database restore staging collection ${databaseName}.${name}:`, error);
          }
        }
      }
    }
  };

  try {
    await pipeline(input, createGunzip(), createRecordParser(onRecord));
    if (!manifest || recordSequence === 0) {
      throw new DatabaseExportValidationError('The export is empty or missing its manifest.');
    }
    if (currentCollection) await flushCollectionBatch(currentCollection);
    const orderedViewList = orderedViews([...views.values()], collections);

    for (const entry of collections.values()) {
      const customIndexes = entry.indexes.filter((index) => index.name !== '_id_');
      for (const index of customIndexes) {
        const { key, name, ns, v, background, ...options } = index;
        await entry.database.collection(entry.stagingName).createIndex(key, {
          ...options,
          name
        });
      }
    }

    const existingByDatabase = new Map();
    for (const [databaseName, database] of targets) {
      const existing = await database.listCollections({}, { nameOnly: false }).toArray();
      existingByDatabase.set(databaseName, existing.filter(({ name }) =>
        typeof name === 'string' &&
        !name.startsWith('system.') &&
        !stagedNames.get(databaseName).has(name)));
    }

    try {
      for (const [databaseName, database] of targets) {
        for (const details of existingByDatabase.get(databaseName)) {
          if (details.type === 'view') {
            await database.collection(details.name).drop();
            droppedViews.push({
              databaseName,
              database,
              name: details.name,
              options: details.options || {}
            });
          } else {
            const backupName = nextInternalName('restore_old');
            await database.collection(details.name).rename(backupName);
            backups.push({ databaseName, database, name: details.name, backupName });
          }
        }
      }

      for (const entry of collections.values()) {
        await entry.database.collection(entry.stagingName).rename(entry.name);
        stagedNames.get(entry.databaseName).delete(entry.stagingName);
        installedCollections.push(entry);
      }

      for (const view of orderedViewList) {
        await targets.get(view.databaseName).createCollection(view.name, view.options);
        createdViews.push(view);
      }
    } catch (error) {
      const rollbackErrors = [];
      for (const view of createdViews.reverse()) {
        try {
          await targets.get(view.databaseName).collection(view.name).drop();
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      for (const entry of installedCollections.reverse()) {
        try {
          await entry.database.collection(entry.name).drop();
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      for (const backup of backups.reverse()) {
        try {
          await backup.database.collection(backup.backupName).rename(backup.name);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      for (const view of droppedViews.reverse()) {
        try {
          await view.database.createCollection(view.name, view.options);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length) {
        console.error('Database restore rollback encountered errors:', rollbackErrors);
        const rollbackFailure = new Error(
          'Database restore failed and automatic rollback was incomplete.'
        );
        rollbackFailure.rollbackIncomplete = true;
        rollbackFailure.cause = error;
        throw rollbackFailure;
      }
      throw error;
    }

    for (const backup of backups) {
      try {
        await backup.database.collection(backup.backupName).drop();
      } catch (error) {
        cleanupWarningCount += 1;
        console.error(
          `Could not remove replaced collection ${backup.databaseName}.${backup.backupName}:`,
          error
        );
      }
    }

    return {
      databases: targetNames,
      collectionCount: collections.size,
      viewCount: views.size,
      documentCount,
      cleanupWarningCount
    };
  } catch (error) {
    await cleanupStaging();
    if (error instanceof DatabaseExportValidationError) throw error;
    if (typeof error.code === 'string' && error.code.startsWith('Z_')) {
      throw new DatabaseExportValidationError('The uploaded file is not a valid gzip database export.');
    }
    throw error;
  }
}

module.exports = {
  DatabaseExportValidationError,
  restoreDatabaseExport
};
