import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { auth } from "../middleware/auth.js";

const r = Router();

r.get("/balance", auth, async (req, res) => {
  const w = await prisma.wallet.findMany({ where: { userId: req.user!.id } });
  const get = (cur: string) => Number(w.find(x => x.currency === cur)?.qty || 0);
  res.json({
    balance: {
      usd: { qty: get("USD") },
      btc: { qty: get("BTC") },
      sol: { qty: get("SOL") }
    }
  });
});

export default r;
