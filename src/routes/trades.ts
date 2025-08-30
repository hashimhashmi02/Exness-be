import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { z } from "zod";
import { auth } from "../middleware/auth.js";
import { env } from "../lib/env.js";
import { withSpread, pnlCents } from "../lib/math.js";
import { priceBook } from "../state/priceBook.js";

const r = Router();

const CreateBody = z.object({
  asset: z.string(),                             // "BTC" | "ETH" | "SOL"
  type: z.enum(["buy", "sell"]),
  margin: z.coerce.number().int().positive(),    // cents (2 decimals)
  leverage: z.coerce.number().int().positive()   // 1,5,10,20,100
});

// 3) Create order (POST /api/v1/trade)
r.post("/trade", auth, async (req, res) => {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) return res.status(411).json({ message: "Incorrect inputs" });

  const b = parsed.data;

  const asset = b.asset.toUpperCase();
  const symbol = asset + "USDT";
  const allowed = env.SYMBOLS.split(",").map(s => s.trim().toUpperCase());
  if (!allowed.includes(symbol)) return res.status(411).json({ message: "Incorrect inputs" });

  if (![1, 5, 10, 20, 100].includes(b.leverage))
    return res.status(411).json({ message: "Incorrect inputs" });

  const user = await prisma.user.findUnique({ where: { id: String(req.user!.id) } });
  if (!user) return res.status(403).json({ message: "Incorrect inputs" });
  if (Number(user.usdBalance) < b.margin)
    return res.status(411).json({ message: "Incorrect inputs" });

  
  const mark = priceBook.get(symbol);
  if (!mark) return res.status(411).json({ message: "Incorrect inputs" });
  const { buy, sell } = withSpread(mark);

  const side = (b.type === "buy" ? "BUY" : "SELL") as "BUY" | "SELL";
  const entry = side === "BUY" ? buy : sell;

  // reserve margin
  await prisma.user.update({
    where: { id: user.id },
    data: { usdBalance: BigInt(Number(user.usdBalance) - b.margin) }
  });

  const order = await prisma.order.create({
    data: {
      userId: user.id,
      symbol,
      side,                                // "BUY" | "SELL"
      marginCents: BigInt(b.margin),       // cents
      leverage: b.leverage,                // 1/5/10/20/100
      openPrice: BigInt(entry)             // integer price (PRICE_DECIMALS)
    }
  });

  res.json({ orderId: order.id });
});

// 4) Get open orders (GET /api/v1/trades/open)
r.get("/trades/open", auth, async (req, res) => {
  const rows = await prisma.order.findMany({
    where: { userId: String(req.user!.id), status: "OPEN" },
    orderBy: { openedAt: "desc" }
  });

  res.json({
    trades: rows.map(o => ({
      orderId: o.id,
      type: o.side,                       
      margin: Number(o.marginCents),      
      leverage: o.leverage,
      openPrice: Number(o.openPrice)      
    }))
  });
});

// 5) Get existing closed orders (GET /api/v1/trades)
r.get("/trades", auth, async (req, res) => {
  const rows = await prisma.order.findMany({
    where: { userId: String(req.user!.id), status: "CLOSED" },
    orderBy: { closedAt: "desc" }
  });

  res.json({
    trades: rows.map(o => ({
      orderId: o.id,
      type: o.side,
      margin: Number(o.marginCents),      
      leverage: o.leverage,
      openPrice: Number(o.openPrice),     
      closePrice: Number(o.closePrice ?? 0),
      pnl: Number(o.pnlCents ?? 0)       
    }))
  });
});

const CloseBody = z.object({ orderId: z.string() });

r.post("/trade/close", auth, async (req, res) => {
  const { orderId } = CloseBody.parse(req.body);

  const o = await prisma.order.findUnique({ where: { id: orderId } });
  if (!o || o.userId !== String(req.user!.id))
    return res.status(404).json({ message: "Order not found" });
  if (o.status === "CLOSED")
    return res.status(400).json({ message: "Already closed" });

  const mark = priceBook.get(o.symbol);
  if (!mark) return res.status(400).json({ message: "No price" });

  const { buy, sell } = withSpread(mark);
  const exit = o.side === "BUY" ? sell : buy; // opposite side at close

  const exposureCents = Number(o.marginCents) * o.leverage;
  const pnl = pnlCents(o.side as "BUY" | "SELL", exposureCents, Number(o.openPrice), exit);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: o.userId },
      data: { usdBalance: { increment: BigInt(Number(o.marginCents) + pnl) } }
    }),
    prisma.order.update({
      where: { id: o.id },
      data: {
        status: "CLOSED",
        closePrice: BigInt(exit),
        pnlCents: BigInt(pnl),
        closedAt: new Date()
      }
    })
  ]);

  res.json({ ok: true, orderId: o.id });
});

export default r;
