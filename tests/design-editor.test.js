import test from "node:test";
import assert from "node:assert/strict";
import { addConditionApplication, addEffectApplication, addEffectBlock, addNumericApplication, buildDesignDraft, createDesignEditor, getNumericTargets, numericCardNeedsTarget, removeApplication } from "../src/design-editor.js";

const base = { id: "test", name: "テスト", class: "ロイヤル", type: "フォロワー", cost: 2, attack: 3, health: 4, effect: "相手のリーダーに5ダメージ。" };

test("数値カードは選択可能な数字だけを提示し、選択不要な大型化は即時適用できる", () => {
  const editor = createDesignEditor(base);

  assert.deepEqual(getNumericTargets(editor, "a5").map(target => target.id), ["stat:attack", "stat:health"]);
  assert.deepEqual(getNumericTargets(editor, "a14").map(target => target.id), ["block:0:0"]);
  assert.deepEqual(getNumericTargets(editor, "a6"), []);
  assert.equal(numericCardNeedsTarget("a6"), false);
  assert.equal(numericCardNeedsTarget("a5"), true);

  addNumericApplication(editor, { id: "a6", text: "コストを+2し、攻撃力と体力をそれぞれ+3する。" }, [], {});
  assert.deepEqual(buildDesignDraft(editor), {
    cost: 4,
    attack: 6,
    health: 7,
    blocks: [{ id: "block-0", text: "相手のリーダーに5ダメージ。", prefixes: [], suffixes: [], rendered: "相手のリーダーに5ダメージ。" }],
    effect: "相手のリーダーに5ダメージ。"
  });
});

test("選択肢は選んだ効果だけを反映し、エンハンスは調整後コストから自動計算する", () => {
  const editor = createDesignEditor(base);
  addConditionApplication(editor, { id: "b5", auto: "enhance_cost_plus_2", text: "【エンハンス_X】" }, 0);
  addNumericApplication(editor, { id: "a6", text: "コストを+2し、攻撃力と体力をそれぞれ+3する。" }, [], {});
  addEffectApplication(editor, { id: "a101", text: "これは【疾走/守護/潜伏】を持つ。", choices: ["疾走", "守護", "潜伏"] }, 0, { choice: "守護" });

  const draft = buildDesignDraft(editor);
  assert.equal(draft.cost, 4);
  assert.equal(draft.effect, "【エンハンス_6】 相手のリーダーに5ダメージ。 これは【守護】を持つ。");
  assert.doesNotMatch(draft.effect, /※|疾走\/守護\/潜伏/);
});
test("数値プラスと数値マイナスは指定された符号だけを割り振る", () => {
  const plus = createDesignEditor(base);
  assert.throws(() => addNumericApplication(plus, { id: "a10", text: "数値プラス" }, ["stat:attack", "stat:health"], { deltas: { "stat:attack": 4, "stat:health": -1 } }), /数値プラス/);
  addNumericApplication(plus, { id: "a10", text: "数値プラス" }, ["stat:attack", "stat:health"], { deltas: { "stat:attack": 1, "stat:health": 2 } });
  assert.deepEqual([buildDesignDraft(plus).attack, buildDesignDraft(plus).health], [4, 6]);

  const minus = createDesignEditor(base);
  assert.throws(() => addNumericApplication(minus, { id: "a11", text: "数値マイナス" }, ["stat:attack", "stat:health"], { deltas: { "stat:attack": -4, "stat:health": 1 } }), /数値マイナス/);
  addNumericApplication(minus, { id: "a11", text: "数値マイナス" }, ["stat:attack", "stat:health"], { deltas: { "stat:attack": -1, "stat:health": -2 } });
  assert.deepEqual([buildDesignDraft(minus).attack, buildDesignDraft(minus).health], [2, 2]);
});

