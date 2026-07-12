import test from "node:test";
import assert from "node:assert/strict";
import { addConditionApplication, addEffectApplication, addEffectBlock, addNumericApplication, buildDesignDraft, createDesignEditor, getNumericTargets, numericCardNeedsTarget } from "../src/design-editor.js";

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
test("新規文章ブロックへ効果カードを置くと、追加と同時にその効果を反映できる", () => {
  const editor = createDesignEditor(base);
  addEffectBlock(editor);
  const newBlockIndex = buildDesignDraft(editor).blocks.length - 1;
  addEffectApplication(editor, { id: "a15", text: "このフォロワーは【突進】を持つ。" }, newBlockIndex);

  const draft = buildDesignDraft(editor);
  assert.equal(draft.blocks.length, 2);
  assert.equal(draft.blocks[1].rendered, "このフォロワーは【突進】を持つ。");
});
test("クレストは完成カード名を自動で差し込み、ターン終了時条件と組み合わせられる", () => {
  const editor = createDesignEditor(base);
  addConditionApplication(editor, { id: "b10", text: "自分のターン終了時、" }, 0);
  addEffectApplication(editor, { id: "a126", auto: "crest_card_name", text: "自分は『クレスト：※このカードのカード名』を持つ。" }, 0);

  assert.equal(buildDesignDraft(editor).effect, "自分のターン終了時、 相手のリーダーに5ダメージ。 自分は『クレスト：テスト』を持つ。");
});