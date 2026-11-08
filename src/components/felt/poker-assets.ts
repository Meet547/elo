import { RANK_INDEX, type Card } from "@/lib/poker/cards";

const ROOT = "/poker";

export const ACE_OF_SPADES_SRC = `${ROOT}/cards/AS.svg`;
export const CARD_BACK_SRC = `${ROOT}/backs/back_red.svg`;

export function cardFaceSrc({ r, s }: Card) {
  return `${ROOT}/cards/${RANK_INDEX[r]}${s.toUpperCase()}.svg`;
}

export type ChipColor = "white" | "red" | "blue" | "green" | "black" | "yellow" | "orange" | "purple" | "pink" | "brown";
export type ChipView = "top" | "tilt" | "edge";

export function chipSrc(color: ChipColor, view: ChipView) {
  return `${ROOT}/chips/${view}/chip_${color}.svg`;
}
