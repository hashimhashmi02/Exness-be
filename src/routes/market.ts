import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { z } from "zod";
import { Interval } from "@prisma/client";

const r = Router();

const Q = z.object({
  asset: z.string().default("sol"),
  duration: z.enum(["1m","5m","5min","5minutes","5"]).default("1m"),
  startTime: z.coerce.number().optional(),
  endTime: z.coerce.number().optional()
});

function toInterval(d: string): Interval {
  return (d === "5m" || d === "5" || d === "5min" || d === "5minutes")
    ? Interval.FIVE_MIN
    : Interval.ONE_MIN;
}

r.get("/candles", async (req, res) => {
  const q = Q.parse(req.query);
  const symbol = q.asset.toUpperCase() === "SOL"
    ? "SOLUSDT"
    : q.asset.toUpperCase() === "BTC"
      ? "BTCUSDT"
      : q.asset.toUpperCase() + "USDT";

  const interval = toInterval(q.duration);

  const where: any = { symbol, interval };
  if (q.startTime) where.tStart = { gte: new Date(q.startTime) };
  if (q.endTime) where.tStart = { ...(where.tStart || {}), lte: new Date(q.endTime) };

  const rows = await prisma.candle.findMany({ where, orderBy: { tStart: "asc" }});
  res.json(rows.map(c => ({
    t: c.tStart.getTime(),
    o: Number(c.open),
    h: Number(c.high),
    l: Number(c.low),
    c: Number(c.close),
    v: Number(c.volume)
  })));
});

export default r;
