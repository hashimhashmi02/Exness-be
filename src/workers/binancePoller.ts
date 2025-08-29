import axios from "axios";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { Interval } from "@prisma/client";

const BASE = "https://api.binance.com/api/v3/klines";

async function upsert1m(symbol: string) {
  const last = await prisma.candle.findFirst({
    where: { symbol, interval: Interval.ONE_MIN },
    orderBy: { tStart: "desc" }
  });

  const params: any = { symbol, interval: "1m", limit: 500 };
  if (last) params.startTime = last.tStart.getTime() + 60_000;

  const { data } = await axios.get(BASE, { params, timeout: 10_000 });

  const rows = (data as any[]).map(k => ({
    tStart: new Date(k[0]),
    open: k[1], high: k[2], low: k[3], close: k[4], volume: k[5]
  }));

  for (const r of rows) {
    await prisma.candle.upsert({
      where: { symbol_interval_tStart: { symbol, interval: Interval.ONE_MIN, tStart: r.tStart } },
      update: { open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume },
      create: { symbol, interval: Interval.ONE_MIN, tStart: r.tStart, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }
    });
  }
}

async function aggregate5m(symbol: string) {
  const recent = await prisma.candle.findMany({
    where: { symbol, interval: Interval.ONE_MIN },
    orderBy: { tStart: "asc" },
    take: 200
  });
  if (!recent.length) return;

  const buckets = new Map<number, { o:string,h:string,l:string,c:string,v:number,start:Date }>();
  for (const c of recent) {
    const bucketStart = Math.floor(c.tStart.getTime() / 300000) * 300000;
    if (!buckets.has(bucketStart)) {
      buckets.set(bucketStart, {
        o: String(c.open), h: String(c.high), l: String(c.low),
        c: String(c.close), v: Number(c.volume), start: new Date(bucketStart)
      });
    } else {
      const b = buckets.get(bucketStart)!;
      b.c = String(c.close);
      b.h = String(Math.max(Number(b.h), Number(c.high)));
      b.l = String(Math.min(Number(b.l), Number(c.low)));
      b.v += Number(c.volume);
    }
  }

  for (const [, b] of buckets) {
    await prisma.candle.upsert({
      where: { symbol_interval_tStart: { symbol, interval: Interval.FIVE_MIN, tStart: b.start } },
      update: { open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v.toString() },
      create: { symbol, interval: Interval.FIVE_MIN, tStart: b.start, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v.toString() }
    });
  }
}

export async function runPriceLoop() {
  const symbol = env.BINANCE_SYMBOL;
  const tick = async () => {
    try {
      await upsert1m(symbol);
      await aggregate5m(symbol);
    } catch (e) {
      console.error("poller error:", (e as Error).message);
    }
  };
  await tick();
  setInterval(tick, env.POLL_INTERVAL_MS);
}
