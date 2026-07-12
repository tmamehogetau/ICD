import { BASE_CARDS } from "./cards.js";
import { BASIC_ADJUSTMENTS, DRAW_ADJUSTMENT_INSTANCES, getAdjustment as findAdjustment } from "./adjustments.js";

const clone = value => JSON.parse(JSON.stringify(value));
const DRAW_ADJUSTMENT_INSTANCE_IDS = new Set(DRAW_ADJUSTMENT_INSTANCES);
const BASIC_ADJUSTMENT_IDS = new Set(BASIC_ADJUSTMENTS.map(card => card.id));

export function shuffle(items, rng = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
      const card = drawOne(state);
      if (!card) break;
      player.hand.push(card);
    }
  }
}

function nextBase(state) {
  if (!state.baseDeck.length) state.baseDeck = shuffle(BASE_CARDS.map(card => card.id), state.rng || Math.random);
  return state.baseDeck.shift();
}

export function createGame({ names, rounds = 4, rng = Math.random }) {
  const cleanNames = names.map(name => name.trim());
  assert(cleanNames.length >= 3 && cleanNames.length <= 6, "プレイヤーは3〜6人です。 ");
  assert(cleanNames.every(Boolean), "全員の名前を入力してください。 ");
  assert(new Set(cleanNames).size === cleanNames.length, "プレイヤー名は重複できません。 ");
  assert(rounds === 4, "ラウンド数は4で固定です。 ");

  const state = {
    version: 1,
    stage: "round_reveal",
    rounds,
    round: 1,
    players: cleanNames.map((name, index) => ({ id: `p${index + 1}`, name, hand: [], total: 0 })),
    baseDeck: shuffle(BASE_CARDS.map(card => card.id), rng),
    adjustmentDeck: shuffle(DRAW_ADJUSTMENT_INSTANCES, rng),
    adjustmentDiscard: [],
    roundUsedAdjustments: [],
    currentBaseId: null,
    activePlayer: 0,
    designs: [],
    redrawCounts: {},
    ballots: [],
    roundHistory: [],
    bestCards: [],
    finalBallots: [],
    signage: [],
    rng
  };
  refillHands(state);
  state.currentBaseId = nextBase(state);
  return state;
}

export function beginBuild(state) {
  assert(state.stage === "round_reveal", "今は制作を開始できません。 ");
  state.activePlayer = 0;
  state.designs = [];
  state.redrawCounts = {};
  state.ballots = [];
  state.stage = "pass_build";
}

export function revealBuildHand(state) {
  assert(state.stage === "pass_build", "受け渡し画面ではありません。 ");
  state.stage = "build";
}

export function exchangeCards(state, cardIds) {
  assert(state.stage === "build", "今は交換できません。 ");
  assert(Array.isArray(cardIds) && cardIds.length === 1, "引き直すカードを1枚選んでください。 ");
  const player = state.players[state.activePlayer];
  const redrawCount = state.redrawCounts[player.id] || 0;
  assert(redrawCount < 2, "引き直しは各ラウンド2回までです。 ");
  assert(cardIds.every(id => player.hand.includes(id)), "手札にないカードが含まれています。 ");
  for (const id of cardIds) {
    player.hand.splice(player.hand.indexOf(id), 1);
    state.adjustmentDiscard.push(id);
  }
  for (let i = 0; i < cardIds.length; i += 1) {
    const card = drawOne(state);
    if (card) player.hand.push(card);
  }
  state.redrawCounts[player.id] = redrawCount + 1;
}

