import test from "node:test";
import assert from "node:assert/strict";
import { ADJUSTMENTS, BASIC_ADJUSTMENTS, DRAW_ADJUSTMENTS, DRAW_ADJUSTMENT_INSTANCES, getAdjustmentDefinitionId } from "../src/adjustments.js";
import { BASE_CARDS } from "../src/cards.js";
import { beginBuild, beginFinalVoting, beginRoundVoting, continueAfterRound, createGame, exchangeCards, getAdjustment, getRankings, revealBuildHand, revealFinalBallot, revealRoundBallot, scoreFromVotes, submitDesign, submitFinalVote, submitRoundVote } from "../src/game.js";

const rng = () => 0.25;
const names = ["あかね", "つばさ", "みなと"];

function submitAllDesigns(state) {
  beginBuild(state);
  for (let index = 0; index < state.players.length; index += 1) {
    revealBuildHand(state);
    const base = BASE_CARDS.find(card => card.id === state.currentBaseId);
    submitDesign(state, { name: `${base.name}-${index}`, cost: base.cost, attack: base.attack, health: base.health, effect: base.effect, intent: "テスト", adjustmentIds: index === 0 ? [state.players[index].hand[0]] : [] });
  }
}

test("データセットはベース54枚、通常調整40枚以上、ベーシック1枚以上で全件フォロワー", () => {
  assert.equal(BASE_CARDS.length, 54);
  assert.ok(DRAW_ADJUSTMENTS.length >= 40);
  assert.ok(BASIC_ADJUSTMENTS.length >= 1);
  assert.equal(ADJUSTMENTS.length, DRAW_ADJUSTMENTS.length + BASIC_ADJUSTMENTS.length);
  assert.ok(BASE_CARDS.every(card => card.type === "フォロワー"));
  assert.equal(BASE_CARDS.find(card => card.id === "b19")?.effect, "【ラストワード】【土の秘術_2】『貪欲のアルテマ・ララランラム』1枚を自分の場に出す。");
  assert.equal(BASE_CARDS.find(card => card.name.includes("ララライ＆"))?.effect.endsWith("（2）"), true);
});

