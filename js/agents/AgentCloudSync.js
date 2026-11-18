/**
 * Agente de Sincronización en la Nube en Tiempo Real (SSE + NDJSON sobre ntfy.sh)
 *
 * Responsable de sincronizar bidireccionalmente y sin servidor propio:
 * - El catálogo de productos y el stock por almacén
 * - Los almacenes / trabajadores y sus reglas de comisión
 * - Las ventas registradas por los trabajadores desde sus propios móviles
 * - Las reservas de clientes en tiempo real
 *
 * Utiliza un canal derivado `${ntfyTopic}-sync-v1` en ntfy.sh:
 * - Historial en caché: `GET https://ntfy.sh/${syncTopic}/json?poll=1&since=all`
 * - Tiempo real (vivo): `EventSource('https://ntfy.sh/' + syncTopic + '/sse')`
 */

import { MAIN_WAREHOUSE_ID } from './AgentStorage.js?v=5.2';

const DEVICE_ID_STORAGE_KEY = 'gv_device_id';
const LAST_SNAPSHOT_TS_KEY = 'gv_last_sync_snapshot_ts';

export class AgentCloudSync {
  constructor(storageAgent, notificationsAgent) {
    this.storage = storageAgent;
    this.notifications = notificationsAgent;
    this.onRemoteEvent = null;
    this.deviceId = this._getOrCreateDeviceId();
    this.eventSource = null;
    this.currentStreamTopic = null;
    this.isConnected = false;
    this.processedMessageIds = new Set();
    this._reconnectTimer = null;
  }

  /**
   * Genera o recupera un identificador único para este navegador/dispositivo.
   */
  _getOrCreateDeviceId() {
    try {
      let id = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
      if (!id) {
        id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
        localStorage.setItem(DEVICE_ID_STORAGE_KEY, id);
      }
      return id;
    } catch (err) {
      return 'dev_mem_' + Math.random().toString(36).substring(2, 10);
    }
  }

  /**
   * Obtiene el canal de sincronización derivado del topic de notificaciones del negocio.
   */
  getSyncTopic() {
    const settings = this.notifications ? this.notifications.getSettings() : { topic: '' };
    const baseTopic = (settings && settings.topic ? String(settings.topic).trim() : '') || 'vapeos-default';
    return `${baseTopic}-sync-v1`;
  }

  /**
   * Obtiene la URL base del servidor ntfy configurado.
   */
  _getServerUrl() {
    const settings = this.notifications ? this.notifications.getSettings() : null;
    return (settings && settings.serverUrl ? String(settings.serverUrl).trim() : 'https://ntfy.sh').replace(/\/+$/, '');
  }

  /**
   * Inicializa la sincronización en la nube:
   * 1. Registra el callback para eventos remotos en vivo.
   * 2. Descarga eventos en caché (snapshots y ventas ocurridas mientras la app estaba cerrada).
   * 3. Abre el canal EventSource (SSE) en tiempo real.
   */
  async init(onRemoteEventCallback = null) {
    if (onRemoteEventCallback) {
      this.onRemoteEvent = onRemoteEventCallback;
    }

    this.deviceId = this._getOrCreateDeviceId();

    try {
      await this.pullCachedEvents();
    } catch (err) {
      console.warn('AgentCloudSync: Error al descargar eventos en caché iniciales:', err);
    }

    this.startLiveStream();
    return this;
  }

