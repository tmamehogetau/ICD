import { BASE_CARDS } from "./cards.js";
import { BASIC_ADJUSTMENTS, DRAW_ADJUSTMENT_INSTANCES, getAdjustment as findAdjustment } from "./adjustments.js";

const DRAW_ADJUSTMENT_INSTANCE_IDS = new Set(DRAW_ADJUSTMENT_INSTANCES);
const BASIC_ADJUSTMENT_IDS = new Set(BASIC_ADJUSTMENTS.map(card => card.id));

const clone = value => JSON.parse(JSON.stringify(value));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function shuffle(items, rng) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(rng() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function playerById(state, playerId) {
  const player = state.players.find(candidate => candidate.id === playerId);
  assert(player, "参加者が見つかりません。 ");
  return player;
}

function drawOne(state) {
  if (!state.adjustmentDeck.length) {
    state.adjustmentDeck = shuffle(state.adjustmentDiscard, state.rng || Math.random);
    state.adjustmentDiscard = [];
  }
  return state.adjustmentDeck.shift();
}

function refillHands(state) {
  for (const player of state.players) {
    while (player.hand.length < 5) {
      const cardId = drawOne(state);
      if (!cardId) break;
      player.hand.push(cardId);
    }
  }
}

function nextBase(state) {
  if (!state.baseDeck.length) state.baseDeck = shuffle(BASE_CARDS.map(card => card.id), state.rng || Math.random);
  return state.baseDeck.shift();
}

function requireHost(state, playerId) {
  assert(playerId === state.hostId, "ホストだけが進行できます。 ");
}

function validateCardPayload(payload) {
  assert(String(payload?.name || "").trim(), "完成カード名を入力してください。 ");
  for (const key of ["cost", "attack", "health"]) {
    assert(Number.isInteger(Number(payload?.[key])) && Number(payload[key]) >= 0, `${key}は0以上の整数で入力してください。 `);
  }
  assert(payload?.effect === undefined || typeof payload.effect === "string", "効果テキストが不正です。 ");
}

function validateVotes(voterId, candidates, two, one) {
  const targetIds = new Set(candidates.filter(card => card.playerId !== voterId).map(card => card.id));
  assert(!two || targetIds.has(two), "2点票の投票先が不正です。 ");
  assert(!one || targetIds.has(one), "1点票の投票先が不正です。 ");
  assert(!two || !one || two !== one, "2点票と1点票は別の候補に投票してください。 ");
}

function allSubmitted(state, ballots = state.ballots) {
  return ballots.length === state.players.length;
}

function publicDesign(design, revealScore = false) {
  const card = {
    id: design.id,
    playerId: design.playerId,
    playerName: design.playerName,
    baseId: design.baseId,
    name: design.name,
    cost: design.cost,
    attack: design.attack,
    health: design.health,
    type: design.type,
    class: design.class,
    effect: design.effect,
    intent: design.intent,
    adjustments: design.adjustmentIds.map(id => {
      const adjustment = findAdjustment(id);
      return adjustment ? { id: adjustment.id, name: adjustment.name, category: adjustment.category, text: adjustment.text } : null;
    }).filter(Boolean)
  };
  if (revealScore) Object.assign(card, { appeal: design.appeal, overpowered: design.overpowered, score: design.score });
  return card;
}

function calculateRound(state) {
  for (const design of state.designs) {
    design.appeal = state.ballots.reduce((score, ballot) => score + (ballot.two === design.id ? 2 : 0) + (ballot.one === design.id ? 1 : 0), 0);
    design.twoVotes = state.ballots.filter(ballot => ballot.two === design.id).length;
    design.overpowered = design.twoVotes === state.players.length - 1;
    design.score = scoreFromVotes(design.appeal, design.overpowered);
    playerById(state, design.playerId).total += design.score;
  }
  const maxScore = Math.max(...state.designs.map(card => card.score));
  const best = state.designs.filter(card => card.score === maxScore).map(card => clone(card));
  state.bestCards.push(...best);
  state.roundHistory.push({
    round: state.round,
    baseId: state.currentBaseId,
    designs: clone(state.designs),
    bestIds: best.map(card => card.id)
  });
  state.adjustmentDiscard.push(...state.roundUsedAdjustments);
  state.roundUsedAdjustments = [];
  refillHands(state);
  state.stage = "round_results";
}

function calculateFinal(state) {
  const scored = state.bestCards.map(card => ({
    ...card,
    finalAppeal: state.finalBallots.reduce((sum, ballot) => sum + (ballot.two === card.id ? 2 : 0) + (ballot.one === card.id ? 1 : 0), 0)
  }));
  const max = Math.max(...scored.map(card => card.finalAppeal));
  state.signage = scored.filter(card => card.finalAppeal === max);
  const bonus = 3;
  for (const playerId of new Set(state.signage.map(card => card.playerId))) {
    playerById(state, playerId).total += bonus;
  }
  state.stage = "final_results";
}

export function scoreFromVotes(appeal, overpowered = false) {
  return overpowered ? 0 : appeal;
}

export function createOnlineGame({ players, rounds = 4, rng = Math.random }) {
  assert(Array.isArray(players) && players.length >= 3 && players.length <= 6, "プレイヤーは3〜6人です。 ");
  assert(rounds === 4, "ラウンド数は4で固定です。 ");
  const cleanPlayers = players.map(player => ({ id: String(player?.id || "").trim(), name: String(player?.name || "").trim() }));
  assert(cleanPlayers.every(player => player.id && player.name), "全員のIDと名前を入力してください。 ");
  assert(new Set(cleanPlayers.map(player => player.id)).size === cleanPlayers.length, "プレイヤーIDは重複できません。 ");
  assert(new Set(cleanPlayers.map(player => player.name)).size === cleanPlayers.length, "プレイヤー名は重複できません。 ");

  const state = {
    version: 1,
    mode: "online",
    stage: "round_reveal",
    rounds,
    round: 1,
    hostId: cleanPlayers[0].id,
    players: cleanPlayers.map(player => ({ ...player, hand: [], total: 0 })),
    baseDeck: shuffle(BASE_CARDS.map(card => card.id), rng),
    adjustmentDeck: shuffle(DRAW_ADJUSTMENT_INSTANCES, rng),
    adjustmentDiscard: [],
    roundUsedAdjustments: [],
    currentBaseId: null,
    activePlayer: 0,
    designs: [],
    redrawCounts: {},
    ballots: [],
    finalBallots: [],
    roundHistory: [],
    bestCards: [],
    signage: [],
    rng
  };
  refillHands(state);
  state.currentBaseId = nextBase(state);
  return state;
}

export function beginOnlineBuild(state, playerId) {
  requireHost(state, playerId);
  assert(state.stage === "round_reveal", "今は制作を開始できません。 ");
  state.designs = [];
  state.redrawCounts = {};
  state.ballots = [];
  state.stage = "build";
}

export function revealOnlineBuildHand(state, playerId) {
  playerById(state, playerId);
  assert(state.stage === "build", "今は手札を公開する段階ではありません。 ");
}
export function exchangeOnlineCards(state, playerId, cardIds) {
  assert(state.stage === "build", "今は交換できません。 ");
  const player = playerById(state, playerId);
  assert(!state.designs.some(design => design.playerId === playerId), "完成カードの提出後は企画見直しできません。 ");
  const redrawCount = state.redrawCounts[playerId] || 0;
  assert(redrawCount < 2, "引き直しは各ラウンド2回までです。 ");
  assert(Array.isArray(cardIds) && cardIds.length === 1, "引き直すカードを1枚選んでください。 ");
  assert(new Set(cardIds).size === cardIds.length, "同じカードは選べません。 ");
  assert(cardIds.every(id => player.hand.includes(id)), "手札にないカードが含まれています。 ");
  for (const cardId of cardIds) {
    player.hand.splice(player.hand.indexOf(cardId), 1);
    state.adjustmentDiscard.push(cardId);
  }
  for (let index = 0; index < cardIds.length; index += 1) {
    const cardId = drawOne(state);
    if (cardId) player.hand.push(cardId);
  }
  state.redrawCounts[playerId] = redrawCount + 1;
}

export function submitOnlineDesign(state, playerId, payload) {
  assert(state.stage === "build", "今は完成カードを提出できません。 ");
  const player = playerById(state, playerId);
  assert(!state.designs.some(design => design.playerId === playerId), "完成カードはすでに提出済みです。 ");
  validateCardPayload(payload);
  const used = payload.adjustmentIds || [];
  assert(Array.isArray(used) && new Set(used).size === used.length, "同じ調整カードは選べません。 ");
  const usedDraw = used.filter(id => DRAW_ADJUSTMENT_INSTANCE_IDS.has(id));
  const usedBasic = used.filter(id => BASIC_ADJUSTMENT_IDS.has(id));
  assert(usedDraw.length + usedBasic.length === used.length, "存在しない調整カードが含まれています。 ");
  assert(usedDraw.every(id => player.hand.includes(id)), "手札にない通常の調整カードが含まれています。 ");

  for (const cardId of usedDraw) {
    player.hand.splice(player.hand.indexOf(cardId), 1);
    state.roundUsedAdjustments.push(cardId);
  }
  const base = BASE_CARDS.find(card => card.id === state.currentBaseId);
  state.designs.push({
    id: `r${state.round}-${player.id}`,
    playerId,
    playerName: player.name,
    baseId: base.id,
    class: base.class,
    type: base.type,
    name: String(payload.name).trim(),
    cost: Number(payload.cost),
    attack: Number(payload.attack),
    health: Number(payload.health),
    effect: String(payload.effect || "").trim(),
    intent: String(payload.intent || "").trim(),
    adjustmentIds: [...used],
    appeal: 0,
    overpowered: false,
    score: 0
  });
  if (state.designs.length === state.players.length) {
    state.ballots = [];
    state.stage = "vote";
  }
}

export function cancelOnlineDesign(state, playerId) {
  assert(state.stage === "build", "今は提出を取り消せません。 ");
  assert(state.designs.length < state.players.length, "全員提出後は取り消せません。 ");
  const player = playerById(state, playerId);
  const designIndex = state.designs.findIndex(design => design.playerId === playerId);
  assert(designIndex >= 0, "提出済みの完成カードがありません。 ");

  const [design] = state.designs.splice(designIndex, 1);
  for (const cardId of design.adjustmentIds.filter(id => DRAW_ADJUSTMENT_INSTANCE_IDS.has(id))) {
    const usedIndex = state.roundUsedAdjustments.indexOf(cardId);
    assert(usedIndex >= 0, "使用済み調整カードが見つかりません。 ");
    state.roundUsedAdjustments.splice(usedIndex, 1);
    player.hand.push(cardId);
  }
}

export function beginOnlineVoting(state, playerId) {
  requireHost(state, playerId);
  assert(["presentations", "vote"].includes(state.stage), "全員の完成案提出後に品評を開始できます。 ");
  if (state.stage === "vote") return;
  state.ballots = [];
  state.stage = "vote";
}

export function revealOnlineRoundBallot(state, playerId) {
  playerById(state, playerId);
  assert(state.stage === "vote", "今は投票用紙を公開する段階ではありません。 ");
}
export function submitOnlineRoundVote(state, playerId, { two = null, one = null } = {}) {
  assert(state.stage === "vote", "今は投票できません。 ");
  playerById(state, playerId);
  assert(!state.ballots.some(ballot => ballot.voterId === playerId), "投票はすでに提出済みです。 ");
  validateVotes(playerId, state.designs, two, one);
  state.ballots.push({ voterId: playerId, two, one });
  if (state.ballots.length === state.players.length) {
    calculateRound(state);
  }
}

export function continueOnlineRound(state, playerId = state.hostId) {
  requireHost(state, playerId);
  assert(state.stage === "round_results", "ラウンド結果画面ではありません。 ");
  if (state.round >= state.rounds) {
    state.stage = "final_overview";
    return;
  }
  state.round += 1;
  state.currentBaseId = nextBase(state);
  state.designs = [];
  state.redrawCounts = {};
  state.ballots = [];
  state.stage = "round_reveal";
}

export function beginOnlineFinalVoting(state, playerId = state.hostId) {
  requireHost(state, playerId);
  assert(state.stage === "final_overview", "決選投票の準備画面ではありません。 ");
  assert(state.bestCards.length > 0, "決選候補がありません。 ");
  state.finalBallots = [];
  state.stage = "final_vote";
}

export function revealOnlineFinalBallot(state, playerId) {
  playerById(state, playerId);
  assert(state.stage === "final_vote", "今は決選投票用紙を公開する段階ではありません。 ");
}
export function submitOnlineFinalVote(state, playerId, { two = null, one = null } = {}) {
  assert(state.stage === "final_vote", "今は決選投票できません。 ");
  playerById(state, playerId);
  assert(!state.finalBallots.some(ballot => ballot.voterId === playerId), "決選投票はすでに提出済みです。 ");
  validateVotes(playerId, state.bestCards, two, one);
  state.finalBallots.push({ voterId: playerId, two, one });
  if (state.finalBallots.length === state.players.length) {
    calculateFinal(state);
  }
}

export function getOnlineRankings(state) {
  return [...state.players]
    .map(player => ({ id: player.id, name: player.name, total: player.total }))
    .sort((left, right) => right.total - left.total || left.name.localeCompare(right.name, "ja"));
}

export function viewOnlineGame(state, viewerId) {
  const viewer = playerById(state, viewerId);
  const showDesigns = ["presentations", "vote", "round_results", "final_overview", "final_vote", "final_results"].includes(state.stage);
  const revealRoundScores = ["round_results", "final_overview", "final_vote", "final_results"].includes(state.stage);
  const revealFinalScores = state.stage === "final_results";
  const ownRoundBallot = state.ballots.find(ballot => ballot.voterId === viewerId);
  const ownFinalBallot = state.finalBallots.find(ballot => ballot.voterId === viewerId);
  const ownDesign = state.designs.find(design => design.playerId === viewerId);
  const designSubmitted = Boolean(ownDesign);
  const phase = state.stage === "build"
    ? designSubmitted ? "submitted" : "build"
    : "waiting";
  const hasSubmitted = state.stage === "build"
    ? designSubmitted
    : state.stage === "vote"
      ? Boolean(ownRoundBallot)
      : state.stage === "final_vote"
        ? Boolean(ownFinalBallot)
        : false;
  const isConcurrentAction = ["build", "vote", "final_vote"].includes(state.stage);
  const hand = viewer.hand.map(instanceId => {
    const adjustment = findAdjustment(instanceId);
    return adjustment ? { instanceId, ...clone(adjustment) } : { instanceId };
  });

  return {
    version: state.version,
    mode: state.mode,
    stage: state.stage,
    round: state.round,
    rounds: state.rounds,
    hostId: state.hostId,
    activePlayerId: null,
    activePlayerName: null,
    viewer: { id: viewer.id, name: viewer.name, isHost: viewer.id === state.hostId },
    base: clone(BASE_CARDS.find(card => card.id === state.currentBaseId)),
    players: state.players.map(player => ({ id: player.id, name: player.name, total: player.total })),
    submission: {
      designSubmitted: state.designs.some(design => design.playerId === viewerId),
      designsSubmitted: state.designs.length,
      votesSubmitted: state.ballots.length,
      finalVotesSubmitted: state.finalBallots.length,
      playerCount: state.players.length
    },
    designs: showDesigns ? state.designs.map(design => publicDesign(design, revealRoundScores)) : [],
    bestCards: state.bestCards.map(card => ({ ...publicDesign(card, true), finalAppeal: revealFinalScores ? card.finalAppeal ?? 0 : undefined })),
    signage: revealFinalScores ? state.signage.map(card => ({ ...publicDesign(card, true), finalAppeal: card.finalAppeal })) : [],
    rankings: state.stage === "final_results" ? getOnlineRankings(state) : [],
    private: {
      hand,
      basicAdjustments: clone(BASIC_ADJUSTMENTS),
      isActivePlayer: state.stage === "build" ? phase === "build" : isConcurrentAction && !hasSubmitted,
      phase,
      canRedraw: phase === "build" && (state.redrawCounts[viewerId] || 0) < 2,
      redrawsUsed: state.redrawCounts[viewerId] || 0,
      canCancelDesign: state.stage === "build" && designSubmitted && state.designs.length < state.players.length,
      submittedDesign: ownDesign ? publicDesign(ownDesign) : null,
      roundBallot: ownRoundBallot ? clone(ownRoundBallot) : null,
      finalBallot: ownFinalBallot ? clone(ownFinalBallot) : null
    },
    note: "手札は閲覧者本人だけ、投票は各投票者本人だけに返します。公開結果には票の内訳を含めません。"
  };
}