test("管理用JSONは固定IDと必須項目を保つ", () => {
  const baseKeys = ["attack", "class", "cost", "effect", "health", "id", "name", "type"];
  const adjustmentKeys = ["category", "copies", "id", "name", "text"];
  const classes = new Set(["ニュートラル", "エルフ", "ロイヤル", "ウィッチ", "ドラゴン", "ナイトメア", "ビショップ", "ネメシス"]);
  const categories = new Set(["数値", "効果", "条件"]);

  assert.deepEqual(BASE_CARDS.map(card => card.id), Array.from({ length: 54 }, (_, index) => `b${index + 1}`));
  assert.deepEqual(DRAW_ADJUSTMENTS.map(card => card.id), Array.from({ length: DRAW_ADJUSTMENTS.length }, (_, index) => `a${index + 1}`));
  assert.deepEqual(BASIC_ADJUSTMENTS.map(card => card.id), Array.from({ length: BASIC_ADJUSTMENTS.length }, (_, index) => `b${index + 1}`));
  assert.equal(new Set(ADJUSTMENTS.map(card => card.id)).size, ADJUSTMENTS.length);
  assert.equal(new Set(BASE_CARDS.map(card => card.name)).size, BASE_CARDS.length);
  assert.equal(new Set(DRAW_ADJUSTMENTS.map(card => card.name)).size, DRAW_ADJUSTMENTS.length);
  assert.equal(new Set(BASIC_ADJUSTMENTS.map(card => card.name)).size, BASIC_ADJUSTMENTS.length);
  assert.equal(new Set(ADJUSTMENTS.map(card => card.name)).size, ADJUSTMENTS.length);

  for (const card of BASE_CARDS) {
    assert.deepEqual(Object.keys(card).sort(), baseKeys);
    assert.ok(card.name);
    assert.ok(classes.has(card.class));
    assert.equal(card.type, "フォロワー");
    assert.ok(Number.isInteger(card.cost) && card.cost >= 0);
    assert.ok(Number.isInteger(card.attack) && card.attack >= 0);
    assert.ok(Number.isInteger(card.health) && card.health >= 0);
    assert.equal(typeof card.effect, "string");
  }

  for (const card of ADJUSTMENTS) {
    assert.ok(Object.keys(card).every(key => [...adjustmentKeys, "choices", "auto", "creates"].includes(key)));
    assert.ok(card.name && card.text);
    assert.ok(categories.has(card.category));
    assert.ok(Number.isInteger(card.copies) && card.copies >= 1);
    assert.equal(card.text.includes("※"), card.auto === "crest_card_name");
    assert.equal(card.creates === "crest_effect", card.id === "a126");
    if (card.choices) assert.ok(Array.isArray(card.choices) && card.choices.length >= 2);
  }

});
test("3〜6人・4ラウンド固定で初期手札は5枚", () => {
  const game = createGame({ names, rounds: 4, rng });
  assert.equal(game.players.length, 3);
  assert.deepEqual(game.players.map(player => player.hand.length), [5, 5, 5]);
  assert.ok(game.players.flatMap(player => player.hand).every(id => /^a\d+#\d+$/u.test(id)));
  assert.ok(game.adjustmentDeck.every(id => /^a\d+#\d+$/u.test(id)));
  assert.throws(() => createGame({ names: ["A", "B"], rounds: 4, rng }));
  assert.throws(() => createGame({ names, rounds: 3, rng }));
  assert.throws(() => createGame({ names, rounds: 5, rng }));
});

test("数値カードは指定どおり複製され、実体IDで同時使用できる", () => {
  assert.equal(DRAW_ADJUSTMENTS.filter(card => card.category === "数値").reduce((sum, card) => sum + card.copies, 0), 26);
  assert.ok(DRAW_ADJUSTMENTS.filter(card => card.category === "数値").every(card => ["a13", "a14"].includes(card.id) ? card.copies === 1 : card.copies === 2));
  assert.ok(DRAW_ADJUSTMENTS.filter(card => card.category !== "数値").every(card => card.copies === 1));
  assert.equal(DRAW_ADJUSTMENT_INSTANCES.length, 139);
  assert.equal(DRAW_ADJUSTMENT_INSTANCES.length, DRAW_ADJUSTMENTS.reduce((sum, card) => sum + card.copies, 0));
  assert.deepEqual(DRAW_ADJUSTMENT_INSTANCES.filter(id => getAdjustmentDefinitionId(id) === "a1"), ["a1#1", "a1#2"]);
  assert.equal(getAdjustment("a1#2").name, "全部盛り");
  assert.deepEqual(getAdjustment("a126"), { id: "a126", category: "効果", name: "クレスト", text: "自分は『クレスト：※このカードのカード名』を持つ。", auto: "crest_card_name", creates: "crest_effect", copies: 1 });
  assert.deepEqual(getAdjustment("a127"), { id: "a127", category: "条件", name: "エンハンス10", text: "【エンハンス_10】", copies: 1 });
  assert.deepEqual(getAdjustment("a95")?.choices, ["スペルブースト", "土の秘術", "エンハンス", "回復", "進化"]);
  assert.match(getAdjustment("a111")?.text || "", /（１）\n（２）/u);
  assert.equal(BASIC_ADJUSTMENTS.find(card => card.id === "b10")?.text, "自分のターン終了時、");

  const game = createGame({ names, rounds: 4, rng });
  const base = BASE_CARDS.find(card => card.id === game.currentBaseId);
  game.stage = "build";
  game.players[0].hand = ["a1#1", "a1#2"];
  submitDesign(game, { name: base.name, cost: base.cost, attack: base.attack, health: base.health, effect: base.effect, adjustmentIds: ["a1#1", "a1#2"] });
  assert.deepEqual(game.designs[0].adjustmentIds, ["a1#1", "a1#2"]);
  assert.deepEqual(game.roundUsedAdjustments, ["a1#1", "a1#2"]);
});
test("調整中の引き直しは1枚ずつ、各ラウンド2回まで行える", () => {
  const game = createGame({ names, rounds: 4, rng });
  beginBuild(game);
  revealBuildHand(game);
  const old = game.players[0].hand[0];
  assert.throws(() => exchangeCards(game, []));
  exchangeCards(game, [old]);
  exchangeCards(game, [game.players[0].hand[0]]);
  assert.throws(() => exchangeCards(game, [game.players[0].hand[0]]), /2回/);
  assert.equal(game.players[0].hand.length, 5);
  assert.ok(!game.players[0].hand.includes(old));
  game.activePlayer = 1;
  assert.throws(() => exchangeCards(game, game.players[1].hand.slice(0, 3)));
});

test("通常カードは手札からすべて使用でき、ベーシックカードは手札外から枚数制限なく使える", () => {
  const game = createGame({ names, rounds: 4, rng });
  beginBuild(game);
  revealBuildHand(game);
  const base = BASE_CARDS.find(card => card.id === game.currentBaseId);
  const drawIds = [...game.players[0].hand];
  const basicIds = BASIC_ADJUSTMENTS.map(card => card.id);
  submitDesign(game, {
    name: base.name,
    cost: base.cost,
    attack: base.attack,
    health: base.health,
    effect: base.effect,
    adjustmentIds: [...drawIds, ...basicIds]
  });
  assert.deepEqual(game.designs[0].adjustmentIds, [...drawIds, ...basicIds]);
  assert.ok(drawIds.every(id => game.roundUsedAdjustments.includes(id)));
  assert.ok(basicIds.every(id => !game.roundUsedAdjustments.includes(id)));

  revealBuildHand(game);
  submitDesign(game, {
    name: `${base.name}-2`,
    cost: base.cost,
    attack: base.attack,
    health: base.health,
    effect: base.effect,
    adjustmentIds: basicIds
  });
  assert.deepEqual(game.designs[1].adjustmentIds, basicIds);

  const invalid = createGame({ names, rounds: 4, rng });
  beginBuild(invalid);
  revealBuildHand(invalid);
  const otherDrawId = DRAW_ADJUSTMENT_INSTANCES.find(id => !invalid.players[0].hand.includes(id));
  assert.throws(() => submitDesign(invalid, {
    name: base.name,
    cost: base.cost,
    attack: base.attack,
    health: base.health,
    effect: base.effect,
    adjustmentIds: [otherDrawId]
  }));
});

test("使用した調整カードはラウンド終了まで山札へ戻らない", () => {
  const game = createGame({ names, rounds: 4, rng });
  beginBuild(game);
  revealBuildHand(game);
  const usedId = game.players[0].hand[0];
  const base = BASE_CARDS.find(card => card.id === game.currentBaseId);
  submitDesign(game, { name: base.name, cost: base.cost, attack: base.attack, health: base.health, effect: base.effect, adjustmentIds: [usedId] });
  assert.ok(game.roundUsedAdjustments.includes(usedId));
  assert.ok(!game.adjustmentDiscard.includes(usedId));
});
test("6人が引き直しと使用をしても使用済みカードは同じラウンドに再配布されない", () => {
  const sixNames = ["A", "B", "C", "D", "E", "F"];
  const game = createGame({ names: sixNames, rounds: 4, rng });
  const usedIds = [];
  beginBuild(game);
  for (let index = 0; index < game.players.length; index += 1) {
    revealBuildHand(game);
    exchangeCards(game, [game.players[index].hand[0]]);
    const used = game.players[index].hand.slice(0, 2);
    usedIds.push(...used);
    const base = BASE_CARDS.find(card => card.id === game.currentBaseId);
    submitDesign(game, { name: `${base.name}-${index}`, cost: base.cost, attack: base.attack, health: base.health, effect: base.effect, adjustmentIds: used });
  }
  assert.equal(usedIds.length, 12);
  assert.equal(new Set(usedIds).size, 12);
  assert.equal(game.roundUsedAdjustments.length, 12);
  assert.ok(usedIds.every(id => !game.adjustmentDiscard.includes(id)));
});
test("ヤバすぎカードは全員から2点票を受けると0点になる", () => {
  assert.equal(scoreFromVotes(5, false), 5);
  assert.equal(scoreFromVotes(5, true), 0);
});

test("ヤバい票は別候補・自分以外、全員2点票のカードを0点にして最優を確定", () => {
  const game = createGame({ names, rounds: 4, rng });
  submitAllDesigns(game);
  beginRoundVoting(game);
  revealRoundBallot(game);
  assert.throws(() => submitRoundVote(game, { two: game.designs[0].id }));
  assert.throws(() => submitRoundVote(game, { two: game.designs[1].id, one: game.designs[1].id }));
  submitRoundVote(game, { two: game.designs[1].id, one: game.designs[2].id });
  revealRoundBallot(game);
  submitRoundVote(game, { two: game.designs[0].id, one: game.designs[2].id });
  revealRoundBallot(game);
  submitRoundVote(game, { two: game.designs[0].id, one: game.designs[1].id });
  assert.equal(game.stage, "round_results");
  assert.equal(game.roundUsedAdjustments.length, 0);
  assert.ok(game.adjustmentDiscard.length >= 1);
  assert.equal(game.designs[0].overpowered, true);
  assert.equal(game.designs[0].score, 0);
  assert.equal(game.designs[1].score, 3);
  assert.equal(game.bestCards.length, 1);
  assert.equal(game.bestCards[0].playerId, game.players[1].id);
});

test("4ラウンド決選の看板ボーナスは3点、最終順位を返す", () => {
  const game = createGame({ names, rounds: 4, rng });
  game.stage = "final_overview";
  game.bestCards = [
    { id: "c1", playerId: "p1", playerName: names[0], name: "A" },
    { id: "c2", playerId: "p2", playerName: names[1], name: "B" },
    { id: "c3", playerId: "p3", playerName: names[2], name: "C" }
  ];
  beginFinalVoting(game);
  revealFinalBallot(game);
  submitFinalVote(game, { two: "c2", one: "c3" });
  revealFinalBallot(game);
  submitFinalVote(game, { two: "c1", one: "c3" });
  revealFinalBallot(game);
  submitFinalVote(game, { two: "c1", one: "c2" });
  assert.equal(game.stage, "final_results");
  assert.equal(game.signage[0].id, "c1");
  assert.equal(game.signage[0].finalAppeal, 4);
  assert.equal(game.players[0].total, 3);
  assert.equal(getRankings(game)[0].id, "p1");
});

test("次ラウンドへ進み、最終ラウンド後は決選へ", () => {
  const game = createGame({ names, rounds: 4, rng });
  game.stage = "round_results";
  continueAfterRound(game);
  assert.equal(game.round, 2);
  assert.equal(game.stage, "round_reveal");
  game.round = 4;
  game.stage = "round_results";
  continueAfterRound(game);
  assert.equal(game.stage, "final_overview");
});
