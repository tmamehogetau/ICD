import adjustments from "../data/adjustment-cards.json" with { type: "json" };

export const ADJUSTMENTS = adjustments;
export const DRAW_ADJUSTMENTS = adjustments.filter(card => card.id.startsWith("a"));
export const BASIC_ADJUSTMENTS = adjustments.filter(card => card.id.startsWith("b"));

const adjustmentById = new Map(ADJUSTMENTS.map(card => [card.id, card]));
const instancePattern = /^(a[1-9]\d*)#([1-9]\d*)$/u;

export function createAdjustmentInstanceId(definitionId, copyNumber) {
  return `${definitionId}#${copyNumber}`;
}

export function getAdjustmentDefinitionId(id) {
  return instancePattern.exec(id)?.[1] || id;
}

export const DRAW_ADJUSTMENT_INSTANCES = DRAW_ADJUSTMENTS.flatMap(card =>
  Array.from({ length: card.copies }, (_, index) => createAdjustmentInstanceId(card.id, index + 1))
);

export function getAdjustment(id) {
  return adjustmentById.get(getAdjustmentDefinitionId(id));
}