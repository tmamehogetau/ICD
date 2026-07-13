import { createServer } from "node:http";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  beginOnlineBuild,
  cancelOnlineDesign,
  cancelOnlineFinalVote,
  cancelOnlineRoundVote,
  beginOnlineFinalVoting,
  beginOnlineVoting,
  continueOnlineRound,
  createOnlineGame,
  exchangeOnlineCards,
  revealOnlineBuildHand,
  revealOnlineFinalBallot,
  revealOnlineRoundBallot,
  submitOnlineDesign,
  submitOnlineFinalVote,
  submitOnlineRoundVote,
  viewOnlineGame
} from "./src/online-game.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const roomsFile = process.env.ONLINE_ROOMS_FILE || join(root, "data", "online-rooms.json");
const port = Number(process.env.PORT || 4173);
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" };
const rooms = new Map();

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function sendKeepAlive(res) {
  sendJson(res, 200, { status: "alive", timestamp: Date.now() });
}

function cleanName(value) {
  const name = String(value || "").trim();
  if (!name || name.length > 30) throw new Error("名前は1〜30文字で入力してください。 ");
  return name;
}

function createRoomCode() {
  let code;
  do {
    code = randomBytes(5).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/gu, "").slice(0, 6);
  } while (rooms.has(code));
  return code;
}

function createToken() {
  return randomBytes(24).toString("base64url");
}

function getBearerToken(req) {
  const match = /^Bearer\s+(.+)$/iu.exec(req.headers.authorization || "");
  if (!match) throw new Error("Bearer tokenが必要です。 ");
  return match[1];
}

function findRoom(code) {
  const room = rooms.get(String(code || "").toUpperCase());
  if (!room) throw new Error("ルームが見つかりません。 ");
  return room;
}

function findMember(room, token) {
  const member = room.members.find(candidate => candidate.token === token);
  if (!member) throw new Error("このルームへの参加権限がありません。 ");
  return member;
}

function viewRoom(room, member) {
  if (room.status === "playing") return viewOnlineGame(room.game, member.playerId);
  return {
    stage: "lobby",
    roomCode: room.code,
    version: room.version,
    rounds: room.rounds,
    hostId: room.hostId,
    viewer: { id: member.playerId, name: member.name, isHost: member.playerId === room.hostId },
    players: room.members.map(({ playerId, name }) => ({ id: playerId, name, total: 0 })),
    canStart: member.playerId === room.hostId && room.members.length >= 3,
    note: "3〜6人がそろったら、ホストがゲームを開始します。"
  };
}

function viewWithRoomData(room, member) {
  const state = viewRoom(room, member);
  return { roomCode: room.code, version: room.version, state: { ...state, version: room.version } };
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 100_000) throw new Error("リクエストが大きすぎます。 ");
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("JSON形式が不正です。 ");
  }
}

async function saveRooms() {
  await mkdir(normalize(join(roomsFile, "..")), { recursive: true });
  const serializable = {
    version: 1,
    rooms: [...rooms.values()].map(room => ({ ...room, game: room.game ? { ...room.game, rng: undefined } : null }))
  };
  const temporary = `${roomsFile}.tmp`;
  await writeFile(temporary, JSON.stringify(serializable, null, 2), "utf8");
  await rename(temporary, roomsFile);
}

async function loadRooms() {
  try {
    const parsed = JSON.parse(await readFile(roomsFile, "utf8"));
    for (const room of parsed.rooms || []) {
      if (!room?.code || !Array.isArray(room.members)) continue;
      room.code = String(room.code).toUpperCase();
      room.version = Number.isInteger(room.version) ? room.version : 1;
      room.processedActions = Array.isArray(room.processedActions) ? room.processedActions.slice(-100) : [];
      if (room.game) {
        if (room.game.stage === "exchange") room.game.stage = "build";
        if (!room.game.redrawCounts) room.game.redrawCounts = Object.fromEntries((room.game.exchangedPlayers || []).map(playerId => [playerId, 1]));
        delete room.game.exchangedPlayers;
      }      rooms.set(room.code, room);
    }
    console.log(`オンラインルームを${rooms.size}件復元しました。`);
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn("オンラインルームの復元に失敗しました。", error.message);
  }
}

function requireCurrentVersion(room, version, member, actionType) {
  const concurrentAction = ["exchange", "submitDesign", "cancelDesign", "submitRoundVote", "cancelRoundVote", "submitFinalVote", "cancelFinalVote"].includes(actionType);
  if (!Number.isInteger(version) || (version !== room.version && !concurrentAction)) {
    const error = new Error("画面が古くなっています。再読み込みしてください。 ");
    error.status = 409;
    error.body = { error: error.message, ...viewWithRoomData(room, member) };
    throw error;
  }
}

async function createRoom(req, res) {
  const body = await readJson(req);
  const name = cleanName(body.name);
  const rounds = 4;
  const playerId = "p1";
  const token = createToken();
  const room = {
    code: createRoomCode(),
    version: 1,
    status: "lobby",
    rounds,
    hostId: playerId,
    members: [{ playerId, name, token }],
    processedActions: [],
    game: null,
    createdAt: new Date().toISOString()
  };
  rooms.set(room.code, room);
  await saveRooms();
  sendJson(res, 201, { token, playerId, ...viewWithRoomData(room, room.members[0]) });
}

