/**
 * Agente de Gestión de Inventario
 * 
 * Responsable de la lógica de catálogo, control de stock, precios de coste
 * y de venta, y operaciones de reabastecimiento o ajuste.
 */

export class AgentInventory {
  /**
   * @param {import('./AgentStorage.js').AgentStorage} storageAgent 
   */
  constructor(storageAgent) {
    this.storage = storageAgent;
    this.lowStockThreshold = 5; // Umbral de aviso de stock bajo
  }

  /**
   * Obtiene todos los productos del catálogo con opciones de filtrado.
   * @param {Object} [filters]
   * @param {string} [filters.query] Texto de búsqueda
   * @param {string} [filters.category] Categoría
   * @param {boolean} [filters.onlyLowStock] Solo con stock bajo
   */
  async getProducts(filters = {}) {
    const products = await this.storage.getAllProducts();

    return products.filter(item => {
      // Filtro de texto
      if (filters.query && filters.query.trim()) {
        const q = filters.query.toLowerCase().trim();
        const matchesName = item.name.toLowerCase().includes(q);
        const matchesCat = item.category ? item.category.toLowerCase().includes(q) : false;
        if (!matchesName && !matchesCat) return false;
      }

      // Filtro de categoría
      if (filters.category && filters.category !== 'all') {
        if (item.category !== filters.category) return false;
      }

      // Filtro de stock bajo
      if (filters.onlyLowStock) {
        if (item.stock > this.lowStockThreshold) return false;
      }

      return true;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Obtiene un producto individual por ID.
   */
  async getProduct(id) {
    return await this.storage.getProductById(id);
  }

  /**
   * Añade un nuevo producto al catálogo validando sus campos.
   */
  async addProduct(data) {
    this._validateProductData(data);

    const newProduct = {
      id: 'prod_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      name: data.name.trim(),
      category: (data.category || 'General').trim(),
      costPrice: parseFloat(data.costPrice) || 0,
      sellPrice: parseFloat(data.sellPrice) || 0,
      stock: parseInt(data.stock, 10) || 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    return await this.storage.saveProduct(newProduct);
  }

  /**
   * Actualiza los datos de un producto existente.
   */
  async updateProduct(id, data) {
    const existing = await this.storage.getProductById(id);
    if (!existing) {
      throw new Error(`Producto con ID ${id} no encontrado.`);
    }

    if (data.name !== undefined) existing.name = data.name.trim();
    if (data.category !== undefined) existing.category = data.category.trim();
    if (data.costPrice !== undefined) existing.costPrice = parseFloat(data.costPrice) || 0;
    if (data.sellPrice !== undefined) existing.sellPrice = parseFloat(data.sellPrice) || 0;
    if (data.stock !== undefined) existing.stock = parseInt(data.stock, 10) || 0;

    this._validateProductData(existing);
    return await this.storage.saveProduct(existing);
  }

  /**
   * Modifica el stock de forma relativa (+delta o -delta).
   */
  async adjustStock(id, delta) {
    const product = await this.storage.getProductById(id);
    if (!product) throw new Error('Producto no encontrado.');

    const newStock = product.stock + delta;
    if (newStock < 0) {
      throw new Error(`Stock insuficiente. Stock actual: ${product.stock}, intento de restar: ${Math.abs(delta)}`);
    }

    product.stock = newStock;
    return await this.storage.saveProduct(product);
  }

  /**
   * Elimina un producto del catálogo.
   */
  async deleteProduct(id) {
    return await this.storage.deleteProduct(id);
  }

  /**
   * Devuelve las categorías únicas existentes en el catálogo.
   */
  async getCategories() {
    const products = await this.storage.getAllProducts();
    const categories = new Set();
    products.forEach(p => {
      if (p.category) categories.add(p.category);
    });
    return Array.from(categories).sort();
  }

  /**
   * Calcula el resumen de valoración global del inventario actual.
   */
  async getInventoryValuation() {
    const products = await this.storage.getAllProducts();
    let totalStockUnits = 0;
    let totalCostValuation = 0;
    let totalRetailValuation = 0;
    let lowStockCount = 0;

    for (const p of products) {
      const stock = p.stock || 0;
      totalStockUnits += stock;
      totalCostValuation += stock * (p.costPrice || 0);
      totalRetailValuation += stock * (p.sellPrice || 0);
      if (stock <= this.lowStockThreshold) {
        lowStockCount++;
      }
    }

    const potentialGrossProfit = totalRetailValuation - totalCostValuation;

    return {
      totalProducts: products.length,
      totalStockUnits,
      totalCostValuation,
      totalRetailValuation,
      potentialGrossProfit,
      lowStockCount
    };
  }

  _validateProductData(data) {
    if (!data.name || !data.name.trim()) {
      throw new Error('El nombre del producto es obligatorio.');
    }
    if (data.costPrice !== undefined && (isNaN(data.costPrice) || data.costPrice < 0)) {
      throw new Error('El precio de coste debe ser un número mayor o igual a 0.');
    }
    if (data.sellPrice !== undefined && (isNaN(data.sellPrice) || data.sellPrice < 0)) {
      throw new Error('El precio de venta debe ser un número mayor o igual a 0.');
    }
    if (data.stock !== undefined && (isNaN(data.stock) || data.stock < 0)) {
      throw new Error('El stock no puede ser un valor negativo.');
    }
  }
}
