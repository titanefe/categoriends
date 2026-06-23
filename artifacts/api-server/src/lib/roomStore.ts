export interface Player {
  id: string;
  name: string;
  score: number;
  eliminated: boolean;
  userId: string | null;
  elo: number;
}

export interface Room {
  code: string;
  mode: "solo" | "duel" | "party";
  hostId: string;
  language: "en" | "tr";
  category: string;
  subcategory: string;
  customSubcategory: boolean;
  status: "waiting" | "playing" | "finished";
  players: Player[];
  acceptedAnswers: string[];
  currentPlayerId: string | null;
  turnOrder: string[];
  timeSeconds: number;
  impossibleMode: boolean;
  createdAt: number;
  /** IDs of eliminated players in order, earliest eliminated first. */
  eliminationOrder: string[];
}

const rooms = new Map<string, Room>();

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function createRoom(
  hostId: string,
  mode: Room["mode"],
  language: Room["language"],
  category: string,
  timeSeconds: number = 15,
  impossibleMode: boolean = false
): Room {
  let code = generateCode();
  while (rooms.has(code)) {
    code = generateCode();
  }
  const room: Room = {
    code,
    mode,
    hostId,
    language,
    category,
    subcategory: "",
    customSubcategory: false,
    status: "waiting",
    players: [],
    acceptedAnswers: [],
    currentPlayerId: null,
    turnOrder: [],
    timeSeconds,
    impossibleMode,
    createdAt: Date.now(),
    eliminationOrder: [],
  };
  rooms.set(code, room);
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}

export function updateRoom(code: string, updates: Partial<Room>): Room | null {
  const room = rooms.get(code);
  if (!room) return null;
  Object.assign(room, updates);
  rooms.set(code, room);
  return room;
}

export function deleteRoom(code: string): void {
  rooms.delete(code);
}

export function addPlayerToRoom(code: string, player: Player): Room | null {
  const room = rooms.get(code);
  if (!room) return null;
  const existing = room.players.find((p) => p.id === player.id);
  if (!existing) {
    room.players.push(player);
  }
  rooms.set(code, room);
  return room;
}

export function removePlayerFromRoom(code: string, playerId: string): Room | null {
  const room = rooms.get(code);
  if (!room) return null;
  room.players = room.players.filter((p) => p.id !== playerId);
  rooms.set(code, room);
  return room;
}

export function getNextPlayer(room: Room): string | null {
  const activePlayers = room.turnOrder.filter((id) => {
    const p = room.players.find((pl) => pl.id === id);
    return p && !p.eliminated;
  });
  if (activePlayers.length === 0) return null;
  if (!room.currentPlayerId) return activePlayers[0];

  const idx = activePlayers.indexOf(room.currentPlayerId);
  if (idx !== -1) {
    // Current player is still active — advance normally
    return activePlayers[(idx + 1) % activePlayers.length];
  }

  // Current player was just eliminated — find their slot in the full turn order
  // and pick the next active player after that position
  const fullIdx = room.turnOrder.indexOf(room.currentPlayerId);
  if (fullIdx === -1) return activePlayers[0];
  for (let i = 1; i <= room.turnOrder.length; i++) {
    const candidate = room.turnOrder[(fullIdx + i) % room.turnOrder.length];
    if (activePlayers.includes(candidate)) return candidate;
  }
  return activePlayers[0];
}
