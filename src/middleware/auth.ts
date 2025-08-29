import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../lib/env.js";
import type { JwtUser } from "../types.js";

declare global {
  namespace Express {
    interface Request { user?: JwtUser }
  }
}

export function auth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token" });
  }
  try {
    const token = h.slice(7);
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtUser;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}
