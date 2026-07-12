import { beginOnlineBuild, cancelOnlineDesign, beginOnlineFinalVoting, beginOnlineVoting, continueOnlineRound, createOnlineGame, exchangeOnlineCards, revealOnlineBuildHand, revealOnlineFinalBallot, revealOnlineRoundBallot, submitOnlineDesign, submitOnlineFinalVote, submitOnlineRoundVote, viewOnlineGame } from "./online-game.js";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const fail = (message, status = 400) => json({ error: message }, status);
const random = length => [...crypto.getRandomValues(new Uint8Array(length))].map(value => value.toString(36).padStart(2, "0")).join("");
const token = () => random(24);
const roomCode = () => random(5).replace(/[^a-z0-9]/giu, "").slice(0, 7).toUpperCase();
const auth = request => request.headers.get("authorization")?.replace(/^Bearer\s+/iu, "") || "";
async function setup(env) { await env.DB.prepare("CREATE TABLE IF NOT EXISTS izakaya_rooms (code TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)").run(); }
async function load(env, code) { const row = await env.DB.prepare("SELECT payload FROM izakaya_rooms WHERE code = ?").bind(code).first(); return row ? JSON.parse(row.payload) : null; }
async function save(env, room) { room.version = (room.version || 0) + 1; await env.DB.prepare("INSERT OR REPLACE INTO izakaya_rooms (code, payload, updated_at) VALUES (?, ?, ?)").bind(room.code, JSON.stringify(room), Date.now()).run(); }
function member(room, request) { const found = room.members.find(item => item.token === auth(request)); if (!found) throw Object.assign(new Error("参加情報を確認できません。"), { status: 401 }); return found; }
function lobbyState(room, member) {
  return {
    stage: "lobby",
    version: room.version,
    roomCode: room.code,
    rounds: 4,
    round: 1,
    hostId: "p1",
    players: room.members.map(({ playerId, name }) => ({ id: playerId, name })),
    viewer: { id: member.playerId, name: member.name, isHost: member.playerId === "p1" }
  };
}
function state(room, member) { return { roomCode: room.code, state: viewOnlineGame(room.game, member.playerId) }; }
function action(game, playerId, type, payload) {
  const handlers = { beginBuild: beginOnlineBuild, revealBuildHand: revealOnlineBuildHand, exchange: exchangeOnlineCards, submitDesign: submitOnlineDesign, cancelDesign: cancelOnlineDesign, beginVoting: beginOnlineVoting, revealRoundBallot: revealOnlineRoundBallot, continueRound: continueOnlineRound, beginFinalVoting: beginOnlineFinalVoting, revealFinalBallot: revealOnlineFinalBallot, submitRoundVote: submitOnlineRoundVote, submitFinalVote: submitOnlineFinalVote };
  if (!handlers[type]) throw new Error("未対応の操作です。");
  return handlers[type](game, playerId, ...(type === "exchange" ? [payload.cardIds] : [payload]));
}
export default { async fetch(request, env) {
  const url = new URL(request.url); if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
  try {
    await setup(env);
    if (request.method === "POST" && url.pathname === "/api/rooms") {
      const body = await request.json(), name = String(body.name || "").trim(); if (!name) return fail("名前を入力してください。");
      let code = roomCode(); while (await load(env, code)) code = roomCode();
      const memberToken = token(), room = { code, version: 1, members: [{ playerId: "p1", name, token: memberToken }], game: null };
      await save(env, room); return json({ roomCode: code, token: memberToken, state: lobbyState(room, room.members[0]) });
    }
    const matched = /^\/api\/rooms\/([A-Z0-9]+)(?:\/(join|state|actions))?$/u.exec(url.pathname); if (!matched) return fail("見つかりません。", 404);
    const room = await load(env, matched[1]); if (!room) return fail("会議室が見つかりません。", 404);
    if (matched[2] === "join" && request.method === "POST") {
      const body = await request.json(), name = String(body.name || "").trim(); if (room.game || !name || room.members.length >= 6 || room.members.some(item => item.name === name)) return fail("参加者名を確認してください。");
      const playerId = `p${room.members.length + 1}`, memberToken = token(); room.members.push({ playerId, name, token: memberToken }); await save(env, room);
      return json({ roomCode: room.code, token: memberToken, state: lobbyState(room, room.members.at(-1)) });
    }
    const current = member(room, request);
    if (matched[2] === "state" && request.method === "GET") return room.game ? json(state(room, current)) : json({ state: lobbyState(room, current) });
    if (matched[2] === "actions" && request.method === "POST") {
      const body = await request.json();
      if (body.type === "start") { if (current.playerId !== "p1" || room.members.length < 3) return fail("幹事が3人以上で開始してください。", 403); room.game = createOnlineGame({ players: room.members.map(item => ({ id: item.playerId, name: item.name })), rounds: 4 }); }
      else { if (!room.game) return fail("ゲームがまだ開始されていません。"); action(room.game, current.playerId, body.type, body.payload || {}); }
      await save(env, room); return json(state(room, current));
    }
    return fail("見つかりません。", 404);
  } catch (caught) { return fail(caught.message || "処理に失敗しました。", caught.status || 400); }
} };