test("コピー系は完成予定名ではなくベースカード名を表示する", () => {
  const editor = createDesignEditor({ ...base, name: "原案カード" });
  editor.cardName = "完成予定カード";
  addEffectApplication(editor, { id: "a54", auto: "base_card_name", text: "『※ベースカード名』1枚を自分の場に出す。" }, 0);
  addEffectApplication(editor, { id: "a85", auto: "base_card_name", text: "『※ベースカード名』10枚を自分のデッキに加える。" }, 0);
  assert.match(buildDesignDraft(editor).effect, /『原案カード』1枚/);
  assert.match(buildDesignDraft(editor).effect, /『原案カード』10枚/);
  assert.doesNotMatch(buildDesignDraft(editor).effect, /完成予定カード|※ベースカード名/);
});
test("新規文章ブロックへ効果カードを置くと、追加と同時にその効果を反映できる", () => {
  const editor = createDesignEditor(base);
  addEffectBlock(editor);
  const newBlockIndex = buildDesignDraft(editor).blocks.length - 1;
  addEffectApplication(editor, { id: "a15", text: "このフォロワーは【突進】を持つ。" }, newBlockIndex);

  const draft = buildDesignDraft(editor);
  assert.equal(draft.blocks.length, 2);
  assert.equal(draft.blocks[1].rendered, "このフォロワーは【突進】を持つ。");
});
test("数値カードは追加した条件・効果カード本文の数字も変更できる", () => {
  const editor = createDesignEditor(base);
  addConditionApplication(editor, { id: "a127", name: "エンハンス10", text: "【エンハンス_10】" }, 0);
  addEffectApplication(editor, { id: "a88", name: "リーダーダメージ", text: "相手のリーダーに1ダメージ。" }, 0);

  const targets = getNumericTargets(editor, "a14");
  assert.deepEqual(targets.slice(-2).map(target => target.id), ["app:0:0", "app:1:0"]);
  assert.deepEqual(targets.slice(-2).map(target => target.label), ["エンハンス10の「10」", "リーダーダメージの「1」"]);
  addNumericApplication(editor, { id: "a1", text: "選んだ数字を+1する。" }, ["app:0:0", "app:1:0"], {});

  assert.equal(buildDesignDraft(editor).effect, "【エンハンス_11】 相手のリーダーに5ダメージ。 相手のリーダーに2ダメージ。");
});
test("対象の調整カードを取り消すと、その本文を参照した数値カードも取り消される", () => {
  const editor = createDesignEditor(base);
  addEffectApplication(editor, { id: "a88", name: "リーダーダメージ", text: "相手のリーダーに1ダメージ。" }, 0);
  addNumericApplication(editor, { id: "a3", text: "数値調整", name: "数値調整" }, ["app:0:0"], { delta: 1 });

  const cancelled = removeApplication(editor, 0);
  assert.equal(cancelled.length, 1);
  assert.deepEqual(editor.applications, []);
  assert.equal(buildDesignDraft(editor).effect, "相手のリーダーに5ダメージ。");
});
test("クレストは完成カード名を自動で差し込み、専用効果欄を他の調整カードで組み立てられる", () => {
  const editor = createDesignEditor(base);
  addEffectApplication(editor, { id: "a126", auto: "crest_card_name", creates: "crest_effect", text: "自分は『クレスト：※このカードのカード名』を持つ。" }, 0);
  addConditionApplication(editor, { id: "b10", text: "自分のターン終了時、" }, 0, {}, "crest_effect");
  addEffectApplication(editor, { id: "a15", text: "このフォロワーは【突進】を持つ。" }, 0, {}, "crest_effect");

  const draft = buildDesignDraft(editor);
  assert.equal(draft.crest?.rendered, "自分のターン終了時、 このフォロワーは【突進】を持つ。");
  assert.equal(draft.effect, "相手のリーダーに5ダメージ。 自分は『クレスト：テスト』を持つ。\nクレスト効果 自分のターン終了時、 このフォロワーは【突進】を持つ。");
});
test("モードは（１）（２）の独立ブロックを作り、それぞれに調整カードを配置できる", () => {
  const editor = createDesignEditor(base);
  addEffectApplication(editor, { id: "a111", creates: "mode_blocks", text: "このカードに【モード】を追加する。" }, 0);
  addConditionApplication(editor, { id: "b1", text: "【ファンファーレ】" }, 0, {}, "mode_1");
  addEffectApplication(editor, { id: "a15", text: "このフォロワーは【突進】を持つ。" }, 0, {}, "mode_1");
  addEffectApplication(editor, { id: "a88", text: "相手のリーダーに1ダメージ。" }, 0, {}, "mode_2");

  const draft = buildDesignDraft(editor);
  assert.deepEqual(draft.modeBlocks?.map(block => block.rendered), ["（１） 【ファンファーレ】 このフォロワーは【突進】を持つ。", "（２） 相手のリーダーに1ダメージ。"]);
  assert.equal(draft.effect, "相手のリーダーに5ダメージ。 このカードに【モード】を追加する。\n（１） 【ファンファーレ】 このフォロワーは【突進】を持つ。\n（２） 相手のリーダーに1ダメージ。");
  removeApplication(editor, 0);
  assert.equal(editor.applications.length, 0);
  assert.equal(buildDesignDraft(editor).modeBlocks, undefined);
});
