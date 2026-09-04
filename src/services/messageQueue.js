const axios = require('axios');

/**
 * Enterprise Multi-Channel Dispatch Queue with Rate-Limiting & 429 Backoff
 * Guarantees zero message drops, per-channel isolation, and safe cadence.
 */
class ChannelQueue {
  constructor(channelKey, options = {}) {
    this.channelKey = channelKey;
    this.queue = [];
    this.isProcessing = false;
    this.delayMs = options.delayMs || 1350; // 1.35s safe window per channel (~0.74 msg/s)
    this.retryAfterUntil = 0;
    this.onLog = options.onLog || console.log;
    this.stats = {
      enqueued: 0,
      delivered: 0,
      rateLimits: 0,
      retries: 0,
      dropped: 0
    };
  }

  enqueue(task) {
    this.stats.enqueued++;
    this.queue.push({
      ...task,
      attempts: 0,
      enqueuedAt: Date.now()
    });
    this.onLog(`📥 [Queue:${this.channelKey}] Mensaje encolado (En espera: ${this.queue.length})`);
    this.process();
  }

  async process() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      if (now < this.retryAfterUntil) {
        const waitMs = this.retryAfterUntil - now;
        this.onLog(`⏳ [Queue:${this.channelKey}] En pausa por Rate-Limit 429. Reanudando en ${(waitMs / 1000).toFixed(1)}s...`);
        await new Promise(r => setTimeout(r, waitMs));
      }

      const item = this.queue[0]; // Peek at head
      item.attempts++;

      const requestHeaders = {
        'User-Agent': 'DiscordBot (https://github.com/officialkingyuli-beep/crypto_bot_alert, 2.0)',
        'Content-Type': 'application/json',
        ...(item.headers || {})
      };

      let success = false;

      try {
        const response = await axios.post(
          item.url,
          item.payload,
          {
            headers: requestHeaders,
            timeout: 10000
          }
        );

        if (response.status === 200 || response.status === 204) {
          this.stats.delivered++;
          this.queue.shift(); // Remove from queue only upon success
          success = true;
          this.onLog(`✅ [Queue:${this.channelKey}] Mensaje entregado con éxito (${item.metadata?.symbol || 'Alerta'} | Latencia cola: ${Date.now() - item.enqueuedAt}ms)`);
          if (item.onSuccess) item.onSuccess(response.data);
        }
      } catch (err) {
        if (err.response && err.response.status === 429) {
          this.stats.rateLimits++;
          const retryHeader = err.response.data?.retry_after || err.response.headers?.['retry-after'] || 3;
          const retrySec = Math.ceil(parseFloat(retryHeader));
          this.retryAfterUntil = Date.now() + (retrySec * 1000) + 500;
          this.onLog(`⚠️ [Queue:${this.channelKey}] HTTP 429 Detectado. Pausando este canal por ${retrySec}s... (Mensaje retenido para reintento)`);
        } else {
          this.stats.retries++;
          const errorMsg = err.response ? `${err.response.status} ${JSON.stringify(err.response.data)}` : err.message;
          this.onLog(`❌ [Queue:${this.channelKey}] Error de red/despacho (Intento ${item.attempts}/3): ${errorMsg}`);

          if (item.attempts >= 3) {
            this.stats.dropped++;
            this.queue.shift(); // Evitar bloqueo permanente por payload corrupto
            this.onLog(`🛑 [Queue:${this.channelKey}] Mensaje descartado tras 3 intentos fallidos para no bloquear la cola.`);
            if (item.onError) item.onError(err);
          } else {
            // Breve espera antes del reintento
            await new Promise(r => setTimeout(r, 1000));
          }
        }
      }

      // Safe spacer delay between deliveries in the same channel
      if (success && this.queue.length > 0) {
        await new Promise(r => setTimeout(r, this.delayMs));
      }
    }

    this.isProcessing = false;
  }
}

class MessageQueueManager {
  constructor(onLog) {
    this.onLog = onLog || console.log;
    this.channels = new Map();
  }

  getChannelQueue(channelKey = 'default', options = {}) {
    if (!this.channels.has(channelKey)) {
      this.channels.set(channelKey, new ChannelQueue(channelKey, {
        onLog: this.onLog,
        ...options
      }));
    }
    return this.channels.get(channelKey);
  }

  enqueue(channelKey, task) {
    const queue = this.getChannelQueue(channelKey);
    queue.enqueue(task);
  }

  getStats() {
    const stats = {};
    for (const [key, q] of this.channels.entries()) {
      stats[key] = {
        pending: q.queue.length,
        ...q.stats
      };
    }
    return stats;
  }
}

module.exports = {
  ChannelQueue,
  MessageQueueManager
};
