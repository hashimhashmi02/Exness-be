class PriceBook {
  private map = new Map<string, number>();
  set(symbol: string, priceInt: number) { this.map.set(symbol, priceInt); }
  get(symbol: string) { return this.map.get(symbol); }
  snapshot() {
    return Array.from(this.map.entries()).map(([symbol, priceInt]) => ({ symbol, priceInt }));
  }
}
export const priceBook = new PriceBook();
