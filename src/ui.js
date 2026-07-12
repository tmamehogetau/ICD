import { BASIC_ADJUSTMENTS } from "./adjustments.js";
import { addConditionApplication, addEffectApplication, addNumericApplication, addEffectBlock, buildDesignDraft, createDesignEditor, getNumericTargets, numericCardNeedsTarget, removeApplication } from "./design-editor.js";

const root = document.querySelector("#game");
const storageKey = "new-pack-meeting-online-session";
let meeting = null;
let session = readSession();
let notice = "";
let editor = null;
let selectedAdjustmentId = null;
let pendingTargets = [];
let pendingDeltas = {};
let pendingChoice = "";
let draftName = "";
let draftIntent = "";
let redrawMode = false;
let keepAliveTimer = null;
let isSubmittingDesign = false;

const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
const nl = value => esc(value).replace(/\n/g, "<br>");
const mine = () => Boolean(meeting?.private?.isActivePlayer);
const host = () => Boolean(meeting?.viewer?.isHost);

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(storageKey)); } catch { return null; }
}
function saveSession(value) {
  session = value;
  if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey);
}
function header(title, kicker = "ONLINE MEETING") {
  return `<div class="section-head"><div><p class="eyebrow">${kicker}</p><h2>${esc(title)}</h2></div>${meeting && meeting.stage !== "lobby" ? `<div class="round-chip"><span>ROUND</span><strong>${meeting.round}</strong><small>/ ${meeting.rounds}</small></div>` : ""}</div>`;
}
function baseCard(card, compact = false) {
  if (!card) return "";
  return `<article class="base-card legend-card ${compact ? "compact" : ""}" data-class="${esc(card.class)}"><div class="author-tab">${esc(card.name)}</div><div class="card-top"><span class="cost">${card.cost}</span><div><p class="card-class">${esc(card.class)}</p></div></div><div class="stats"><strong>${card.attack}</strong><span>攻撃 / 体力</span><strong>${card.health}</strong></div><p class="effect">${card.effect ? nl(card.effect) : '<span class="blank-effect">能力なし</span>'}</p></article>`;
}
function adjustCard(card, controls = "") {
  return `<article class="adjust-card">${controls}<span class="clip" aria-hidden="true"></span><p class="category">${esc(card.category)}調整</p><h4>${esc(card.name)}</h4><p>${esc(card.text)}</p></article>`;
}
function designCard(card, scores = false, final = false) {
  return `<article class="design-card legend-card"><div class="author-tab">${esc(card.name)}</div><div class="card-top"><span class="cost">${card.cost}</span><div><p class="card-class">${esc(card.class)}</p></div></div><p class="effect">${card.effect ? nl(card.effect) : '<span class="blank-effect">能力なし</span>'}</p><div class="stats"><strong>${card.attack}</strong><span class="card-owner">担当：${esc(card.playerName)}</span><strong>${card.health}</strong></div>${scores ? `<div class="score-strip"><span>ヤバさ ${card.appeal}点</span>${card.overpowered ? "<span>ヤバすぎ：0点</span>" : ""}<strong>${card.score}点</strong></div>` : ""}${final ? `<div class="score-strip"><span>決選魅力票</span><strong>${card.finalAppeal || 0}点</strong></div>` : ""}</article>`;
}
function waiting(title, detail) {
  return `<section class="pass-screen"><p class="eyebrow">IZAKAYA / WAITING</p><div class="pass-folder"><span>いま調整中</span><strong>${esc(meeting.activePlayerName || "幹事")}</strong><small>${esc(detail)}</small></div><h2>${esc(title)}</h2><p>この画面は自動で更新されます。</p></section>`;
}
function setup() {
  if (location.hash) history.replaceState(null, "", location.pathname);
  root.innerHTML = `${header("今夜の卓を開く", "IZAKAYA / OPEN TABLE")}<section class="setup-sheet paper"><div class="red-note">3〜6名<br>各自の端末で参加</div><div class="online-intro"><b>招待制・アカウント不要</b><span>手札と未公開票は本人だけに届きます。</span></div><label class="wide player-name-field">あなたの名前<input id="player-name" maxlength="16" value="先輩" required></label><div class="table-entry"><form id="create-form"><fieldset><legend>新しい卓を作る</legend><p class="agreement">今夜は全4ラウンド。最終看板カードのボーナスは3点です。</p><button class="primary stamp-button">卓を作成する</button></fieldset></form><form id="join-form" class="join-form"><fieldset><legend>卓番号で参加</legend><label>卓番号<input name="code" maxlength="7" required></label><button class="secondary">卓に参加する</button></fieldset></form></div></section>`;
}
function lobby() {
  root.innerHTML = `${header("飲み仲間を待っています", "IZAKAYA / TABLE WAITING")}<section class="setup-sheet paper"><div class="red-note angled">卓番号<br>${esc(meeting.roomCode)}</div><h3>卓番号を共有</h3><div class="invite-row"><code>${esc(meeting.roomCode)}</code><button class="secondary" data-action="copy">卓番号をコピー</button></div><p class="agreement">参加者はトップ画面の「卓に参加する」から、この卓番号を入力してください。</p><div class="rule-summary"><span>飲み仲間 ${meeting.players.length} / 6名</span><span>乾杯は3名から</span><span>幹事：${esc(meeting.players.find(player => player.id === meeting.hostId)?.name || "")}</span></div><section class="scoreboard paper"><h3>今夜の飲み仲間</h3>${meeting.players.map((item, index) => `<div><span>${String(index + 1).padStart(2, "0")}</span><b>${esc(item.name)}</b><strong>${item.id === meeting.hostId ? "幹事" : "参加済み"}</strong></div>`).join("")}</section>${host() ? `<button class="primary stamp-button" data-action="start" ${meeting.players.length < 3 ? "disabled" : ""}>乾杯して始める</button>` : '<p class="agreement">幹事が乾杯して始めるのを待っています。</p>'}</section>`;
}
function reveal() {
  root.innerHTML = `${header(`第${meeting.round}回　今夜のお題`, "KANPAI 01 / BASE CARD")}<div class="two-column"><section>${baseCard(meeting.base)}</section><section class="brief paper"><div class="red-note angled">今夜のたたき台</div><h3>今夜の調整ルール</h3><ol><li>原案を確認する</li><li>調整中に不要な通常調整カードを1枚ずつ、最大2回引き直す</li><li>通常調整・ベーシックを自由に適用する</li><li>完成案を手入力して提出する</li></ol><p class="agreement">各端末から、同時に操作します。秘密情報は本人以外に表示されません。</p>${host() ? '<button class="primary" data-action="begin-build">調整を始める</button>' : '<p class="agreement">幹事が調整を始めるのを待っています。</p>'}</section></div>`;
}
function pass(stage) {
  const config = { pass_build: ["制作の番です", "手札を見る", "reveal-build", "PRIVATE HAND"], pass_vote: ["評価の番です", "投票用紙を開く", "reveal-vote", "SECRET BALLOT"], pass_final_vote: ["決選投票の番です", "決選投票を始める", "reveal-final-vote", "FINAL BALLOT"] }[stage];
  if (!mine()) return waiting(config[0], `${meeting.activePlayerName}さんが操作中です。`);
  root.innerHTML = `<section class="pass-screen"><p class="eyebrow">${config[3]}</p><div class="pass-folder"><span>今夜の担当</span><strong>${esc(meeting.viewer.name)}</strong><small>秘密情報を開きます</small></div><h2>${config[0]}</h2><p>自分の端末で、手札とカードを確認してください。</p><button class="primary stamp-button" data-action="${config[2]}">${config[1]}</button></section>`;
}
function adjustmentPool() {
  return [...(meeting.private?.hand || []), ...(meeting.private?.basicAdjustments || BASIC_ADJUSTMENTS)];
}
function selectedAdjustment() { return adjustmentPool().find(card => (card.instanceId || card.id) === selectedAdjustmentId) || null; }
function appliedAdjustmentIds() { return new Set(editor.applications.map(item => item.adjustmentId)); }
function ensureEditor() {
  if (!editor || editor.base.id !== meeting.base.id) { editor = createDesignEditor(meeting.base); selectedAdjustmentId = null; pendingTargets = []; pendingDeltas = {}; pendingChoice = ""; draftName = meeting.base.name; draftIntent = ""; }
}
function basePlanCard(draft, selected) {
  return `<article class="design-card plan-card"><div class="author-tab">完成予定</div><div class="card-top"><span class="cost">${draft.cost}</span><div><small>${esc(meeting.base.class)} / フォロワー</small><h3>${esc(draftName || meeting.base.name)}</h3></div></div><div class="stats"><strong>${draft.attack}</strong><span>攻撃 / 体力</span><strong>${draft.health}</strong></div><div class="effect planned-effect">${draft.blocks.map((block, index) => `<button type="button" class="effect-block ${selected && ["効果", "条件"].includes(selected.category) && (!selected.choices?.length || pendingChoice) ? "targetable" : ""}" data-block-index="${index}"><small>BLOCK ${String(index + 1).padStart(2, "0")}</small>${block.rendered ? nl(block.rendered) : "<i>新しい効果ブロック</i>"}</button>`).join("")}</div></article>`;
}
function numericPicker(selected) {
  const targets = getNumericTargets(editor, selected.id);
  const selectedIds = new Set(pendingTargets);
  const simple = ["a2", "a3", "a4", "a7", "a13", "a14"].includes(selected.id);
  const countHint = { a1:"1〜3個",a2:"1個",a3:"1個",a4:"1個",a5:"攻撃力か体力",a6:"選択不要",a7:"1個",a8:"2個（先→後）",a9:"2個",a10:"1個以上",a11:"1個以上",a12:"2個（+2→-2）",a13:"1個",a14:"効果内1個" }[selected.id] || "対象を選択";
  return `<section class="placement-panel paper"><p class="eyebrow">NUMERIC PLACEMENT</p><h3>${esc(selected.name)} <small>${esc(countHint)}</small></h3><p>${esc(selected.text)}</p>${selected.id === "a3" ? `<div class="choice-row compact-choice"><label class="radio-card"><input type="radio" name="numeric-delta" value="1" checked><b>＋1</b></label><label class="radio-card"><input type="radio" name="numeric-delta" value="-1"><b>−1</b></label></div>` : ""}<div class="target-grid">${targets.map(target => `<div class="number-target ${selectedIds.has(target.id) ? "selected" : ""}"><button type="button" data-number-target="${target.id}"><b>${esc(target.label)}</b><strong>${target.value}</strong></button>${["a10","a11"].includes(selected.id) && selectedIds.has(target.id) ? `<label>配分<input aria-label="${esc(target.label)}への振り分け" data-delta-target="${target.id}" type="number" value="${pendingDeltas[target.id] ?? 0}"></label>` : ""}</div>`).join("")}</div><div class="placement-actions"><button type="button" class="secondary" data-action="cancel-adjustment">選び直す</button><button type="button" class="primary" data-action="apply-numeric">この数値配置を反映</button></div></section>`;
}
function effectPlacementPicker(selected) {
  const choices = selected.choices || [];
  const choiceButtons = choices.length ? `<div class="choice-row effect-choice-row">${choices.map(choice => `<button type="button" class="secondary ${pendingChoice === choice ? "selected" : ""}" data-effect-choice="${esc(choice)}">${esc(choice)}</button>`).join("")}</div>` : "";
  const instruction = choices.length && !pendingChoice
    ? "先に能力を1つ選んでください。"
    : "完成予定カードの効果ブロックを選択してください。";
  return `<section class="placement-panel paper"><p class="eyebrow">${esc(selected.category)} PLACEMENT</p><h3>${esc(selected.name)}</h3><p>${esc(selected.text)}</p>${choiceButtons}<b>${instruction}</b><button type="button" class="secondary" data-action="cancel-adjustment">選び直す</button></section>`;
}
function submittedDesign() {
  const design = meeting.private?.submittedDesign;
  const submitted = meeting.submission?.designsSubmitted || 0;
  const players = meeting.submission?.playerCount || 0;
  root.innerHTML = `${header("完成案を提出しました", "PHASE 03 / SUBMITTED")}<section class="submitted-sheet paper"><div class="submitted-stamp">提出済み</div><h2>ほかの参加者の提出を待っています</h2><p class="agreement">現在の提出数：${submitted} / ${players}</p>${design ? designCard(design) : ""}${meeting.private?.canCancelDesign ? `<div class="center-action"><button class="secondary" data-action="cancel-design">提出を取り消して調整へ戻る</button></div>` : ""}</section>`;
}
function build() {
  if (!mine()) return waiting("制作結果を待っています", `完成案を提出済みです。ほかの参加者の提出待ち（${meeting.submission?.designsSubmitted || 0} / ${meeting.submission?.playerCount || 0}）。`);
  ensureEditor();
  const draft = buildDesignDraft(editor), selected = selectedAdjustment(), applied = appliedAdjustmentIds();
  const hand = meeting.private?.hand || [], basics = meeting.private?.basicAdjustments || BASIC_ADJUSTMENTS;
  const picker = selected?.category === "数値" ? numericPicker(selected) : selected ? effectPlacementPicker(selected) : "";
  const selectableCard = card => {
    const id = card.instanceId || card.id;
    if (redrawMode) return adjustCard(card).replace(`<article class="adjust-card">`, `<article class="adjust-card adjustment-choice redraw-choice" data-redraw-card="${esc(id)}">`);
    const disabled = applied.has(id);
    const opening = disabled ? `<article class="adjust-card adjustment-choice disabled">` : `<article class="adjust-card adjustment-choice" data-action="choose-adjustment" data-adjustment-id="${esc(id)}">`;
    return adjustCard(card).replace(`<article class="adjust-card">`, opening);
  };
  root.innerHTML = `${header("調整フェーズ", "PRIVATE / BLOCK EDITOR")}<div class="build-layout block-editor"><section class="workspace"><div class="editor-board"><section class="adjustment-bank"><div class="subhead"><h3>通常の調整カード</h3><span>手札内のカードをすべて使用可</span></div><section class="redraw-control paper ${redrawMode ? "active" : ""}"><div><b>${redrawMode ? "不要札を1枚クリック" : "不要札を引き直す"}</b><small>残り ${Math.max(0, 2 - (meeting.private?.redrawsUsed || 0))} / 2回</small></div>${redrawMode ? '<button type="button" class="secondary" data-action="cancel-redraw">戻る</button>' : meeting.private?.canRedraw ? '<button type="button" class="secondary" data-action="begin-redraw">引き直しモード</button>' : ""}</section><div class="hand-grid">${hand.map(selectableCard).join("")}</div><div class="subhead"><h3>ベーシックカード</h3><span>手札外・枚数制限なし</span></div><div class="hand-grid basic-grid">${basics.map(card => `<button type="button" class="basic-chip" data-action="choose-adjustment" data-adjustment-id="${esc(card.id)}" ${applied.has(card.id) ? "disabled" : ""}><small>${esc(card.category)}</small><b>${esc(card.name)}</b><span>${esc(card.text)}</span></button>`).join("")}</div></section><section class="plan-workspace"><div class="subhead"><h3>完成予定</h3><span>適用先を選ぶと即時反映</span></div>${planCard(draft, selected)}${picker}<section class="application-log paper"><h3>適用履歴</h3>${editor.applications.length ? editor.applications.map((app, index) => `<div><span>${esc(app.kind)} / ${esc(adjustmentPool().find(card => (card.instanceId || card.id) === app.adjustmentId)?.name || app.definitionId)}</span><button type="button" data-action="remove-application" data-application-index="${index}">取り消す</button></div>`).join("") : "<p>まだ調整カードを置いていません。</p>"}</section><form id="design-form" class="center-action" aria-busy="${isSubmittingDesign}"><button class="primary stamp-button ${isSubmittingDesign ? "submitting" : ""}" ${isSubmittingDesign ? "disabled" : ""}>${isSubmittingDesign ? "完成予定を提出中…" : "この完成予定を提出"}</button>${isSubmittingDesign ? '<p class="submission-feedback" role="status">提出を受け付けています…</p>' : ""}</form></section></div></section></div>`;
}
function presentations() { root.innerHTML = `${header("今夜の品評会", "AGENDA 04 / PRESENTATION")}<div class="notice paper"><b>全員の完成カードを公開中</b><span>性能と調整内容を確認してから、みんなの品評を始めます。</span></div><div class="design-grid">${meeting.designs.map(card => designCard(card)).join("")}</div><div class="center-action">${host() ? '<button class="primary stamp-button" data-action="begin-voting">この一覧のまま評価へ</button>' : '<p class="agreement">幹事がみんなの品評を開始するのを待っています。</p>'}</div>`; }
function options(cards) { return `<option value="">投票しない</option>${cards.filter(card => card.playerId !== meeting.viewer.id).map(card => `<option value="${esc(card.id)}">${esc(card.name)}（${esc(card.playerName)}）</option>`).join("")}`; }
function vote(final = false) {
  if (!mine()) return waiting(final ? "決選投票中" : "ヤバいカード投票中", `あなたの投票は提出済みです。ほかの参加者の投票待ち（${final ? meeting.submission?.finalVotesSubmitted || 0 : meeting.submission?.votesSubmitted || 0} / ${meeting.submission?.playerCount || 0}）。`);
  const cards = final ? meeting.bestCards : meeting.designs;
  const title = final ? "決選投票" : "ヤバいカード投票";
  const note = final ? "最強だと思うカードを選んでください。" : "一番ヤバいカードと、次にヤバいカードへ投票します。";
  const twoLabel = final ? "一番推したいカード" : "一番ヤバいカード";
  const oneLabel = final ? "次に推したいカード" : "次にヤバいカード";
  root.innerHTML = `${header(title, final ? "FINAL / OPEN BALLOT" : "AGENDA 05 / YABAI BALLOT")}<section class="evaluation-workspace"><div class="evaluation-cards"><div class="notice paper"><b>${final ? "カードを見ながら決選投票" : "カードを見ながらヤバさを投票"}</b><span>${esc(note)}</span></div><div class="design-grid">${cards.map(card => designCard(card)).join("")}</div></div><form id="${final ? "final-vote-form" : "vote-form"}" class="ballot paper evaluation-ballot"><div class="ballot-mark">${final ? "決選投票" : "ヤバい投票"}</div><label><span class="vote-value two">2</span><span><b>2点票</b><small>${esc(twoLabel)}</small></span><select name="two">${options(cards)}</select></label><label><span class="vote-value one">1</span><span><b>1点票</b><small>${esc(oneLabel)}</small></span><select name="one">${options(cards)}</select></label>${final ? "" : '<p class="agreement">自分の案には投票できません。自分以外の全員から2点票を受けたカードは「ヤバすぎ」として0点になります。</p>'}<button class="primary stamp-button">${final ? "決選票を提出する" : "ヤバい票を提出する"}</button></form></section>`;
}
function results() { root.innerHTML = `${header(`第${meeting.round}回　今夜の採点結果`, "AGENDA 06 / JUDGEMENT")}<div class="formula paper"><span>ヤバさ＝2点票・1点票の合計</span><span>自分以外の全員から2点票＝ヤバすぎ・0点</span></div><div class="design-grid results">${meeting.designs.map(card => designCard(card, true)).join("")}</div><section class="scoreboard paper"><h3>累計得点</h3>${[...meeting.players].sort((a, b) => b.total - a.total).map((item, index) => `<div><span>${index + 1}</span><b>${esc(item.name)}</b><strong>${item.total}点</strong></div>`).join("")}</section><div class="center-action">${host() ? `<button class="primary" data-action="continue-round">${meeting.round === meeting.rounds ? "今夜の看板カード決選へ" : "次の原案を開く"}</button>` : '<p class="agreement">幹事が次へ進めるのを待っています。</p>'}</div>`; }
function finalOverview() { root.innerHTML = `${header("今夜の看板カード決選", "FINAL AGENDA / SHORTLIST")}<div class="notice paper"><b>再プレゼンは15秒</b><span>ラウンド最優カードを並べ、最後は純粋な魅力で選びます。</span></div><div class="design-grid finalists">${meeting.bestCards.map(card => designCard(card, true)).join("")}</div><div class="center-action">${host() ? '<button class="primary stamp-button" data-action="begin-final-voting">決選投票へ</button>' : '<p class="agreement">幹事が決選投票を開始するのを待っています。</p>'}</div>`; }
function finalResults() { const top = meeting.rankings[0]?.total; root.innerHTML = `${header("お開き・最終発表", "MEETING CLOSED / APPROVED")}<section class="hero-result paper"><div class="giant-stamp">新弾<br>看板</div><p>NEW PACK SIGNATURE CARD</p><h2>${meeting.signage.map(card => esc(card.name)).join(" / ")}</h2><span>担当：${meeting.signage.map(card => esc(card.playerName)).join(" / ")}</span></section><section class="final-ranking paper"><h3>最終順位</h3>${meeting.rankings.map((item, index) => `<div class="rank-row ${item.total === top ? "champion" : ""}"><span class="rank">${String(index + 1).padStart(2, "0")}</span><b>${esc(item.name)}</b><strong>${item.total}点</strong>${item.total === top ? "<em>最優秀デザイナー</em>" : ""}</div>`).join("")}</section><div class="center-action"><button class="secondary" data-action="leave">この端末の参加情報を消す</button></div>`; }
function render() {
  if (!meeting) setup(); else if (meeting.stage === "lobby") lobby(); else if (meeting.stage === "round_reveal") reveal(); else if (["pass_build", "pass_vote", "pass_final_vote"].includes(meeting.stage)) pass(meeting.stage); else if (meeting.stage === "build") build(); else if (meeting.stage === "presentations") presentations(); else if (meeting.stage === "vote") vote(); else if (meeting.stage === "round_results") results(); else if (meeting.stage === "final_overview") finalOverview(); else if (meeting.stage === "final_vote") vote(true); else if (meeting.stage === "final_results") finalResults();
  if (notice) { const toast = document.createElement("div"); toast.className = "toast"; toast.textContent = notice; root.prepend(toast); notice = ""; }
  root.focus({ preventScroll: true });
  syncKeepAlive();
}
function shouldKeepAlive() { return Boolean(session && meeting && meeting.stage !== "final_results"); }
function syncKeepAlive() {
  if (!shouldKeepAlive()) {
    if (keepAliveTimer) window.clearInterval(keepAliveTimer);
    keepAliveTimer = null;
    return;
  }
  if (keepAliveTimer) return;
  const ping = () => fetch("/api/keepalive", { cache: "no-store" }).catch(() => {});
  ping();
  keepAliveTimer = window.setInterval(ping, 5 * 60 * 1000);
}
function checked(name) { return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(input => input.value); }
function playerName() {
  const name = String(document.querySelector("#player-name")?.value || "").trim();
  if (!name) throw new Error("あなたの名前を入力してください。");
  return name;
}
async function api(path, options = {}) {
  const headers = { ...(options.body ? { "content-type": "application/json" } : {}), ...(session ? { authorization: `Bearer ${session.token}` } : {}) };
  const response = await fetch(path, { ...options, headers }); const body = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(body.error || "通信に失敗しました。"); error.code = body.code; throw error; }
  return body;
}
async function refresh() {
  if (!session) return;
  try { const response = await api(`/api/rooms/${encodeURIComponent(session.roomCode)}/state`); const next = response.state; if (!meeting || next.version !== meeting.version) { meeting = next; render(); } }
  catch (error) { if (["unauthorized", "room_not_found"].includes(error.code)) { saveSession(null); meeting = null; notice = error.message; render(); } }
}
async function command(type, payload = {}) { const response = await api(`/api/rooms/${encodeURIComponent(session.roomCode)}/actions`, { method: "POST", body: JSON.stringify({ type, payload, version: meeting.version, actionId: crypto.randomUUID() }) }); meeting = response.state; render(); }
root.addEventListener("click", async event => {
  const button = event.target.closest("[data-action]"); if (!button) return;
  try { const action = button.dataset.action;
    if (action === "copy") { await navigator.clipboard.writeText(meeting.roomCode); notice = "卓番号をコピーしました。"; render(); return; }
    if (action === "leave") { saveSession(null); meeting = null; render(); return; }
    if (action === "begin-redraw") { redrawMode = true; selectedAdjustmentId = null; render(); return; }
    if (action === "cancel-redraw") { redrawMode = false; render(); return; }
    const map = { start: "start", "begin-build": "beginBuild", "reveal-build": "revealBuildHand", "cancel-design": "cancelDesign", "begin-voting": "beginVoting", "reveal-vote": "revealRoundBallot", "continue-round": "continueRound", "begin-final-voting": "beginFinalVoting", "reveal-final-vote": "revealFinalBallot" }; if (map[action]) await command(map[action]);
  } catch (error) { notice = error.message; await refresh(); render(); }
});
root.addEventListener("submit", async event => {
  event.preventDefault(); const data = new FormData(event.target);
  try {
    if (event.target.id === "create-form") { const response = await api("/api/rooms", { method: "POST", body: JSON.stringify({ name: playerName(), rounds: 4 }) }); saveSession({ roomCode: response.roomCode, token: response.token }); meeting = response.state; render(); return; }
    if (event.target.id === "join-form") { const code = String(data.get("code")).trim().toUpperCase(); const response = await api(`/api/rooms/${encodeURIComponent(code)}/join`, { method: "POST", body: JSON.stringify({ name: playerName() }) }); saveSession({ roomCode: response.roomCode, token: response.token }); meeting = response.state; render(); return; }
    if (event.target.id === "design-form") { if (isSubmittingDesign) return; const draft = buildDesignDraft(editor); isSubmittingDesign = true; render(); try { await command("submitDesign", { name: draftName.trim() || meeting.base.name, cost: draft.cost, attack: draft.attack, health: draft.health, effect: draft.effect, intent: "", adjustmentIds: editor.applications.map(item => item.adjustmentId) }); } finally { isSubmittingDesign = false; } }
    if (event.target.id === "vote-form") await command("submitRoundVote", { two: data.get("two") || null, one: data.get("one") || null });
    if (event.target.id === "final-vote-form") await command("submitFinalVote", { two: data.get("two") || null, one: data.get("one") || null });
  } catch (error) { notice = error.message; await refresh(); render(); }
});
document.addEventListener("keydown", async event => { if (event.key.toLowerCase() !== "f" || ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return; if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); });
window.render_game_to_text = () => JSON.stringify(meeting || { stage: "setup" });
window.advanceTime = () => { render(); return window.render_game_to_text(); };
render(); refresh(); window.setInterval(refresh, 1000);