async function joinRoom(req, res, code) {
  const room = findRoom(code);
  const body = await readJson(req);
  const name = cleanName(body.name);
  const reconnectingMember = room.members.find(member => member.name === name);
  if (reconnectingMember) {
    reconnectingMember.token = createToken();
    room.version += 1;
    await saveRooms();
    return sendJson(res, 200, { token: reconnectingMember.token, playerId: reconnectingMember.playerId, ...viewWithRoomData(room, reconnectingMember) });
  }
  if (room.status !== "lobby") throw new Error("このルームはすでに開始しています。卓番号と参加時の名前を入力して復帰してください。 ");
  if (room.members.length >= 6) throw new Error("このルームは満員です。 ");
  const member = { playerId: `p${room.members.length + 1}`, name, token: createToken() };
  room.members.push(member);
  room.version += 1;
  await saveRooms();
  sendJson(res, 201, { token: member.token, playerId: member.playerId, ...viewWithRoomData(room, member) });
}

function startGame(room, member) {
  if (member.playerId !== room.hostId) throw new Error("ホストだけが開始できます。 ");
  if (room.status !== "lobby") throw new Error("ゲームはすでに開始しています。 ");
  if (room.members.length < 3) throw new Error("3人以上そろってから開始してください。 ");
  room.game = createOnlineGame({ players: room.members.map(({ playerId, name }) => ({ id: playerId, name })), rounds: room.rounds });
  room.status = "playing";
}

function applyAction(room, member, type, payload) {
  if (type === "start") return startGame(room, member);
  if (room.status !== "playing") throw new Error("ゲームがまだ開始されていません。 ");
  const state = room.game;
  switch (type) {
    case "beginBuild": return beginOnlineBuild(state, member.playerId);
    case "revealBuildHand": return revealOnlineBuildHand(state, member.playerId);
    case "exchange": return exchangeOnlineCards(state, member.playerId, payload.cardIds);
    case "submitDesign": return submitOnlineDesign(state, member.playerId, payload);
    case "cancelDesign": return cancelOnlineDesign(state, member.playerId);
    case "beginVoting": return beginOnlineVoting(state, member.playerId);
    case "revealRoundBallot": return revealOnlineRoundBallot(state, member.playerId);
    case "submitRoundVote": return submitOnlineRoundVote(state, member.playerId, payload);
    case "cancelRoundVote": return cancelOnlineRoundVote(state, member.playerId);
    case "continueRound": return continueOnlineRound(state, member.playerId);
    case "beginFinalVoting": return beginOnlineFinalVoting(state, member.playerId);
    case "revealFinalBallot": return revealOnlineFinalBallot(state, member.playerId);
    case "submitFinalVote": return submitOnlineFinalVote(state, member.playerId, payload);
    case "cancelFinalVote": return cancelOnlineFinalVote(state, member.playerId);
    default: throw new Error("不明なアクションです。 ");
  }
}

async function handleAction(req, res, code) {
  const room = findRoom(code);
  const member = findMember(room, getBearerToken(req));
  const body = await readJson(req);
  const actionId = String(body.actionId || "").trim();
  if (!actionId || actionId.length > 100) throw new Error("actionIdが不正です。 ");
  const processed = room.processedActions.find(action => action.id === actionId);
  if (processed) {
    if (processed.playerId !== member.playerId) throw new Error("actionIdが不正です。 ");
    return sendJson(res, 200, { replayed: true, ...viewWithRoomData(room, member) });
  }
  requireCurrentVersion(room, body.version, member, String(body.type || ""));
  applyAction(room, member, String(body.type || ""), body.payload || {});
  room.version += 1;
  room.processedActions.push({ id: actionId, playerId: member.playerId });
  room.processedActions = room.processedActions.slice(-100);
  await saveRooms();
  sendJson(res, 200, viewWithRoomData(room, member));
}

async function getState(req, res, code) {
  const room = findRoom(code);
  const member = findMember(room, getBearerToken(req));
  sendJson(res, 200, viewWithRoomData(room, member));
}

async function serveStatic(req, res) {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = normalize(join(root, relative));
  if (!file.startsWith(root) || !(await stat(file)).isFile()) throw new Error("not found");
  res.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(await readFile(file));
}

const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const joinMatch = /^\/api\/rooms\/([A-Za-z0-9]+)\/join$/u.exec(pathname);
    const actionMatch = /^\/api\/rooms\/([A-Za-z0-9]+)\/actions$/u.exec(pathname);
    const stateMatch = /^\/api\/rooms\/([A-Za-z0-9]+)\/state$/u.exec(pathname);
    if (req.method === "GET" && pathname === "/api/keepalive") return sendKeepAlive(res);
    if (req.method === "POST" && pathname === "/api/rooms") return await createRoom(req, res);
    if (req.method === "POST" && joinMatch) return await joinRoom(req, res, joinMatch[1]);
    if (req.method === "POST" && actionMatch) return await handleAction(req, res, actionMatch[1]);
    if (req.method === "GET" && stateMatch) return await getState(req, res, stateMatch[1]);
    if (req.method === "GET" || req.method === "HEAD") return await serveStatic(req, res);
    sendJson(res, 405, { error: "Method Not Allowed" });
  } catch (error) {
    const status = error.status || (error.message === "not found" ? 404 : 400);
    sendJson(res, status, error.body || { error: error.message || "処理に失敗しました。" });
  }
});

await loadRooms();
server.listen(port, () => console.log(`居酒屋開発会議: http://localhost:${port}`));


