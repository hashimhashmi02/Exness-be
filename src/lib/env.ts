import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(6),
  SYMBOLS: z.string().default("BTCUSDT,ETHUSDT,SOLUSDT"),
  PRICE_DECIMALS: z.coerce.number().int().min(0).default(4),
  SPREAD_BPS: z.coerce.number().int().min(0).default(100) 
});

export const env = Env.parse(process.env);
export const SUPPORTED = env.SYMBOLS.split(",").map(s => s.trim().toUpperCase());