function ensureApplicationLimit(card) {
  const id = card.instanceId || card.id;
  if (appliedAdjustmentIds().has(id)) throw new Error("この調整カードはすでに適用済みです。");
  
}
root.addEventListener("click", event => {
  const effectChoice = event.target.closest("[data-effect-choice]");
  const numberTarget = event.target.closest("[data-number-target]");
  const effectBlock = event.target.closest("[data-block-index]");
  const button = event.target.closest("[data-action]");
  try {
    if (effectChoice) { pendingChoice = effectChoice.dataset.effectChoice; render(); return; }
    if (numberTarget) {
      const target = numberTarget.dataset.numberTarget;
      pendingTargets = pendingTargets.includes(target) ? pendingTargets.filter(item => item !== target) : [...pendingTargets, target];
      render();
      return;
    }
    if (effectBlock && selectedAdjustment() && ["効果", "条件"].includes(selectedAdjustment().category)) {
      const card = selectedAdjustment(); ensureApplicationLimit(card);
      if (card.choices?.length && !pendingChoice) throw new Error("能力を1つ選んでください。");
      const blockIndex = Number(effectBlock.dataset.blockIndex);
      const params = pendingChoice ? { choice: pendingChoice } : {};
      if (card.category === "効果") addEffectApplication(editor, card, blockIndex, params); else addConditionApplication(editor, card, blockIndex, params);
      selectedAdjustmentId = null; pendingTargets = []; pendingDeltas = {}; pendingChoice = ""; render(); return;
    }
    if (!button) return;
    const action = button.dataset.action;
    if (action === "choose-adjustment") { const card = adjustmentPool().find(item => (item.instanceId || item.id) === button.dataset.adjustmentId); if (!card) throw new Error("調整カードが見つかりません。"); ensureApplicationLimit(card); if (card.category === "数値" && !numericCardNeedsTarget(card.id)) { addNumericApplication(editor, card, [], {}); selectedAdjustmentId = null; pendingTargets = []; pendingDeltas = {}; pendingChoice = ""; render(); return; } selectedAdjustmentId = button.dataset.adjustmentId; pendingTargets = []; pendingDeltas = {}; pendingChoice = ""; render(); return; }
    if (action === "cancel-adjustment") { selectedAdjustmentId = null; pendingTargets = []; pendingDeltas = {}; pendingChoice = ""; render(); return; }
    if (action === "remove-application") { removeApplication(editor, Number(button.dataset.applicationIndex)); selectedAdjustmentId = null; pendingTargets = []; pendingDeltas = {}; pendingChoice = ""; render(); return; }
    if (action === "apply-numeric") {
      const card = selectedAdjustment(); ensureApplicationLimit(card);
      const deltas = Object.fromEntries([...document.querySelectorAll("[data-delta-target]")].map(input => [input.dataset.deltaTarget, Number(input.value || 0)]));
      const delta = Number(document.querySelector('input[name="numeric-delta"]:checked')?.value || 1);
      addNumericApplication(editor, card, pendingTargets, { delta, deltas });
      selectedAdjustmentId = null; pendingTargets = []; pendingDeltas = {}; pendingChoice = ""; render();
    }
  } catch (error) { notice = error.message; render(); }
});
root.addEventListener("click", event => {
  const button = event.target.closest('[data-action="add-effect-block"]');
  if (!button) return;
  try {
    const card = selectedAdjustment();
    if (card && ["効果", "条件"].includes(card.category)) {
      if (card.choices?.length && !pendingChoice) throw new Error("能力を1つ選んでください。");
      addEffectBlock(editor);
      const blockIndex = buildDesignDraft(editor).blocks.length - 1;
      const params = pendingChoice ? { choice: pendingChoice } : {};
      if (card.category === "効果") addEffectApplication(editor, card, blockIndex, params); else addConditionApplication(editor, card, blockIndex, params);
      selectedAdjustmentId = null; pendingTargets = []; pendingDeltas = {}; pendingChoice = "";
    } else addEffectBlock(editor);
    render();
  } catch (error) { notice = error.message; render(); }
});root.addEventListener("input", event => {
  if (event.target.id === "planned-name") draftName = event.target.value;
  if (event.target.id === "planned-intent") draftIntent = event.target.value;
  if (event.target.matches("[data-delta-target]")) pendingDeltas[event.target.dataset.deltaTarget] = Number(event.target.value || 0);
});



