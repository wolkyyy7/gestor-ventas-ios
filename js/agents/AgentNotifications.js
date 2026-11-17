/**
 * Agente de Notificaciones Push Instantáneas (iPhone / ntfy.sh)
 *
 * Responsable de enviar notificaciones push instantáneas al iPhone del jefe
 * mediante ntfy.sh cuando un trabajador o el propio jefe registra una venta,
 * reserva o alerta de stock bajo.
 *
 * Soporta auto-vinculación transparente mediante el parámetro URL `?sync=<topic>`
 * para que los trabajadores queden conectados al canal del jefe al abrir su enlace.
 */

const STORAGE_KEY_NTFY = 'gv_ntfy_settings';

export class AgentNotifications {
  constructor(storageAgent = null) {
    this.storage = storageAgent;
    this.settings = this._loadOrInitializeSettings();
  }

  /**
   * Genera un código de canal único y privado para el jefe.
   */
  _generateDefaultTopic() {
    const randomPart = Math.random().toString(36).substring(2, 8);
    return `vapeos-jefe-${randomPart}`;
  }

  /**
   * Carga los ajustes desde localStorage o crea la configuración inicial por defecto.
   */
  _loadOrInitializeSettings() {
    const defaults = {
      enabled: true,
      topic: this._generateDefaultTopic(),
      serverUrl: 'https://ntfy.sh',
      notifyWorkerSales: true,
      notifyBossSales: true,
      notifyReservations: true,
      notifyLowStock: true
    };

    try {
      const raw = localStorage.getItem(STORAGE_KEY_NTFY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const rawTopic = (parsed.topic && String(parsed.topic).trim()) ? String(parsed.topic).trim().replace(/[^a-zA-Z0-9_-]/g, '') : '';
        const merged = {
          ...defaults,
          ...parsed,
          topic: rawTopic || defaults.topic,
          serverUrl: (parsed.serverUrl && String(parsed.serverUrl).trim())
            ? String(parsed.serverUrl).trim().replace(/\/+$/, '')
            : defaults.serverUrl
        };
        localStorage.setItem(STORAGE_KEY_NTFY, JSON.stringify(merged));
        return merged;
      }
    } catch (err) {
      console.warn('AgentNotifications: Error leyendo ajustes de localStorage:', err);
    }

    try {
      localStorage.setItem(STORAGE_KEY_NTFY, JSON.stringify(defaults));
    } catch (err) {
      console.warn('AgentNotifications: No se pudo guardar configuración inicial:', err);
    }

    return defaults;
  }

  /**
   * Inicializa los ajustes y detecta si la URL incluye `?sync=<topic>` para
   * adoptar automáticamente el canal ntfy del jefe en el móvil del trabajador.
   */
  async init() {
    this.settings = this._loadOrInitializeSettings();

    try {
      if (typeof window !== 'undefined' && window.location && window.location.search) {
        const params = new URLSearchParams(window.location.search);
        const syncTopic = params.get('sync');
        if (syncTopic && syncTopic.trim()) {
          const cleanTopic = syncTopic.trim().replace(/[^a-zA-Z0-9_-]/g, '');
          if (cleanTopic) {
            this.saveSettings({
              ...this.settings,
              enabled: true,
              topic: cleanTopic
            });
          }
        }
      }
    } catch (err) {
      console.warn('AgentNotifications: No se pudo procesar parámetro ?sync= de la URL:', err);
    }

    return this;
  }

  /**
   * Devuelve una copia de los ajustes actuales de notificaciones.
   */
  getSettings() {
    const s = this.settings || this._loadOrInitializeSettings();
    return {
      enabled: Boolean(s.enabled),
      topic: String(s.topic || ''),
      serverUrl: String(s.serverUrl || 'https://ntfy.sh').replace(/\/+$/, ''),
      notifyWorkerSales: s.notifyWorkerSales !== false,
      notifyBossSales: s.notifyBossSales !== false,
      notifyReservations: s.notifyReservations !== false,
      notifyLowStock: s.notifyLowStock !== false
    };
  }

  /**
   * Actualiza y guarda la configuración en localStorage ('gv_ntfy_settings').
   */
  saveSettings(newSettings = {}) {
    const current = this.getSettings();
    const cleanTopic = newSettings.topic !== undefined
      ? String(newSettings.topic).trim().replace(/[^a-zA-Z0-9_-]/g, '')
      : current.topic;

    const cleanServerUrl = newSettings.serverUrl !== undefined
      ? String(newSettings.serverUrl).trim().replace(/\/+$/, '') || 'https://ntfy.sh'
      : current.serverUrl;

    const updated = {
      enabled: newSettings.enabled !== undefined ? Boolean(newSettings.enabled) : current.enabled,
      topic: cleanTopic || this._generateDefaultTopic(),
      serverUrl: cleanServerUrl,
      notifyWorkerSales: newSettings.notifyWorkerSales !== undefined
        ? Boolean(newSettings.notifyWorkerSales)
        : current.notifyWorkerSales,
      notifyBossSales: newSettings.notifyBossSales !== undefined
        ? Boolean(newSettings.notifyBossSales)
        : current.notifyBossSales,
      notifyReservations: newSettings.notifyReservations !== undefined
        ? Boolean(newSettings.notifyReservations)
        : current.notifyReservations,
      notifyLowStock: newSettings.notifyLowStock !== undefined
        ? Boolean(newSettings.notifyLowStock)
        : current.notifyLowStock
    };

    this.settings = updated;
    try {
      localStorage.setItem(STORAGE_KEY_NTFY, JSON.stringify(updated));
    } catch (err) {
      console.warn('AgentNotifications: Error al guardar ajustes en localStorage:', err);
    }

    return this.getSettings();
  }

