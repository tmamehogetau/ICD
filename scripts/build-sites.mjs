import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = new URL("../dist/", import.meta.url);
const readJson = path => readFile(new URL(path, import.meta.url), "utf8").then(JSON.parse);

const [cards, adjustments] = await Promise.all([
  readJson("../data/base-cards.json"),
  readJson("../data/adjustment-cards.json")
]);

await rm(dist, { recursive: true, force: true });
await mkdir(new URL("server/", dist), { recursive: true });
await Promise.all([
  cp(new URL("../index.html", import.meta.url), new URL("index.html", dist)),
  cp(new URL("../styles.css", import.meta.url), new URL("styles.css", dist)),
  cp(new URL("../src/", import.meta.url), new URL("src/", dist), { recursive: true }),
  cp(new URL("../data/", import.meta.url), new URL("data/", dist), { recursive: true }),
  cp(new URL("../src/online-game.js", import.meta.url), new URL("server/online-game.js", dist)),
  cp(new URL("../sites-worker.mjs", import.meta.url), new URL("server/index.js", dist))
]);

const cardsModule = `export const BASE_CARDS = ${JSON.stringify(cards)};\n`;
const adjustmentsModule = `export const ADJUSTMENTS = ${JSON.stringify(adjustments)};
export const DRAW_ADJUSTMENTS = ADJUSTMENTS.filter(card => card.id.startsWith("a"));
export const BASIC_ADJUSTMENTS = ADJUSTMENTS.filter(card => card.id.startsWith("b"));
const adjustmentById = new Map(ADJUSTMENTS.map(card => [card.id, card]));
const instancePattern = /^(a[1-9]\\d*)#([1-9]\\d*)$/u;
export function createAdjustmentInstanceId(definitionId, copyNumber) { return String(definitionId) + "#" + copyNumber; }
export function getAdjustmentDefinitionId(id) { return instancePattern.exec(id)?.[1] || id; }
export const DRAW_ADJUSTMENT_INSTANCES = DRAW_ADJUSTMENTS.flatMap(card => Array.from({ length: card.copies }, (_, index) => createAdjustmentInstanceId(card.id, index + 1)));
export function getAdjustment(id) { return adjustmentById.get(getAdjustmentDefinitionId(id)); }
`;
await Promise.all([
  writeFile(new URL("server/cards.js", dist), cardsModule),
  writeFile(new URL("server/adjustments.js", dist), adjustmentsModule)
]);

console.log("Sites用の公開ビルドを dist に出力しました。");