function changedTarget(targetId) {
  return editor.applications.some(app => app.kind === "numeric" && app.targetIds.includes(targetId));
}
function markedBlockText(text, blockIndex) {
  const source = String(text || ""); let output = "", last = 0, numberIndex = 0;
  for (const match of source.matchAll(/\d+/g)) {
    output += esc(source.slice(last, match.index));
    const value = esc(match[0]);
    output += changedTarget(`block:${blockIndex}:${numberIndex}`) ? `<span class="change-mark">${value}</span>` : value;
    last = match.index + match[0].length; numberIndex += 1;
  }
  return output + esc(source.slice(last));
}
function planCard(draft, selected) {
  const stat = (key, value) => `<strong class="${draft[key] !== meeting.base[key] ? "changed-value" : ""}">${value}</strong>`;
  return `<article class="design-card legend-card plan-card"><div class="author-tab">${esc(draftName || meeting.base.name)}</div><div class="card-top"><span class="cost ${draft.cost !== meeting.base.cost ? "changed-value" : ""}">${draft.cost}</span><div><p class="card-class">${esc(meeting.base.class)}</p><small class="plan-note">赤字は変更・追加箇所</small></div></div><div class="stats">${stat("attack", draft.attack)}<span>攻撃 / 体力</span>${stat("health", draft.health)}</div><div class="effect planned-effect">${draft.blocks.map((block, index) => { const additions = [...block.prefixes.map(text => `<span class="change-mark">${esc(text)}</span>`), markedBlockText(block.text, index), ...block.suffixes.map(text => `<span class="change-mark">${esc(text)}</span>`)].filter(Boolean).join(" "); return `<section class="effect-block ${selected && ["効果", "条件"].includes(selected.category) && (!selected.choices?.length || pendingChoice) ? "targetable" : ""}"><button type="button" data-block-index="${index}"><small>BLOCK ${String(index + 1).padStart(2, "0")}</small>${additions || "<i>新しい文章ブロック</i>"}</button></section>`; }).join("")}<button type="button" class="add-block" data-action="add-effect-block">＋ 新規文章ブロック</button></div></article>`;
}











root.addEventListener("click", async event => {
  const card = event.target.closest("[data-redraw-card]");
  if (!card) return;
  try {
    redrawMode = false;
    await command("exchange", { cardIds: [card.dataset.redrawCard] });
  } catch (error) { notice = error.message; await refresh(); render(); }
});





