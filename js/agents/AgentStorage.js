/**
 * Agente de Persistencia y Almacenamiento Local
 * 
 * Responsable de la gestión autónoma del almacenamiento offline en el iPhone/Navegador.
 * Utiliza IndexedDB de alto rendimiento con fallback transparente a LocalStorage.
 * Proporciona persistencia duradera, eventos reactivos, soporte multi-almacén,
 * registro de transferencias, reservas de clientes, liquidaciones/comisiones de trabajadores,
 * sincronización remota y copias de seguridad.
 */

export const MAIN_WAREHOUSE_ID = 'wh_main';

export class AgentStorage {
  constructor() {
    this.dbName = 'GestorVentasDB';
    this.dbVersion = 4;
    this.db = null;
    this.isIndexedDBSupported = typeof indexedDB !== 'undefined';
    this.listeners = new Map();
    this.supabase = null;
  }

  /**
   * Conecta el agente de Supabase para sincronización permanente automática.
   */
  attachSupabaseAgent(supabaseAgent) {
    this.supabase = supabaseAgent;
  }

  _syncCloud(fn) {
    if (this.supabase && this.supabase.isConfigured()) {
      try {
        Promise.resolve(fn(this.supabase)).catch(err => {
          console.warn('AgentStorage -> Supabase sync warning:', err?.message || err);
        });
      } catch (err) {
        console.warn('AgentStorage -> Supabase sync error:', err?.message || err);
      }
    }
  }

  /**
   * Genera un PIN aleatorio de 4 dígitos para trabajadores (distinto de 1234).
   */
  _generateDefaultWorkerPin() {
    let pin = String(Math.floor(1000 + Math.random() * 8999));
    if (pin === '1234') pin = '2580';
    return pin;
  }

  /**
   * Devuelve la definición por defecto del Almacén Principal.
   */
  _getDefaultMainWarehouse() {
    const now = new Date().toISOString();
    return {
      id: MAIN_WAREHOUSE_ID,
      name: 'Mi Almacén (Principal)',
      workerName: 'Jefe (Principal)',
      icon: '🏠',
      color: 'emerald',
      isMain: true,
      workerPin: '',
      notes: 'Almacén central principal',
      rewardEveryNUnits: 5,
      rewardFreeUnits: 1,
      rewardVapersDelivered: 0,
      cashSettledAmount: 0,
      createdAt: now,
      updatedAt: now
    };
  }

  /**
   * Asegura que un objeto almacén tenga todos los campos de comisiones, liquidación y PIN inicializados.
   */
  _normalizeWarehouseObject(wh) {
    if (!wh) return wh;
    wh.rewardEveryNUnits = Math.max(1, parseInt(wh.rewardEveryNUnits, 10) || 5);
    wh.rewardFreeUnits = Math.max(1, parseInt(wh.rewardFreeUnits, 10) || 1);
    wh.rewardVapersDelivered = Math.max(0, parseInt(wh.rewardVapersDelivered, 10) || 0);
    wh.cashSettledAmount = Math.max(0, parseFloat(wh.cashSettledAmount) || 0);

    if (wh.id === MAIN_WAREHOUSE_ID || wh.isMain) {
      wh.isMain = true;
      wh.workerPin = wh.workerPin || '';
    } else {
      if (!wh.workerPin || String(wh.workerPin).trim().length < 4) {
        wh.workerPin = this._generateDefaultWorkerPin();
      } else {
        wh.workerPin = String(wh.workerPin).trim();
      }
    }
    return wh;
  }

