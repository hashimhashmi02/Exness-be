import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { z } from "zod";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { env } from "../lib/env.js";
import { auth } from "../middleware/auth.js";

const r = Router();

// 1) Signup (POST /api/v1/user/signup)
const Creds = z.object({ email: z.string().email(), password: z.string().min(6) });

r.post("/user/signup", async (req, res) => {
  const { email, password } = Creds.parse(req.body);
  try {
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return res.status(403).json({ message: "Error while signing up" }); // per spec wording
    const hash = await bcrypt.hash(password, 10);
    const u = await prisma.user.create({ data: { email, password: hash }});
    res.json({ userId: u.id });
  } catch {
    res.status(403).json({ message: "Error while signing up" });
  }
});

// 2) Signin (POST /api/v1/user/signin)
r.post("/user/signin", async (req, res) => {
  const { email, password } = Creds.parse(req.body);
  const u = await prisma.user.findUnique({ where: { email } });
  if (!u) return res.status(403).json({ message: "Incorrect credentials" });
  const ok = await bcrypt.compare(password, u.password);
  if (!ok) return res.status(403).json({ message: "Incorrect credentials" });
  const token = jwt.sign({ id: u.id, email: u.email }, env.JWT_SECRET, { expiresIn: "7d" });
  res.json({ token });
});

// 6) Get USD balance (GET /api/v1/user/balance)
r.get("/user/balance", auth, async (req, res) => {
  const u = await prisma.user.findUnique({ where: { id: String(req.user!.id) }, select: { usdBalance: true }});
  res.json({ usd_balance: Number(u?.usdBalance ?? 0) });
});

export default r;
