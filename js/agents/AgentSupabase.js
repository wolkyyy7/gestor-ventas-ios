/**
 * Agente de Base de Datos Permanente en la Nube (Supabase PostgreSQL + Realtime)
 *
 * Responsable de:
 * - Conectar con las tablas PostgreSQL en Supabase (`warehouses`, `products`, `sales`,
 *   `reservations`, `transfers`, `settlements`, `app_config`)
 * - Sincronizar bidireccionalmente en tiempo real vía Supabase Realtime WebSockets
 * - Mapear limpiamente entre camelCase (JS) y snake_case (PostgreSQL)
 * - Mantener la app funcional offline usando IndexedDB como caché local inmediata
 */

import { DEFAULT_SUPABASE_CONFIG } from '../config/supabaseConfig.js';
import { MAIN_WAREHOUSE_ID } from './AgentStorage.js';

const SUPABASE_CONFIG_KEY = 'gv_supabase_config';

export class AgentSupabase {
  constructor(storageAgent) {
    this.storage = storageAgent;
    this.config = this._loadConfig();
    this.client = null;
    this.realtimeChannel = null;
    this.onRemoteEvent = null;
    this.isConnected = false;
    this.lastSyncAt = null;
    this.lastError = null;
    this._recentLocalWrites = new Map();
  }

  _loadConfig() {
    let url = (DEFAULT_SUPABASE_CONFIG.url || '').trim().replace(/\/+$/, '');
    let anonKey = (DEFAULT_SUPABASE_CONFIG.anonKey || '').trim();

    try {
      const raw = localStorage.getItem(SUPABASE_CONFIG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.url && String(parsed.url).trim()) {
          url = String(parsed.url).trim().replace(/\/+$/, '');
        }
        if (parsed.anonKey && String(parsed.anonKey).trim()) {
          anonKey = String(parsed.anonKey).trim();
        }
      }
    } catch (_) {}

