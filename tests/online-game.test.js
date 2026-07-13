import test from "node:test";
import assert from "node:assert/strict";
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
} from "../src/online-game.js";
import { BASE_CARDS } from "../src/cards.js";

const players = [
  { id: "u1", name: "あかね" },
  { id: "u2", name: "つばさ" },
  { id: "u3", name: "みなと" }
];
const rng = () => 0.25;

function payload(state, suffix) {
  const base = BASE_CARDS.find(card => card.id === state.currentBaseId);
  return {
    name: `${base.name}-${suffix}`,
    cost: base.cost,
    attack: base.attack,
    health: base.health,
    effect: base.effect,
    intent: `${suffix}の開発意図`
  };
}

function submitAllDesigns(state, order = ["u3", "u1", "u2"]) {
  beginOnlineBuild(state, "u1");
  for (const playerId of order) {
    revealOnlineBuildHand(state, playerId);
    submitOnlineDesign(state, playerId, payload(state, playerId));
  }
}

function completeRoundVoting(state, order = ["u3", "u1", "u2"]) {
  beginOnlineVoting(state, "u1");
  const votes = {
    u1: { two: "r1-u2", one: "r1-u3" },
    u2: { two: "r1-u1", one: "r1-u3" },
    u3: { two: "r1-u1", one: "r1-u2" }
  };
  for (const playerId of order) {
    revealOnlineRoundBallot(state, playerId);
    submitOnlineRoundVote(state, playerId, votes[playerId]);
  }
}

function setFinalCandidates(state) {
  state.bestCards = players.map((player, index) => ({
    id: `best-${index + 1}`,
    playerId: player.id,
    playerName: player.name,
    baseId: state.currentBaseId,
    name: `候補${index + 1}`,
    cost: 1,
    attack: 1,
    health: 1,
    type: "フォロワー",
    class: "ニュートラル",
    effect: "",
    intent: "",
    adjustmentIds: [],
    appeal: 0,
    overpowered: false,
    score: 0
  }));
}

test("オンライン制作は各自の交換確定後すぐ提出でき、最後の提出で公開する", () => {
  const state = createOnlineGame({ players, rounds: 4, rng });

  assert.equal(state.hostId, "u1");
  assert.deepEqual(state.players.map(player => player.hand.length), [5, 5, 5]);
  assert.throws(() => beginOnlineBuild(state, "u2"), /ホスト/);

  beginOnlineBuild(state, "u1");
  assert.equal(state.stage, "build");
  assert.doesNotThrow(() => revealOnlineBuildHand(state, "u2"));
  assert.equal(viewOnlineGame(state, "u1").private.isActivePlayer, true);

  const u3Hand = [...state.players.find(player => player.id === "u3").hand];
  assert.throws(() => exchangeOnlineCards(state, "u3", u3Hand.slice(0, 3)), /1枚/);
  exchangeOnlineCards(state, "u3", u3Hand.slice(0, 1));
  assert.equal(state.players.find(player => player.id === "u3").hand.length, 5);
  assert.equal(viewOnlineGame(state, "u3").private.phase, "build");
  submitOnlineDesign(state, "u3", payload(state, "u3"));
  assert.equal(state.stage, "build");
  assert.equal(viewOnlineGame(state, "u3").private.isActivePlayer, false);
  assert.equal(viewOnlineGame(state, "u1").private.isActivePlayer, true);
  assert.deepEqual(viewOnlineGame(state, "u1").designs, []);
  submitOnlineDesign(state, "u1", payload(state, "u1"));
  assert.equal(state.stage, "build");
  assert.equal(viewOnlineGame(state, "u1").private.isActivePlayer, false);
  assert.equal(viewOnlineGame(state, "u2").private.isActivePlayer, true);
  submitOnlineDesign(state, "u2", payload(state, "u2"));
  assert.equal(state.stage, "vote");
  assert.equal(state.designs.length, 3);
  assert.equal(viewOnlineGame(state, "u2").private.isActivePlayer, true);
  assert.equal(viewOnlineGame(state, "u2").designs.length, 3);
});

test("オンライン投票は全員が順不同に提出でき、最後の一票でだけ集計する", () => {
  const state = createOnlineGame({ players, rounds: 4, rng });
  submitAllDesigns(state);

  beginOnlineVoting(state, "u1");
  assert.equal(state.stage, "vote");
  assert.doesNotThrow(() => revealOnlineRoundBallot(state, "u2"));
  assert.equal(viewOnlineGame(state, "u1").private.isActivePlayer, true);

  submitOnlineRoundVote(state, "u3", { two: "r1-u1", one: "r1-u2" });
  assert.equal(state.stage, "vote");
  assert.equal(state.ballots.length, 1);
  assert.equal(viewOnlineGame(state, "u3").private.isActivePlayer, false);
  assert.equal(viewOnlineGame(state, "u3").private.canCancelRoundVote, true);
  cancelOnlineRoundVote(state, "u3");
  assert.equal(state.ballots.length, 0);
  assert.equal(viewOnlineGame(state, "u3").private.isActivePlayer, true);
  submitOnlineRoundVote(state, "u3", { two: "r1-u1", one: "r1-u2" });
  assert.equal(viewOnlineGame(state, "u1").private.isActivePlayer, true);
  assert.equal(state.designs.every(design => design.score === 0), true);

  submitOnlineRoundVote(state, "u1", { two: "r1-u2", one: "r1-u3" });
  assert.equal(state.stage, "vote");
  assert.equal(state.ballots.length, 2);
  assert.equal(viewOnlineGame(state, "u2").private.isActivePlayer, true);

  submitOnlineRoundVote(state, "u2", { two: "r1-u1", one: "r1-u3" });
  assert.equal(state.stage, "round_results");
  assert.equal(state.ballots.length, 3);
  assert.equal(state.designs.find(design => design.id === "r1-u1").overpowered, true);
  assert.equal(state.designs.find(design => design.id === "r1-u1").score, 0);
  assert.deepEqual(state.designs.find(design => design.id === "r1-u1").twoVotes, 2);
  assert.deepEqual(state.designs.find(design => design.id === "r1-u1").oneVotes, 0);
  assert.deepEqual(state.bestCards.map(card => card.id), ["r1-u2"]);
  const scoreView = viewOnlineGame(state, "u1").designs.find(design => design.id === "r1-u1");
  assert.deepEqual({ twoVotes: scoreView.twoVotes, oneVotes: scoreView.oneVotes, appeal: scoreView.appeal, score: scoreView.score }, { twoVotes: 2, oneVotes: 0, appeal: 4, score: 0 });
});

