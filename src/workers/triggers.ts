import { prisma } from "../lib/prisma.js";
import { withSpread, pnlCents } from "../lib/math.js";
import { OrderSide, OrderStatus } from "@prisma/client";

export async function checkOrderTriggers(symbol: string, markInt: number) {
  
  const orders = await prisma.order.findMany({
    where: {
      symbol,
      status: OrderStatus.OPEN,
      OR: [{ stopLossPrice: { not: null } }, { takeProfitPrice: { not: null } }],
    },
  });
  if (orders.length === 0) return;

  const { buy, sell } = withSpread(markInt);

  for (const o of orders) {
    const sl = o.stopLossPrice != null ? Number(o.stopLossPrice) : null;
    const tp = o.takeProfitPrice != null ? Number(o.takeProfitPrice) : null;

    let hit = false;
    if (o.side === "BUY") {
      if (sl != null && sell <= sl) hit = true;         
      if (tp != null && sell >= tp) hit = true;        
    } else {
      if (sl != null && buy >= sl) hit = true;          
      if (tp != null && buy <= tp) hit = true;          
    }
    if (!hit) continue;

    const exit = o.side === "BUY" ? sell : buy;
    const exposureCents = Number(o.marginCents) * o.leverage;
    const pnl = pnlCents(o.side, exposureCents, Number(o.openPrice), exit);

    
    await prisma.$transaction([
      prisma.user.update({
        where: { id: o.userId },
        data: { usdBalance: { increment: BigInt(Number(o.marginCents) + pnl) } },
      }),
      prisma.order.update({
        where: { id: o.id },
        data: {
          status: "CLOSED",
          closePrice: BigInt(exit),
          pnlCents: BigInt(pnl),
          closedAt: new Date(),
        },
      }),
    ]).catch(() => { /* ignore if closed  concurrently */ });
  }
}
