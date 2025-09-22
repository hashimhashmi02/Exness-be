import WebSocket from "ws";
import { SUPPORTED } from "../lib/env.js";
import { bnPriceToInt } from "../lib/math.js";

type Handler = (symbol: string, priceInt: number, ts: number) => void;
export class BinanceTradeFeed {
  private ws?: WebSocket | undefined;
  private reconnectTimer?: NodeJS.Timeout | undefined;
  private heartbeatTimer?: NodeJS.Timeout | undefined;
  private handlers: Handler[] = [];
  private seen = new Set<string>();
  public lastPrice: Record<string, number> = {};

  
  start() {
    this.connect();
  }

  stop() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    try { this.ws?.close(); } catch {}
    this.ws = undefined;
  }

  onTrade(h: Handler) {
    this.handlers.push(h);
  }

  private connect() {
    const streams = SUPPORTED.map((s) => `${s.toLowerCase()}@trade`).join("/");
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      console.log("[binance] connected", streams);
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = setInterval(() => {
        try {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.ping();
          }
        } catch {}
      }, 15_000);
    });

    this.ws.on("close", (code, reason) => {
      console.log("[binance] closed", code, reason.toString());
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      console.error("[binance] error", (err as Error)?.message || err);
      
    });

    this.ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const data = msg?.data ?? msg;
        const symbol: string = data?.s;
        const pxStr: string = data?.p;
        const ts: number = data?.T;

        if (!symbol || !pxStr || !ts) return;

        const priceInt = bnPriceToInt(pxStr);
        this.lastPrice[symbol] = priceInt;

        if (!this.seen.has(symbol)) {
          this.seen.add(symbol);
          console.log("[trade first seen]", symbol);
        }

      
        for (const h of this.handlers) {
          try { h(symbol, priceInt, ts); } catch {}
        }
      } catch (e) {
      }
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), 2_000);
  }
}
