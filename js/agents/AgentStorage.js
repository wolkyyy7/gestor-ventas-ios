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
      return this._ensureInitialData();
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
        await this._ensureInitialData();
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
   * Si la app se abre por primera vez y no hay productos, carga un catálogo de muestra.
   */
  async _ensureInitialData() {
    const products = await this.getAllProducts();
    if (products.length === 0) {
      const demoProducts = [
        {
          id: 'prod_1',
          name: 'Camiseta Algodón Orgánico',
          category: 'Ropa',
          costPrice: 5.50,
          sellPrice: 18.00,
          stock: 24,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'prod_2',
          name: 'Sudadera Premium Capucha',
          category: 'Ropa',
          costPrice: 14.00,
          sellPrice: 38.00,
          stock: 12,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'prod_3',
          name: 'Taza Cerámica Hecha a Mano',
          category: 'Hogar',
          costPrice: 3.20,
          sellPrice: 12.00,
          stock: 18,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'prod_4',
          name: 'Gorra Ajustable Bordada',
          category: 'Accesorios',
          costPrice: 4.80,
          sellPrice: 16.50,
          stock: 4, // Stock bajo a propósito para mostrar la alerta visual
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'prod_5',
          name: 'Bolsa Tote Bag Eco',
          category: 'Accesorios',
          costPrice: 1.80,
          sellPrice: 7.50,
          stock: 35,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ];

      for (const p of demoProducts) {
        await this.saveProduct(p);
      }

      // Cargar un par de ventas de demostración de hoy
      const now = new Date();
      const demoSales = [
        {
          id: 'sale_demo_1',
          timestamp: new Date(now.getTime() - 1000 * 60 * 45).toISOString(),
          productId: 'prod_1',
          productName: 'Camiseta Algodón Orgánico',
          costPrice: 5.50,
          unitPrice: 18.00,
          quantity: 2,
          grossTotal: 36.00,
          totalCost: 11.00,
          netProfit: 25.00,
          paymentMethod: 'Tarjeta',
          notes: 'Venta presencial'
        },
        {
          id: 'sale_demo_2',
          timestamp: new Date(now.getTime() - 1000 * 60 * 15).toISOString(),
          productId: 'prod_3',
          productName: 'Taza Cerámica Hecha a Mano',
          costPrice: 3.20,
          unitPrice: 12.00,
          quantity: 1,
          grossTotal: 12.00,
          totalCost: 3.20,
          netProfit: 8.80,
          paymentMethod: 'Efectivo',
          notes: ''
        }
      ];

      for (const s of demoSales) {
        await this.saveSale(s);
      }
    }
  }

  /**
   * Resetea todos los datos y recarga los de demostración.
   */
  async resetToDemo() {
    if (this.db) {
      await new Promise((resolve) => {
        const tx = this.db.transaction(['products', 'sales'], 'readwrite');
        tx.objectStore('products').clear();
        tx.objectStore('sales').clear();
        tx.oncomplete = () => resolve();
      });
    } else {
      localStorage.removeItem('gv_products');
      localStorage.removeItem('gv_sales');
    }
    await this._ensureInitialData();
    this._notify('products:changed', { action: 'reset' });
    this._notify('sales:changed', { action: 'reset' });
  }
}