  /**
   * Publica un paquete JSON de sincronización en el canal `${topic}-sync-v1`.
   */
  async _publishSyncEnvelope(envelope) {
    const syncTopic = this.getSyncTopic();
    if (!syncTopic) return { published: false, reason: 'no_sync_topic' };

    const serverUrl = this._getServerUrl();

    try {
      const response = await fetch(serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({
          topic: syncTopic,
          message: JSON.stringify(envelope)
        })
      });

      if (!response.ok) {
        return { published: false, status: response.status };
      }

      return { published: true, topic: syncTopic };
    } catch (err) {
      console.warn('AgentCloudSync: Error publicando evento de sincronización:', err);
      return { published: false, error: err?.message || String(err) };
    }
  }

  /**
   * Publica el estado completo (catálogo, almacenes, reservas y últimas 60 ventas)
   * para que los móviles de los trabajadores reciban el inventario actualizado al instante.
   */
  async publishFullState() {
    if (!this.storage) return { published: false };

    const [products, warehouses, reservations, allSales] = await Promise.all([
      this.storage.getAllProducts(),
      this.storage.getAllWarehouses(),
      this.storage.getAllReservations(),
      this.storage.getAllSales()
    ]);

    const sales = Array.isArray(allSales) ? allSales.slice(0, 60) : [];

    const envelope = {
      type: 'STATE_SNAPSHOT',
      senderId: this.deviceId,
      timestamp: Date.now(),
      payload: {
        products,
        warehouses,
        reservations,
        sales
      }
    };

    return this._publishSyncEnvelope(envelope);
  }

  /**
   * Publica en tiempo real una venta realizada por un trabajador (o jefe) junto con el producto actualizado.
   */
  async publishWorkerSale(sale, updatedProduct = null) {
    if (!sale) return { published: false };

    const envelope = {
      type: 'SALE_EVENT',
      senderId: this.deviceId,
      timestamp: Date.now(),
      payload: {
        sale,
        updatedProduct
      }
    };

    return this._publishSyncEnvelope(envelope);
  }

  /**
   * Publica un evento de reserva ('create', 'complete', 'cancel', 'delete') en tiempo real.
   */
  async publishReservationEvent(action, reservation) {
    if (!reservation) return { published: false };

    const envelope = {
      type: 'RESERVATION_EVENT',
      senderId: this.deviceId,
      timestamp: Date.now(),
      payload: {
        action,
        reservation
      }
    };

    return this._publishSyncEnvelope(envelope);
  }

  /**
   * Descarga los mensajes almacenados en caché en ntfy.sh (`?poll=1&since=all`),
   * aplica primero el `STATE_SNAPSHOT` más reciente y luego todos los eventos
   * `SALE_EVENT` y `RESERVATION_EVENT` posteriores cuyos IDs no estén registrados.
   */
  async pullCachedEvents() {
    const syncTopic = this.getSyncTopic();
    if (!syncTopic || !this.storage) return { synced: false };

    const serverUrl = this._getServerUrl();
    const url = `${serverUrl}/${encodeURIComponent(syncTopic)}/json?poll=1&since=all`;

    let text = '';
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/x-ndjson, application/json, text/plain' }
      });
      if (!response.ok) {
        return { synced: false, status: response.status };
      }
      text = await response.text();
    } catch (err) {
      console.warn('AgentCloudSync: No se pudo conectar para pullCachedEvents:', err);
      return { synced: false, error: err?.message || String(err) };
    }

    if (!text || !text.trim()) {
      return { synced: true, appliedSnapshots: 0, appliedSales: 0 };
    }

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const envelopes = [];

    for (const line of lines) {
      try {
        const ntfyRow = JSON.parse(line);
        if (ntfyRow.id) {
          this.processedMessageIds.add(ntfyRow.id);
        }
        if (ntfyRow.event !== 'message' || !ntfyRow.message) continue;

        const parsedMsg = JSON.parse(ntfyRow.message);
        if (parsedMsg && parsedMsg.type && parsedMsg.payload) {
          envelopes.push({
            ntfyId: ntfyRow.id,
            ...parsedMsg,
            timestamp: Number(parsedMsg.timestamp) || (ntfyRow.time ? ntfyRow.time * 1000 : 0)
          });
        }
      } catch (_) {
        // Ignorar líneas que no sean JSON de sincronización válido
      }
    }

    if (envelopes.length === 0) {
      return { synced: true, appliedSnapshots: 0, appliedSales: 0 };
    }

    // Ordenar cronológicamente de más antiguo a más reciente
    envelopes.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    // Buscar el STATE_SNAPSHOT más reciente
    let latestSnapshot = null;
    for (const env of envelopes) {
      if (env.type === 'STATE_SNAPSHOT') {
        latestSnapshot = env;
      }
    }

    let appliedSnapshots = 0;
    let snapshotTimestamp = 0;

    if (latestSnapshot) {
      snapshotTimestamp = latestSnapshot.timestamp || 0;
      const isWorkerUrl = typeof window !== 'undefined' &&
        window.location &&
        new URLSearchParams(window.location.search).has('wh');

      const lastAppliedTs = Number(localStorage.getItem(LAST_SNAPSHOT_TS_KEY) || 0);
      const shouldApplySnapshot =
        latestSnapshot.senderId !== this.deviceId ||
        isWorkerUrl ||
        snapshotTimestamp > lastAppliedTs;

      if (shouldApplySnapshot) {
        await this._applyStateSnapshot(latestSnapshot.payload);
        try {
          localStorage.setItem(LAST_SNAPSHOT_TS_KEY, String(snapshotTimestamp));
        } catch (_) {}
        appliedSnapshots = 1;
      }
    }

    // Aplicar todos los SALE_EVENT y RESERVATION_EVENT posteriores al snapshot (o todos si no están en local)
    let appliedSales = 0;
    let appliedReservations = 0;

    for (const env of envelopes) {
      if (env.type === 'SALE_EVENT') {
        const wasApplied = await this._applySaleEvent(env.payload, snapshotTimestamp, env.timestamp);
        if (wasApplied) appliedSales++;
      } else if (env.type === 'RESERVATION_EVENT') {
        if ((env.timestamp || 0) >= snapshotTimestamp) {
          const wasApplied = await this._applyReservationEvent(env.payload);
          if (wasApplied) appliedReservations++;
        }
      }
    }

    if ((appliedSnapshots > 0 || appliedSales > 0 || appliedReservations > 0) && this.onRemoteEvent) {
      try {
        this.onRemoteEvent({
          type: 'CACHED_SYNC_COMPLETE',
          appliedSnapshots,
          appliedSales,
          appliedReservations
        });
      } catch (err) {
        console.warn('AgentCloudSync: Error en callback onRemoteEvent tras pullCachedEvents:', err);
      }
    }

    return {
      synced: true,
      appliedSnapshots,
      appliedSales,
      appliedReservations
    };
  }

  /**
   * Inicia la escucha en vivo mediante Server-Sent Events (SSE) en `https://ntfy.sh/${syncTopic}/sse`.
   */
  startLiveStream() {
    if (typeof EventSource === 'undefined') {
      console.warn('AgentCloudSync: EventSource no soportado en este navegador.');
      return;
    }

    const syncTopic = this.getSyncTopic();
    if (!syncTopic) return;

    if (this.eventSource && this.currentStreamTopic === syncTopic) {
      return;
    }

    this._closeLiveStream();

    const serverUrl = this._getServerUrl();
    const sseUrl = `${serverUrl}/${encodeURIComponent(syncTopic)}/sse`;
    this.currentStreamTopic = syncTopic;

    try {
      const es = new EventSource(sseUrl);
      this.eventSource = es;

      es.onopen = () => {
        this.isConnected = true;
      };

      es.onmessage = async (event) => {
        if (!event || !event.data) return;
        await this._handleIncomingSseData(event.data);
      };

      es.onerror = () => {
        this.isConnected = false;
        // EventSource reintenta automáticamente, pero si se cierra por completo programamos reconexión
        if (es.readyState === EventSource.CLOSED) {
          if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
          this._reconnectTimer = setTimeout(() => {
            this.restartLiveStream();
          }, 6000);
        }
      };
    } catch (err) {
      console.warn('AgentCloudSync: Error abriendo EventSource:', err);
    }
  }

  /**
   * Reinicia la conexión SSE en vivo (por ejemplo, tras cambiar el código de canal ntfy).
   */
  restartLiveStream() {
    this._closeLiveStream();
    this.startLiveStream();
  }

  /**
   * Cierra limpiamente la conexión EventSource activa.
   */
  _closeLiveStream() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.eventSource) {
      try {
        this.eventSource.close();
      } catch (_) {}
      this.eventSource = null;
    }
    this.currentStreamTopic = null;
    this.isConnected = false;
  }

  /**
   * Procesa un mensaje entrante desde el flujo SSE en tiempo real.
   */
  async _handleIncomingSseData(rawData) {
    let ntfyPacket = null;
    try {
      ntfyPacket = JSON.parse(rawData);
    } catch (_) {
      return;
    }

    if (!ntfyPacket) return;
    if (ntfyPacket.id) {
      if (this.processedMessageIds.has(ntfyPacket.id)) return;
      this.processedMessageIds.add(ntfyPacket.id);
    }

    const rawMessage = ntfyPacket.message !== undefined ? ntfyPacket.message : rawData;
    if (!rawMessage || typeof rawMessage !== 'string') return;

    let envelope = null;
    try {
      envelope = JSON.parse(rawMessage);
    } catch (_) {
      return;
    }

    if (!envelope || !envelope.type || !envelope.payload) return;

    // Ignorar eventos emitidos por este mismo dispositivo
    if (envelope.senderId && envelope.senderId === this.deviceId) {
      return;
    }

    if (envelope.type === 'SALE_EVENT') {
      const applied = await this._applySaleEvent(envelope.payload, 0, envelope.timestamp || Date.now());
      if (applied && this.onRemoteEvent) {
        try {
          this.onRemoteEvent({
            type: 'SALE_EVENT',
            sale: envelope.payload.sale,
            updatedProduct: envelope.payload.updatedProduct || null
          });
        } catch (err) {
          console.warn('AgentCloudSync: Error en onRemoteEvent (SALE_EVENT):', err);
        }
      }
    } else if (envelope.type === 'STATE_SNAPSHOT') {
      await this._applyStateSnapshot(envelope.payload);
      try {
        localStorage.setItem(LAST_SNAPSHOT_TS_KEY, String(envelope.timestamp || Date.now()));
      } catch (_) {}
      if (this.onRemoteEvent) {
        try {
          this.onRemoteEvent({
            type: 'STATE_SNAPSHOT',
            payload: envelope.payload
          });
        } catch (err) {
          console.warn('AgentCloudSync: Error en onRemoteEvent (STATE_SNAPSHOT):', err);
        }
      }
    } else if (envelope.type === 'RESERVATION_EVENT') {
      const applied = await this._applyReservationEvent(envelope.payload);
      if (applied && this.onRemoteEvent) {
        try {
          this.onRemoteEvent({
            type: 'RESERVATION_EVENT',
            action: envelope.payload.action,
            reservation: envelope.payload.reservation
          });
        } catch (err) {
          console.warn('AgentCloudSync: Error en onRemoteEvent (RESERVATION_EVENT):', err);
        }
      }
    }
  }

  /**
   * Sincroniza en `this.storage` un `STATE_SNAPSHOT` completo recibido desde otro dispositivo.
   */
  async _applyStateSnapshot(payload) {
    if (!payload || !this.storage) return false;

    const { products, warehouses, reservations, sales } = payload;

    // 1. Sincronizar almacenes
    if (Array.isArray(warehouses)) {
      for (const wh of warehouses) {
        if (wh && wh.id) {
          await this.storage.saveWarehouse(wh);
        }
      }
    }

    // 2. Sincronizar catálogo de productos y su stock por almacén
    if (Array.isArray(products)) {
      for (const prod of products) {
        if (prod && prod.id) {
          await this.storage.saveProduct(prod);
        }
      }
    }

    // 3. Sincronizar reservas
    if (Array.isArray(reservations)) {
      const localReservations = await this.storage.getAllReservations();
      const remoteIds = new Set(reservations.map(r => r.id));

      for (const res of reservations) {
        if (res && res.id) {
          await this.storage.saveReservation(res);
        }
      }

      for (const localRes of localReservations) {
        if (localRes && localRes.id && !remoteIds.has(localRes.id)) {
          await this.storage.deleteReservation(localRes.id);
        }
      }
    }

    // 4. Sincronizar ventas incluidas en el snapshot que no existan localmente
    if (Array.isArray(sales)) {
      const localSales = await this.storage.getAllSales();
      const existingSaleIds = new Set(localSales.map(s => s.id));

      for (const sale of sales) {
        if (sale && sale.id && !existingSaleIds.has(sale.id)) {
          await this.storage.saveSale(sale);
          existingSaleIds.add(sale.id);
        }
      }
    }

    return true;
  }

  /**
   * Aplica un `SALE_EVENT` remoto:
   * - Si la venta no existía en `this.storage`, la guarda.
   * - Actualiza el stock del producto en el almacén correspondiente.
   */
  async _applySaleEvent(payload, snapshotTimestamp = 0, eventTimestamp = 0) {
    if (!payload || !payload.sale || !this.storage) return false;

    const { sale, updatedProduct } = payload;
    if (!sale.id) return false;

    const localSales = await this.storage.getAllSales();
    const alreadyExists = localSales.some(s => s.id === sale.id);
    if (alreadyExists) {
      return false;
    }

    // Guardar la nueva venta remota
    await this.storage.saveSale(sale);

    // Actualizar el stock del producto si el evento es posterior al último snapshot aplicado
    if (eventTimestamp >= snapshotTimestamp && sale.productId) {
      const localProduct = await this.storage.getProductById(sale.productId);
      const targetWhId = sale.warehouseId || MAIN_WAREHOUSE_ID;
      const qtySold = Math.max(1, parseInt(sale.quantity, 10) || 1);

      if (localProduct) {
        if (!localProduct.stockByWarehouse || typeof localProduct.stockByWarehouse !== 'object') {
          localProduct.stockByWarehouse = {
            [MAIN_WAREHOUSE_ID]: Math.max(0, parseInt(localProduct.stock, 10) || 0)
          };
        }

        if (
          updatedProduct &&
          updatedProduct.stockByWarehouse &&
          updatedProduct.stockByWarehouse[targetWhId] !== undefined
        ) {
          localProduct.stockByWarehouse[targetWhId] = Math.max(
            0,
            parseInt(updatedProduct.stockByWarehouse[targetWhId], 10) || 0
          );
        } else {
          const currentWhStock = Math.max(
            0,
            parseInt(localProduct.stockByWarehouse[targetWhId], 10) || 0
          );
          localProduct.stockByWarehouse[targetWhId] = Math.max(0, currentWhStock - qtySold);
        }

        localProduct.stock = Object.values(localProduct.stockByWarehouse).reduce(
          (sum, val) => sum + (Math.max(0, parseInt(val, 10) || 0)),
          0
        );

        await this.storage.saveProduct(localProduct);
      } else if (updatedProduct && updatedProduct.id) {
        await this.storage.saveProduct(updatedProduct);
      }
    }

    return true;
  }

  /**
   * Aplica un `RESERVATION_EVENT` remoto en `this.storage`.
   */
  async _applyReservationEvent(payload) {
    if (!payload || !payload.reservation || !this.storage) return false;

    const { action, reservation } = payload;
    if (!reservation.id) return false;

    if (action === 'delete' || action === 'cancel' || action === 'complete') {
      await this.storage.deleteReservation(reservation.id);
      return true;
    }

    await this.storage.saveReservation(reservation);
    return true;
  }
}
