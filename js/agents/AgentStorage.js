/**
 * Agente de Persistencia y Almacenamiento Local
 * 
 * Responsable de la gestión autónoma del almacenamiento offline en el iPhone/Navegador.
 * Utiliza IndexedDB de alto rendimiento con fallback transparente a LocalStorage.
 * Proporciona persistencia duradera, eventos reactivos e importación/exportación de copias de seguridad.
 */

export class AgentStorage {
  constructor() {
    this.dbName = 'GestorVentasDB';
    this.dbVersion = 1;
    this.db = null;
    this.isIndexedDBSupported = typeof indexedDB !== 'undefined';
    this.listeners = new Map();
  }

  /**
   * Inicializa la conexión con IndexedDB o LocalStorage.
   */
  async init() {
    if (!this.isIndexedDBSupported) {
      console.warn('AgentStorage: IndexedDB no disponible, usando LocalStorage fallback.');
      return this._checkAndApplyCatalogV2();
    }

    return new Promise((resolve, reject) => {
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
      };

      request.onsuccess = async (event) => {
        this.db = event.target.result;
        await this._checkAndApplyCatalogV2();
        resolve(this);
      };

      request.onerror = (event) => {
        console.error('AgentStorage: Error al abrir IndexedDB:', event.target.error);
        this.isIndexedDBSupported = false;
        this._ensureInitialData().then(() => resolve(this));
      };
    });
  }

  /**
   * Suscribe callbacks para eventos de datos (ej: 'products:changed', 'sales:changed')
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

  async saveProduct(product) {
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

    this._notify('products:changed', { action: 'save', product });
    return product;
  }

  async deleteProduct(id) {
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
          // Devolver ordenadas de más reciente a más antigua
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

  async saveSale(sale) {
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
      sales.unshift(sale);
      localStorage.setItem('gv_sales', JSON.stringify(sales));
    }

    this._notify('sales:changed', { action: 'save', sale });
    return sale;
  }

  async deleteSale(id) {
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

    this._notify('sales:changed', { action: 'delete', id });
  }

  // ==========================================
  // GESTIÓN DE COPIAS DE SEGURIDAD Y DATOS
  // ==========================================

  /**
   * Exporta toda la base de datos en un objeto JSON completo descargable.
   */
  async exportBackup() {
    const products = await this.getAllProducts();
    const sales = await this.getAllSales();
    const backup = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      appName: 'GestorInventarioVentas',
      data: {
        products,
        sales
      }
    };
    return backup;
  }

  /**
   * Restaura datos desde un objeto JSON de respaldo.
   */
  async importBackup(backupData) {
    if (!backupData || !backupData.data) {
      throw new Error('Formato de copia de seguridad no válido');
    }

    const { products = [], sales = [] } = backupData.data;

    if (this.db) {
      // Limpiar y reinsertar
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction(['products', 'sales'], 'readwrite');
        const prodStore = tx.objectStore('products');
        const salesStore = tx.objectStore('sales');
        prodStore.clear();
        salesStore.clear();
        products.forEach(p => prodStore.put(p));
        sales.forEach(s => salesStore.put(s));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } else {
      localStorage.setItem('gv_products', JSON.stringify(products));
      localStorage.setItem('gv_sales', JSON.stringify(sales));
    }

    this._notify('products:changed', { action: 'reset' });
    this._notify('sales:changed', { action: 'reset' });
    return true;
  }

  /**
   * Comprueba directamente el catálogo. Si contiene productos antiguos (como Camiseta)
   * o no tiene los nuevos sabores, los reemplaza forzosamente por los 10 sabores oficiales.
   */
  async _checkAndApplyCatalogV2() {
    const products = await this.getAllProducts();
    const hasOldProducts = products.some(p => p.name && (p.name.includes('Camiseta') || p.name.includes('Sudadera') || p.name.includes('Taza')));
    const hasNewProducts = products.some(p => p.name && p.name.includes('Coco Loco'));

    if (hasOldProducts || !hasNewProducts || products.length !== 10) {
      console.log('Estableciendo los 10 sabores oficiales...');
      await this.setNewProductCatalog();
    }
  }

  /**
   * Establece el catálogo exacto de los 10 productos con 10 unidades cada uno.
   */
  async setNewProductCatalog() {
    const newProducts = [
      { id: 'flavor_1', name: 'Coco Loco 🥥🌴', category: 'Sabores', costPrice: 6.70, sellPrice: 13.00, stock: 10 },
      { id: 'flavor_2', name: 'Strawberry Kiwi 🍓🥝', category: 'Sabores', costPrice: 6.70, sellPrice: 13.00, stock: 10 },
      { id: 'flavor_3', name: 'Blueberry Watermelon 🫐🍉', category: 'Sabores', costPrice: 6.70, sellPrice: 13.00, stock: 10 },
      { id: 'flavor_4', name: 'Black ice Dragon fruit Strawberry 🫐🧊🐉🍓', category: 'Sabores', costPrice: 6.70, sellPrice: 13.00, stock: 10 },
      { id: 'flavor_5', name: 'Love 66 🍈🍉🥭🌿', category: 'Sabores', costPrice: 6.70, sellPrice: 13.00, stock: 10 },
      { id: 'flavor_6', name: 'Tropical fruit 🍍🥭🍌🥥', category: 'Sabores', costPrice: 6.70, sellPrice: 13.00, stock: 10 },
      { id: 'flavor_7', name: 'Blueberry sour raspberry 🫐🍇🍋', category: 'Sabores', costPrice: 6.70, sellPrice: 13.00, stock: 10 },
      { id: 'flavor_8', name: 'Lemon peach passion fruit 🍋🍑🥭', category: 'Sabores', costPrice: 6.70, sellPrice: 13.00, stock: 10 },
      { id: 'flavor_9', name: 'Juicy peach ice 🍑💦🧊', category: 'Sabores', costPrice: 6.70, sellPrice: 13.00, stock: 10 },
      { id: 'flavor_10', name: 'Lemon lime 🍋🍋🟩', category: 'Sabores', costPrice: 6.70, sellPrice: 13.00, stock: 10 }
    ].map(p => ({
      ...p,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));

    if (this.db) {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction(['products', 'sales'], 'readwrite');
        const prodStore = tx.objectStore('products');
        const salesStore = tx.objectStore('sales');
        prodStore.clear();
        salesStore.clear(); // Limpiar ventas anteriores para empezar limpio
        newProducts.forEach(p => prodStore.put(p));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } else {
      localStorage.setItem('gv_products', JSON.stringify(newProducts));
      localStorage.setItem('gv_sales', JSON.stringify([]));
    }

    this._notify('products:changed', { action: 'reset' });
    this._notify('sales:changed', { action: 'reset' });
  }

  /**
   * Si la app está vacía, asegura la inserción de los 10 productos.
   */
  async _ensureInitialData() {
    const products = await this.getAllProducts();
    if (products.length === 0) {
      await this.setNewProductCatalog();
    }
  }

  /**
   * Resetea el catálogo a los 10 productos oficiales.
   */
  async resetToDemo() {
    await this.setNewProductCatalog();
  }
}
