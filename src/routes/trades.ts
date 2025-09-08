import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { z } from "zod";
import { auth } from "../middleware/auth.js";
import { env } from "../lib/env.js";
import { withSpread, pnlCents } from "../lib/math.js";
import { OrderStatus, OrderSide } from "@prisma/client";
import { priceBook } from "../state/priceBook.js";

const r = Router();

const CreateBody = z.object({
  asset: z.string(),
  type: z.enum(["buy", "sell"]),
  margin: z.coerce.number().int().positive(),
  leverage: z.coerce.number().int().positive(),
  stopLoss: z.coerce.number().int().optional(),
  takeProfit: z.coerce.number().int().optional(),
});

r.post("/trade", auth, async (req, res) => {
  const b = CreateBody.safeParse(req.body);
  if (!b.success) return res.status(411).json({ message: "Incorrect inputs" });

  const asset = b.data.asset.toUpperCase();
  const symbol = asset + "USDT";
  const whitelist = env.SYMBOLS.split(",").map(s => s.trim().toUpperCase());
  if (!whitelist.includes(symbol)) return res.status(411).json({ message: "Incorrect inputs" });

  if (![1, 5, 10, 20, 100].includes(b.data.leverage))
    return res.status(411).json({ message: "Incorrect inputs" });

  const user = await prisma.user.findUnique({ where: { id: String(req.user!.id) } });
  if (!user) return res.status(403).json({ message: "Incorrect inputs" });
  if (Number(user.usdBalance) < b.data.margin)
    return res.status(411).json({ message: "Insufficient balance" });


  const mark = priceBook.get(symbol);
  if (!mark) return res.status(503).json({ message: "No price available" });
  const { buy, sell } = withSpread(mark);

  const side: OrderSide = b.data.type === "buy" ? "BUY" : "SELL";
  const entry = side === "BUY" ? buy : sell;

  
  const sl = b.data.stopLoss;
  const tp = b.data.takeProfit;
  if (sl && tp) {
    if (side === "BUY" && !(sl < entry && tp > entry))
      return res.status(411).json({ message: "SL must be below and TP above entry for long" });
    if (side === "SELL" && !(sl > entry && tp < entry))
      return res.status(411).json({ message: "SL must be above and TP below entry for short" });
  }


  await prisma.user.update({
    where: { id: user.id },
    data: { usdBalance: BigInt(Number(user.usdBalance) - b.data.margin) },
  });

  const order = await prisma.order.create({
    //@ts-ignore
    data: {
      userId: user.id,
      symbol,
      side,
      marginCents: BigInt(b.data.margin),
      leverage: b.data.leverage,
      openPrice: BigInt(entry),
      stopLossPrice: sl != null ? BigInt(sl) : undefined,
      takeProfitPrice: tp != null ? BigInt(tp) : undefined,
    },
  });

  res.json({ orderId: order.id });
});


r.get("/trades/open", auth, async (req, res) => {
  const rows = await prisma.order.findMany({
    where: { userId: req.user!.id, status: OrderStatus.OPEN },
    orderBy: { openedAt: "desc" },
  });
  res.json({
    trades: rows.map((o) => ({
      orderId: o.id,
      type: o.side,
      margin: Number(o.marginCents),
      leverage: o.leverage,
      openPrice: Number(o.openPrice),
      stopLoss: o.stopLossPrice != null ? Number(o.stopLossPrice) : null,
      takeProfit: o.takeProfitPrice != null ? Number(o.takeProfitPrice) : null,
      openedAt: o.openedAt,
    })),
  });
});

r.get("/trades", auth, async (req, res) => {
  const rows = await prisma.order.findMany({
    where: { userId: req.user!.id, status: OrderStatus.CLOSED },
    orderBy: { closedAt: "desc" },
  });
  res.json({
    trades: rows.map((o) => ({
      orderId: o.id,
      type: o.side,
      margin: Number(o.marginCents),
      leverage: o.leverage,
      openPrice: Number(o.openPrice),
      closePrice: Number(o.closePrice ?? 0),
      pnl: Number(o.pnlCents ?? 0),
      stopLoss: o.stopLossPrice != null ? Number(o.stopLossPrice) : null,
      takeProfit: o.takeProfitPrice != null ? Number(o.takeProfitPrice) : null,
      openedAt: o.openedAt,
      closedAt: o.closedAt,
    })),
  });
});

const CloseBody = z.object({ orderId: z.string() });
r.post("/trade/close", auth, async (req, res) => {
  const { orderId } = CloseBody.parse(req.body);
  const o = await prisma.order.findUnique({ where: { id: orderId } });
  if (!o || o.userId !== req.user!.id) return res.status(404).json({ message: "Order not found" });
  if (o.status === "CLOSED") return res.status(400).json({ message: "Already closed" });

  const mark = priceBook.get(o.symbol);
  if (!mark) return res.status(400).json({ message: "No price" });
  const { buy, sell } = withSpread(mark);
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
  ]);

  res.json({ ok: true, orderId: o.id });
});

export default r;
 