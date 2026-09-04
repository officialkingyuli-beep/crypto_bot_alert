const fs = require('fs');
const path = require('path');

/**
 * Enterprise Anti-Spam & Intelligent Cooldown Tracker
 * Supports persistent state across restarts and state-change bypasses.
 */
class CooldownTracker {
  constructor(options = {}) {
    this.storagePath = options.storagePath || path.join(__dirname, '../../data/cooldown_state.json');
    this.cooldownMinutes = options.cooldownMinutes || 15;
    this.minSymbolIntervalMs = (options.minSymbolIntervalMinutes || 4) * 60 * 1000; // Mínimo 4 min por moneda
    this.globalSpacerMs = (options.globalSpacerSeconds || 30) * 1000; // Mínimo 30s entre cualquier alerta en el canal
    this.lastGlobalAlertTime = 0;
    this.onLog = options.onLog || console.log;
    this.states = new Map(); // symbol -> { lastAlertTime, state, side, price }
    
    this.initStorage();
    this.loadFromDisk();
  }

  initStorage() {
    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (err) {
        this.onLog(`[CooldownTracker] Advertencia creando carpeta de datos: ${err.message}`);
      }
    }
  }

  loadFromDisk() {
    if (fs.existsSync(this.storagePath)) {
      try {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        const data = JSON.parse(raw);
        const now = Date.now();
        const maxRetentionMs = 24 * 60 * 60 * 1000; // Limpiar entradas con más de 24h

        for (const [sym, info] of Object.entries(data)) {
          if (now - (info.lastAlertTime || 0) < maxRetentionMs) {
            this.states.set(sym.toUpperCase(), info);
          }
        }
        this.onLog(`💾 [CooldownTracker] ${this.states.size} estados de símbolos cargados exitosamente desde disco.`);
      } catch (err) {
        this.onLog(`[CooldownTracker] Error leyendo estados de disco: ${err.message}. Iniciando en memoria.`);
      }
    }
  }

  saveToDisk() {
    try {
      const obj = {};
      for (const [sym, info] of this.states.entries()) {
        obj[sym] = info;
      }
      fs.writeFileSync(this.storagePath, JSON.stringify(obj, null, 2), 'utf8');
    } catch (err) {
      this.onLog(`[CooldownTracker] Error persistiendo cooldowns: ${err.message}`);
    }
  }

  /**
   * Checks if an alert can be triggered
   * @param {Object} params
   * @param {string} params.symbol - Asset symbol
   * @param {string} params.state - 'OBSERVATION' | 'ACTIVE_ENTRY' | 'INVALIDATED'
   * @param {string} params.side - 'BULLISH' | 'BEARISH'
   * @param {number} [params.cooldownMinutes] - Optional override
   * @returns {Object} { allowed: boolean, reason: string, remainingMinutes: number }
   */
  canTriggerAlert({ symbol, state, side, cooldownMinutes = null }) {
    const cleanSym = symbol.toUpperCase();
    const now = Date.now();

    // 1. Candado Global Anti-Avalancha: Mínimo 30 segundos entre alertas en Discord
    const timeSinceLastGlobal = now - this.lastGlobalAlertTime;
    if (timeSinceLastGlobal < this.globalSpacerMs) {
      return {
        allowed: false,
        reason: 'GLOBAL_SPACER_ACTIVE',
        remainingSeconds: Math.ceil((this.globalSpacerMs - timeSinceLastGlobal) / 1000)
      };
    }

    const effectiveCooldownMs = (cooldownMinutes || this.cooldownMinutes) * 60 * 1000;
    const previous = this.states.get(cleanSym);

    // Caso 1: Primera vez que se detecta el símbolo
    if (!previous) {
      return { allowed: true, reason: 'INITIAL_SIGNAL', remainingMinutes: 0 };
    }

    // 2. Candado Absoluto por Símbolo: Mínimo 4 minutos para la misma moneda
    const elapsedMs = now - previous.lastAlertTime;
    if (elapsedMs < this.minSymbolIntervalMs) {
      return {
        allowed: false,
        reason: 'MIN_SYMBOL_INTERVAL_ACTIVE',
        remainingMinutes: parseFloat(((this.minSymbolIntervalMs - elapsedMs) / 60000).toFixed(1))
      };
    }

    // Caso 2: Transición Válida Unidireccional (OBSERVATION -> ACTIVE_ENTRY o INVALIDATED)
    const isStateUpgrade = (previous.state === 'OBSERVATION' && state === 'ACTIVE_ENTRY');
    const isInvalidation = (state === 'INVALIDATED');

    if (isStateUpgrade || isInvalidation) {
      return {
        allowed: true,
        reason: 'STATE_TRANSITION_BYPASS',
        previousState: previous.state,
        newState: state,
        remainingMinutes: 0
      };
    }

    // Caso 3: Alerta en el mismo estado -> Aplicar Cooldown estricto (15 min)
    if (elapsedMs < effectiveCooldownMs) {
      const remainingMs = effectiveCooldownMs - elapsedMs;
      return {
        allowed: false,
        reason: 'COOLDOWN_ACTIVE',
        remainingMinutes: parseFloat((remainingMs / 60000).toFixed(1)),
        lastAlertTime: previous.lastAlertTime
      };
    }

    return { allowed: true, reason: 'COOLDOWN_EXPIRED', remainingMinutes: 0 };
  }

  /**
   * Records newly emitted alert state
   */
  recordAlert({ symbol, state, side, price, timestamp = Date.now() }) {
    const cleanSym = symbol.toUpperCase();
    this.lastGlobalAlertTime = timestamp;
    this.states.set(cleanSym, {
      lastAlertTime: timestamp,
      state: state || 'ACTIVE_ENTRY',
      side: side || 'BULLISH',
      price: price || 0
    });
    this.saveToDisk();
  }

  getState(symbol) {
    return this.states.get(symbol.toUpperCase()) || null;
  }
}

module.exports = CooldownTracker;
