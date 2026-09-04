const WebSocket = require('ws');
const axios = require('axios');

class BybitStreamService {
  constructor(onTickerUpdate) {
    this.onTickerUpdate = onTickerUpdate;
    this.ws = null;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.isConnecting = false;
    this.symbols = [];
  }

  async start() {
    console.log('[BybitStream] Initializing Real-Time Bybit Linear Futures Feed...');
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
      const response = await axios.get('https://api.bybit.com/v5/market/tickers?category=linear', { headers, timeout: 8000 });
      if (response.data && response.data.result && response.data.result.list) {
        const sorted = response.data.result.list
          .filter(t => t.symbol && t.symbol.endsWith('USDT'))
          .sort((a, b) => parseFloat(b.turnover24h || 0) - parseFloat(a.turnover24h || 0))
          .slice(0, 80);

        this.symbols = sorted.map(s => s.symbol);
        console.log(`✅ [BybitStream] Loaded ${this.symbols.length} top USDT pairs from Bybit Linear Futures.`);
        return;
      }
    } catch (err) {
      console.warn(`[BybitStream] Primary Bybit REST call (${err.message}). Trying fallback endpoint...`);
    }

    // Fallback static top 50 USDT pairs if REST call is blocked
    this.symbols = [
      'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'PEPEUSDT', 'DOGEUSDT', 'XRPUSDT', 'SHIBUSDT',
      'NEARUSDT', 'SUIUSDT', 'WIFUSDT', 'FLOKIUSDT', 'BONKUSDT', 'AVAXUSDT', 'LINKUSDT',
      'ADAUSDT', 'BCHUSDT', 'LTCUSDT', 'TRXUSDT', 'DOTUSDT', 'MATICUSDT', 'UNIUSDT',
      'TAOUSDT', 'WLDUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT', 'INJUSDT', 'TIAUSDT',
      'FETUSDT', 'RENDERUSDT', 'KASUSDT', 'SEIUSDT', 'RUNEUSDT', 'NOTUSDT', 'TONUSDT',
      'ONDOUSDT', 'ARKMUSDT', 'PENDLEUSDT', 'GALAUSDT', 'FTMUSDT', 'JASMYUSDT',
      'BOMEUSDT', 'POPCATUSDT', 'PYTHUSDT', 'BEAMUSDT', 'BLURUSDT', 'STRKUSDT',
      'SNXUSDT', 'CRVUSDT', 'LDOUSDT'
    ];
    console.log(`[BybitStream] Using static top ${this.symbols.length} USDT trading pairs.`);
  }

  connectWebSocket() {
    if (this.isConnecting) return;
    this.isConnecting = true;

    const wsUrl = 'wss://stream.bybit.com/v5/public/linear';
    console.log('[BybitStream] Connecting to Bybit Real-Time WebSocket...');
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      console.log('✅ [BybitStream] Connected to Bybit Real-Time WebSocket. Subscribing to 1m kline feeds...');
      this.isConnecting = false;

      // Subscribe to 1-minute klines for top Bybit symbols
      const topSymbols = this.symbols.length > 0 ? this.symbols : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'PEPEUSDT', 'DOGEUSDT'];
      
      const args1 = topSymbols.slice(0, 30).map(s => `kline.1.${s}`);
      this.ws.send(JSON.stringify({ op: 'subscribe', args: args1 }));

      if (topSymbols.length > 30) {
        const args2 = topSymbols.slice(30, 60).map(s => `kline.1.${s}`);
        this.ws.send(JSON.stringify({ op: 'subscribe', args: args2 }));
      }

      // Start Ping keep-alive every 20 seconds (Prevents Bybit WebSocket disconnect)
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ op: 'ping' }));
        }
      }, 20000);
    });

    this.ws.on('message', (data) => {
      try {
        const json = JSON.parse(data);
        if (json && json.topic && json.topic.startsWith('kline.1.') && json.data) {
          const kArray = json.data;
          if (Array.isArray(kArray) && kArray.length > 0) {
            const k = kArray[0];
            const topicSymbol = json.topic.replace('kline.1.', '');
            const openPrice = parseFloat(k.open || 0);
            const closePrice = parseFloat(k.close || 0);
            // Turnover in USDT (fallback to volume * closePrice if turnover is missing)
            const volume = parseFloat(k.turnover || 0) || (parseFloat(k.volume || 0) * closePrice);
            const candleTime = parseInt(k.start || 0, 10);
            const confirm = k.confirm;

            if (closePrice > 0) {
              this.onTickerUpdate({
                exchange: 'Bybit',
                symbol: topicSymbol,
                price: closePrice,
                openPrice: openPrice,
                high: parseFloat(k.high || closePrice),
                low: parseFloat(k.low || closePrice),
                volume: volume,
                isClosed: confirm,
                candleTime: candleTime,
                timestamp: new Date()
              });
            }
          }
        }
      } catch (err) {
        // parse error ignored
      }
    });

    this.ws.on('error', (err) => {
      console.error('[BybitStream] WebSocket error:', err.message);
    });

    this.ws.on('close', () => {
      console.warn('[BybitStream] Connection closed. Reconnecting in 5s...');
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

module.exports = BybitStreamService;
