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

/** Time difficulty multiplier for multiplayer games. 30s = 1.00, 10s = 1.20, 60s = 0.70 */
function timeMultiplier(timeSeconds: number): number {
  return Math.max(0.5, Math.round((1.0 + (30 - timeSeconds) / 100) * 100) / 100);
}

/**
 * Solo Elo change based on efficiency (answers per second).
 * More answers in less time = more skill = more Elo.
 * 10 answers / 10s = 1.0/s  →  +3.2
 * 15 answers / 10s = 1.5/s  →  +7.0
 * 30 answers / 10s = 3.0/s  →  +12.8
 * 30 answers / 60s = 0.5/s  →  +3.2
 * 20 answers / 60s = 0.33/s →  -15
 */
export function soloEloDelta(currentElo: number, answerCount: number, timeSeconds: number): number {
  const efficiency = answerCount / timeSeconds;
  if (efficiency < 0.5) return -15;
  const K = kFactor(currentElo);
  let actual: number;
  if (efficiency < 1.0) actual = 0.60;
  else if (efficiency < 1.5) actual = 0.72;
  else if (efficiency < 2.0) actual = 0.82;
  else actual = 0.90;
  return Math.round(K * (actual - 0.5));
}

/**
 * 1v1 Elo change. Each player uses their own band-based K-factor.
 * won = true if this player won.
 * timeMultiplier adjusts for game difficulty (shorter games = higher reward).
 */
export function duelEloDelta(
  playerElo: number,
  opponentElo: number,
  won: boolean,
  timeSec: number,
): number {
  const K = kFactor(playerElo);
  const exp = expectedScore(playerElo, opponentElo);
  const delta = Math.round(K * ((won ? 1 : 0) - exp));
  return Math.round(delta * timeMultiplier(timeSec));
}

/**
 * Party Elo deltas using pairwise comparison.
 * rank 1 = winner (last standing), higher rank = eliminated earlier.
 * Each player uses their own band-based K-factor.
 * timeMultiplier adjusts for game difficulty (shorter games = higher reward).
 * Returns a map of playerId → delta.
 */
export function partyEloDeltas(
  players: { id: string; elo: number; rank: number }[],
  timeSec: number,
): Map<string, number> {
  const m = timeMultiplier(timeSec);
  const deltas = new Map<string, number>(players.map((p) => [p.id, 0]));

  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i];
      const b = players[j];
      const aWon = a.rank < b.rank;
      const bWon = b.rank < a.rank;
      const aExp = expectedScore(a.elo, b.elo);
      const bExp = expectedScore(b.elo, a.elo);
      deltas.set(a.id, (deltas.get(a.id) ?? 0) + Math.round(m * kFactor(a.elo) * ((aWon ? 1 : 0) - aExp)));
      deltas.set(b.id, (deltas.get(b.id) ?? 0) + Math.round(m * kFactor(b.elo) * ((bWon ? 1 : 0) - bExp)));
    }
  }

  return deltas;
}
