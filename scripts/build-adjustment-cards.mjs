import { readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const sourceUrl = new URL("../data/adjustment-cards.txt", import.meta.url);
const outputUrl = new URL("../data/adjustment-cards.json", import.meta.url);
const temporaryOutputUrl = new URL("../data/adjustment-cards.json.tmp", import.meta.url);
const requiredKeys = ["id", "category", "name", "text"];
const optionalKeys = ["copies", "choices", "auto", "creates"];
const cardKeys = [...requiredKeys, ...optionalKeys];
const allowedCategories = new Set(["数値", "効果", "条件"]);

function fail(message) {
  throw new Error(`調整カードの生成に失敗しました: ${message}`);
}

function parseCards(source) {
  const cards = [];
  let currentCard = {};

  function finishCard() {
    if (Object.keys(currentCard).length === 0) return;

    for (const key of requiredKeys) {
      if (!Object.hasOwn(currentCard, key)) fail(`${cards.length + 1}件目に ${key} がありません。`);
      if (currentCard[key].trim() === "") fail(`${cards.length + 1}件目の ${key} が空です。`);
    }

    const copies = currentCard.copies ?? "1";
    if (!/^[1-9]\d*$/u.test(copies)) fail(`${cards.length + 1}件目の copies は1以上の整数にしてください。`);
    const choices = currentCard.choices
      ? currentCard.choices.split("|").map(choice => choice.trim()).filter(Boolean)
      : undefined;
    if (currentCard.choices && choices.length < 2) fail(`${cards.length + 1}件目の choices は2つ以上指定してください。`);
    cards.push({
      ...Object.fromEntries(requiredKeys.map(key => [key, currentCard[key]])),
      ...(choices ? { choices } : {}),
      ...(currentCard.auto ? { auto: currentCard.auto } : {}),
      ...(currentCard.creates ? { creates: currentCard.creates } : {}),
      copies: Number(copies)
    });
    currentCard = {};
  }

  for (const [index, rawLine] of source.replace(/^\uFEFF/, "").split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (line.startsWith("#")) continue;
    if (line === "") {
      finishCard();
      continue;
    }

    if (line.startsWith("id:") && Object.keys(currentCard).length > 0) finishCard();

    const separatorIndex = line.indexOf(":");
    if (separatorIndex < 0) {
      if (Object.hasOwn(currentCard, "text")) {
        currentCard.text += `\n${line}`;
        continue;
      }
      fail(`${index + 1}行目は「キー: 値」の形式ではありません。`);
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!cardKeys.includes(key)) fail(`${index + 1}行目のキー「${key}」は使用できません。`);
    if (Object.hasOwn(currentCard, key)) fail(`${index + 1}行目で ${key} が重複しています。`);
    currentCard[key] = value;
  }
  finishCard();

  const ids = new Set();
  const names = new Set();
  const cardsByPrefix = { a: [], b: [] };
  for (const card of cards) {
    const match = /^([ab])([1-9]\d*)$/u.exec(card.id);
    if (!match) fail(`ID「${card.id}」は a1 または b1 のような形式で記述してください。`);
    const prefix = match[1];
    if (ids.has(card.id)) fail(`ID「${card.id}」が重複しています。`);
    if (names.has(card.name)) fail(`名前「${card.name}」が重複しています。`);
    if (!allowedCategories.has(card.category)) fail(`「${card.name}」のカテゴリ「${card.category}」は使用できません。`);
    ids.add(card.id);
    names.add(card.name);
    cardsByPrefix[prefix].push(card);
  }

  if (cardsByPrefix.a.length < 40) fail(`通常カードは40枚以上必要です。現在は${cardsByPrefix.a.length}枚です。`);
  if (cardsByPrefix.b.length < 1) fail("ベーシックカードは1枚以上必要です。");
  for (const prefix of ["a", "b"]) {
    for (const [index, card] of cardsByPrefix[prefix].entries()) {
      const expectedId = `${prefix}${index + 1}`;
      if (card.id !== expectedId) fail(`${prefix}カードのIDは連番にしてください。「${card.id}」ではなく「${expectedId}」が必要です。`);
    }
  }

  return cards;
}

try {
  const source = await readFile(sourceUrl, "utf8");
  const cards = parseCards(source);
  await writeFile(temporaryOutputUrl, `${JSON.stringify(cards, null, 2)}\n`, "utf8");
  await rename(temporaryOutputUrl, outputUrl);
  console.log(`${fileURLToPath(outputUrl)} を ${cards.length}枚のカードから生成しました。`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}


