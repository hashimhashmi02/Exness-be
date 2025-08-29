import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import http from "http";
import { WebSocketServer } from "ws";
import { prisma } from "./lib/prisma.js";
import { Interval } from "@prisma/client";

import authRoutes from "./routes/auth.js";
import marketRoutes from "./routes/market.js";
import walletRoutes from "./routes/wallet.js";
import orderRoutes from "./routes/orders.js";

import { runPriceLoop } from "./workers/binancePoller.js";
import { runRiskWatcher } from "./workers/riskWatcher.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

app.use(authRoutes);
app.use(marketRoutes);
app.use(walletRoutes);
app.use(orderRoutes);

app.get("/", (_req, res) => res.send("Exness backend OK"));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function broadcast(msg: any) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((c: any) => { if (c.readyState === 1) c.send(data); });
}

async function pricePushLoop() {
  let lastTime = 0;
  setInterval(async () => {
    const last = await prisma.candle.findFirst({
      where: { interval: Interval.ONE_MIN },
      orderBy: { tStart: "desc" }
    });
    if (!last) return;
    const ts = last.tStart.getTime();
    if (ts !== lastTime) {
      lastTime = ts;
      broadcast({ t: ts, close: Number(last.close) });
    }
  }, 2000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`API on http://localhost:${PORT}`);
  runPriceLoop();
  runRiskWatcher();
  pricePushLoop();
});
