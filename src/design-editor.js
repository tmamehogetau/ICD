const clone = value => JSON.parse(JSON.stringify(value));
const baseId = id => String(id).split("#")[0];
const digits = /\d+/g;
const assert = (ok, message) => { if (!ok) throw new Error(message); };

export function createDesignEditor(base) {
  return { base: clone(base), applications: [], extraBlocks: [] };
}

function makeState(editor) {
  const lines = String(editor.base.effect || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return { cost: editor.base.cost, attack: editor.base.attack, health: editor.base.health, blocks: [...(lines.length ? lines : [""]), ...(editor.extraBlocks || [])].map(text => ({ text, prefixes: [], suffixes: [] })) };
}

function access(state, id) {
  if (id.startsWith("stat:")) {
    const key = id.slice(5); assert(["cost", "attack", "health"].includes(key), "数値の適用先が不正です。");
    return { get: () => state[key], set: value => { state[key] = Math.max(0, Math.trunc(value)); } };
  }
  const match = /^block:(\d+):(\d+)$/u.exec(id); assert(match, "数値の適用先が不正です。");
  const block = state.blocks[Number(match[1])]; const token = block && [...block.text.matchAll(digits)][Number(match[2])]; assert(token, "効果内の数字が見つかりません。");
  return { get: () => Number(token[0]), set: value => { const next = String(Math.max(0, Math.trunc(value))); block.text = `${block.text.slice(0, token.index)}${next}${block.text.slice(token.index + token[0].length)}`; } };
}

function numeric(state, app) {
  const id = baseId(app.definitionId), targets = app.targetIds || [], params = app.params || {};
  const at = index => access(state, targets[index]);
  const one = () => { assert(targets.length === 1, "数値の適用先を1つ選んでください。"); return at(0); };
  const add = (index, delta) => { const item = at(index); item.set(item.get() + delta); };
  if (id === "a1") { assert(targets.length >= 1 && targets.length <= 3, "全部盛りは1〜3個の数字を選びます。"); targets.forEach((_, i) => add(i, 1)); }
  else if (id === "a2") { add(0, 2); one(); }
  else if (id === "a3") { assert(params.delta === 1 || params.delta === -1, "数値調整は+1か-1を選びます。"); add(0, params.delta); one(); }
  else if (id === "a4") { add(0, -2); one(); }
  else if (id === "a5") { assert(targets.length === 1 && ["stat:attack", "stat:health"].includes(targets[0]), "超軽量化は攻撃力か体力を選びます。"); state.cost = Math.max(0, state.cost - 2); add(0, -1); }
  else if (id === "a6") { assert(targets.length === 0, "大型化は適用先を選びません。"); state.cost += 2; state.attack += 3; state.health += 3; }
  else if (id === "a7") { add(0, 3); one(); }
  else if (id === "a8") { assert(targets.length === 2 && targets[0] !== targets[1], "均整化は異なる2個の数字を選びます。"); at(0).set(at(1).get()); }
  else if (id === "a9") { assert(targets.length === 2 && targets[0] !== targets[1], "エクスチェンジは異なる2個の数字を選びます。"); const first = at(0), second = at(1), value = first.get(); first.set(second.get()); second.set(value); }
  else if (id === "a10" || id === "a11") { assert(targets.length, "数値の適用先を選んでください。"); const sum = targets.reduce((total, key) => total + Number(params.deltas?.[key] || 0), 0); assert(sum === (id === "a10" ? 3 : -3), "振り分けの合計が正しくありません。"); targets.forEach((key, i) => add(i, Number(params.deltas[key] || 0))); }
  else if (id === "a12") { assert(targets.length === 2 && targets[0] !== targets[1], "数値移植は異なる2個の数字を選びます。"); add(0, 2); add(1, -2); }
  else if (id === "a13") { const item = one(); item.set(Math.floor(item.get() / 2)); }
  else if (id === "a14") { assert(targets.length === 1 && targets[0].startsWith("block:"), "倍プッシュは効果内の数字を選びます。"); const item = one(); item.set(item.get() * 2); }
  else throw new Error("未対応の数値カードです。");
}

function applicationText(state, app) {
  if (app.auto === "enhance_cost_plus_2") return app.text.replace("X", String(state.cost + 2));
  if (app.params?.choice) return app.text.replace(/【[^】]+】/u, `【${app.params.choice}】`);
  return app.text;
}

export function buildDesignDraft(editor) {
  const state = makeState(editor);
  for (const app of editor.applications) if (app.kind === "numeric") numeric(state, app);
  for (const app of editor.applications) {
    if (app.kind === "numeric") continue;
    const text = applicationText(state, app);
    if (app.kind === "condition") state.blocks[app.blockIndex].prefixes.push(text);
    else if (app.kind === "effect") state.blocks[app.blockIndex].suffixes.push(text);
  }
  const blocks = state.blocks.map((block, index) => ({ id: `block-${index}`, rendered: [...block.prefixes, block.text, ...block.suffixes].filter(Boolean).join(" "), ...block }));
  return { cost: state.cost, attack: state.attack, health: state.health, blocks, effect: blocks.map(block => block.rendered).filter(Boolean).join("\n") };
}
export function getEffectBlocks(editor) { return buildDesignDraft(editor).blocks; }
export const numericCardNeedsTarget = definitionId => baseId(definitionId) !== "a6";

export function getNumericTargets(editor, definitionId) {
  const draft = buildDesignDraft(editor);
  const targets = [["cost", "コスト"], ["attack", "攻撃力"], ["health", "体力"]].map(([key, label]) => ({ id: `stat:${key}`, label, value: draft[key], kind: "stat" }));
  draft.blocks.forEach((block, blockIndex) => [...block.text.matchAll(digits)].forEach((match, numberIndex) => targets.push({ id: `block:${blockIndex}:${numberIndex}`, label: `効果${blockIndex + 1}の「${match[0]}」`, value: Number(match[0]), kind: "block" })));
  const id = definitionId ? baseId(definitionId) : null;
  if (id === "a5") return targets.filter(target => ["stat:attack", "stat:health"].includes(target.id));
  if (id === "a6") return [];
  if (id === "a14") return targets.filter(target => target.kind === "block");
  return targets;
}
function add(editor, kind, card, blockIndex, targetIds = [], params = {}) {
  if (kind !== "numeric") assert(Number.isInteger(blockIndex) && blockIndex >= 0 && blockIndex < getEffectBlocks(editor).length, "効果ブロックを選んでください。");
  const app = { kind, adjustmentId: card.instanceId || card.id, definitionId: card.id, text: card.text, auto: card.auto, blockIndex, targetIds: [...targetIds], params: clone(params) };
  if (kind === "numeric") buildDesignDraft({ ...editor, applications: [...editor.applications, app] });
  editor.applications.push(app);
}
export const addEffectApplication = (editor, card, blockIndex, params = {}) => add(editor, "effect", card, blockIndex, [], params);
export const addConditionApplication = (editor, card, blockIndex, params = {}) => add(editor, "condition", card, blockIndex, [], params);
export const addNumericApplication = (editor, card, targetIds, params) => add(editor, "numeric", card, null, targetIds, params);
export const removeApplication = (editor, index) => editor.applications.splice(index, 1);
export const addEffectBlock = editor => { editor.extraBlocks.push(""); return editor.extraBlocks.length - 1; };
export const setEffectBlockText = (editor, index, text) => { const baseCount = Math.max(1, String(editor.base.effect || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean).length); if (index < baseCount) throw new Error("原案の文章ブロックは直接編集できません。"); editor.extraBlocks[index - baseCount] = String(text || "").trim(); };