export function submitDesign(state, payload) {
  assert(state.stage === "build", "今は完成カードを提出できません。 ");
  const player = state.players[state.activePlayer];
  const used = payload.adjustmentIds || [];
  assert(new Set(used).size === used.length, "同じ調整カードは選べません。 ");
  const usedDrawAdjustments = used.filter(id => DRAW_ADJUSTMENT_INSTANCE_IDS.has(id));
  const usedBasicAdjustments = used.filter(id => BASIC_ADJUSTMENT_IDS.has(id));
  assert(usedDrawAdjustments.length + usedBasicAdjustments.length === used.length, "存在しない調整カードが含まれています。 ");
  assert(usedDrawAdjustments.every(id => player.hand.includes(id)), "手札にない通常の調整カードが含まれています。 ");
  assert(String(payload.name || "").trim(), "完成カード名を入力してください。 ");
  assert(Number.isInteger(Number(payload.cost)) && Number(payload.cost) >= 0, "コストを入力してください。 ");
  assert(Number.isInteger(Number(payload.attack)) && Number(payload.attack) >= 0, "攻撃力を入力してください。 ");
  assert(Number.isInteger(Number(payload.health)) && Number(payload.health) >= 0, "体力を入力してください。 ");
  assert(String(payload.effect || "").trim() || payload.effect === "", "効果を入力してください。 ");

  for (const id of usedDrawAdjustments) {
    player.hand.splice(player.hand.indexOf(id), 1);
    state.roundUsedAdjustments.push(id);
  }
  state.designs.push({
    id: `r${state.round}-${player.id}`,
    playerId: player.id,
    playerName: player.name,
    baseId: state.currentBaseId,
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

  if (state.activePlayer < state.players.length - 1) {
    state.activePlayer += 1;
    state.stage = "pass_build";
  } else {
    state.stage = "presentations";
  }
}

export function beginRoundVoting(state) {
  assert(state.stage === "presentations", "プレゼン一覧から投票へ進んでください。 ");
  state.activePlayer = 0;
  state.stage = "pass_vote";
}

export function revealRoundBallot(state) {
  assert(state.stage === "pass_vote", "受け渡し画面ではありません。 ");
  state.stage = "vote";
}

function validateVotes({ voterId, candidates, two, one }) {
  const candidateIds = new Set(candidates.filter(card => card.playerId !== voterId).map(card => card.id));
  assert(!two || candidateIds.has(two), "2点票の投票先が不正です。 ");
  assert(!one || candidateIds.has(one), "1点票の投票先が不正です。 ");
  assert(!two || !one || two !== one, "2点票と1点票は別の候補に投票してください。 ");
}

export function submitRoundVote(state, { two = null, one = null }) {
  assert(state.stage === "vote", "今は投票できません。 ");
  const voter = state.players[state.activePlayer];
  validateVotes({ voterId: voter.id, candidates: state.designs, two, one });
  state.ballots.push({ voterId: voter.id, two, one });
  if (state.activePlayer < state.players.length - 1) {
    state.activePlayer += 1;
    state.stage = "pass_vote";
  } else {
    calculateRound(state);
  }
}

export function scoreFromVotes(appeal, overpowered = false) {
  return overpowered ? 0 : appeal;
}

function calculateRound(state) {
  for (const design of state.designs) {
    design.appeal = state.ballots.reduce((score, ballot) => score + (ballot.two === design.id ? 2 : 0) + (ballot.one === design.id ? 1 : 0), 0);
    design.twoVotes = state.ballots.filter(ballot => ballot.two === design.id).length;
    design.overpowered = design.twoVotes === state.players.length - 1;
    design.score = scoreFromVotes(design.appeal, design.overpowered);
    state.players.find(player => player.id === design.playerId).total += design.score;
  }
  const maxScore = Math.max(...state.designs.map(card => card.score));
  const best = state.designs.filter(card => card.score === maxScore).map(card => clone(card));
  state.bestCards.push(...best);
  state.roundHistory.push({ round: state.round, baseId: state.currentBaseId, designs: clone(state.designs), ballots: clone(state.ballots), bestIds: best.map(card => card.id) });
  state.adjustmentDiscard.push(...state.roundUsedAdjustments);
  state.roundUsedAdjustments = [];
  refillHands(state);
  state.stage = "round_results";
}

export function continueAfterRound(state) {
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
  state.activePlayer = 0;
  state.stage = "round_reveal";
}

export function beginFinalVoting(state) {
  assert(state.stage === "final_overview", "決選投票の準備画面ではありません。 ");
  state.activePlayer = 0;
  state.finalBallots = [];
  state.stage = "pass_final_vote";
}

export function revealFinalBallot(state) {
  assert(state.stage === "pass_final_vote", "受け渡し画面ではありません。 ");
  state.stage = "final_vote";
}

export function submitFinalVote(state, { two = null, one = null }) {
  assert(state.stage === "final_vote", "今は決選投票できません。 ");
  const voter = state.players[state.activePlayer];
  validateVotes({ voterId: voter.id, candidates: state.bestCards, two, one });
  state.finalBallots.push({ voterId: voter.id, two, one });
  if (state.activePlayer < state.players.length - 1) {
    state.activePlayer += 1;
    state.stage = "pass_final_vote";
    return;
  }
  const scored = state.bestCards.map(card => ({
    ...card,
    finalAppeal: state.finalBallots.reduce((sum, ballot) => sum + (ballot.two === card.id ? 2 : 0) + (ballot.one === card.id ? 1 : 0), 0)
  }));
  const max = Math.max(...scored.map(card => card.finalAppeal));
  state.signage = scored.filter(card => card.finalAppeal === max);
  const bonus = 3;
  for (const playerId of new Set(state.signage.map(card => card.playerId))) {
    state.players.find(player => player.id === playerId).total += bonus;
  }
  state.stage = "final_results";
}

export function getRankings(state) {
  return [...state.players].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ja"));
}

export function getBaseCard(id) {
  return BASE_CARDS.find(card => card.id === id);
}

export function getAdjustment(id) {
  return findAdjustment(id);
}

export function publicState(state) {
  if (!state) return { stage: "setup" };
  const hidden = ["pass_build", "pass_vote", "pass_final_vote"].includes(state.stage);
  return {
    stage: state.stage,
    round: state.round,
    rounds: state.rounds,
    activePlayer: hidden ? null : state.players[state.activePlayer]?.name,
    base: getBaseCard(state.currentBaseId)?.name,
    designsSubmitted: state.designs.length,
    ballotsSubmitted: state.ballots.length,
    candidates: state.stage.startsWith("final") ? state.bestCards.length : state.designs.length,
    scores: state.players.map(player => ({ name: player.name, total: player.total })),
    note: "UI document flow; no spatial coordinate system. Private hands and ballots are omitted during pass screens."
  };
}
