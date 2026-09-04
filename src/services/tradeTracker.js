const fs = require('fs');
const path = require('path');

/**
 * Enterprise Trade Tracking Engine (Requerimiento 5)
 * Tracks active momentum trades in real-time until TP1, TP2, SL, Invalidation, or Expiration.
 * Persists open trades and closed history to disk.
 */
class TradeTracker {
  constructor(options = {}) {
    this.dataDir = options.dataDir || path.join(__dirname, '../../data');
    this.activeTradesFile = path.join(this.dataDir, 'active_trades.json');
    this.historyFile = path.join(this.dataDir, 'trade_history.json');
    this.maxDurationMs = options.maxDurationMs || (4 * 60 * 60 * 1000); // 4 Hours default expiration
    this.onTradeUpdate = options.onTradeUpdate || (() => {});
    this.onLog = options.onLog || console.log;

    // In-memory Map: tradeId -> tradeObject
    this.activeTrades = new Map();
    this.ensureDataDir();
    this.loadState();
  }

  ensureDataDir() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
    } catch (e) {
      this.onLog('⚠️ [TradeTracker] No se pudo crear directorio data: ' + e.message);
    }
  }

  loadState() {
    try {
      if (fs.existsSync(this.activeTradesFile)) {
        const raw = fs.readFileSync(this.activeTradesFile, 'utf-8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const trade of list) {
            this.activeTrades.set(trade.id, trade);
          }
          this.onLog(`📂 [TradeTracker] Recargados ${this.activeTrades.size} trades activos desde disco.`);
        }
      }
    } catch (e) {
      this.onLog('⚠️ [TradeTracker] Error al cargar active_trades.json: ' + e.message);
    }
  }

  saveActiveTrades() {
    try {
      const list = Array.from(this.activeTrades.values());
      fs.writeFileSync(this.activeTradesFile, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e) {
      this.onLog('⚠️ [TradeTracker] Error al guardar active_trades.json: ' + e.message);
    }
  }

  recordHistory(trade) {
    try {
      let history = [];
      if (fs.existsSync(this.historyFile)) {
        const raw = fs.readFileSync(this.historyFile, 'utf-8');
        history = JSON.parse(raw);
        if (!Array.isArray(history)) history = [];
      }
      history.push(trade);
      // Keep last 500 closed trades to maintain small file size
      if (history.length > 500) {
        history = history.slice(-500);
      }
      fs.writeFileSync(this.historyFile, JSON.stringify(history, null, 2), 'utf-8');
    } catch (e) {
      this.onLog('⚠️ [TradeTracker] Error al guardar trade_history.json: ' + e.message);
    }
  }

  /**
   * Registers a new active trade from an alert
   */
  registerTrade(alertData) {
    const symbol = alertData.symbol.toUpperCase();
    const side = alertData.side || 'BULLISH';
    const entryPrice = alertData.price;
    const tradeLevels = alertData.quant ? alertData.quant.tradeLevels : {};

    const stopLoss = tradeLevels.suggestedStopLoss || (side === 'BULLISH' ? entryPrice * 0.985 : entryPrice * 1.015);
    const takeProfit1 = tradeLevels.takeProfit1 || (side === 'BULLISH' ? entryPrice * 1.02 : entryPrice * 0.98);
    const takeProfit2 = tradeLevels.takeProfit2 || (side === 'BULLISH' ? entryPrice * 1.04 : entryPrice * 0.96);
    const invalidationPrice = tradeLevels.invalidationPrice || stopLoss;

    const tradeId = `${symbol}_${Date.now()}`;
    const trade = {
      id: tradeId,
      symbol,
      side,
      entryPrice,
      currentPrice: entryPrice,
      stopLoss,
      takeProfit1,
      takeProfit2,
      invalidationPrice,
      status: 'OPEN', // 'OPEN' | 'TP1_HIT' | 'WIN' | 'LOSS' | 'INVALIDATED' | 'EXPIRED'
      tp1Hit: false,
      entryTime: Date.now(),
      closeTime: null,
      maxDurationMs: this.maxDurationMs,
      pnlPct: 0.0,
      exitReason: null,
      exchange: alertData.exchange || 'Bybit / Binance'
    };

    this.activeTrades.set(tradeId, trade);
    this.saveActiveTrades();
    this.onLog(`🎯 [TradeTracker] Trade registrado: ${symbol} (${side} @ $${entryPrice}) | TP1: $${takeProfit1.toFixed(4)} | SL: $${stopLoss.toFixed(4)}`);
    return trade;
  }

  /**
   * Process price updates against open trades
   */
  processPriceUpdate(symbol, currentPrice, high = null, low = null) {
    const cleanSymbol = symbol.toUpperCase();
    const now = Date.now();
    const highPrice = high || currentPrice;
    const lowPrice = low || currentPrice;

    for (const [id, trade] of this.activeTrades.entries()) {
      if (trade.symbol !== cleanSymbol) continue;

      trade.currentPrice = currentPrice;
      const isBull = trade.side === 'BULLISH';

      // 1. Check Take Profit 2 (WIN Completo)
      const hitTp2 = isBull ? (highPrice >= trade.takeProfit2) : (lowPrice <= trade.takeProfit2);
      if (hitTp2) {
        trade.status = 'WIN';
        trade.closeTime = now;
        trade.pnlPct = isBull
          ? ((trade.takeProfit2 - trade.entryPrice) / trade.entryPrice) * 100
          : ((trade.entryPrice - trade.takeProfit2) / trade.entryPrice) * 100;
        trade.exitReason = 'TP2_HIT';

        this.activeTrades.delete(id);
        this.saveActiveTrades();
        this.recordHistory(trade);
        this.onLog(`🏆 [TradeTracker WIN] ${trade.symbol} alcanzó TP2 (+${trade.pnlPct.toFixed(2)}%)!`);
        this.onTradeUpdate(trade);
        continue;
      }

      // 2. Check Take Profit 1 (Ganancia Parcial)
      const hitTp1 = isBull ? (highPrice >= trade.takeProfit1) : (lowPrice <= trade.takeProfit1);
      if (hitTp1 && !trade.tp1Hit) {
        trade.tp1Hit = true;
        trade.status = 'TP1_HIT';
        const tp1Pnl = isBull
          ? ((trade.takeProfit1 - trade.entryPrice) / trade.entryPrice) * 100
          : ((trade.entryPrice - trade.takeProfit1) / trade.entryPrice) * 100;

        this.saveActiveTrades();
        this.onLog(`🎯 [TradeTracker TP1] ${trade.symbol} alcanzó TP1 (+${tp1Pnl.toFixed(2)}%)!`);
        this.onTradeUpdate({ ...trade, pnlPct: tp1Pnl });
      }

      // 3. Check Stop Loss
      const hitSl = isBull ? (lowPrice <= trade.stopLoss) : (highPrice >= trade.stopLoss);
      if (hitSl) {
        trade.status = 'LOSS';
        trade.closeTime = now;
        trade.pnlPct = isBull
          ? ((trade.stopLoss - trade.entryPrice) / trade.entryPrice) * 100
          : ((trade.entryPrice - trade.stopLoss) / trade.entryPrice) * 100;
        trade.exitReason = 'STOP_LOSS_HIT';

        this.activeTrades.delete(id);
        this.saveActiveTrades();
        this.recordHistory(trade);
        this.onLog(`🛑 [TradeTracker LOSS] ${trade.symbol} ejecutó SL (${trade.pnlPct.toFixed(2)}%)!`);
        this.onTradeUpdate(trade);
        continue;
      }

      // 4. Check Technical Invalidation
      const hitInvalidation = isBull ? (lowPrice <= trade.invalidationPrice) : (highPrice >= trade.invalidationPrice);
      if (hitInvalidation) {
        trade.status = 'INVALIDATED';
        trade.closeTime = now;
        trade.pnlPct = isBull
          ? ((trade.invalidationPrice - trade.entryPrice) / trade.entryPrice) * 100
          : ((trade.entryPrice - trade.invalidationPrice) / trade.entryPrice) * 100;
        trade.exitReason = 'TECHNICAL_INVALIDATION';

        this.activeTrades.delete(id);
        this.saveActiveTrades();
        this.recordHistory(trade);
        this.onLog(`🚫 [TradeTracker INVALIDATED] ${trade.symbol} violó la estructura técnica (${trade.pnlPct.toFixed(2)}%)!`);
        this.onTradeUpdate(trade);
        continue;
      }

      // 5. Check Time Expiration (e.g. 4 Hours)
      if (now - trade.entryTime > trade.maxDurationMs) {
        trade.status = 'EXPIRED';
        trade.closeTime = now;
        trade.pnlPct = isBull
          ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
          : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
        trade.exitReason = 'TIME_EXPIRED';

        this.activeTrades.delete(id);
        this.saveActiveTrades();
        this.recordHistory(trade);
        this.onLog(`⌛ [TradeTracker EXPIRED] ${trade.symbol} tiempo límite superado (${trade.pnlPct.toFixed(2)}%)!`);
        this.onTradeUpdate(trade);
        continue;
      }
    }
  }

  getActiveTradesCount() {
    return this.activeTrades.size;
  }
}

module.exports = TradeTracker;
