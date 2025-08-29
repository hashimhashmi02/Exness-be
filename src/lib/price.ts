import { prisma } from "./prisma.js";
import { Interval } from "@prisma/client";


export async function latestPrice(symbol = "SOLUSDT"): Promise<number> {
  const c1 = await prisma.candle.findFirst({
    where: { symbol, interval: Interval.ONE_MIN },
    orderBy: { tStart: "desc" }
  });
  if (c1) return Number(c1.close);

  const c5 = await prisma.candle.findFirst({
    where: { symbol, interval: Interval.FIVE_MIN },
    orderBy: { tStart: "desc" }
  });
  if (!c5) throw new Error("No price available");
  return Number(c5.close);
}
