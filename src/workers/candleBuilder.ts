import { prisma } from "../lib/prisma.js";

type Buf = { tsStart: number; open: number; high: number; low: number; close: number };
const buffers: Record<string, Buf> = {};

const minuteStart = (ts: number) => Math.floor(ts / 60000) * 60000;

type FlushTask = { symbol: string; buf: Buf };
const queue: FlushTask[] = [];
let flushing = false;

async function drain() {
  if (flushing) return;
  flushing = true;
  try {
    while (queue.length) {
      const { symbol, buf } = queue.shift()!;
      try {
        await prisma.candleM1.upsert({
          where: { symbol_ts: { symbol, ts: new Date(buf.tsStart) } },
          update: { open: buf.open, high: buf.high, low: buf.low, close: buf.close },
          create: { symbol, ts: new Date(buf.tsStart), open: buf.open, high: buf.high, low: buf.low, close: buf.close }
        });
      } catch (e: any) {
  
        const code = e?.code ?? "";
        if (code !== "P2021") {
          console.error("candle upsert error:", e?.message ?? e);
        }
      }
    }
  } finally {
    flushing = false;
  }
}
export async function onTradeForCandles(symbol: string, priceInt: number, ts: number) {
  const ms = minuteStart(ts);
  const prev = buffers[symbol];

  if (!prev || prev.tsStart !== ms) {
    if (prev) {
      queue.push({ symbol, buf: prev });
   
      void drain();
    }
    buffers[symbol] = { tsStart: ms, open: priceInt, high: priceInt, low: priceInt, close: priceInt };
    return;
  }
  prev.close = priceInt;
  if (priceInt > prev.high) prev.high = priceInt;
  if (priceInt < prev.low) prev.low = priceInt;
}
