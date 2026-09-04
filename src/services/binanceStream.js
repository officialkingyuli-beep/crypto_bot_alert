const WebSocket = require('ws');
const axios = require('axios');

class BinanceStreamService {
  constructor(onTickerUpdate) {
    this.onTickerUpdate = onTickerUpdate;
    this.ws = null;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.isConnecting = false;
    this.symbols = [];
  }

  async start() {
    console.log('[BinanceStream] Initializing Real-Time Binance Futures Feed...');
    await this.fetchTopSymbols();
    this.connectWebSocket();
  }

  async fetchTopSymbols() {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9'
    };

    try {
      const response = await axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr', { headers, timeout: 8000 });
      if (response.data && Array.isArray(response.data)) {
        const sorted = response.data
          .filter(t => t.symbol && t.symbol.endsWith('USDT'))
          .sort((a, b) => parseFloat(b.quoteVolume || 0) - parseFloat(a.quoteVolume || 0))
          .slice(0, 50);

        this.symbols = sorted.map(s => s.symbol.toLowerCase());
        console.log(`✅ [BinanceStream] Loaded ${this.symbols.length} top USDT pairs from Binance Futures.`);
        return;
      }
    } catch (err) {
      console.warn(`[BinanceStream] Primary Binance Futures REST call (${err.message}). Using cloud fallback pairs...`);
    }

    // Static fallback top 50 USDT pairs for cloud environments
    this.symbols = [
      'btcusdt', 'ethusdt', 'solusdt', 'pepeusdt', 'dogeusdt', 'xrpusdt', 'shibusdt',
      'nearusdt', 'suiusdt', 'wifusdt', 'flokiusdt', 'bonkusdt', 'avaxusdt', 'linkusdt',
      'adausdt', 'bchusdt', 'ltcusdt', 'trxusdt', 'dotusdt', 'maticusdt', 'uniusdt',
      'taousdt', 'wldusdt', 'aptusdt', 'arbusdt', 'opusdt', 'injusdt', 'tiausdt',
      'fetusdt', 'renderusdt', 'kasusdt', 'seiusdt', 'runeusdt', 'notusdt', 'tonusdt',
      'ondousdt', 'arkmusdt', 'pendleusdt', 'galausdt', 'ftmusdt', 'jasmyusdt',
      'bomeusdt', 'popcatusdt', 'pythusdt', 'beamusdt', 'blurusdt', 'strkusdt',
      'snxusdt', 'crvusdt', 'ldousdt'
    ];
    console.log(`[BinanceStream] Using static top ${this.symbols.length} USDT trading pairs for Binance.`);
  }

  connectWebSocket() {
    if (this.isConnecting) return;
    this.isConnecting = true;

    // Stream 1-minute klines for top 50 symbols
    const streamNames = this.symbols.slice(0, 50).map(s => `${s}@kline_1m`).join('/');
    const wsUrl = `wss://stream.binance.com:9443/stream?streams=${streamNames}`;

    console.log('[BinanceStream] Connecting to Binance Live Trades WebSocket Stream...');
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      console.log('✅ [BinanceStream] Connected to Binance Real-Time WebSocket. Streaming market trades...');
      this.isConnecting = false;

      // Ping keep-alive every 30 seconds
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.ping();
        }
      }, 30000);
    });

    this.ws.on('message', (data) => {
      try {
        const json = JSON.parse(data);
        if (json && json.data && json.data.k) {
          const k = json.data.k;
          const symbol = k.s;
          const closePrice = parseFloat(k.c);
          // Quote Volume in USDT (fallback to base volume k.v * closePrice if k.q is missing)
          const volume = parseFloat(k.q || 0) || (parseFloat(k.v || 0) * closePrice);
          const isClosed = k.x;
          const openPrice = parseFloat(k.o);
          const candleTime = k.t; // Candle open time timestamp

          this.onTickerUpdate({
            exchange: 'Binance',
            symbol: symbol,
            price: closePrice,
            openPrice: openPrice,
            high: parseFloat(k.h || closePrice),
            low: parseFloat(k.l || closePrice),
            volume: volume,
            isClosed: isClosed,
            candleTime: candleTime,
            timestamp: new Date()
          });
        }
      } catch (err) {
        // parse error ignored
      }
    });

    this.ws.on('error', (err) => {
      console.error('[BinanceStream] WebSocket error:', err.message);
    });

    this.ws.on('close', () => {
      console.warn('[BinanceStream] Connection closed. Reconnecting in 5s...');
      this.isConnecting = false;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.scheduleReconnect();
    });
  }

  scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connectWebSocket();
    }, 5000);
  }

  stop() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
    }
  }
}

module.exports = BinanceStreamService;
