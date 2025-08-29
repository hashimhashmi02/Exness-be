import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(6),
  BINANCE_SYMBOL: z.string().default("SOLUSDT"),
  POLL_INTERVAL_MS: z.coerce.number().default(25000)
});

export const env = Env.parse(process.env);
