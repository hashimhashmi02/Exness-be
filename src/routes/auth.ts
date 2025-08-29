import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../lib/env.js";

const r = Router();

const Creds = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

r.post("/signup", async (req, res) => {
  const { email, password } = Creds.parse(req.body);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "Email exists" });

  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email, password: hash,
      wallets: { createMany: { data: [
        { currency: "USD", qty: "10000" },
        { currency: "BTC", qty: "0" },
        { currency: "SOL", qty: "0" }
      ]}}
    }
  });

  const token = jwt.sign({ id: user.id, email }, env.JWT_SECRET, { expiresIn: "7d" });
  res.json({ token });
});

r.post("/signin", async (req, res) => {
  const { email, password } = Creds.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: "Bad creds" });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: "Bad creds" });

  const token = jwt.sign({ id: user.id, email }, env.JWT_SECRET, { expiresIn: "7d" });
  res.json({ token });
});

export default r;
