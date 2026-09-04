const WebSocket = require('ws');

class OkxStreamService {
  constructor(onTickerUpdate) {
    this.onTickerUpdate = onTickerUpdate;
    this.ws = null;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.isConnecting = false;
    
    // Strict Whitelist of the Top 35 Most Liquid, Highly-Traded Futures Pairs
    this.symbols = [
      'BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP', 'PEPE-USDT-SWAP', 'DOGE-USDT-SWAP',
      'XRP-USDT-SWAP', 'SHIB-USDT-SWAP', 'NEAR-USDT-SWAP', 'SUI-USDT-SWAP', 'WIF-USDT-SWAP',
      'FLOKI-USDT-SWAP', 'BONK-USDT-SWAP', 'AVAX-USDT-SWAP', 'LINK-USDT-SWAP', 'ADA-USDT-SWAP',
      'BCH-USDT-SWAP', 'LTC-USDT-SWAP', 'TRX-USDT-SWAP', 'DOT-USDT-SWAP', 'MATIC-USDT-SWAP',
      'UNI-USDT-SWAP', 'TAO-USDT-SWAP', 'WLD-USDT-SWAP', 'APT-USDT-SWAP', 'ARB-USDT-SWAP',
      'OP-USDT-SWAP', 'INJ-USDT-SWAP', 'TIA-USDT-SWAP', 'FET-USDT-SWAP', 'RENDER-USDT-SWAP',
      'KAS-USDT-SWAP', 'RUNE-USDT-SWAP', 'SEI-USDT-SWAP', 'STX-USDT-SWAP', 'GALA-USDT-SWAP'
    ];
  }

  async start() {
    console.log(`[OKXStream] Initializing Real-Time Feed for Top ${this.symbols.length} Curated High-Liquidity Cryptos...`);
    this.connectWebSocket();
  }

  connectWebSocket() {
    if (this.isConnecting) return;
    this.isConnecting = true;

    const wsUrl = 'wss://ws.okx.com:8443/ws/v5/business';
    console.log('[OKXStream] Connecting to OKX Business WebSocket for 1m Candles...');
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      console.log(`✅ [OKXStream] Connected! Subscribed to 1m Candles for ${this.symbols.length} pairs...`);
      this.isConnecting = false;

      // Subscribe to 1m candles for curated pairs
      const args = this.symbols.map(instId => ({ channel: 'candle1m', instId }));
      this.ws.send(JSON.stringify({ op: 'subscribe', args }));

      // Ping keep alive every 20s
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send('ping');
        }
      }, 20000);
    });

    this.ws.on('message', (data) => {
      try {
        const str = data.toString();
        if (str === 'pong') return;

        const json = JSON.parse(str);
        if (json && json.arg && json.arg.channel === 'candle1m' && Array.isArray(json.data) && json.data.length > 0) {
          const instId = json.arg.instId;
          if (!instId) return;

          const c = json.data[0];
          // OKX 1m candle array: [ts, open, high, low, close, volContracts, volCoins, volQuoteUSDT, confirm]
          const symbol = instId.replace('-USDT-SWAP', 'USDT').replace('-', '');
          const openPrice = parseFloat(c[1] || 0);
          const highPrice = parseFloat(c[2] || openPrice);
          const lowPrice = parseFloat(c[3] || openPrice);
          const closePrice = parseFloat(c[4] || 0);
          // Field 7 is volCcyQuote: 1-minute Turnover in USDT (Quote currency)
          // Fallback to volCoins * closePrice if volCcyQuote is missing
          const volumeQuote = parseFloat(c[7] || 0) || (parseFloat(c[6] || 0) * closePrice);
          const isClosed = c[8] === '1';
          const candleTime = parseInt(c[0] || Date.now(), 10);

          if (closePrice > 0) {
            this.onTickerUpdate({
              exchange: 'Bybit / Binance',
              symbol: symbol,
              price: closePrice,
              openPrice: openPrice,
              high: highPrice,
              low: lowPrice,
              volume: volumeQuote,
              isClosed: isClosed,
              candleTime: candleTime,
              timestamp: new Date()
            });
          }
        }
      } catch (err) {}
    });

    this.ws.on('error', (err) => {
      console.error('[OKXStream] WebSocket error:', err.message);
    });

    this.ws.on('close', () => {
      console.warn('[OKXStream] Connection closed. Reconnecting in 5s...');
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

module.exports = OkxStreamService;