  /**
   * Inicializa la conexión con IndexedDB o LocalStorage.
   */
  async init() {
    if (!this.isIndexedDBSupported) {
      console.warn('AgentStorage: IndexedDB no disponible, usando LocalStorage fallback.');
      await this._ensureInitialData();
      return this;
    }

    return new Promise((resolve) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Almacén de Productos
        if (!db.objectStoreNames.contains('products')) {
          const productStore = db.createObjectStore('products', { keyPath: 'id' });
          productStore.createIndex('name', 'name', { unique: false });
          productStore.createIndex('category', 'category', { unique: false });
          productStore.createIndex('stock', 'stock', { unique: false });
        }

        // Almacén de Transacciones / Ventas
        if (!db.objectStoreNames.contains('sales')) {
          const salesStore = db.createObjectStore('sales', { keyPath: 'id' });
          salesStore.createIndex('timestamp', 'timestamp', { unique: false });
          salesStore.createIndex('productId', 'productId', { unique: false });
          salesStore.createIndex('paymentMethod', 'paymentMethod', { unique: false });
        }

        // Almacén de Configuración
        if (!db.objectStoreNames.contains('config')) {
          db.createObjectStore('config', { keyPath: 'key' });
        }

        // Almacén de Almacenes / Casas de trabajadores (v2)
        if (!db.objectStoreNames.contains('warehouses')) {
          db.createObjectStore('warehouses', { keyPath: 'id' });
        }

        // Almacén de Transferencias / Repartos de stock (v2)
        if (!db.objectStoreNames.contains('transfers')) {
          const transferStore = db.createObjectStore('transfers', { keyPath: 'id' });
          transferStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Almacén de Reservas de Clientes (v3)
        if (!db.objectStoreNames.contains('reservations')) {
          const reservationStore = db.createObjectStore('reservations', { keyPath: 'id' });
          reservationStore.createIndex('createdAt', 'createdAt', { unique: false });
          reservationStore.createIndex('productId', 'productId', { unique: false });
        }

        // Almacén de Liquidaciones y Entregas de Vapers Gratis a Trabajadores (v3)
        if (!db.objectStoreNames.contains('settlements')) {
          const settlementStore = db.createObjectStore('settlements', { keyPath: 'id' });
          settlementStore.createIndex('timestamp', 'timestamp', { unique: false });
          settlementStore.createIndex('warehouseId', 'warehouseId', { unique: false });
        }

        // Almacén de Pedidos / Lotes de Mercancía (v4)
        if (!db.objectStoreNames.contains('orders')) {
          const orderStore = db.createObjectStore('orders', { keyPath: 'id' });
          orderStore.createIndex('createdAt', 'createdAt', { unique: false });
          orderStore.createIndex('status', 'status', { unique: false });
        }
      };

      request.onblocked = () => {
        console.warn('AgentStorage: Apertura de IndexedDB bloqueada por otra pestaña');
      };

      request.onsuccess = async (event) => {
        this.db = event.target.result;
        this.db.onversionchange = () => {
          try { this.db.close(); } catch (_) {}
          this.db = null;
        };
        this.db.onclose = () => {
          this.db = null;
        };
        try {
          await this._ensureInitialData();
        } catch (err) {
          console.error('AgentStorage: Error en _ensureInitialData:', err);
        }
        resolve(this);
      };

      request.onerror = async (event) => {
        console.error('AgentStorage: Error al abrir IndexedDB:', event.target.error);
        this.isIndexedDBSupported = false;
        try {
          await this._ensureInitialData();
        } catch (err) {
          console.error('AgentStorage: Error en fallback _ensureInitialData:', err);
        }
        resolve(this);
      };
    });
  }

  /**
   * Suscribe callbacks para eventos de datos (ej: 'products:changed', 'sales:changed', 'warehouses:changed')
   */
  subscribe(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.listeners.get(event).delete(callback);
  }

  _notify(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(cb => {
        try { cb(data); } catch (err) { console.error('Error en callback:', err); }
      });
    }
    // Notificación genérica
    if (this.listeners.has('*')) {
      this.listeners.get('*').forEach(cb => {
        try { cb({ event, data }); } catch (err) { console.error(err); }
      });
    }
  }

  // ==========================================
  // MÉTODOS DE ALMACENES (WAREHOUSES)
  // ==========================================

  async getAllWarehouses() {
    let warehouses = [];
    if (this.db) {
      warehouses = await new Promise((resolve, reject) => {
        const tx = this.db.transaction('warehouses', 'readonly');
        const store = tx.objectStore('warehouses');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } else {
      const data = localStorage.getItem('gv_warehouses');
      warehouses = data ? JSON.parse(data) : [];
    }

    // Asegurar que wh_main exista siempre
    let mainWh = warehouses.find(w => w.id === MAIN_WAREHOUSE_ID);
    if (!mainWh) {
      mainWh = this._getDefaultMainWarehouse();
      await this.saveWarehouse(mainWh);
      warehouses.push(mainWh);
    } else if (!mainWh.isMain) {
      mainWh.isMain = true;
    }

    warehouses.forEach(w => this._normalizeWarehouseObject(w));

    // Ordenar: isMain primero, luego por fecha de creación o nombre
    warehouses.sort((a, b) => {
      if (a.id === MAIN_WAREHOUSE_ID || a.isMain) return -1;
      if (b.id === MAIN_WAREHOUSE_ID || b.isMain) return 1;
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });

    return warehouses;
  }

  async getWarehouseById(id) {
    const targetId = id || MAIN_WAREHOUSE_ID;
    if (this.db) {
      const wh = await new Promise((resolve, reject) => {
        const tx = this.db.transaction('warehouses', 'readonly');
        const store = tx.objectStore('warehouses');
        const req = store.get(targetId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      if (wh) return this._normalizeWarehouseObject(wh);
      if (targetId === MAIN_WAREHOUSE_ID) {
        const defaultMain = this._getDefaultMainWarehouse();
        await this.saveWarehouse(defaultMain);
        return defaultMain;
      }
      return null;
    } else {
      const warehouses = await this.getAllWarehouses();
      return warehouses.find(w => w.id === targetId) || null;
    }
  }

  async saveWarehouse(warehouse, options = {}) {
    if (!warehouse.id) {
      warehouse.id = 'wh_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    }
    if (warehouse.id === MAIN_WAREHOUSE_ID) {
      warehouse.isMain = true;
    }
    if (!warehouse.createdAt) {
      warehouse.createdAt = new Date().toISOString();
    }
    this._normalizeWarehouseObject(warehouse);
    warehouse.updatedAt = new Date().toISOString();

    if (this.db) {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction('warehouses', 'readwrite');
        const store = tx.objectStore('warehouses');
        const req = store.put(warehouse);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } else {
      const data = localStorage.getItem('gv_warehouses');
      const warehouses = data ? JSON.parse(data) : [];
      const idx = warehouses.findIndex(w => w.id === warehouse.id);
      if (idx >= 0) warehouses[idx] = warehouse;
      else warehouses.push(warehouse);
      localStorage.setItem('gv_warehouses', JSON.stringify(warehouses));
    }

    if (!options.skipCloudSync) {
      this._syncCloud(sb => sb.upsertWarehouse(warehouse));
    }
    this._notify('warehouses:changed', { action: 'save', warehouse });
    return warehouse;
  }

  async deleteWarehouse(id, options = {}) {
    if (id === MAIN_WAREHOUSE_ID) {
      throw new Error('No se puede eliminar el Almacén Principal.');
    }

    if (this.db) {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction('warehouses', 'readwrite');
        const store = tx.objectStore('warehouses');
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } else {
      const data = localStorage.getItem('gv_warehouses');
      let warehouses = data ? JSON.parse(data) : [];
      warehouses = warehouses.filter(w => w.id !== id);
      localStorage.setItem('gv_warehouses', JSON.stringify(warehouses));
    }

    if (!options.skipCloudSync) {
      this._syncCloud(sb => sb.deleteWarehouse(id));
    }
    this._notify('warehouses:changed', { action: 'delete', id });
  }

  // ==========================================
  // MÉTODOS DE RESERVAS DE CLIENTES (RESERVATIONS)
  // ==========================================

  async getAllReservations() {
    if (this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction('reservations', 'readonly');
        const store = tx.objectStore('reservations');
        const req = store.getAll();
        req.onsuccess = () => {
          const list = req.result || [];
          list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
          resolve(list);
        };
        req.onerror = () => reject(req.error);
      });
    } else {
      const data = localStorage.getItem('gv_reservations');
      const list = data ? JSON.parse(data) : [];
      list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      return list;
    }
  }

  async saveReservation(reservation, options = {}) {
    if (!reservation.id) {
      reservation.id = 'res_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    }
    if (!reservation.createdAt) {
      reservation.createdAt = new Date().toISOString();
    }
    reservation.updatedAt = new Date().toISOString();

    if (this.db) {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction('reservations', 'readwrite');
        const store = tx.objectStore('reservations');
        const req = store.put(reservation);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } else {
      const list = await this.getAllReservations();
      const idx = list.findIndex(r => r.id === reservation.id);
      if (idx >= 0) list[idx] = reservation;
      else list.unshift(reservation);
      localStorage.setItem('gv_reservations', JSON.stringify(list));
    }

    if (!options.skipCloudSync) {
      this._syncCloud(sb => sb.upsertReservation(reservation));
    }
    this._notify('reservations:changed', { action: 'save', reservation });
    return reservation;
  }

  async deleteReservation(id, options = {}) {
    if (this.db) {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction('reservations', 'readwrite');
        const store = tx.objectStore('reservations');
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } else {
      let list = await this.getAllReservations();
      list = list.filter(r => r.id !== id);
      localStorage.setItem('gv_reservations', JSON.stringify(list));
    }

    if (!options.skipCloudSync) {
      this._syncCloud(sb => sb.deleteReservation(id));
    }
    this._notify('reservations:changed', { action: 'delete', id });
  }

  // ==========================================
  // MÉTODOS DE LIQUIDACIONES Y VAPERS DE REGALO (SETTLEMENTS)
  // ==========================================

  async getAllSettlements() {
    if (this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction('settlements', 'readonly');
        const store = tx.objectStore('settlements');
        const req = store.getAll();
        req.onsuccess = () => {
          const list = req.result || [];
          list.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
          resolve(list);
        };
        req.onerror = () => reject(req.error);
      });
    } else {
      const data = localStorage.getItem('gv_settlements');
      const list = data ? JSON.parse(data) : [];
      list.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
      return list;
    }
  }

  async saveSettlement(settlement, options = {}) {
    if (!settlement.id) {
      settlement.id = 'stl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    }
    if (!settlement.timestamp) {
      settlement.timestamp = new Date().toISOString();
    }

    if (this.db) {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction('settlements', 'readwrite');
        const store = tx.objectStore('settlements');
        const req = store.put(settlement);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } else {
      const list = await this.getAllSettlements();
      const idx = list.findIndex(s => s.id === settlement.id);
      if (idx >= 0) list[idx] = settlement;
      else list.unshift(settlement);
      localStorage.setItem('gv_settlements', JSON.stringify(list));
    }

    if (!options.skipCloudSync) {
      this._syncCloud(sb => sb.upsertSettlement(settlement));
    }
    this._notify('settlements:changed', { action: 'save', settlement });
    return settlement;
  }

  async deleteSettlement(id, options = {}) {
    if (this.db) {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction('settlements', 'readwrite');
        const store = tx.objectStore('settlements');
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } else {
      let list = await this.getAllSettlements();
      list = list.filter(s => s.id !== id);
      localStorage.setItem('gv_settlements', JSON.stringify(list));
    }

    if (!options.skipCloudSync) {
      this._syncCloud(sb => sb.deleteSettlement(id));
    }
    this._notify('settlements:changed', { action: 'delete', id });
  }

  // ==========================================
  // MÉTODOS DE TRANSFERENCIAS (REPARTOS)
  // ==========================================

  async getAllTransfers() {
    if (this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction('transfers', 'readonly');
        const store = tx.objectStore('transfers');
        const req = store.getAll();
        req.onsuccess = () => {
          const transfers = req.result || [];
          transfers.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
          resolve(transfers);
        };
        req.onerror = () => reject(req.error);
      });
    } else {
      const data = localStorage.getItem('gv_transfers');
      const transfers = data ? JSON.parse(data) : [];
      transfers.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      return transfers;
    }
  }

  async saveTransfer(transfer, options = {}) {
    if (!transfer.id) {
      transfer.id = 'trf_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    }
    if (!transfer.timestamp) {
      transfer.timestamp = new Date().toISOString();
    }

    if (this.db) {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction('transfers', 'readwrite');
        const store = tx.objectStore('transfers');
        const req = store.put(transfer);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } else {
      const transfers = await this.getAllTransfers();
      const idx = transfers.findIndex(t => t.id === transfer.id);
      if (idx >= 0) transfers[idx] = transfer;
      else transfers.unshift(transfer);
      localStorage.setItem('gv_transfers', JSON.stringify(transfers));
    }

    if (!options.skipCloudSync) {
      this._syncCloud(sb => sb.upsertTransfer(transfer));
    }
    this._notify('transfers:changed', { action: 'save', transfer });
    return transfer;
  }

  async deleteTransfer(id, options = {}) {
    if (this.db) {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction('transfers', 'readwrite');
        const store = tx.objectStore('transfers');
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } else {
      let list = await this.getAllTransfers();
      list = list.filter(t => t.id !== id);
      localStorage.setItem('gv_transfers', JSON.stringify(list));
    }

    if (!options.skipCloudSync) {
      this._syncCloud(sb => sb.deleteTransfer(id));
    }
    this._notify('transfers:changed', { action: 'delete', id });
  }

  // ==========================================
  // MÉTODOS DE CONFIGURACIÓN
  // ==========================================

  async getConfig(key, defaultValue = null) {
    if (this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction('config', 'readonly');
        const store = tx.objectStore('config');
        const req = store.get(key);
        req.onsuccess = () => {
          resolve(req.result && req.result.value !== undefined ? req.result.value : defaultValue);
        };
        req.onerror = () => reject(req.error);
      });
    } else {
      const data = localStorage.getItem('gv_config');
      const configObj = data ? JSON.parse(data) : {};
      return configObj[key] !== undefined ? configObj[key] : defaultValue;
    }
  }

  async setConfig(key, value, options = {}) {
    const record = {
      key,
      value,
      updatedAt: new Date().toISOString()
    };

    if (this.db) {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction('config', 'readwrite');
        const store = tx.objectStore('config');
        const req = store.put(record);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } else {
      const data = localStorage.getItem('gv_config');
      const configObj = data ? JSON.parse(data) : {};
      configObj[key] = value;
      localStorage.setItem('gv_config', JSON.stringify(configObj));
    }

    if (!options.skipCloudSync) {
      this._syncCloud(sb => sb.upsertConfig(key, value));
    }
    this._notify('config:changed', { key, value });
    return value;
  }

  // ==========================================
  // MÉTODOS DE PRODUCTOS (INVENTARIO)
  // ==========================================

  async getAllProducts() {
    if (this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction('products', 'readonly');
        const store = tx.objectStore('products');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } else {
      const data = localStorage.getItem('gv_products');
      return data ? JSON.parse(data) : [];
    }
  }

  async getProductById(id) {
    if (this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction('products', 'readonly');
        const store = tx.objectStore('products');
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } else {
      const products = await this.getAllProducts();
      return products.find(p => p.id === id) || null;
    }
  }

  async saveProduct(product, options = {}) {
    if (!product.id) {
      product.id = 'prod_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    }
    product.updatedAt = new Date().toISOString();

    if (this.db) {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction('products', 'readwrite');
        const store = tx.objectStore('products');
        const req = store.put(product);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } else {
      const products = await this.getAllProducts();
      const idx = products.findIndex(p => p.id === product.id);
      if (idx >= 0) products[idx] = product;
      else products.push(product);
      localStorage.setItem('gv_products', JSON.stringify(products));
    }

    if (!options.skipCloudSync) {
      this._syncCloud(sb => sb.upsertProduct(product));
    }
    this._notify('products:changed', { action: 'save', product });
    return product;
  }

  async deleteProduct(id, options = {}) {
    if (this.db) {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction('products', 'readwrite');
        const store = tx.objectStore('products');
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } else {
      let products = await this.getAllProducts();
      products = products.filter(p => p.id !== id);
      localStorage.setItem('gv_products', JSON.stringify(products));
    }

    if (!options.skipCloudSync) {
      this._syncCloud(sb => sb.deleteProduct(id));
    }
    this._notify('products:changed', { action: 'delete', id });
  }

  // ==========================================
  // MÉTODOS DE VENTAS (TRANSACCIONES)
  // ==========================================

  async getAllSales() {
    if (this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction('sales', 'readonly');
        const store = tx.objectStore('sales');
        const req = store.getAll();
        req.onsuccess = () => {
          const sales = req.result || [];
          sales.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
          resolve(sales);
        };
        req.onerror = () => reject(req.error);
      });
    } else {
      const data = localStorage.getItem('gv_sales');
      const sales = data ? JSON.parse(data) : [];
      sales.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      return sales;
    }
  }

  async saveSale(sale, options = {}) {
    if (!sale.id) {
      sale.id = 'sale_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    }
    if (!sale.timestamp) {
      sale.timestamp = new Date().toISOString();
    }

    if (this.db) {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction('sales', 'readwrite');
        const store = tx.objectStore('sales');
        const req = store.put(sale);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } else {
      const sales = await this.getAllSales();
      const idx = sales.findIndex(s => s.id === sale.id);
      if (idx >= 0) sales[idx] = sale;
      else sales.unshift(sale);
      localStorage.setItem('gv_sales', JSON.stringify(sales));
    }

    if (!options.skipCloudSync) {
      this._syncCloud(sb => sb.upsertSale(sale));
    }
    this._notify('sales:changed', { action: 'save', sale });
    return sale;
  }

  async deleteSale(id, options = {}) {
    if (this.db) {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction('sales', 'readwrite');
        const store = tx.objectStore('sales');
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } else {
      let sales = await this.getAllSales();
      sales = sales.filter(s => s.id !== id);
      localStorage.setItem('gv_sales', JSON.stringify(sales));
    }

    if (!options.skipCloudSync) {
      this._syncCloud(sb => sb.deleteSale(id));
    }
    this._notify('sales:changed', { action: 'delete', id });
  }

  // ==========================================
  // MÉTODOS DE PEDIDOS / LOTES DE MERCANCÍA (ORDERS)
  // ==========================================

  async getAllOrders() {
    if (this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction('orders', 'readonly');
        const store = tx.objectStore('orders');
        const req = store.getAll();
        req.onsuccess = () => {
          const list = req.result || [];
          list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
          resolve(list);
        };
        req.onerror = () => reject(req.error);
      });
    } else {
      const data = localStorage.getItem('gv_orders');
      const list = data ? JSON.parse(data) : [];
      list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      return list;
    }
  }

  async getOrderById(id) {
    if (!id) return null;
    if (this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction('orders', 'readonly');
        const store = tx.objectStore('orders');
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } else {
      const list = await this.getAllOrders();
      return list.find(o => o.id === id) || null;
    }
  }

  async getActiveOrder() {
    const orders = await this.getAllOrders();
    return orders.find(o => o.status === 'active') || orders[0] || null;
  }

  async saveOrder(order, options = {}) {
    if (!order.id) {
      order.id = 'ord_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    }
    if (!order.createdAt) {
      order.createdAt = new Date().toISOString();
    }
    order.updatedAt = new Date().toISOString();

    if (this.db) {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction('orders', 'readwrite');
        const store = tx.objectStore('orders');
        const req = store.put(order);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } else {
      const list = await this.getAllOrders();
      const idx = list.findIndex(o => o.id === order.id);
      if (idx >= 0) list[idx] = order;
      else list.unshift(order);
      localStorage.setItem('gv_orders', JSON.stringify(list));
    }

    if (!options.skipCloudSync) {
      this._syncCloud(sb => sb.upsertOrder(order));
    }
    this._notify('orders:changed', { action: 'save', order });
    return order;
  }

  async deleteOrder(id, options = {}) {
    if (this.db) {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction('orders', 'readwrite');
        const store = tx.objectStore('orders');
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } else {
      let list = await this.getAllOrders();
      list = list.filter(o => o.id !== id);
      localStorage.setItem('gv_orders', JSON.stringify(list));
    }

    if (!options.skipCloudSync) {
      this._syncCloud(sb => sb.deleteOrder(id));
    }
    this._notify('orders:changed', { action: 'delete', id });
  }

  /**
   * Reemplaza la caché local completa con la información autoritativa descargada de Supabase.
   */
  async replaceAllFromCloud(remoteData = {}) {
    const warehouses = (remoteData.warehouses || []).map(w => this._normalizeWarehouseObject({ ...w }));
    if (!warehouses.some(w => w.id === MAIN_WAREHOUSE_ID)) {
      warehouses.unshift(this._getDefaultMainWarehouse());
    }
    const products = remoteData.products || [];
    const sales = remoteData.sales || [];
    const reservations = remoteData.reservations || [];
    const transfers = remoteData.transfers || [];
    const settlements = remoteData.settlements || [];
    const hasOrdersPayload = remoteData.orders !== null && remoteData.orders !== undefined;
    const orders = hasOrdersPayload ? remoteData.orders : null;

    if (this.db) {
      await new Promise((resolve, reject) => {
        const storeNames = ['products', 'sales', 'warehouses', 'transfers', 'reservations', 'settlements'];
        if (hasOrdersPayload) storeNames.push('orders');

        const tx = this.db.transaction(storeNames, 'readwrite');
        const prodStore = tx.objectStore('products');
        const salesStore = tx.objectStore('sales');
        const whStore = tx.objectStore('warehouses');
        const trfStore = tx.objectStore('transfers');
        const resStore = tx.objectStore('reservations');
        const stlStore = tx.objectStore('settlements');

        prodStore.clear();
        salesStore.clear();
        whStore.clear();
        trfStore.clear();
        resStore.clear();
        stlStore.clear();

        products.forEach(p => prodStore.put(p));
        sales.forEach(s => salesStore.put(s));
        warehouses.forEach(w => whStore.put(w));
        transfers.forEach(t => trfStore.put(t));
        reservations.forEach(r => resStore.put(r));
        settlements.forEach(st => stlStore.put(st));

        if (hasOrdersPayload) {
          const ordStore = tx.objectStore('orders');
          ordStore.clear();
          orders.forEach(o => ordStore.put(o));
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
      });
    } else {
      localStorage.setItem('gv_products', JSON.stringify(products));
      localStorage.setItem('gv_sales', JSON.stringify(sales));
      localStorage.setItem('gv_warehouses', JSON.stringify(warehouses));
      localStorage.setItem('gv_transfers', JSON.stringify(transfers));
      localStorage.setItem('gv_reservations', JSON.stringify(reservations));
      localStorage.setItem('gv_settlements', JSON.stringify(settlements));
      if (hasOrdersPayload) {
        localStorage.setItem('gv_orders', JSON.stringify(orders));
      }
    }

    this._notify('warehouses:changed', { action: 'cloud_replace' });
    this._notify('products:changed', { action: 'cloud_replace' });
    this._notify('sales:changed', { action: 'cloud_replace' });
    this._notify('reservations:changed', { action: 'cloud_replace' });
    this._notify('transfers:changed', { action: 'cloud_replace' });
    this._notify('settlements:changed', { action: 'cloud_replace' });
    this._notify('orders:changed', { action: 'cloud_replace' });
    return true;
  }

  // ==========================================
  // SINCRONIZACIÓN REMOTA EN TIEMPO REAL
  // ==========================================

  /**
   * Aplica un snapshot completo recibido por sincronización remota realizando merge por ID
   * para no perder ventas ni registros locales.
   */
  async applyRemoteSyncSnapshot(snapshot) {
    if (!snapshot) return false;
    const payload = snapshot.data ? snapshot.data : snapshot;

    const [
      localProducts,
      localWarehouses,
      localSales,
      localReservations,
      localTransfers,
      localSettlements
    ] = await Promise.all([
      this.getAllProducts(),
      this.getAllWarehouses(),
      this.getAllSales(),
      this.getAllReservations(),
      this.getAllTransfers(),
      this.getAllSettlements()
    ]);

    const mergeById = (localArr = [], remoteArr = []) => {
      const map = new Map();
      localArr.forEach(item => {
        if (item && item.id) map.set(item.id, item);
      });
      remoteArr.forEach(item => {
        if (item && item.id) {
          const existing = map.get(item.id);
          if (!existing) {
            map.set(item.id, item);
          } else {
            const localTime = new Date(existing.updatedAt || existing.timestamp || existing.createdAt || 0).getTime();
            const remoteTime = new Date(item.updatedAt || item.timestamp || item.createdAt || 0).getTime();
            if (remoteTime >= localTime) {
              map.set(item.id, { ...existing, ...item });
            }
          }
        }
      });
      return Array.from(map.values());
    };

    const mergedWarehouses = mergeById(localWarehouses, payload.warehouses || []).map(w =>
      this._normalizeWarehouseObject({ ...w })
    );
    if (!mergedWarehouses.some(w => w.id === MAIN_WAREHOUSE_ID)) {
      mergedWarehouses.unshift(this._getDefaultMainWarehouse());
    }

    const mergedProducts = mergeById(localProducts, payload.products || []).map(p => {
      const copy = { ...p };
      if (!copy.stockByWarehouse || typeof copy.stockByWarehouse !== 'object') {
        copy.stockByWarehouse = { [MAIN_WAREHOUSE_ID]: Math.max(0, parseInt(copy.stock, 10) || 0) };
      } else if (copy.stockByWarehouse[MAIN_WAREHOUSE_ID] === undefined) {
        copy.stockByWarehouse[MAIN_WAREHOUSE_ID] = 0;
      }
      copy.stock = Object.values(copy.stockByWarehouse).reduce(
        (sum, v) => sum + (Math.max(0, parseInt(v, 10) || 0)),
        0
      );
      return copy;
    });

    const mergedSales = mergeById(localSales, payload.sales || []);
    const mergedReservations = mergeById(localReservations, payload.reservations || []);
    const mergedTransfers = mergeById(localTransfers, payload.transfers || []);
    const mergedSettlements = mergeById(localSettlements, payload.settlements || []);

    if (this.db) {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction(
          ['products', 'sales', 'warehouses', 'transfers', 'reservations', 'settlements'],
          'readwrite'
        );
        const prodStore = tx.objectStore('products');
        const salesStore = tx.objectStore('sales');
        const whStore = tx.objectStore('warehouses');
        const trfStore = tx.objectStore('transfers');
        const resStore = tx.objectStore('reservations');
        const stlStore = tx.objectStore('settlements');

        mergedProducts.forEach(p => prodStore.put(p));
        mergedSales.forEach(s => salesStore.put(s));
        mergedWarehouses.forEach(w => whStore.put(w));
        mergedTransfers.forEach(t => trfStore.put(t));
        mergedReservations.forEach(r => resStore.put(r));
        mergedSettlements.forEach(st => stlStore.put(st));

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } else {
      localStorage.setItem('gv_products', JSON.stringify(mergedProducts));
      localStorage.setItem('gv_sales', JSON.stringify(mergedSales));
      localStorage.setItem('gv_warehouses', JSON.stringify(mergedWarehouses));
      localStorage.setItem('gv_transfers', JSON.stringify(mergedTransfers));
      localStorage.setItem('gv_reservations', JSON.stringify(mergedReservations));
      localStorage.setItem('gv_settlements', JSON.stringify(mergedSettlements));
    }

    this._notify('warehouses:changed', { action: 'sync' });
    this._notify('products:changed', { action: 'sync' });
    this._notify('sales:changed', { action: 'sync' });
    this._notify('reservations:changed', { action: 'sync' });
    this._notify('transfers:changed', { action: 'sync' });
    this._notify('settlements:changed', { action: 'sync' });
    return true;
  }

  /**
   * Aplica al instante una venta remota realizada por un trabajador (junto con su actualización de stock)
   * si aún no estaba registrada localmente.
   */
  async applyRemoteSaleEvent(sale, updatedProduct = null) {
    if (!sale || !sale.id) return { applied: false };

    const allSales = await this.getAllSales();
    if (allSales.some(s => s.id === sale.id)) {
      return { applied: false, sale };
    }

    await this.saveSale(sale);

    if (updatedProduct && updatedProduct.id) {
      const copy = { ...updatedProduct };
      if (copy.stockByWarehouse && typeof copy.stockByWarehouse === 'object') {
        copy.stock = Object.values(copy.stockByWarehouse).reduce(
          (sum, v) => sum + (Math.max(0, parseInt(v, 10) || 0)),
          0
        );
      }
      await this.saveProduct(copy);
    } else if (sale.productId) {
      const localProd = await this.getProductById(sale.productId);
      if (localProd) {
        const targetWh = sale.warehouseId || MAIN_WAREHOUSE_ID;
        const qty = parseInt(sale.quantity, 10) || 0;
        if (!localProd.stockByWarehouse || typeof localProd.stockByWarehouse !== 'object') {
          localProd.stockByWarehouse = { [MAIN_WAREHOUSE_ID]: Math.max(0, parseInt(localProd.stock, 10) || 0) };
        }
        const currentWhStock = parseInt(localProd.stockByWarehouse[targetWh], 10) || 0;
        localProd.stockByWarehouse[targetWh] = Math.max(0, currentWhStock - qty);
        localProd.stock = Object.values(localProd.stockByWarehouse).reduce(
          (sum, v) => sum + (Math.max(0, parseInt(v, 10) || 0)),
          0
        );
        await this.saveProduct(localProd);
      }
    }

    if (sale.reservationId) {
      try {
        await this.deleteReservation(sale.reservationId);
      } catch (_) {}
    }

    return { applied: true, sale };
  }

  // ==========================================
  // GESTIÓN DE COPIAS DE SEGURIDAD Y DATOS
  // ==========================================

  /**
   * Exporta toda la base de datos en un objeto JSON completo descargable (v3.0).
   */
  async exportBackup() {
    const [products, sales, warehouses, transfers, reservations, settlements, orders] = await Promise.all([
      this.getAllProducts(),
      this.getAllSales(),
      this.getAllWarehouses(),
      this.getAllTransfers(),
      this.getAllReservations(),
      this.getAllSettlements(),
      this.getAllOrders()
    ]);

    return {
      version: '4.0',
      exportedAt: new Date().toISOString(),
      appName: 'GestorInventarioVentas',
      data: {
        products,
        sales,
        warehouses,
        transfers,
        reservations,
        settlements,
        orders
      }
    };
  }

  /**
   * Restaura datos desde un objeto JSON de respaldo (compatible con v1.0, v2.0 y v3.0).
   */
  async importBackup(backupData) {
    if (!backupData || !backupData.data) {
      throw new Error('Formato de copia de seguridad no válido');
    }

    const rawProducts = backupData.data.products || [];
    const rawSales = backupData.data.sales || [];
    const rawWarehouses = backupData.data.warehouses || [];
    const rawTransfers = backupData.data.transfers || [];
    const rawReservations = backupData.data.reservations || [];
    const rawSettlements = backupData.data.settlements || [];
    const rawOrders = backupData.data.orders || [];

    const warehouses = rawWarehouses.map(w => this._normalizeWarehouseObject({ ...w }));
    let mainWh = warehouses.find(w => w.id === MAIN_WAREHOUSE_ID);
    if (!mainWh) {
      mainWh = this._getDefaultMainWarehouse();
      warehouses.unshift(mainWh);
    } else {
      mainWh.isMain = true;
    }

    const products = rawProducts.map(p => {
      const copy = { ...p };
      if (!copy.stockByWarehouse || typeof copy.stockByWarehouse !== 'object') {
        const initialStock = Math.max(0, parseInt(copy.stock, 10) || 0);
        copy.stockByWarehouse = { [MAIN_WAREHOUSE_ID]: initialStock };
      } else if (copy.stockByWarehouse[MAIN_WAREHOUSE_ID] === undefined) {
        copy.stockByWarehouse[MAIN_WAREHOUSE_ID] = 0;
      }
      copy.stock = Object.values(copy.stockByWarehouse).reduce(
        (sum, val) => sum + (Math.max(0, parseInt(val, 10) || 0)),
        0
      );
      return copy;
    });

    const sales = rawSales.map(s => ({
      ...s,
      warehouseId: s.warehouseId || MAIN_WAREHOUSE_ID,
      warehouseName: s.warehouseName || mainWh.name || 'Mi Almacén (Principal)',
      workerName: s.workerName !== undefined ? s.workerName : (mainWh.workerName || ''),
      paymentStatus: s.paymentStatus || 'paid',
      buyerName: s.buyerName || '',
      notes: s.notes || ''
    }));

    if (this.db) {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction(
          ['products', 'sales', 'warehouses', 'transfers', 'reservations', 'settlements', 'orders'],
          'readwrite'
        );
        const prodStore = tx.objectStore('products');
        const salesStore = tx.objectStore('sales');
        const whStore = tx.objectStore('warehouses');
        const trfStore = tx.objectStore('transfers');
        const resStore = tx.objectStore('reservations');
        const stlStore = tx.objectStore('settlements');
        const ordStore = tx.objectStore('orders');

        prodStore.clear();
        salesStore.clear();
        whStore.clear();
        trfStore.clear();
        resStore.clear();
        stlStore.clear();
        ordStore.clear();

        products.forEach(p => prodStore.put(p));
        sales.forEach(s => salesStore.put(s));
        warehouses.forEach(w => whStore.put(w));
        rawTransfers.forEach(t => trfStore.put(t));
        rawReservations.forEach(r => resStore.put(r));
        rawSettlements.forEach(st => stlStore.put(st));
        rawOrders.forEach(o => ordStore.put(o));

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } else {
      localStorage.setItem('gv_products', JSON.stringify(products));
      localStorage.setItem('gv_sales', JSON.stringify(sales));
      localStorage.setItem('gv_warehouses', JSON.stringify(warehouses));
      localStorage.setItem('gv_transfers', JSON.stringify(rawTransfers));
      localStorage.setItem('gv_reservations', JSON.stringify(rawReservations));
      localStorage.setItem('gv_settlements', JSON.stringify(rawSettlements));
      localStorage.setItem('gv_orders', JSON.stringify(rawOrders));
    }

    this._notify('warehouses:changed', { action: 'reset' });
    this._notify('products:changed', { action: 'reset' });
    this._notify('sales:changed', { action: 'reset' });
    this._notify('transfers:changed', { action: 'reset' });
    this._notify('reservations:changed', { action: 'reset' });
    this._notify('settlements:changed', { action: 'reset' });
    this._notify('orders:changed', { action: 'reset' });
    return true;
  }

  /**
   * Establece el catálogo exacto de los 10 productos oficiales con 10 unidades cada uno en el almacén principal.
   */
  async setNewProductCatalog() {
    const warehouses = await this.getAllWarehouses();
    let mainWh = warehouses.find(w => w.id === MAIN_WAREHOUSE_ID);
    if (!mainWh) {
      mainWh = this._getDefaultMainWarehouse();
      await this.saveWarehouse(mainWh);
    }

    for (const wh of warehouses) {
      wh.rewardVapersDelivered = 0;
      wh.cashSettledAmount = 0;
      await this.saveWarehouse(wh);
    }

    const now = new Date().toISOString();
    const newProducts = [
      { id: 'flavor_1', name: 'Coco Loco 🥥🌴', category: 'Sabores', costPrice: 6.70, sellPrice: 12.00, stock: 10 },
      { id: 'flavor_2', name: 'Strawberry Kiwi 🍓🥝', category: 'Sabores', costPrice: 6.70, sellPrice: 12.00, stock: 10 },
      { id: 'flavor_3', name: 'Blueberry Watermelon 🫐🍉', category: 'Sabores', costPrice: 6.70, sellPrice: 12.00, stock: 10 },
      { id: 'flavor_4', name: 'Black ice Dragon fruit Strawberry 🫐🧊🐉🍓', category: 'Sabores', costPrice: 6.70, sellPrice: 12.00, stock: 10 },
      { id: 'flavor_5', name: 'Love 66 🍈🍉🥭🌿', category: 'Sabores', costPrice: 6.70, sellPrice: 12.00, stock: 10 },
      { id: 'flavor_6', name: 'Tropical fruit 🍍🥭🍌🥥', category: 'Sabores', costPrice: 6.70, sellPrice: 12.00, stock: 10 },
      { id: 'flavor_7', name: 'Blueberry sour raspberry 🫐🍇🍋', category: 'Sabores', costPrice: 6.70, sellPrice: 12.00, stock: 10 },
      { id: 'flavor_8', name: 'Lemon peach passion fruit 🍋🍑🥭', category: 'Sabores', costPrice: 6.70, sellPrice: 12.00, stock: 10 },
      { id: 'flavor_9', name: 'Juicy peach ice 🍑💦🧊', category: 'Sabores', costPrice: 6.70, sellPrice: 12.00, stock: 10 },
      { id: 'flavor_10', name: 'Lemon lime 🍋🍋🟩', category: 'Sabores', costPrice: 6.70, sellPrice: 12.00, stock: 10 }
    ].map(p => ({
      ...p,
      stockByWarehouse: { [MAIN_WAREHOUSE_ID]: 10 },
      createdAt: now,
      updatedAt: now
    }));

    if (this.db) {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction(
          ['products', 'sales', 'transfers', 'reservations', 'settlements'],
          'readwrite'
        );
        tx.objectStore('products').clear();
        tx.objectStore('sales').clear();
        tx.objectStore('transfers').clear();
        tx.objectStore('reservations').clear();
        tx.objectStore('settlements').clear();

        const prodStore = tx.objectStore('products');
        newProducts.forEach(p => prodStore.put(p));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } else {
      localStorage.setItem('gv_products', JSON.stringify(newProducts));
      localStorage.setItem('gv_sales', JSON.stringify([]));
      localStorage.setItem('gv_transfers', JSON.stringify([]));
      localStorage.setItem('gv_reservations', JSON.stringify([]));
      localStorage.setItem('gv_settlements', JSON.stringify([]));
    }

    this._notify('products:changed', { action: 'reset' });
    this._notify('sales:changed', { action: 'reset' });
    this._notify('transfers:changed', { action: 'reset' });
    this._notify('reservations:changed', { action: 'reset' });
    this._notify('settlements:changed', { action: 'reset' });
  }

  /**
   * Asegura que existan datos iniciales y ejecuta migraciones transparentes a multi-almacén y v3.
   */
  async _ensureInitialData() {
    const warehouses = await this.getAllWarehouses();
    const mainWh = warehouses.find(w => w.id === MAIN_WAREHOUSE_ID) || this._getDefaultMainWarehouse();

    for (const wh of warehouses) {
      const hadPin = !!wh.workerPin;
      this._normalizeWarehouseObject(wh);
      if (
        (!wh.isMain && !hadPin) ||
        wh.rewardEveryNUnits === undefined ||
        wh.rewardFreeUnits === undefined ||
        wh.rewardVapersDelivered === undefined ||
        wh.cashSettledAmount === undefined
      ) {
        await this.saveWarehouse(wh);
      }
    }

    const products = await this.getAllProducts();
    if (products.length === 0) {
      await this.setNewProductCatalog();
    } else {
      for (const product of products) {
        let needsSave = false;

        if (!product.stockByWarehouse || typeof product.stockByWarehouse !== 'object') {
          const legacyStock = Math.max(0, parseInt(product.stock, 10) || 0);
          product.stockByWarehouse = { [MAIN_WAREHOUSE_ID]: legacyStock };
          needsSave = true;
        } else if (product.stockByWarehouse[MAIN_WAREHOUSE_ID] === undefined) {
          product.stockByWarehouse[MAIN_WAREHOUSE_ID] = 0;
          needsSave = true;
        }

        const totalStock = Object.values(product.stockByWarehouse).reduce(
          (sum, val) => sum + (Math.max(0, parseInt(val, 10) || 0)),
          0
        );

        if (product.stock !== totalStock) {
          product.stock = totalStock;
          needsSave = true;
        }

        if (needsSave) {
          await this.saveProduct(product);
        }
      }
    }

    // Asegurar que exista al menos un Pedido Inicial en 'orders' y asignar orderId a ventas antiguas
    let orders = await this.getAllOrders();
    let defaultOrder = orders.find(o => o.status === 'active') || orders[0];
    if (!defaultOrder) {
      const currentProds = await this.getAllProducts();
      const totalUnits = currentProds.reduce((s, p) => s + (parseInt(p.stock, 10) || 0), 0);
      const totalCost = currentProds.reduce((s, p) => s + (parseInt(p.stock, 10) || 0) * (parseFloat(p.costPrice) || 0), 0);
      const expectedRev = currentProds.reduce((s, p) => s + (parseInt(p.stock, 10) || 0) * (parseFloat(p.sellPrice) || 12), 0);
      defaultOrder = await this.saveOrder({
        id: 'order_1_initial',
        name: 'Pedido #1 (Inicial)',
        status: 'active',
        supplier: 'Proveedor Principal',
        notes: 'Pedido inicial de arranque',
        items: currentProds.map(p => ({
          productId: p.id,
          productName: p.name,
          quantity: parseInt(p.stock, 10) || 0,
          costPrice: parseFloat(p.costPrice) || 0,
          sellPrice: parseFloat(p.sellPrice) || 12
        })),
        totalUnits,
        totalCost: parseFloat(totalCost.toFixed(2)),
        expectedRevenue: parseFloat(expectedRev.toFixed(2))
      });
    }

    const sales = await this.getAllSales();
    for (const sale of sales) {
      let saleChanged = false;
      if (!sale.orderId) {
        sale.orderId = defaultOrder.id;
        sale.orderName = defaultOrder.name;
        saleChanged = true;
      }
      if (!sale.warehouseId) {
        sale.warehouseId = MAIN_WAREHOUSE_ID;
        sale.warehouseName = mainWh.name || 'Mi Almacén (Principal)';
        sale.workerName = mainWh.workerName || 'Jefe (Principal)';
        saleChanged = true;
      }
      if (!sale.paymentStatus) {
        sale.paymentStatus = 'paid';
        sale.paidAt = sale.timestamp;
        saleChanged = true;
      }
      if (sale.buyerName === undefined) {
        sale.buyerName = '';
        saleChanged = true;
      }
      if (saleChanged) {
        await this.saveSale(sale);
      }
    }
  }

  /**
   * Resetea el catálogo a los 10 productos oficiales.
   */
  async resetToDemo() {
    await this.setNewProductCatalog();
  }
}
