const express = require('express');
const http = require('http');
const config = require('./config');
const BinanceStreamService = require('./services/binanceStream');
const BybitStreamService = require('./services/bybitStream');
const OkxStreamService = require('./services/okxStream');
const SignalDetector = require('./services/signalDetector');
const DiscordBotClient = require('./bot/discordClient');
const TradeTracker = require('./services/tradeTracker');

// In-Memory Live Event Stream (Allows live audit without viewing Render logs)
const recentEvents = [];
function logEvent(msg) {
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  const entry = `[${time}] ${msg}`;
  recentEvents.push(entry);
  if (recentEvents.length > 25) recentEvents.shift();
  process.stdout.write(entry + '\n');
}

logEvent('🚀 CRYPTO BOT ALERT 2.0 - ALPHA MARKET INTELLIGENCE SYSTEM');

// 1. Initialize Discord Bot Client
const discordBot = new DiscordBotClient(logEvent);

// 2. Initialize Automated Trade Tracking Engine (Requerimiento 5)
const tradeTracker = new TradeTracker({
  onTradeUpdate: (trade) => {
    logEvent(`🎯 [TRADE RESULT] ${trade.symbol} ${trade.status} (${trade.pnlPct >= 0 ? '+' : ''}${trade.pnlPct.toFixed(2)}%)`);
    discordBot.sendTradeUpdate(trade);
  },
  onLog: logEvent
});

// 3. Initialize Signal Analytics Engine
const signalDetector = new SignalDetector((alertSignal) => {
  logEvent(`⚡ [SIGNAL DISPATCHED] ${alertSignal.type} on ${alertSignal.symbol} (${alertSignal.priceChangePct.toFixed(2)}% | Vol: ${alertSignal.volumeMultiplier.toFixed(1)}x | State: ${alertSignal.state})`);
  discordBot.sendAlert(alertSignal);

  // Register in automated trade tracking engine if active entry
  if (alertSignal.state === 'ACTIVE_ENTRY') {
    tradeTracker.registerTrade(alertSignal);
  }
});

// 4. Initialize Exchange WebSocket Streams
let totalTickersProcessed = 0;
let lastMinuteTickers = 0;
let topRecentMove = { symbol: 'BTCUSDT', changePct: 0 };

function handleTicker(tickerData) {
  totalTickersProcessed++;
  lastMinuteTickers++;
  
  if (tickerData.price && tickerData.openPrice && tickerData.openPrice > 0) {
    const chg = ((tickerData.price - tickerData.openPrice) / tickerData.openPrice) * 100;
    if (Math.abs(chg) > Math.abs(topRecentMove.changePct)) {
      topRecentMove = { symbol: tickerData.symbol, changePct: chg };
    }
  }

  // 1. Evaluate Quantitative Signals
  signalDetector.processTickerData(tickerData);

  // 2. Monitor Active Trades against TP1, TP2, SL, Invalidation
  if (tickerData.price && tickerData.symbol) {
    tradeTracker.processPriceUpdate(
      tickerData.symbol,
      tickerData.price,
      tickerData.high,
      tickerData.low
    );
  }
}

const binanceStream = new BinanceStreamService(handleTicker);
const bybitStream = new BybitStreamService(handleTicker);
const okxStream = new OkxStreamService(handleTicker);

// 4. Express Server for Health Checks & Webhooks
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    status: 'ONLINE',
    botName: 'Crypto Alert Bot 2.0',
    system: 'Alpha Market Intelligence System',
    alertsProcessed: discordBot.alertCount,
    activeTrades: tradeTracker.getActiveTradesCount(),
    tickersProcessed: totalTickersProcessed,
    uptime: process.uptime(),
    botClientReady: discordBot.isReady,
    botUser: discordBot.client.user?.tag || null,
    botLastError: discordBot.lastError,
    tokenLength: config.discord.token ? config.discord.token.length : 0,
    targetChannel: config.discord.vipChannelId || '1470787821181866046',
    activeConfig: {
      minPriceChangePct: config.scanner.minPriceChangePct,
      minVolumeMultiplier: config.scanner.minVolumeMultiplier,
      rsiOverbought: config.scanner.rsiOverbought,
      rsiOversold: config.scanner.rsiOversold,
      atrMultiplier: config.scanner.atrMultiplier,
      timeframe: config.scanner.timeframe
    },
    recentEvents: recentEvents
  });
});

// Start Web Server
app.listen(config.server.port, () => {
  logEvent(`🌐 [Server] Health & Webhook API running on port ${config.server.port}`);
  
  // Auto Keep-Alive Self Ping every 3 minutes (Prevents Render Free Inactivity Sleep)
  setInterval(() => {
    http.get(`http://localhost:${config.server.port}/`, () => {}).on('error', () => {});
  }, 3 * 60 * 1000);

  // Active Real-Time Market Scan Logger every 60 seconds (Flushes immediately)
  setInterval(() => {
    const mins = Math.floor(process.uptime() / 60);
    logEvent(`📊 [Live Market Scan - Min ${mins}] Ticks/min: ${lastMinuteTickers} | Total: ${totalTickersProcessed} | Top Move: ${topRecentMove.symbol} (${topRecentMove.changePct >= 0 ? '+' : ''}${topRecentMove.changePct.toFixed(2)}%) | Alerts: ${discordBot.alertCount}`);
    lastMinuteTickers = 0;
    topRecentMove = { symbol: 'BTCUSDT', changePct: 0 };
  }, 60 * 1000);
});

// 5. Start Engine & Connections in Parallel
async function main() {
  logEvent('✅ [System Ready] Starting parallel connections to Discord, Binance, Bybit & Global Feeds...');
  
  discordBot.start().catch(err => logEvent('❌ [DiscordBot Error] ' + err.message));
  binanceStream.start().catch(err => logEvent('❌ [BinanceStream Error] ' + err.message));
  bybitStream.start().catch(err => logEvent('❌ [BybitStream Error] ' + err.message));
  okxStream.start().catch(err => logEvent('❌ [OKXStream Error] ' + err.message));
}

main().catch(err => {
  console.error('❌ [Fatal Error]', err);
});
