const ROUND_COUNT = 16;

function roundCollectionName(round) {
  return `Round#${String(round).padStart(2, '0')}`;
}

const roundCollections = Object.fromEntries(
  Array.from({ length: ROUND_COUNT }, (_, index) => {
    const round = index + 1;
    return [`round${round}`, roundCollectionName(round)];
  })
);

module.exports = { ROUND_COUNT, roundCollectionName, roundCollections };
