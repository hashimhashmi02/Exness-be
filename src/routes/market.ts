import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { SUPPORTED, env } from "../lib/env.js";
import { withSpread } from "../lib/math.js";
import { priceBook } from "../state/priceBook.js";

const r = Router();

// 7) Get candles (GET /api/v1/candles?asset=BTC&startTime&endTime&ts=1m/1w/1d)
const Q = z.object({
  asset: z.string(),
  startTime: z.coerce.number().optional(),
  endTime: z.coerce.number().optional(),
  ts: z.enum(["1m", "1d", "1w"]).default("1m")
});

r.get("/candles", async (req, res) => {
  const q = Q.parse(req.query);
  const symbol = q.asset.toUpperCase() + "USDT";
  if (!SUPPORTED.includes(symbol)) return res.status(400).json({ message: "Unsupported asset" });

  const where: any = { symbol };
  if (q.startTime) where.ts = { gte: new Date(q.startTime) };
  if (q.endTime) where.ts = { ...(where.ts || {}), lte: new Date(q.endTime) };

  const rows = await prisma.candleM1.findMany({ where, orderBy: { ts: "asc" } });

  // aggregate to 1d / 1w if requested
  function bucket(ts: number) {
    if (q.ts === "1m") return Math.floor(ts / 60000) * 60000;
    if (q.ts === "1d") {
      const d = new Date(ts); d.setUTCHours(0,0,0,0); return d.getTime();
    }
    // 1w: Monday 00:00 UTC bucket
    const d = new Date(ts); const day = (d.getUTCDay() + 6) % 7; // 0..6, 0=Mon
    d.setUTCDate(d.getUTCDate() - day); d.setUTCHours(0,0,0,0); return d.getTime();
  }

  const map = new Map<number, { o:number,h:number,l:number,c:number }>();
  for (const c of rows) {
    const b = bucket(c.ts.getTime());
    const val = { o:Number(c.open), h:Number(c.high), l:Number(c.low), c:Number(c.close) };
    if (!map.has(b)) map.set(b, { ...val });
    else {
      const x = map.get(b)!;
      x.c = val.c;
      x.h = Math.max(x.h, val.h);
      x.l = Math.min(x.l, val.l);
    }
  }

  const candles = Array.from(map.entries()).sort((a,b)=>a[0]-b[0]).map(([t, x]) => ({
    timestamp: t,
    open: x.o, close: x.c, high: x.h, low: x.l,
    decimal: env.PRICE_DECIMALS
  }));

  res.json({ candles });
});

// 8) Get assets (GET /api/v1/assets)
r.get("/assets", async (_req, res) => {
  const assets = SUPPORTED.map(sym => {
    const mark = priceBook.get(sym);
    if (!mark) return null;
    const { buy, sell } = withSpread(mark);
    const name = sym.startsWith("BTC") ? "Bitcoin" : sym.startsWith("ETH") ? "Ethereum" : "Solana";
    return { name, symbol: sym.replace("USDT",""), buyPrice: buy, sellPrice: sell, decimals: env.PRICE_DECIMALS, imageUrl: "" };
  }).filter(Boolean);
  res.json({ assets });
});

export default r;
