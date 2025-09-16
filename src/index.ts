import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";

import userRoutes from "./routes/user.js";
import tradeRoutes from "./routes/trades.js";
import marketRoutes from "./routes/market.js";

import { env, SUPPORTED } from "./lib/env.js";
import { withSpread } from "./lib/math.js";
import { priceBook } from "./state/priceBook.js";
import { BinanceTradeFeed } from "./ws/binanceTradeFeed.js";
import { onTradeForCandles } from "./workers/candleBuilder.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

app.use("/api/v1", userRoutes);
app.use("/api/v1", tradeRoutes);
app.use("/api/v1", marketRoutes);

app.get("/", (_req, res) => res.send("Exness V0 backend up"));

const server = http.createServer(app);

type Client = WebSocket & { _symbols?: string[]; _alive?: boolean };

function parseSymbolsParam(q: string | null) {
  if (!q) return SUPPORTED;
  const list = q
    .split(",")
    .map((s) => s.trim().toUpperCase().replace("USDT", "") + "USDT")
    .filter((s) => SUPPORTED.includes(s));
  return list.length ? list : SUPPORTED;
}

function makeUpdates(symbols: string[]) {
  return symbols
    .map((sym) => {
      const mark = priceBook.get(sym);
      if (!mark) return null;
      const { buy, sell } = withSpread(mark);
      return {
        symbol: sym.replace("USDT", ""),
        buyPrice: buy,
        sellPrice: sell,
        decimals: env.PRICE_DECIMALS,
      };
    })
    .filter(Boolean) as any[];
}

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws: Client, req) => {

  const url = new URL(req.url || "/ws", "http://localhost");
  ws._symbols = parseSymbolsParam(url.searchParams.get("symbols"));


  ws._alive = true;
  ws.on("pong", () => (ws._alive = true));

  const snap = makeUpdates(ws._symbols!);
  if (snap.length) ws.send(JSON.stringify({ price_updates: snap }));
});


setInterval(() => {
  wss.clients.forEach((c) => {
    const ws = c as Client;
    if (ws._alive === false) return ws.terminate();
    ws._alive = false;
    try {
      ws.ping();
    } catch {}
  });
}, 30_000);


function broadcastPrices() {
  wss.clients.forEach((c) => {
    const ws = c as Client;
    if (ws.readyState !== WebSocket.OPEN) return;
    const updates = makeUpdates(ws._symbols || SUPPORTED);
    if (updates.length) ws.send(JSON.stringify({ price_updates: updates }));
  });
}


console.log("[symbols]", SUPPORTED.join(", "));
const feed = new BinanceTradeFeed();
feed.onTrade(async (symbol, priceInt, ts) => {
  priceBook.set(symbol, priceInt);
  broadcastPrices();                    
  await onTradeForCandles(symbol, priceInt, ts);
});
feed.start();
setInterval(() => broadcastPrices(), 2000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`API http://localhost:${PORT}`));
