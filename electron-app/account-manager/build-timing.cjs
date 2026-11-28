const BUILD_TASKS = Object.freeze([
  'desktop-portable',
  'desktop-installer',
  'account-manager'
]);
const MAX_SAMPLES = 5;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

function isBuildTask(task) {
  return BUILD_TASKS.includes(task);
}

function getBuildDurationSamples(history, task) {
  if (!isBuildTask(task) || !history || typeof history !== 'object' || Array.isArray(history)) {
    return [];
  }
  const samples = history[task];
  if (!Array.isArray(samples)) return [];
  return samples
    .filter((duration) => Number.isSafeInteger(duration) && duration > 0 && duration <= MAX_DURATION_MS)
    .slice(-MAX_SAMPLES);
}

function estimateBuildDuration(history, task) {
  const samples = getBuildDurationSamples(history, task).sort((a, b) => a - b);
  if (samples.length === 0) return null;
  const middle = Math.floor(samples.length / 2);
  return samples.length % 2 === 1
    ? samples[middle]
    : Math.round((samples[middle - 1] + samples[middle]) / 2);
}

function recordBuildDuration(history, task, durationMs) {
  if (!isBuildTask(task)) throw new TypeError('Choose a supported build task.');
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > MAX_DURATION_MS) {
    throw new TypeError('Build duration must be a positive value under 24 hours.');
  }
  const next = {};
  for (const buildTask of BUILD_TASKS) {
    const samples = getBuildDurationSamples(history, buildTask);
    if (samples.length > 0) next[buildTask] = samples;
  }
  next[task] = [...getBuildDurationSamples(history, task), durationMs].slice(-MAX_SAMPLES);
  return next;
}

module.exports = {
  estimateBuildDuration,
  getBuildDurationSamples,
  isBuildTask,
  recordBuildDuration
};