  /**
   * Publica un mensaje push en ntfy.sh enviando un POST JSON al endpoint raíz.
   * Usar JSON en el cuerpo evita errores ISO-8859-1 con emojis y tildes en Safari/iOS.
   */
  async _postToNtfy({ title, message, priority = 4, tags = ['iphone'] }) {
    const settings = this.getSettings();
    if (!settings.topic) {
      return { sent: false, reason: 'missing_topic' };
    }

    const endpoint = settings.serverUrl || 'https://ntfy.sh';
    const payload = {
      topic: settings.topic,
      title,
      message,
      priority,
      tags
    };

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        return {
          sent: false,
          status: response.status,
          reason: `http_${response.status}`,
          error: `Error HTTP ${response.status} al enviar a ntfy`
        };
      }

      return {
        sent: true,
        topic: settings.topic
      };
    } catch (err) {
      console.warn('AgentNotifications: Error de red enviando push a ntfy.sh:', err);
      return {
        sent: false,
        reason: 'network_error',
        error: err?.message || String(err)
      };
    }
  }

  /**
   * Envía una notificación push instantánea al iPhone cuando se registra una venta.
   */
  async notifySale({
    sale,
    warehouse = null,
    remainingStock = 0,
    workerPendingFreeVapers = 0,
    workerProgressText = '',
    isWorkerSession = false
  } = {}) {
    const settings = this.getSettings();
    if (!settings.enabled || !settings.topic || !sale) {
      return { sent: false };
    }

    if (isWorkerSession && !settings.notifyWorkerSales) {
      return { sent: false, reason: 'worker_notifications_disabled' };
    }
    if (!isWorkerSession && !settings.notifyBossSales) {
      return { sent: false, reason: 'boss_notifications_disabled' };
    }

    const warehouseLabel = warehouse?.name || sale.warehouseName || 'Almacén';
    const grossFormatted = Number(sale.grossTotal || 0).toFixed(2);
    const title = `🔔 Venta en ${warehouseLabel}: +${grossFormatted}€`;

    const paymentStatusSuffix = sale.paymentStatus === 'pending' ? ' - ⏳ FIADO' : '';
    const workerOrWarehouseLabel =
      warehouse?.workerName || sale.workerName || warehouse?.name || 'Principal';

    const lines = [
      `📦 Producto: ${sale.quantity}x ${sale.productName}`,
      `💶 Cobro: ${grossFormatted}€ (${sale.paymentMethod || 'Efectivo'}${paymentStatusSuffix})`,
      `👤 Trabajador/Almacén: ${workerOrWarehouseLabel}`
    ];

    if (sale.buyerName || sale.notes) {
      const buyerText = sale.buyerName || 'Venta directa';
      const notesText = sale.notes ? ` | 📝 ${sale.notes}` : '';
      lines.push(`🧑 Cliente: ${buyerText}${notesText}`);
    }

    lines.push(`📉 Stock restante en este almacén: ${remainingStock} uds`);

    if (workerProgressText) {
      lines.push(
        `🎁 Comisión trabajador: ${workerProgressText} (Vapers regalo acumulados: ${workerPendingFreeVapers})`
      );
    }

    const message = lines.join('\n');
    const tags = ['moneybag', 'package'];
    if (remainingStock <= 3 && settings.notifyLowStock) {
      tags.push('warning');
    }

    return this._postToNtfy({
      title,
      message,
      priority: 4,
      tags
    });
  }

  /**
   * Envía una notificación push a ntfy.sh cuando se registra una reserva de cliente.
   */
  async notifyReservation({
    reservation,
    warehouse = null,
    remainingAvailable = null
  } = {}) {
    const settings = this.getSettings();
    if (!settings.enabled || !settings.topic || !settings.notifyReservations || !reservation) {
      return { sent: false };
    }

    const warehouseLabel = warehouse?.name || reservation.warehouseName || 'Almacén';
    const title = `📌 Nueva Reserva de ${reservation.customerName}: ${reservation.quantity}x ${reservation.productName} en ${warehouseLabel}`;

    const lines = [
      `🧑 Cliente: ${reservation.customerName}`,
      `📦 Producto apartado: ${reservation.quantity}x ${reservation.productName}`,
      `🏠 Almacén: ${warehouseLabel}`
    ];

    if (reservation.notes) {
      lines.push(`📝 Nota: ${reservation.notes}`);
    }
    if (remainingAvailable !== null && remainingAvailable !== undefined) {
      lines.push(`📉 Disponible tras reserva: ${remainingAvailable} uds`);
    }

    return this._postToNtfy({
      title,
      message: lines.join('\n'),
      priority: 4,
      tags: ['pushpin', 'package']
    });
  }

  /**
   * Envía una notificación de prueba inmediata al iPhone para verificar la conexión.
   */
  async sendTestNotification() {
    const settings = this.getSettings();
    if (!settings.topic) {
      return { success: false, error: 'No hay canal (topic) configurado.' };
    }

    const result = await this._postToNtfy({
      title: '✅ VapeOS Pro conectado con tu iPhone',
      message: '¡Funciona perfecto! Cada vez que un trabajador registre una venta o reserva en su almacén, recibirás un aviso instantáneo como este en tu iPhone.',
      priority: 4,
      tags: ['white_check_mark', 'iphone', 'moneybag']
    });

    return {
      success: Boolean(result.sent),
      topic: settings.topic,
      error: result.error || null
    };
  }
}
