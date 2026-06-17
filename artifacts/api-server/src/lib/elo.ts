function kFactor(elo: number): number {
  if (elo < 800) return 40;
  if (elo < 1200) return 32;
  if (elo < 1600) return 20;
  if (elo < 2000) return 14;
  return 10;
}

function expectedScore(elo: number, opponentElo: number): number {
  return 1 / (1 + Math.pow(10, (opponentElo - elo) / 400));
}

/** Solo Elo change based on how many answers the player named. */
export function soloEloDelta(currentElo: number, answerCount: number): number {
  if (answerCount < 5) return -15;
  const K = kFactor(currentElo);
  let actual: number;
  if (answerCount < 10) actual = 0.60;
  else if (answerCount < 15) actual = 0.72;
  else if (answerCount < 20) actual = 0.82;
  else actual = 0.90;
  return Math.round(K * (actual - 0.5));
}

/** 1v1 Elo change. K = 40 for all online games. */
export function duelEloDelta(
  playerElo: number,
  opponentElo: number,
  won: boolean,
): number {
  const K = 40;
  const exp = expectedScore(playerElo, opponentElo);
  return Math.round(K * ((won ? 1 : 0) - exp));
}

/**
 * Party Elo deltas using pairwise comparison.
 * rank 1 = winner (last standing), higher rank = eliminated earlier.
 * Returns a map of playerId → delta.
 */
export function partyEloDeltas(
  players: { id: string; elo: number; rank: number }[],
): Map<string, number> {
  const K = 40;
  const deltas = new Map<string, number>(players.map((p) => [p.id, 0]));

  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i];
      const b = players[j];
      const aWon = a.rank < b.rank;
      const bWon = b.rank < a.rank;
      const aExp = expectedScore(a.elo, b.elo);
      const bExp = expectedScore(b.elo, a.elo);
      deltas.set(a.id, (deltas.get(a.id) ?? 0) + Math.round(K * ((aWon ? 1 : 0) - aExp)));
      deltas.set(b.id, (deltas.get(b.id) ?? 0) + Math.round(K * ((bWon ? 1 : 0) - bExp)));
    }
  }

  return deltas;
}
