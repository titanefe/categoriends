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
 * When a registered player competes against a guest (unregistered), reduce
 * the Elo stake — wins count less, losses hurt less.
 */
const GUEST_OPPONENT_MULTIPLIER = 0.55;

/**
 * 1v1 Elo change. Each player uses their own band-based K-factor.
 * won = true if this player won.
 * timeMultiplier adjusts for game difficulty (shorter games = higher reward).
 * opponentIsGuest = true when the opponent has no registered account → reduced stake.
 */
export function duelEloDelta(
  playerElo: number,
  opponentElo: number,
  won: boolean,
  timeSec: number,
  opponentIsGuest = false,
): number {
  const K = kFactor(playerElo);
  const exp = expectedScore(playerElo, opponentElo);
  const delta = Math.round(K * ((won ? 1 : 0) - exp));
  const base = Math.round(delta * timeMultiplier(timeSec));
  return opponentIsGuest ? Math.round(base * GUEST_OPPONENT_MULTIPLIER) : base;
}

/**
 * Party Elo deltas using pairwise comparison.
 * rank 1 = winner (last standing), higher rank = eliminated earlier.
 * Each player uses their own band-based K-factor.
 * timeMultiplier adjusts for game difficulty (shorter games = higher reward).
 * guestIds = set of playerIds that have no registered account → reduced stake for those pairings.
 * Returns a map of playerId → delta.
 */
export function partyEloDeltas(
  players: { id: string; elo: number; rank: number }[],
  timeSec: number,
  guestIds: Set<string> = new Set(),
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
      const aGuestOpponent = guestIds.has(b.id);
      const bGuestOpponent = guestIds.has(a.id);
      const aMult = aGuestOpponent ? GUEST_OPPONENT_MULTIPLIER : 1;
      const bMult = bGuestOpponent ? GUEST_OPPONENT_MULTIPLIER : 1;
      deltas.set(a.id, (deltas.get(a.id) ?? 0) + Math.round(m * aMult * kFactor(a.elo) * ((aWon ? 1 : 0) - aExp)));
      deltas.set(b.id, (deltas.get(b.id) ?? 0) + Math.round(m * bMult * kFactor(b.elo) * ((bWon ? 1 : 0) - bExp)));
    }
  }

  return deltas;
}
