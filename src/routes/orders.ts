import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { auth } from "../middleware/auth.js";
import { latestPrice } from "../lib/price.js";
import { OrderSide, OrderStatus } from "@prisma/client";

const r = Router();

const OpenBody = z.object({
  type: z.enum(["buy","sell"]),
  qty: z.coerce.number().positive(),
  asset: z.string().default("sol"),
  stopLoss: z.coerce.number().positive().optional(),
  takeProfit: z.coerce.number().positive().optional()
});

r.post("/order/open", auth, async (req, res) => {
  const b = OpenBody.parse(req.body);
  const coinSym = b.asset.toUpperCase(); // "SOL" | "BTC" ...
  const px = await latestPrice(coinSym + "USDT");

  const usd = await prisma.wallet.findUnique({ where: { userId_currency: { userId: req.user!.id, currency: "USD" } }});
  const coin = await prisma.wallet.findUnique({ where: { userId_currency: { userId: req.user!.id, currency: coinSym } }});
  if (!usd || !coin) return res.status(400).json({ error: "Wallets missing" });

  if (b.type === "buy") {
    const cost = b.qty * px;
    if (Number(usd.qty) < cost) return res.status(400).json({ error: "Insufficient USD" });
    await prisma.$transaction([
      prisma.wallet.update({ where: { id: usd.id }, data: { qty: (Number(usd.qty) - cost).toString() } }),
      prisma.wallet.update({ where: { id: coin.id }, data: { qty: (Number(coin.qty) + b.qty).toString() } })
    ]);
  } else {
    if (Number(coin.qty) < b.qty) return res.status(400).json({ error: `Insufficient ${coinSym}` });
    const proceeds = b.qty * px;
    await prisma.$transaction([
      prisma.wallet.update({ where: { id: coin.id }, data: { qty: (Number(coin.qty) - b.qty).toString() } }),
      prisma.wallet.update({ where: { id: usd.id }, data: { qty: (Number(usd.qty) + proceeds).toString() } })
    ]);
  }

  const order = await prisma.order.create({
    data: {
      userId: req.user!.id,
      symbol: coinSym,
      side: b.type === "buy" ? OrderSide.BUY : OrderSide.SELL,
      qty: b.qty.toString(),
      entryPrice: px.toString(),
      stopLoss: b.stopLoss ? b.stopLoss.toString() : null,
      takeProfit: b.takeProfit ? b.takeProfit.toString() : null
    }
  });

  const wallets = await prisma.wallet.findMany({ where: { userId: req.user!.id }});
  const pick = (c:string)=>Number(wallets.find(w=>w.currency===c)?.qty||0);
  res.json({
    response: {
      orderId: order.id,
      balance: { usd: pick("USD"), btc: pick("BTC"), sol: pick("SOL") }
    }
  });
});

r.get("/orders", auth, async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { userId: req.user!.id },
    orderBy: { id: "desc" }
  });
  res.json(orders.map(o => ({
    id: o.id, symbol: o.symbol, side: o.side,
    qty: Number(o.qty), entryPrice: Number(o.entryPrice),
    stopLoss: o.stopLoss ? Number(o.stopLoss) : null,
    takeProfit: o.takeProfit ? Number(o.takeProfit) : null,
    status: o.status, openedAt: o.openedAt, closedAt: o.closedAt,
    closePrice: o.closePrice ? Number(o.closePrice) : null
  })));
});

const CloseBody = z.object({ orderId: z.coerce.number() });

r.post("/order/close", auth, async (req, res) => {
  const { orderId } = CloseBody.parse(req.body);
  const o = await prisma.order.findUnique({ where: { id: orderId }});
  if (!o || o.userId !== req.user!.id) return res.status(404).json({ error: "Order not found" });
  if (o.status === OrderStatus.CLOSED) return res.status(400).json({ error: "Already closed" });

  const px = await latestPrice(o.symbol + "USDT");
  const usd = await prisma.wallet.findUnique({ where: { userId_currency: { userId: req.user!.id, currency: "USD" } }});
  const coin = await prisma.wallet.findUnique({ where: { userId_currency: { userId: req.user!.id, currency: o.symbol } }});
  if (!usd || !coin) return res.status(400).json({ error: "Wallets missing" });

  if (o.side === "BUY") {
    if (Number(coin.qty) < Number(o.qty)) return res.status(400).json({ error: "Insufficient coin to close" });
    const proceeds = Number(o.qty) * px;
    await prisma.$transaction([
      prisma.wallet.update({ where: { id: coin.id }, data: { qty: (Number(coin.qty) - Number(o.qty)).toString() } }),
      prisma.wallet.update({ where: { id: usd.id }, data: { qty: (Number(usd.qty) + proceeds).toString() } })
    ]);
  } else {
    const cost = Number(o.qty) * px;
    if (Number(usd.qty) < cost) return res.status(400).json({ error: "Insufficient USD to close" });
    await prisma.$transaction([
      prisma.wallet.update({ where: { id: usd.id }, data: { qty: (Number(usd.qty) - cost).toString() } }),
      prisma.wallet.update({ where: { id: coin.id }, data: { qty: (Number(coin.qty) + Number(o.qty)).toString() } })
    ]);
  }

  const closed = await prisma.order.update({
    where: { id: o.id },
    data: { status: OrderStatus.CLOSED, closedAt: new Date(), closePrice: px.toString() }
  });

  res.json({ ok: true, orderId: closed.id, closePrice: px });
});

export default r;
