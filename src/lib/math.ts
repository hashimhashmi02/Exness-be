import { env } from "./env.js";
export const PRICE_SCALE = 10 ** env.PRICE_DECIMALS;
export const USD_SCALE = 100;

export function bnPriceToInt(p: string): number {
  const v = Number(p);
  return Math.round(v * PRICE_SCALE);
}
export function priceIntToCents(priceInt: number): number {
  return Math.round((priceInt * USD_SCALE) / PRICE_SCALE);
}
export function withSpread(markPriceInt: number) {
  const half = env.SPREAD_BPS / 2 / 10000;
  const buy = Math.round(markPriceInt * (1 + half));
  const sell = Math.round(markPriceInt * (1 - half));
  return { buy, sell };
}
export function pnlCents(
  side: "BUY" | "SELL",
  exposureCents: number,
  entryPriceInt: number,
  exitPriceInt: number
): number {
  const entryCents = priceIntToCents(entryPriceInt);
  const exitCents = priceIntToCents(exitPriceInt);
  const diff = side === "BUY" ? (exitCents - entryCents) : (entryCents - exitCents);
  return Math.round((exposureCents * diff) / entryCents);
}
