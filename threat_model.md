# Threat Model

## Project Overview

Categoriends is a public, internet-reachable real-time multiplayer category word game. The production stack is a React/Vite frontend in `artifacts/categoriends`, an Express 5 API server in `artifacts/api-server`, PostgreSQL via Drizzle in `lib/db`, and a WebSocket game channel at `/ws`. The app allows guest play, while registered users can persist Elo and appear on the daily leaderboard. The backend also calls OpenAI for subcategory generation and answer verification.

Production assumptions for this scan:
- The deployed app is the public site at `https://categoriends.com`.
- TLS between client and server is handled by the platform.
- `artifacts/mockup-sandbox` is development-only and out of scope unless separately exposed.
- `NODE_ENV` is `production` in deployed environments.

## Assets

- **User accounts and sessions** — session cookies, user IDs, usernames, and password hashes. Compromise allows account takeover and unauthorized Elo/leaderboard actions.
- **Competitive integrity data** — room state, turn order, accepted answers, daily scores, and Elo history. Tampering changes winners, rankings, and public leaderboard trust.
- **OpenAI API quota and backend availability** — public endpoints can trigger paid model calls; abuse can cause cost spikes or loss of service.
- **Application secrets** — `SESSION_SECRET`, `DATABASE_URL`, and `OPENAI_API_KEY`. Exposure would allow session forgery, database access, or third-party API abuse.

## Trust Boundaries

- **Browser to API** — all HTTP requests originate from an untrusted client. The server must not trust client-reported game outcomes, scores, or identities.
- **Browser to WebSocket server** — every WebSocket message crosses a high-risk boundary because it can mutate live room state in real time.
- **API/WebSocket server to PostgreSQL** — the backend can read and modify users, Elo records, and daily scores. Bugs in request validation or authorization directly affect persistent data.
- **API server to OpenAI** — public inputs can trigger paid external requests. Missing abuse controls can drain quota or degrade gameplay.
- **Guest to authenticated user boundary** — guests can join games, but only authenticated users should affect their own persistent Elo and leaderboard records.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/lib/websocket.ts`, `artifacts/categoriends/src/main.tsx`
- **Highest-risk areas:** WebSocket protocol in `artifacts/api-server/src/lib/websocket.ts`; score/Elo routes in `artifacts/api-server/src/routes/elo.ts` and `artifacts/api-server/src/routes/daily.ts`; auth routes in `artifacts/api-server/src/routes/auth.ts`; OpenAI-backed routes in `artifacts/api-server/src/routes/game.ts`
- **Public surfaces:** homepage, room creation/joining, gameplay WebSocket, `/api/game/*`, `/api/daily/status`, `/api/daily/leaderboard`, `/api/healthz`
- **Authenticated surfaces:** `/api/auth/me`, `/api/daily/my-status`, `/api/daily/submit`, `/api/elo/*`; multiplayer Elo persistence occurs server-side when authenticated players are in a room
- **Dev-only areas:** `artifacts/mockup-sandbox`, scripts, build artifacts that are not runtime entry points

## Threat Categories

### Spoofing

The server must treat the browser as untrusted for both HTTP and WebSocket traffic. Session-based identity must be enforced server-side on every state-changing route and WebSocket action. A client must not be able to act as another player by sending arbitrary `playerId`, `hostId`, or result fields.

### Tampering

This project’s primary risk is competitive-state tampering. Room settings, game start, accepted answers, eliminations, resets, and match completion must be derived from authorized server-side state, not from client-declared winners, validity flags, or scores. Solo and daily submissions must be backed by server-tracked gameplay state rather than client-reported totals.

### Information Disclosure

The main disclosure risks are session data, password hashes, and unnecessary exposure of user-linked gameplay history. Logs and API responses must avoid secrets, cookies, and internal errors. Public leaderboard responses should expose only the minimum public fields needed for gameplay.

### Denial of Service

Public routes and the public WebSocket channel can be abused to consume CPU, memory, timers, or paid OpenAI quota. Authentication endpoints, AI-backed routes, and WebSocket message handling need rate limiting and bounds checks so one attacker cannot degrade service or exhaust external spend.

### Elevation of Privilege

Any user who can join or observe a room must not gain host powers or force Elo-affecting state transitions for other players. The backend must enforce host-only and current-player-only actions, and must bind them to the connected socket or authenticated session rather than trusting client parameters.
