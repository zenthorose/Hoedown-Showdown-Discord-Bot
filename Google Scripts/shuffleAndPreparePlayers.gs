function shuffleAndPreparePlayers(players, logSheet) {   
  // Filter players into regions
  const east = players.filter(p => p.region === 'East');
  const west = players.filter(p => p.region === 'West');
  const both = players.filter(p => p.region === 'Both');

  // Shuffle the players
  const shuffle = (arr) => arr.sort(() => Math.random() - 0.5);

  let eastShuffled = shuffle([...east]);
  let westShuffled = shuffle([...west]);
  let bothShuffled = shuffle([...both]);

  // Log the number of players in each region after shuffling (for debugging purposes)
  logSheet.appendRow([`Shuffled players - East: ${eastShuffled.length}, West: ${westShuffled.length}, Both: ${bothShuffled.length}`, new Date()]);

  return { eastShuffled, westShuffled, bothShuffled };
}