test("次ラウンド後の決選投票も順不同で、最後の一票だけ結果を確定する", () => {
  const state = createOnlineGame({ players, rounds: 4, rng });
  submitAllDesigns(state);
  completeRoundVoting(state);
  const firstBaseId = state.currentBaseId;

  assert.throws(() => continueOnlineRound(state, "u2"), /ホスト/);
  continueOnlineRound(state, "u1");
  assert.equal(state.round, 2);
  assert.equal(state.stage, "round_reveal");
  assert.notEqual(state.currentBaseId, firstBaseId);

  state.round = 4;
  state.stage = "round_results";
  setFinalCandidates(state);
  continueOnlineRound(state, "u1");
  assert.equal(state.stage, "final_overview");

  const u1TotalBeforeFinal = state.players.find(player => player.id === "u1").total;
  beginOnlineFinalVoting(state, "u1");
  assert.equal(state.stage, "final_vote");
  assert.doesNotThrow(() => revealOnlineFinalBallot(state, "u2"));

  submitOnlineFinalVote(state, "u3", { two: "best-1", one: "best-2" });
  assert.equal(state.stage, "final_vote");
  assert.equal(viewOnlineGame(state, "u3").private.isActivePlayer, false);
  assert.equal(viewOnlineGame(state, "u3").private.canCancelFinalVote, true);
  cancelOnlineFinalVote(state, "u3");
  assert.equal(state.finalBallots.length, 0);
  submitOnlineFinalVote(state, "u3", { two: "best-1", one: "best-2" });
  assert.equal(viewOnlineGame(state, "u1").private.isActivePlayer, true);

  submitOnlineFinalVote(state, "u1", { two: "best-2", one: "best-3" });
  assert.equal(state.stage, "final_vote");
  submitOnlineFinalVote(state, "u2", { two: "best-1", one: "best-3" });
  assert.equal(state.stage, "final_results");
  assert.deepEqual(state.signage.map(card => card.id), ["best-1"]);
  assert.equal(state.players.find(player => player.id === "u1").total, u1TotalBeforeFinal + 3);
});

test("オンライン表示は進行中の完成案・手札・投票理由を他プレイヤーへ漏らさない", () => {
  const state = createOnlineGame({ players, rounds: 4, rng });
  const u2OnlyHand = state.players[1].hand.find(cardId => !state.players[0].hand.includes(cardId));
  const initialView = viewOnlineGame(state, "u1");
  assert.equal(initialView.private.hand.length, 5);
  assert.equal(JSON.stringify(initialView).includes(u2OnlyHand), false);

  beginOnlineBuild(state, "u1");
  submitOnlineDesign(state, "u1", payload(state, "u1"));
  const buildView = viewOnlineGame(state, "u2");
  assert.deepEqual(buildView.designs, []);
  assert.equal(buildView.submission.designSubmitted, false);
  assert.equal(buildView.private.isActivePlayer, true);
  submitOnlineDesign(state, "u2", payload(state, "u2"));
  submitOnlineDesign(state, "u3", payload(state, "u3"));
  beginOnlineVoting(state, "u1");
  submitOnlineRoundVote(state, "u1", { two: "r1-u2" });

  const ownView = viewOnlineGame(state, "u1");
  const otherView = viewOnlineGame(state, "u2");
  assert.deepEqual(ownView.private.roundBallot, { voterId: "u1", two: "r1-u2", one: null });
  assert.equal("nerf" in ownView.private.roundBallot, false);
  assert.equal("reason" in JSON.parse(JSON.stringify(otherView)), false);
  assert.equal("score" in otherView.designs[0], false);
});
test("提出済みの完成案は全員提出前なら取り消せ、使用カードも手札へ戻る", () => {
  const state = createOnlineGame({ players, rounds: 4, rng });
  beginOnlineBuild(state, "u1");
  const usedCardId = state.players.find(player => player.id === "u1").hand[0];
  submitOnlineDesign(state, "u1", { ...payload(state, "u1"), adjustmentIds: [usedCardId] });

  const submitted = viewOnlineGame(state, "u1");
  assert.equal(submitted.private.phase, "submitted");
  assert.equal(submitted.private.canCancelDesign, true);
  assert.equal(submitted.private.submittedDesign.id, "r1-u1");
  assert.equal(submitted.private.hand.some(card => card.instanceId === usedCardId), false);

  cancelOnlineDesign(state, "u1");
  const returned = viewOnlineGame(state, "u1");
  assert.equal(state.designs.length, 0);
  assert.equal(returned.private.phase, "build");
  assert.equal(returned.private.canCancelDesign, false);
  assert.equal(returned.private.hand.some(card => card.instanceId === usedCardId), true);
  assert.equal(state.roundUsedAdjustments.includes(usedCardId), false);
});