    // Permitir auto-configuración por parámetros URL si se pasan ?sbUrl=...&sbKey=...
    try {
      if (typeof window !== 'undefined' && window.location && window.location.search) {
        const params = new URLSearchParams(window.location.search);
        const sbUrl = params.get('sbUrl');
        const sbKey = params.get('sbKey');
        if (sbUrl && sbKey) {
          url = sbUrl.trim().replace(/\/+$/, '');
          anonKey = sbKey.trim();
          localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify({ url, anonKey }));
        }
      }
    } catch (_) {}

    return { url, anonKey };
  }

  isConfigured() {
    return Boolean(this.config && this.config.url && this.config.anonKey && this.config.url.startsWith('http'));
  }

  getConfig() {
    return { ...this.config };
  }

  async saveConfig({ url, anonKey }) {
    const cleanUrl = String(url || '').trim().replace(/\/+$/, '');
    const cleanKey = String(anonKey || '').trim();
    this.config = { url: cleanUrl, anonKey: cleanKey };
    try {
      localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify(this.config));
    } catch (_) {}

    await this.disconnectRealtime();
    this.client = null;

    if (this.isConfigured()) {
      return await this.init(this.onRemoteEvent);
    }
    return { configured: false };
  }

  _markLocalWrite(table, id) {
    if (!id) return;
    this._recentLocalWrites.set(`${table}:${id}`, Date.now());
  }

  _isRecentLocalWrite(table, id) {
    const key = `${table}:${id}`;
    const ts = this._recentLocalWrites.get(key);
    if (!ts) return false;
    if (Date.now() - ts < 4000) return true;
    this._recentLocalWrites.delete(key);
    return false;
  }

  _createClientIfPossible() {
    if (!this.isConfigured()) return null;
    if (this.client) return this.client;

    if (typeof window !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function') {
      this.client = window.supabase.createClient(this.config.url, this.config.anonKey, {
        realtime: { params: { eventsPerSecond: 10 } }
      });
      return this.client;
    }
    return null;
  }

  /**
   * Llamadas REST directas como fallback si el SDK CDN no cargó (ej. offline/bloqueo).
   */
  async _restRequest(path, { method = 'GET', body = null, prefer = '' } = {}) {
    if (!this.isConfigured()) throw new Error('Supabase no configurado');
    const headers = {
      apikey: this.config.anonKey,
      Authorization: `Bearer ${this.config.anonKey}`,
      'Content-Type': 'application/json'
    };
    if (prefer) headers.Prefer = prefer;

    const res = await fetch(`${this.config.url}/rest/v1/${path}`, {
      method,
      headers,
      body: body !== null ? JSON.stringify(body) : undefined
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Supabase REST (${res.status}): ${errText || res.statusText}`);
    }

    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  // ===========================================================================
  // MAPEADORES SNAKE_CASE <-> CAMELCASE
  // ===========================================================================

  _toDbWarehouse(w) {
    return {
      id: w.id,
      name: w.name,
      worker_name: w.workerName || '',
      icon: w.icon || '🏠',
      color: w.color || 'indigo',
      is_main: Boolean(w.isMain),
      worker_pin: w.workerPin || '',
      notes: w.notes || '',
      reward_every_n_units: Math.max(1, parseInt(w.rewardEveryNUnits, 10) || 5),
      reward_free_units: Math.max(1, parseInt(w.rewardFreeUnits, 10) || 1),
      reward_vapers_delivered: Math.max(0, parseInt(w.rewardVapersDelivered, 10) || 0),
      cash_settled_amount: Number(w.cashSettledAmount) || 0,
      created_at: w.createdAt || new Date().toISOString(),
      updated_at: w.updatedAt || new Date().toISOString()
    };
  }

  _fromDbWarehouse(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      workerName: row.worker_name || '',
      icon: row.icon || '🏠',
      color: row.color || 'indigo',
      isMain: Boolean(row.is_main),
      workerPin: row.worker_pin || '',
      notes: row.notes || '',
      rewardEveryNUnits: Math.max(1, parseInt(row.reward_every_n_units, 10) || 5),
      rewardFreeUnits: Math.max(1, parseInt(row.reward_free_units, 10) || 1),
      rewardVapersDelivered: Math.max(0, parseInt(row.reward_vapers_delivered, 10) || 0),
      cashSettledAmount: Number(row.cash_settled_amount) || 0,
      createdAt: row.created_at || new Date().toISOString(),
      updatedAt: row.updated_at || new Date().toISOString()
    };
  }

  _toDbProduct(p) {
    return {
      id: p.id,
      name: p.name,
      category: p.category || 'Sabores',
      cost_price: Number(p.costPrice) || 0,
      sell_price: Number(p.sellPrice) || 0,
      stock: parseInt(p.stock, 10) || 0,
      stock_by_warehouse: p.stockByWarehouse || { [MAIN_WAREHOUSE_ID]: parseInt(p.stock, 10) || 0 },
      created_at: p.createdAt || new Date().toISOString(),
      updated_at: p.updatedAt || new Date().toISOString()
    };
  }

  _fromDbProduct(row) {
    if (!row) return null;
    const stockByWarehouse = row.stock_by_warehouse && typeof row.stock_by_warehouse === 'object'
      ? row.stock_by_warehouse
      : { [MAIN_WAREHOUSE_ID]: parseInt(row.stock, 10) || 0 };
    const totalStock = Object.values(stockByWarehouse).reduce(
      (sum, v) => sum + (Math.max(0, parseInt(v, 10) || 0)),
      0
    );
    return {
      id: row.id,
      name: row.name,
      category: row.category || 'Sabores',
      costPrice: Number(row.cost_price) || 0,
      sellPrice: Number(row.sell_price) || 0,
      stock: totalStock,
      stockByWarehouse,
      createdAt: row.created_at || new Date().toISOString(),
      updatedAt: row.updated_at || new Date().toISOString()
    };
  }

  _toDbSale(s) {
    return {
      id: s.id,
      timestamp: s.timestamp || new Date().toISOString(),
      product_id: s.productId || null,
      product_name: s.productName || 'Producto',
      product_category: s.productCategory || 'Sabores',
      warehouse_id: s.warehouseId || MAIN_WAREHOUSE_ID,
      warehouse_name: s.warehouseName || 'Mi Almacén (Principal)',
      worker_name: s.workerName || '',
      cost_price: Number(s.costPrice) || 0,
      catalog_unit_price: Number(s.catalogUnitPrice) || Number(s.unitPrice) || 12,
      unit_price: Number(s.unitPrice) || 0,
      quantity: parseInt(s.quantity, 10) || 1,
      gross_total: Number(s.grossTotal) || 0,
      total_cost: Number(s.totalCost) || 0,
      net_profit: Number(s.netProfit) || 0,
      profit_margin: Number(s.profitMargin) || 0,
      discount_per_unit: Number(s.discountPerUnit) || 0,
      total_discount: Number(s.totalDiscount) || 0,
      payment_method: s.paymentMethod || 'Efectivo',
      payment_status: s.paymentStatus || 'paid',
      paid_at: s.paidAt || null,
      buyer_name: s.buyerName || '',
      notes: s.notes || '',
      reservation_id: s.reservationId || null,
      order_id: s.orderId || null,
      order_name: s.orderName || '',
      status: s.status || 'completed'
    };
  }

  _fromDbSale(row) {
    if (!row) return null;
    return {
      id: row.id,
      timestamp: row.timestamp || new Date().toISOString(),
      productId: row.product_id || null,
      productName: row.product_name || 'Producto',
      productCategory: row.product_category || 'Sabores',
      warehouseId: row.warehouse_id || MAIN_WAREHOUSE_ID,
      warehouseName: row.warehouse_name || 'Mi Almacén (Principal)',
      workerName: row.worker_name || '',
      costPrice: Number(row.cost_price) || 0,
      catalogUnitPrice: Number(row.catalog_unit_price) || Number(row.unit_price) || 12,
      unitPrice: Number(row.unit_price) || 0,
      quantity: parseInt(row.quantity, 10) || 1,
      grossTotal: Number(row.gross_total) || 0,
      totalCost: Number(row.total_cost) || 0,
      netProfit: Number(row.net_profit) || 0,
      profitMargin: Number(row.profit_margin) || 0,
      discountPerUnit: Number(row.discount_per_unit) || 0,
      totalDiscount: Number(row.total_discount) || 0,
      paymentMethod: row.payment_method || 'Efectivo',
      paymentStatus: row.payment_status || 'paid',
      paidAt: row.paid_at || null,
      buyerName: row.buyer_name || '',
      notes: row.notes || '',
      reservationId: row.reservation_id || null,
      orderId: row.order_id || null,
      orderName: row.order_name || '',
      status: row.status || 'completed'
    };
  }

  _toDbReservation(r) {
    return {
      id: r.id,
      product_id: r.productId || null,
      product_name: r.productName || 'Producto',
      warehouse_id: r.warehouseId || MAIN_WAREHOUSE_ID,
      warehouse_name: r.warehouseName || 'Mi Almacén (Principal)',
      quantity: parseInt(r.quantity, 10) || 1,
      customer_name: r.customerName || 'Cliente',
      agreed_unit_price: Number(r.agreedUnitPrice) || 12,
      notes: r.notes || '',
      status: r.status || 'active',
      created_at: r.createdAt || new Date().toISOString(),
      updated_at: r.updatedAt || new Date().toISOString()
    };
  }

  _fromDbReservation(row) {
    if (!row) return null;
    return {
      id: row.id,
      productId: row.product_id || null,
      productName: row.product_name || 'Producto',
      warehouseId: row.warehouse_id || MAIN_WAREHOUSE_ID,
      warehouseName: row.warehouse_name || 'Mi Almacén (Principal)',
      quantity: parseInt(row.quantity, 10) || 1,
      customerName: row.customer_name || 'Cliente',
      agreedUnitPrice: Number(row.agreed_unit_price) || 12,
      notes: row.notes || '',
      status: row.status || 'active',
      createdAt: row.created_at || new Date().toISOString(),
      updatedAt: row.updated_at || new Date().toISOString()
    };
  }

  _toDbTransfer(t) {
    return {
      id: t.id,
      timestamp: t.timestamp || new Date().toISOString(),
      product_id: t.productId || null,
      product_name: t.productName || 'Producto',
      from_warehouse_id: t.fromWarehouseId || null,
      from_warehouse_name: t.fromWarehouseName || '',
      to_warehouse_id: t.toWarehouseId || null,
      to_warehouse_name: t.toWarehouseName || '',
      quantity: parseInt(t.quantity, 10) || 1,
      notes: t.notes || ''
    };
  }

  _fromDbTransfer(row) {
    if (!row) return null;
    return {
      id: row.id,
      timestamp: row.timestamp || new Date().toISOString(),
      productId: row.product_id || null,
      productName: row.product_name || 'Producto',
      fromWarehouseId: row.from_warehouse_id || null,
      fromWarehouseName: row.from_warehouse_name || '',
      toWarehouseId: row.to_warehouse_id || null,
      toWarehouseName: row.to_warehouse_name || '',
      quantity: parseInt(row.quantity, 10) || 1,
      notes: row.notes || ''
    };
  }

  _toDbSettlement(st) {
    return {
      id: st.id,
      timestamp: st.timestamp || new Date().toISOString(),
      type: st.type || 'cash_settlement',
      warehouse_id: st.warehouseId || null,
      warehouse_name: st.warehouseName || '',
      worker_name: st.workerName || '',
      count: parseInt(st.count, 10) || 0,
      amount: Number(st.amount) || 0,
      product_id: st.productId || null,
      product_name: st.productName || null,
      from_warehouse_id: st.fromWarehouseId || null,
      notes: st.notes || ''
    };
  }

  _fromDbSettlement(row) {
    if (!row) return null;
    return {
      id: row.id,
      timestamp: row.timestamp || new Date().toISOString(),
      type: row.type || 'cash_settlement',
      warehouseId: row.warehouse_id || null,
      warehouseName: row.warehouse_name || '',
      workerName: row.worker_name || '',
      count: parseInt(row.count, 10) || 0,
      amount: Number(row.amount) || 0,
      productId: row.product_id || null,
      productName: row.product_name || null,
      fromWarehouseId: row.from_warehouse_id || null,
      notes: row.notes || ''
    };
  }

  _toDbOrder(o) {
    return {
      id: o.id,
      name: o.name || 'Pedido',
      status: o.status || 'active',
      supplier: o.supplier || '',
      notes: o.notes || '',
      items: Array.isArray(o.items) ? o.items : [],
      total_units: parseInt(o.totalUnits, 10) || 0,
      total_cost: Number(o.totalCost) || 0,
      expected_revenue: Number(o.expectedRevenue) || 0,
      created_at: o.createdAt || new Date().toISOString(),
      closed_at: o.closedAt || null,
      updated_at: o.updatedAt || new Date().toISOString()
    };
  }

  _fromDbOrder(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name || 'Pedido',
      status: row.status || 'active',
      supplier: row.supplier || '',
      notes: row.notes || '',
      items: Array.isArray(row.items) ? row.items : [],
      totalUnits: parseInt(row.total_units, 10) || 0,
      totalCost: Number(row.total_cost) || 0,
      expectedRevenue: Number(row.expected_revenue) || 0,
      createdAt: row.created_at || new Date().toISOString(),
      closedAt: row.closed_at || null,
      updatedAt: row.updated_at || new Date().toISOString()
    };
  }

  // ===========================================================================
  // INICIALIZACIÓN, SINCRONIZACIÓN INICIAL Y REALTIME
  // ===========================================================================

  async init(onRemoteEventCallback = null) {
    if (onRemoteEventCallback) {
      this.onRemoteEvent = onRemoteEventCallback;
    }

    if (!this.isConfigured()) {
      this.isConnected = false;
      return { configured: false };
    }

    try {
      await this.syncFromCloud();
      this.startRealtime();
      this.lastError = null;
      return { configured: true, connected: this.isConnected };
    } catch (err) {
      this.lastError = err?.message || String(err);
      this.isConnected = false;
      console.warn('AgentSupabase: Error inicializando conexión:', err);
      return { configured: true, connected: false, error: this.lastError };
    }
  }

  /**
   * Descarga el estado autoritativo de todas las tablas de Supabase.
   * Si la base de datos en Supabase está vacía (primer arranque), sube el catálogo inicial local.
   */
  async syncFromCloud() {
    if (!this.isConfigured()) return { synced: false };

    const [whRows, prodRows, saleRows, resRows, trfRows, stlRows, cfgRows, ordRows] = await Promise.all([
      this._restRequest('warehouses?select=*'),
      this._restRequest('products?select=*'),
      this._restRequest('sales?select=*&order=timestamp.desc&limit=500'),
      this._restRequest('reservations?select=*'),
      this._restRequest('transfers?select=*&order=timestamp.desc&limit=200'),
      this._restRequest('settlements?select=*&order=timestamp.desc&limit=200'),
      this._restRequest('app_config?select=*'),
      this._restRequest('orders?select=*&order=created_at.desc').catch(() => [])
    ]);

    const hasRemoteData = (prodRows && prodRows.length > 0) || (whRows && whRows.length > 0);

    if (!hasRemoteData) {
      // Primera vez en Supabase: subir datos locales iniciales
      await this.pushAllLocalToCloud();
      this.lastSyncAt = new Date().toISOString();
      this.isConnected = true;
      return { synced: true, action: 'pushed_initial' };
    }

    const remoteData = {
      warehouses: (whRows || []).map(r => this._fromDbWarehouse(r)).filter(Boolean),
      products: (prodRows || []).map(r => this._fromDbProduct(r)).filter(Boolean),
      sales: (saleRows || []).map(r => this._fromDbSale(r)).filter(Boolean),
      reservations: (resRows || []).map(r => this._fromDbReservation(r)).filter(Boolean),
      transfers: (trfRows || []).map(r => this._fromDbTransfer(r)).filter(Boolean),
      settlements: (stlRows || []).map(r => this._fromDbSettlement(r)).filter(Boolean),
      orders: (ordRows || []).map(r => this._fromDbOrder(r)).filter(Boolean)
    };

    if (this.storage && typeof this.storage.replaceAllFromCloud === 'function') {
      await this.storage.replaceAllFromCloud(remoteData);
    }

    if (cfgRows && cfgRows.length > 0 && this.storage) {
      for (const cfg of cfgRows) {
        if (cfg.key) {
          await this.storage.setConfig(cfg.key, cfg.value, { skipCloudSync: true });
        }
      }
    }

    this.lastSyncAt = new Date().toISOString();
    this.isConnected = true;
    return { synced: true, action: 'pulled_from_cloud' };
  }

  /**
   * Sube toda la base de datos local actual hacia Supabase (ideal para migración inicial o respaldo).
   */
  async pushAllLocalToCloud() {
    if (!this.isConfigured() || !this.storage) return { pushed: false };

    const [warehouses, products, sales, reservations, transfers, settlements, authCfg, orders] = await Promise.all([
      this.storage.getAllWarehouses(),
      this.storage.getAllProducts(),
      this.storage.getAllSales(),
      this.storage.getAllReservations(),
      this.storage.getAllTransfers(),
      this.storage.getAllSettlements(),
      this.storage.getConfig('auth_config', null),
      this.storage.getAllOrders()
    ]);

    if (warehouses.length > 0) {
      await this._restRequest('warehouses', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates',
        body: warehouses.map(w => this._toDbWarehouse(w))
      });
    }
    if (products.length > 0) {
      await this._restRequest('products', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates',
        body: products.map(p => this._toDbProduct(p))
      });
    }
    if (sales.length > 0) {
      try {
        await this._restRequest('sales', {
          method: 'POST',
          prefer: 'resolution=merge-duplicates',
          body: sales.map(s => this._toDbSale(s))
        });
      } catch (err) {
        if (String(err.message || '').includes('order_id')) {
          await this._restRequest('sales', {
            method: 'POST',
            prefer: 'resolution=merge-duplicates',
            body: sales.map(s => {
              const row = this._toDbSale(s);
              delete row.order_id;
              delete row.order_name;
              return row;
            })
          });
        } else {
          throw err;
        }
      }
    }
    if (reservations.length > 0) {
      await this._restRequest('reservations', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates',
        body: reservations.map(r => this._toDbReservation(r))
      });
    }
    if (transfers.length > 0) {
      await this._restRequest('transfers', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates',
        body: transfers.map(t => this._toDbTransfer(t))
      });
    }
    if (settlements.length > 0) {
      await this._restRequest('settlements', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates',
        body: settlements.map(st => this._toDbSettlement(st))
      });
    }
    if (orders.length > 0) {
      await this._restRequest('orders', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates',
        body: orders.map(o => this._toDbOrder(o))
      }).catch(() => {});
    }
    if (authCfg) {
      await this.upsertConfig('auth_config', authCfg);
    }

    this.lastSyncAt = new Date().toISOString();
    this.isConnected = true;
    return { pushed: true };
  }

  // ===========================================================================
  // ESCRITURAS ATÓMICAS DESDE AGENTSTORAGE -> SUPABASE
  // ===========================================================================

  async upsertWarehouse(w) {
    if (!this.isConfigured() || !w) return;
    this._markLocalWrite('warehouses', w.id);
    await this._restRequest('warehouses', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: this._toDbWarehouse(w)
    });
    this.lastSyncAt = new Date().toISOString();
  }

  async deleteWarehouse(id) {
    if (!this.isConfigured() || !id) return;
    this._markLocalWrite('warehouses', id);
    await this._restRequest(`warehouses?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    this.lastSyncAt = new Date().toISOString();
  }

  async upsertProduct(p) {
    if (!this.isConfigured() || !p) return;
    this._markLocalWrite('products', p.id);
    await this._restRequest('products', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: this._toDbProduct(p)
    });
    this.lastSyncAt = new Date().toISOString();
  }

  async deleteProduct(id) {
    if (!this.isConfigured() || !id) return;
    this._markLocalWrite('products', id);
    await this._restRequest(`products?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    this.lastSyncAt = new Date().toISOString();
  }

  async upsertSale(s) {
    if (!this.isConfigured() || !s) return;
    this._markLocalWrite('sales', s.id);
    try {
      await this._restRequest('sales', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates',
        body: this._toDbSale(s)
      });
    } catch (err) {
      if (String(err.message || '').includes('order_id')) {
        const row = this._toDbSale(s);
        delete row.order_id;
        delete row.order_name;
        await this._restRequest('sales', {
          method: 'POST',
          prefer: 'resolution=merge-duplicates',
          body: row
        });
      } else {
        throw err;
      }
    }
    this.lastSyncAt = new Date().toISOString();
  }

  async deleteSale(id) {
    if (!this.isConfigured() || !id) return;
    this._markLocalWrite('sales', id);
    await this._restRequest(`sales?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    this.lastSyncAt = new Date().toISOString();
  }

  async upsertReservation(r) {
    if (!this.isConfigured() || !r) return;
    this._markLocalWrite('reservations', r.id);
    await this._restRequest('reservations', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: this._toDbReservation(r)
    });
    this.lastSyncAt = new Date().toISOString();
  }

  async deleteReservation(id) {
    if (!this.isConfigured() || !id) return;
    this._markLocalWrite('reservations', id);
    await this._restRequest(`reservations?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    this.lastSyncAt = new Date().toISOString();
  }

  async upsertTransfer(t) {
    if (!this.isConfigured() || !t) return;
    this._markLocalWrite('transfers', t.id);
    await this._restRequest('transfers', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: this._toDbTransfer(t)
    });
    this.lastSyncAt = new Date().toISOString();
  }

  async upsertSettlement(st) {
    if (!this.isConfigured() || !st) return;
    this._markLocalWrite('settlements', st.id);
    await this._restRequest('settlements', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: this._toDbSettlement(st)
    });
    this.lastSyncAt = new Date().toISOString();
  }

  async upsertConfig(key, value) {
    if (!this.isConfigured() || !key) return;
    this._markLocalWrite('app_config', key);
    await this._restRequest('app_config', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: { key, value, updated_at: new Date().toISOString() }
    });
    this.lastSyncAt = new Date().toISOString();
  }

  async upsertOrder(o) {
    if (!this.isConfigured() || !o) return;
    this._markLocalWrite('orders', o.id);
    await this._restRequest('orders', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: this._toDbOrder(o)
    }).catch(() => {});
    this.lastSyncAt = new Date().toISOString();
  }

  async deleteOrder(id) {
    if (!this.isConfigured() || !id) return;
    this._markLocalWrite('orders', id);
    await this._restRequest(`orders?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
    this.lastSyncAt = new Date().toISOString();
  }

  // ===========================================================================
  // SUPABASE REALTIME (ESCUCHA EN TIEMPO REAL DE CAMBIOS REMOTOS)
  // ===========================================================================

  startRealtime() {
    const client = this._createClientIfPossible();
    if (!client) return;

    if (this.realtimeChannel) return;

    const channel = client
      .channel('vapeos-realtime-all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, (payload) => {
        this._handleRealtimeChange('sales', payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, (payload) => {
        this._handleRealtimeChange('products', payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouses' }, (payload) => {
        this._handleRealtimeChange('warehouses', payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, (payload) => {
        this._handleRealtimeChange('reservations', payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transfers' }, (payload) => {
        this._handleRealtimeChange('transfers', payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements' }, (payload) => {
        this._handleRealtimeChange('settlements', payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_config' }, (payload) => {
        this._handleRealtimeChange('app_config', payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        this._handleRealtimeChange('orders', payload);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          this.isConnected = true;
        }
      });

    this.realtimeChannel = channel;
  }

  async disconnectRealtime() {
    if (this.realtimeChannel && this.client) {
      try {
        await this.client.removeChannel(this.realtimeChannel);
      } catch (_) {}
    }
    this.realtimeChannel = null;
    this.isConnected = false;
  }

  async _handleRealtimeChange(table, payload) {
    if (!payload || !this.storage) return;
    const eventType = payload.eventType;
    const row = payload.new || payload.old;
    const recordId = row ? (row.id || row.key) : null;

    if (recordId && this._isRecentLocalWrite(table, recordId)) {
      return; // Ignorar eco de nuestra propia escritura reciente
    }

    this.lastSyncAt = new Date().toISOString();

    try {
      if (table === 'products') {
        if (eventType === 'DELETE' && payload.old?.id) {
          await this.storage.deleteProduct(payload.old.id, { skipCloudSync: true });
        } else if (payload.new) {
          await this.storage.saveProduct(this._fromDbProduct(payload.new), { skipCloudSync: true });
        }
      } else if (table === 'warehouses') {
        if (eventType === 'DELETE' && payload.old?.id) {
          await this.storage.deleteWarehouse(payload.old.id, { skipCloudSync: true });
        } else if (payload.new) {
          await this.storage.saveWarehouse(this._fromDbWarehouse(payload.new), { skipCloudSync: true });
        }
      } else if (table === 'sales') {
        if (eventType === 'DELETE' && payload.old?.id) {
          await this.storage.deleteSale(payload.old.id, { skipCloudSync: true });
        } else if (payload.new) {
          const sale = this._fromDbSale(payload.new);
          await this.storage.saveSale(sale, { skipCloudSync: true });
          if (eventType === 'INSERT' && this.onRemoteEvent) {
            this.onRemoteEvent({ type: 'SALE_EVENT', sale, source: 'supabase' });
          }
        }
      } else if (table === 'reservations') {
        if (eventType === 'DELETE' && payload.old?.id) {
          await this.storage.deleteReservation(payload.old.id, { skipCloudSync: true });
        } else if (payload.new) {
          await this.storage.saveReservation(this._fromDbReservation(payload.new), { skipCloudSync: true });
        }
      } else if (table === 'transfers' && payload.new) {
        await this.storage.saveTransfer(this._fromDbTransfer(payload.new), { skipCloudSync: true });
      } else if (table === 'settlements' && payload.new) {
        await this.storage.saveSettlement(this._fromDbSettlement(payload.new), { skipCloudSync: true });
      } else if (table === 'app_config' && payload.new?.key) {
        await this.storage.setConfig(payload.new.key, payload.new.value, { skipCloudSync: true });
      } else if (table === 'orders') {
        if (eventType === 'DELETE' && payload.old?.id) {
          await this.storage.deleteOrder(payload.old.id, { skipCloudSync: true });
        } else if (payload.new) {
          await this.storage.saveOrder(this._fromDbOrder(payload.new), { skipCloudSync: true });
        }
      }

      if (this.onRemoteEvent && !(table === 'sales' && eventType === 'INSERT')) {
        this.onRemoteEvent({ type: 'SUPABASE_SYNC', table, eventType, source: 'supabase' });
      }
    } catch (err) {
      console.warn(`AgentSupabase: Error procesando cambio Realtime en ${table}:`, err);
    }
  }
}
