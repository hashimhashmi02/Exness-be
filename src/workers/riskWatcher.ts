import { prisma } from "../lib/prisma.js";
import { latestPrice } from "../lib/price.js";
import { OrderStatus, OrderSide } from "@prisma/client";

export function runRiskWatcher() {
  const loop = async () => {
    try {
      const open = await prisma.order.findMany({ where: { status: OrderStatus.OPEN } });
      if (!open.length) return;

      const symbols = Array.from(new Set(open.map(o => o.symbol)));
      const px: Record<string, number> = {};
      for (const s of symbols) px[s] = await latestPrice(s + "USDT");

      for (const o of open) {
        const p = px[o.symbol];
        if (typeof p === "undefined") continue;
        let close = false;

        if (o.side === OrderSide.BUY) {
          if (o.takeProfit && p >= Number(o.takeProfit)) close = true;
          if (o.stopLoss && p <= Number(o.stopLoss)) close = true;
        } else {
          if (o.takeProfit && p <= Number(o.takeProfit)) close = true;
          if (o.stopLoss && p >= Number(o.stopLoss)) close = true;
        }
        if (!close) continue;

        const usd = await prisma.wallet.findUnique({ where: { userId_currency: { userId: o.userId, currency: "USD" } }});
        const coin = await prisma.wallet.findUnique({ where: { userId_currency: { userId: o.userId, currency: o.symbol } }});
        if (!usd || !coin) continue;

        if (o.side === OrderSide.BUY) {
          if (Number(coin.qty) < Number(o.qty)) continue;
          const proceeds = Number(o.qty) * p;
          await prisma.$transaction([
            prisma.wallet.update({ where: { id: coin.id }, data: { qty: (Number(coin.qty) - Number(o.qty)).toString() } }),
            prisma.wallet.update({ where: { id: usd.id }, data: { qty: (Number(usd.qty) + proceeds).toString() } })
          ]);
        } else {
          const cost = Number(o.qty) * p;
          if (Number(usd.qty) < cost) continue;
          await prisma.$transaction([
            prisma.wallet.update({ where: { id: usd.id }, data: { qty: (Number(usd.qty) - cost).toString() } }),
            prisma.wallet.update({ where: { id: coin.id }, data: { qty: (Number(coin.qty) + Number(o.qty)).toString() } })
          ]);
        }

        await prisma.order.update({
          where: { id: o.id },
          data: { status: OrderStatus.CLOSED, closedAt: new Date(), closePrice: p.toString() }
        });
      }
    } catch (e) {
      console.error("risk watcher error:", (e as Error).message);
    }
  };

  setInterval(loop, 5000);
}
