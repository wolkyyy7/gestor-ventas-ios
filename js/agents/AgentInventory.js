/**
 * Agente de Gestión de Inventario Multi-Almacén, Reservas y Liquidaciones de Trabajadores
 * 
 * Responsable de:
 * - Lógica de catálogo y precios
 * - Gestión de múltiples almacenes (Almacén Principal + Casas de Trabajadores)
 * - Configuración de comisiones de trabajadores (1 vaper de regalo cada N vendidos) y liquidación de efectivo
 * - Sistema de Reservas de unidades para clientes (stock reservado vs stock libre disponible)
 * - Reparto/transferencia de stock entre almacenes
 * - Valoración financiera y generador de mensajes preescritos de stock listos para copiar y pegar
 */

import { MAIN_WAREHOUSE_ID } from './AgentStorage.js?v=5.2';

export class AgentInventory {
  /**
   * @param {import('./AgentStorage.js').AgentStorage} storageAgent 
   */
  constructor(storageAgent) {
    this.storage = storageAgent;
    this.lowStockThreshold = 5; // Umbral de aviso de stock bajo
  }

  // ==========================================
  // GESTIÓN DE ALMACENES, COMISIONES Y LIQUIDACIONES
  // ==========================================

  /**
   * Obtiene todos los almacenes registrados (con wh_main siempre primero).
   */
  async getWarehouses() {
    return await this.storage.getAllWarehouses();
  }

  /**
   * Obtiene un almacén por su ID.
   */
  async getWarehouse(id) {
    return await this.storage.getWarehouseById(id || MAIN_WAREHOUSE_ID);
  }

  /**
   * Crea un nuevo almacén secundario (ej. casa de un trabajador) con su regla de comisión.
   */
  async addWarehouse({
    name,
    workerName = '',
    icon = '🏠',
    color = 'indigo',
    notes = '',
    workerPin = '',
    rewardEveryNUnits = 5,
    rewardFreeUnits = 1
  }) {
    if (!name || !name.trim()) {
      throw new Error('El nombre del almacén o casa del trabajador es obligatorio.');
    }

    const cleanPin = workerPin && String(workerPin).trim().length >= 4
      ? String(workerPin).trim()
      : this.storage._generateDefaultWorkerPin();

    const now = new Date().toISOString();
    const newWarehouse = {
      id: 'wh_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      name: name.trim(),
      workerName: (workerName || '').trim(),
      icon: icon || '🏠',
      color: color || 'indigo',
      isMain: false,
      workerPin: cleanPin,
      notes: (notes || '').trim(),
      rewardEveryNUnits: Math.max(1, parseInt(rewardEveryNUnits, 10) || 5),
      rewardFreeUnits: Math.max(1, parseInt(rewardFreeUnits, 10) || 1),
      rewardVapersDelivered: 0,
      cashSettledAmount: 0,
      createdAt: now,
      updatedAt: now
    };

    return await this.storage.saveWarehouse(newWarehouse);
  }

  /**
   * Actualiza los datos de un almacén existente (incluido renombrar wh_main o ajustar comisiones).
   */
  async updateWarehouse(id, data = {}) {
    const existing = await this.storage.getWarehouseById(id);
    if (!existing) {
      throw new Error(`Almacén con ID ${id} no encontrado.`);
    }

    if (data.name !== undefined) {
      if (!data.name.trim()) {
        throw new Error('El nombre del almacén no puede estar vacío.');
      }
      existing.name = data.name.trim();
    }
    if (data.workerName !== undefined) existing.workerName = data.workerName.trim();
    if (data.icon !== undefined) existing.icon = data.icon || '🏠';
    if (data.color !== undefined) existing.color = data.color || 'indigo';
    if (data.notes !== undefined) existing.notes = data.notes.trim();
    if (data.workerPin !== undefined && !existing.isMain) {
      const cleanPin = String(data.workerPin).trim();
      if (cleanPin.length < 4) {
        throw new Error('El PIN del trabajador debe tener al menos 4 dígitos o caracteres.');
      }
      existing.workerPin = cleanPin;
    }
    if (data.rewardEveryNUnits !== undefined) {
      existing.rewardEveryNUnits = Math.max(1, parseInt(data.rewardEveryNUnits, 10) || 5);
    }
    if (data.rewardFreeUnits !== undefined) {
      existing.rewardFreeUnits = Math.max(1, parseInt(data.rewardFreeUnits, 10) || 1);
    }
    if (data.rewardVapersDelivered !== undefined) {
      existing.rewardVapersDelivered = Math.max(0, parseInt(data.rewardVapersDelivered, 10) || 0);
    }
    if (data.cashSettledAmount !== undefined) {
      existing.cashSettledAmount = Math.max(0, parseFloat(data.cashSettledAmount) || 0);
    }

    return await this.storage.saveWarehouse(existing);
  }

  /**
   * Registra que el jefe le ha entregado `count` vaper(s) de regalo al trabajador.
   * Si se pasa `productId`, descuenta opcionalmente ese vaper del stock físico en `fromWarehouseId`.
   */
  async deliverWorkerRewardVaper({
    workerWarehouseId,
    count = 1,
    productId = null,
    fromWarehouseId = MAIN_WAREHOUSE_ID,
    notes = ''
  }) {
    if (!workerWarehouseId) {
      throw new Error('Debes indicar el almacén/trabajador al que entregas el vaper de regalo.');
    }

    const qty = Math.max(1, parseInt(count, 10) || 1);
    const warehouse = await this.getWarehouse(workerWarehouseId);
    if (!warehouse) {
      throw new Error('Almacén del trabajador no encontrado.');
    }

    let productName = null;
    if (productId && productId !== 'none') {
      const product = await this.getProduct(productId);
      if (product) {
        productName = product.name;
        await this.adjustStock(productId, -qty, fromWarehouseId || MAIN_WAREHOUSE_ID);
      }
    }

    warehouse.rewardVapersDelivered = (parseInt(warehouse.rewardVapersDelivered, 10) || 0) + qty;
    await this.storage.saveWarehouse(warehouse);

    const settlement = await this.storage.saveSettlement({
      type: 'reward_vaper',
      warehouseId: workerWarehouseId,
      warehouseName: warehouse.name,
      workerName: warehouse.workerName || warehouse.name,
      count: qty,
      productId: productId && productId !== 'none' ? productId : null,
      productName,
      fromWarehouseId: productId && productId !== 'none' ? (fromWarehouseId || MAIN_WAREHOUSE_ID) : null,
      notes: (notes || '').trim(),
      timestamp: new Date().toISOString()
    });

    return {
      success: true,
      warehouse,
      settlement,
      message: productName
        ? `Entregado(s) ${qty} vaper(s) de regalo (${productName}) a ${warehouse.workerName || warehouse.name}.`
        : `Registrado(s) ${qty} vaper(s) de regalo entregado(s) a ${warehouse.workerName || warehouse.name}.`
    };
  }

  /**
   * Registra que el trabajador ha entregado `amount` (€) de recaudación al jefe.
   */
  async settleWorkerCash({ workerWarehouseId, amount, notes = '' }) {
    if (!workerWarehouseId) {
      throw new Error('Debes seleccionar el trabajador/almacén que entrega el dinero.');
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      throw new Error('El importe a liquidar debe ser mayor que 0€.');
    }

    const warehouse = await this.getWarehouse(workerWarehouseId);
    if (!warehouse) {
      throw new Error('Almacén del trabajador no encontrado.');
    }

    const cleanAmount = parseFloat(parsedAmount.toFixed(2));
    warehouse.cashSettledAmount = parseFloat(
      ((parseFloat(warehouse.cashSettledAmount) || 0) + cleanAmount).toFixed(2)
    );
    await this.storage.saveWarehouse(warehouse);

    const settlement = await this.storage.saveSettlement({
      type: 'cash_settlement',
      warehouseId: workerWarehouseId,
      warehouseName: warehouse.name,
      workerName: warehouse.workerName || warehouse.name,
      amount: cleanAmount,
      notes: (notes || '').trim(),
      timestamp: new Date().toISOString()
    });

    return {
      success: true,
      warehouse,
      settlement,
      message: `Liquidación registrada: ${parsedAmount.toFixed(2)}€ recibidos de ${warehouse.workerName || warehouse.name}.`
    };
  }

  /**
   * Obtiene el historial reciente de liquidaciones y entregas de vapers gratis.
   */
  async getRecentSettlements(limit = 30, warehouseId = 'all') {
    const all = await this.storage.getAllSettlements();
    const filtered = (!warehouseId || warehouseId === 'all')
      ? all
      : all.filter(s => s.warehouseId === warehouseId);
    return filtered.slice(0, limit);
  }

  /**
   * Elimina un almacén secundario.
   * Por defecto devuelve todo el stock que tuviera al Almacén Principal (wh_main).
   */
  async deleteWarehouse(id, { returnStockToMain = true } = {}) {
    if (!id || id === MAIN_WAREHOUSE_ID) {
      throw new Error('No se puede eliminar el Almacén Principal.');
    }

    const products = await this.storage.getAllProducts();
    for (const p of products) {
      this._normalizeProductStock(p);
      const whStock = parseInt(p.stockByWarehouse[id], 10) || 0;

      if (returnStockToMain && whStock > 0) {
        p.stockByWarehouse[MAIN_WAREHOUSE_ID] =
          (parseInt(p.stockByWarehouse[MAIN_WAREHOUSE_ID], 10) || 0) + whStock;
      }

      if (p.stockByWarehouse[id] !== undefined) {
        delete p.stockByWarehouse[id];
      }

      this._normalizeProductStock(p);
      await this.storage.saveProduct(p);
    }

    // Reasignar o limpiar reservas activas de ese almacén al principal
    const reservations = await this.storage.getAllReservations();
    for (const r of reservations) {
      if (r.warehouseId === id) {
        if (returnStockToMain) {
          r.warehouseId = MAIN_WAREHOUSE_ID;
          r.warehouseName = 'Mi Almacén (Principal)';
          await this.storage.saveReservation(r);
        } else {
          await this.storage.deleteReservation(r.id);
        }
      }
    }

    await this.storage.deleteWarehouse(id);
    return { success: true, deletedId: id };
  }

  // ==========================================
  // SISTEMA DE RESERVAS DE CLIENTES
  // ==========================================

  /**
   * Obtiene las reservas filtradas por estado y almacén.
   */
  async getReservations({ status = 'active', warehouseId = 'all', productId = null } = {}) {
    const all = await this.storage.getAllReservations();
    return all.filter(r => {
      const rStatus = r.status || 'active';
      if (status !== 'all' && rStatus !== status) return false;
      if (warehouseId && warehouseId !== 'all' && (r.warehouseId || MAIN_WAREHOUSE_ID) !== warehouseId) {
        return false;
      }
      if (productId && r.productId !== productId) return false;
      return true;
    });
  }

  /**
   * Crea una nueva reserva de unidades para un cliente concreto sin descontar aún la venta,
   * bloqueando esas unidades del stock libre disponible.
   */
  async addReservation({
    productId,
    warehouseId = MAIN_WAREHOUSE_ID,
    quantity,
    customerName,
    agreedUnitPrice = null,
    notes = ''
  }) {
    if (!customerName || !customerName.trim()) {
      throw new Error('Debes indicar el nombre del cliente para la reserva.');
    }

    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
      throw new Error('La cantidad a reservar debe ser de al menos 1 unidad.');
    }

    const targetWh = (!warehouseId || warehouseId === 'all') ? MAIN_WAREHOUSE_ID : warehouseId;
    const [product, warehouse, activeReservations] = await Promise.all([
      this.getProduct(productId),
      this.getWarehouse(targetWh),
      this.getReservations({ status: 'active', warehouseId: targetWh, productId })
    ]);

    if (!product) {
      throw new Error('Producto no encontrado.');
    }

    const physicalStock = this.getProductStock(product, targetWh);
    const alreadyReserved = activeReservations.reduce((sum, r) => sum + (parseInt(r.quantity, 10) || 0), 0);
    const availableStock = Math.max(0, physicalStock - alreadyReserved);

    const whName = warehouse ? warehouse.name : 'Mi Almacén (Principal)';

    if (availableStock < qty) {
      throw new Error(
        `No hay suficiente stock libre de "${product.name}" en "${whName}". ` +
        `Físico: ${physicalStock} uds, ya reservadas: ${alreadyReserved} uds, libres: ${availableStock} uds.`
      );
    }

    const parsedPrice = (agreedUnitPrice !== null && agreedUnitPrice !== '' && !isNaN(parseFloat(agreedUnitPrice)))
      ? parseFloat(agreedUnitPrice)
      : (parseFloat(product.sellPrice) || 12.00);

    const reservation = await this.storage.saveReservation({
      productId: product.id,
      productName: product.name,
      warehouseId: targetWh,
      warehouseName: whName,
      workerName: warehouse?.workerName || '',
      customerName: customerName.trim(),
      quantity: qty,
      agreedUnitPrice: parseFloat(parsedPrice.toFixed(2)),
      notes: (notes || '').trim(),
      status: 'active',
      createdAt: new Date().toISOString()
    });

    return {
      success: true,
      reservation,
      message: `Reservadas ${qty} uds de "${product.name}" para ${customerName.trim()} (${whName}).`
    };
  }

  /**
   * Cancela y elimina una reserva activa, liberando inmediatamente las unidades.
   */
  async cancelReservation(reservationId) {
    if (!reservationId) {
      throw new Error('ID de reserva no válido.');
    }
    await this.storage.deleteReservation(reservationId);
    return {
      success: true,
      deletedId: reservationId,
      message: 'Reserva cancelada. Las unidades vuelven a estar libres.'
    };
  }

  // ==========================================
  // GESTIÓN DE PRODUCTOS Y STOCK MULTI-ALMACÉN
  // ==========================================

  /**
   * Asegura que product.stockByWarehouse sea un objeto válido (con wh_main >= 0)
   * y actualiza product.stock como la suma exacta de todos los almacenes.
   */
  _normalizeProductStock(product) {
    if (!product) return product;

    if (!product.stockByWarehouse || typeof product.stockByWarehouse !== 'object') {
      const fallbackStock = Math.max(0, parseInt(product.stock, 10) || 0);
      product.stockByWarehouse = { [MAIN_WAREHOUSE_ID]: fallbackStock };
    } else if (product.stockByWarehouse[MAIN_WAREHOUSE_ID] === undefined) {
      product.stockByWarehouse[MAIN_WAREHOUSE_ID] = 0;
    }

    let total = 0;
    for (const [whId, val] of Object.entries(product.stockByWarehouse)) {
      const cleanVal = Math.max(0, parseInt(val, 10) || 0);
      product.stockByWarehouse[whId] = cleanVal;
      total += cleanVal;
    }

    product.stock = total;
    return product;
  }

  /**
   * Obtiene el stock de un producto en un almacén concreto o global ('all').
   * Si recibe el objeto producto devuelve el número directamente; si recibe un ID devuelve una Promise.
   */
  getProductStock(productOrId, warehouseId = 'all') {
    const computeStock = (product) => {
      if (!product) return 0;
      this._normalizeProductStock(product);
      if (!warehouseId || warehouseId === 'all') {
        return product.stock || 0;
      }
      return product.stockByWarehouse?.[warehouseId] || 0;
    };

    if (typeof productOrId === 'object' && productOrId !== null) {
      return computeStock(productOrId);
    }

    return this.storage.getProductById(productOrId).then(product => computeStock(product));
  }

  /**
   * Obtiene todos los productos del catálogo con opciones de filtrado y enriquecidos
   * con `warehouseStock`, `reservedByWarehouse`, `warehouseReserved`, `availableStock`
   * y `activeReservations` según el `filters.warehouseId` seleccionado.
   */
  async getProducts(filters = {}) {
    const [rawProducts, allReservations] = await Promise.all([
      this.storage.getAllProducts(),
      this.storage.getAllReservations()
    ]);

    const activeReservationsList = allReservations.filter(r => (r.status || 'active') === 'active');
    const targetWh = filters.warehouseId || 'all';

    const enrichedProducts = rawProducts.map(item => {
      const copy = {
        ...item,
        stockByWarehouse: item.stockByWarehouse ? { ...item.stockByWarehouse } : undefined
      };
      this._normalizeProductStock(copy);

      copy.warehouseStock = targetWh === 'all'
        ? copy.stock
        : (copy.stockByWarehouse[targetWh] || 0);

      // Calcular reservas activas para este producto
      const prodReservations = activeReservationsList.filter(r => r.productId === copy.id);
      const reservedByWarehouse = {};
      let totalReserved = 0;

      prodReservations.forEach(r => {
        const rWh = r.warehouseId || MAIN_WAREHOUSE_ID;
        const rQty = Math.max(0, parseInt(r.quantity, 10) || 0);
        reservedByWarehouse[rWh] = (reservedByWarehouse[rWh] || 0) + rQty;
        totalReserved += rQty;
      });

      const warehouseReserved = targetWh === 'all'
        ? totalReserved
        : (reservedByWarehouse[targetWh] || 0);

      copy.reservedByWarehouse = reservedByWarehouse;
      copy.totalReserved = totalReserved;
      copy.warehouseReserved = warehouseReserved;
      copy.availableStock = Math.max(0, copy.warehouseStock - warehouseReserved);
      copy.activeReservations = targetWh === 'all'
        ? prodReservations
        : prodReservations.filter(r => (r.warehouseId || MAIN_WAREHOUSE_ID) === targetWh);

      return copy;
    });

    return enrichedProducts.filter(item => {
      // Filtro de texto
      if (filters.query && filters.query.trim()) {
        const q = filters.query.toLowerCase().trim();
        const matchesName = item.name.toLowerCase().includes(q);
        const matchesCat = item.category ? item.category.toLowerCase().includes(q) : false;
        const matchesCustomer = item.activeReservations.some(
          r => r.customerName && r.customerName.toLowerCase().includes(q)
        );
        if (!matchesName && !matchesCat && !matchesCustomer) return false;
      }

      // Filtro de categoría
      if (filters.category && filters.category !== 'all') {
        if (item.category !== filters.category) return false;
      }

      // Filtro de stock bajo evaluado sobre warehouseStock
      if (filters.onlyLowStock) {
        if (item.warehouseStock > this.lowStockThreshold) return false;
      }

      // Filtro de solo disponibles evaluado sobre warehouseStock
      if (filters.onlyAvailable) {
        if (item.warehouseStock <= 0) return false;
      }

      return true;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Obtiene un producto individual por ID con su stock normalizado.
   */
  async getProduct(id) {
    const product = await this.storage.getProductById(id);
    if (!product) return null;
    return this._normalizeProductStock(product);
  }

  /**
   * Añade un nuevo producto al catálogo validando sus campos y su stock por almacén.
   */
  async addProduct(data) {
    this._validateProductData(data);

    const targetWh = (data.warehouseId && data.warehouseId !== 'all')
      ? data.warehouseId
      : MAIN_WAREHOUSE_ID;

    let stockByWarehouse = { [MAIN_WAREHOUSE_ID]: 0 };
    if (data.stockByWarehouse && typeof data.stockByWarehouse === 'object') {
      stockByWarehouse = { ...stockByWarehouse, ...data.stockByWarehouse };
    } else {
      const initialStock = Math.max(0, parseInt(data.stock, 10) || 0);
      stockByWarehouse[targetWh] = initialStock;
    }

    const now = new Date().toISOString();
    const newProduct = {
      id: 'prod_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      name: data.name.trim(),
      category: (data.category || 'General').trim(),
      costPrice: parseFloat(data.costPrice) || 0,
      sellPrice: parseFloat(data.sellPrice) || 0,
      stockByWarehouse,
      stock: 0,
      createdAt: now,
      updatedAt: now
    };

    this._normalizeProductStock(newProduct);
    return await this.storage.saveProduct(newProduct);
  }

  /**
   * Actualiza los datos de un producto existente y recalcula su stock multi-almacén.
   */
  async updateProduct(id, data) {
    const existing = await this.storage.getProductById(id);
    if (!existing) {
      throw new Error(`Producto con ID ${id} no encontrado.`);
    }

    this._normalizeProductStock(existing);

    if (data.name !== undefined) existing.name = String(data.name || '').trim();
    if (data.category !== undefined) existing.category = String(data.category || '').trim();
    if (data.costPrice !== undefined) {
      const cp = parseFloat(data.costPrice);
      if (isNaN(cp)) throw new Error('El precio de coste debe ser un número válido.');
      existing.costPrice = cp;
    }
    if (data.sellPrice !== undefined) {
      const sp = parseFloat(data.sellPrice);
      if (isNaN(sp)) throw new Error('El precio de venta debe ser un número válido.');
      existing.sellPrice = sp;
    }

    if (data.stockByWarehouse && typeof data.stockByWarehouse === 'object') {
      existing.stockByWarehouse = {
        ...existing.stockByWarehouse,
        ...data.stockByWarehouse
      };
    } else if (data.stock !== undefined) {
      const parsedStock = parseInt(data.stock, 10);
      if (isNaN(parsedStock) || parsedStock < 0) {
        throw new Error('El stock debe ser un número entero mayor o igual a 0.');
      }
      const targetWh = (data.warehouseId && data.warehouseId !== 'all')
        ? data.warehouseId
        : MAIN_WAREHOUSE_ID;
      existing.stockByWarehouse[targetWh] = parsedStock;
    }

    this._normalizeProductStock(existing);
    this._validateProductData(existing);
    return await this.storage.saveProduct(existing);
  }

  /**
   * Modifica el stock de un almacén específico de forma relativa (+delta o -delta).
   */
  async adjustStock(id, delta, warehouseId = MAIN_WAREHOUSE_ID) {
    const parsedDelta = parseInt(delta, 10);
    if (isNaN(parsedDelta)) {
      throw new Error('La cantidad de ajuste de stock no es válida.');
    }

    const product = await this.storage.getProductById(id);
    if (!product) throw new Error('Producto no encontrado.');

    this._normalizeProductStock(product);
    const targetWh = (!warehouseId || warehouseId === 'all') ? MAIN_WAREHOUSE_ID : warehouseId;
    const currentWhStock = product.stockByWarehouse[targetWh] || 0;
    const newWhStock = currentWhStock + parsedDelta;

    if (newWhStock < 0) {
      const wh = await this.getWarehouse(targetWh);
      const whName = wh ? wh.name : targetWh;
      throw new Error(
        `Stock insuficiente en "${whName}". Stock actual: ${currentWhStock}, intento de restar: ${Math.abs(parsedDelta)}.`
      );
    }

    product.stockByWarehouse[targetWh] = newWhStock;
    this._normalizeProductStock(product);
    return await this.storage.saveProduct(product);
  }

  /**
   * Fija el stock exacto (>= 0) en el almacén indicado y recalcula el stock global.
   */
  async setWarehouseStock(id, exactStock, warehouseId = MAIN_WAREHOUSE_ID) {
    const parsed = parseInt(exactStock, 10);
    if (isNaN(parsed) || parsed < 0) {
      throw new Error('El stock debe ser un número entero mayor o igual a 0.');
    }

    const product = await this.storage.getProductById(id);
    if (!product) throw new Error('Producto no encontrado.');

    this._normalizeProductStock(product);
    const targetWh = (!warehouseId || warehouseId === 'all') ? MAIN_WAREHOUSE_ID : warehouseId;
    product.stockByWarehouse[targetWh] = parsed;
    this._normalizeProductStock(product);

    return await this.storage.saveProduct(product);
  }

  /**
   * Transfiere/reparte unidades de un producto desde un almacén de origen a otro de destino de forma atómica.
   */
  async transferStock({ productId, fromWarehouseId = MAIN_WAREHOUSE_ID, toWarehouseId, quantity, notes = '' }) {
    if (!fromWarehouseId || !toWarehouseId) {
      throw new Error('Debes seleccionar el almacén de origen y el de destino.');
    }
    if (fromWarehouseId === toWarehouseId) {
      throw new Error('El almacén de origen y el de destino no pueden ser el mismo.');
    }

    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
      throw new Error('La cantidad a transferir debe ser al menos 1 unidad.');
    }

    const product = await this.storage.getProductById(productId);
    if (!product) {
      throw new Error('Producto no encontrado.');
    }

    this._normalizeProductStock(product);

    const [fromWh, toWh] = await Promise.all([
      this.getWarehouse(fromWarehouseId),
      this.getWarehouse(toWarehouseId)
    ]);

    if (!toWh) {
      throw new Error('El almacén de destino no existe.');
    }

    const fromName = fromWh ? fromWh.name : 'Almacén Origen';
    const toName = toWh.name;

    const currentOriginStock = product.stockByWarehouse[fromWarehouseId] || 0;
    if (currentOriginStock < qty) {
      throw new Error(
        `Stock insuficiente de "${product.name}" en "${fromName}". Disponible: ${currentOriginStock} uds, solicitado: ${qty} uds.`
      );
    }

    const currentDestStock = product.stockByWarehouse[toWarehouseId] || 0;
    product.stockByWarehouse[fromWarehouseId] = currentOriginStock - qty;
    product.stockByWarehouse[toWarehouseId] = currentDestStock + qty;
    this._normalizeProductStock(product);

    await this.storage.saveProduct(product);

    const transfer = await this.storage.saveTransfer({
      productId: product.id,
      productName: product.name,
      fromWarehouseId,
      fromWarehouseName: fromName,
      toWarehouseId,
      toWarehouseName: toName,
      toWorkerName: toWh.workerName || '',
      quantity: qty,
      notes: (notes || '').trim(),
      timestamp: new Date().toISOString()
    });

    return {
      success: true,
      transfer,
      product,
      message: `Repartidas ${qty} uds de "${product.name}": ${fromName} → ${toName}`
    };
  }

  /**
   * Permite transferir varios productos a la vez de un almacén a otro
   * (ej. para repartir mercancía del Almacén Principal a la casa de un trabajador).
   */
  async batchTransferStock({ fromWarehouseId = MAIN_WAREHOUSE_ID, toWarehouseId, items = [], notes = '' }) {
    if (!fromWarehouseId || !toWarehouseId) {
      throw new Error('Debes indicar el almacén de origen y el de destino.');
    }
    if (fromWarehouseId === toWarehouseId) {
      throw new Error('El almacén de origen y el de destino deben ser distintos.');
    }

    const aggregatedMap = new Map();
    for (const it of (items || [])) {
      if (!it || !it.productId) continue;
      const qty = parseInt(it.quantity, 10);
      if (isNaN(qty) || qty < 0) {
        throw new Error('Las cantidades de transferencia no pueden ser negativas.');
      }
      if (qty === 0) continue;
      aggregatedMap.set(it.productId, (aggregatedMap.get(it.productId) || 0) + qty);
    }
    const validItems = Array.from(aggregatedMap.entries()).map(([productId, quantity]) => ({ productId, quantity }));

    if (validItems.length === 0) {
      throw new Error('Selecciona al menos un producto con cantidad mayor a 0 para transferir.');
    }

    // Pre-validación atómica de disponibilidad en origen y almacén destino antes de ejecutar
    const [fromWh, toWh] = await Promise.all([
      this.getWarehouse(fromWarehouseId),
      this.getWarehouse(toWarehouseId)
    ]);
    if (!toWh) {
      throw new Error('Almacén de destino no encontrado.');
    }
    const fromName = fromWh ? fromWh.name : 'Almacén Origen';
    const toName = toWh.name;

    for (const item of validItems) {
      const prod = await this.storage.getProductById(item.productId);
      if (!prod) {
        throw new Error(`Producto no encontrado (${item.productId}).`);
      }
      this._normalizeProductStock(prod);
      const avail = prod.stockByWarehouse[fromWarehouseId] || 0;
      if (avail < item.quantity) {
        throw new Error(
          `Stock insuficiente de "${prod.name}" en "${fromName}" (disponible: ${avail}, solicitado: ${item.quantity}).`
        );
      }
    }

    const transfers = [];
    let totalUnitsTransferred = 0;

    for (const item of validItems) {
      const res = await this.transferStock({
        productId: item.productId,
        fromWarehouseId,
        toWarehouseId,
        quantity: item.quantity,
        notes
      });
      transfers.push(res.transfer);
      totalUnitsTransferred += item.quantity;
    }

    return {
      success: true,
      transfers,
      totalUnitsTransferred,
      message: `Reparto completado: ${totalUnitsTransferred} unidades enviadas a "${toName}".`
    };
  }

  /**
   * Obtiene los últimos movimientos / repartos de stock entre almacenes.
   */
  async getRecentTransfers(limit = 30) {
    const transfers = await this.storage.getAllTransfers();
    return transfers.slice(0, limit);
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
   * Calcula la valoración del inventario tanto para el warehouseId consultado ('all' o específico)
   * como el desglose completo `byWarehouse` para cada almacén registrado, incluyendo unidades reservadas.
   */
  async getInventoryValuation(warehouseId = 'all') {
    const [products, warehouses, allReservations] = await Promise.all([
      this.storage.getAllProducts(),
      this.storage.getAllWarehouses(),
      this.storage.getAllReservations()
    ]);

    const activeReservations = allReservations.filter(r => (r.status || 'active') === 'active');

    products.forEach(p => this._normalizeProductStock(p));

    const globalTotalUnits = products.reduce((sum, p) => sum + (p.stock || 0), 0);

    // Desglose por cada almacén
    const byWarehouse = warehouses.map(wh => {
      let totalUnits = 0;
      let productsWithStock = 0;
      let lowStockCount = 0;
      let outOfStockCount = 0;
      let costValuation = 0;
      let retailValuation = 0;

      for (const p of products) {
        const whStock = p.stockByWarehouse[wh.id] || 0;
        totalUnits += whStock;
        costValuation += whStock * (p.costPrice || 0);
        retailValuation += whStock * (p.sellPrice || 0);

        if (whStock > 0) productsWithStock++;
        if (whStock === 0) outOfStockCount++;
        if (whStock <= this.lowStockThreshold) lowStockCount++;
      }

      let reservedUnits = 0;
      for (const p of products) {
        const whStock = p.stockByWarehouse[wh.id] || 0;
        const prodReserved = activeReservations
          .filter(r => r.productId === p.id && (r.warehouseId || MAIN_WAREHOUSE_ID) === wh.id)
          .reduce((sum, r) => sum + (parseInt(r.quantity, 10) || 0), 0);
        reservedUnits += Math.min(whStock, prodReserved);
      }

      const availableUnits = Math.max(0, totalUnits - reservedUnits);
      const potentialProfit = retailValuation - costValuation;
      const stockSharePercentage = globalTotalUnits > 0
        ? parseFloat(((totalUnits / globalTotalUnits) * 100).toFixed(1))
        : 0;

      return {
        warehouseId: wh.id,
        name: wh.name,
        workerName: wh.workerName || '',
        icon: wh.icon || '🏠',
        color: wh.color || 'indigo',
        isMain: !!wh.isMain,
        rewardEveryNUnits: wh.rewardEveryNUnits || 5,
        rewardFreeUnits: wh.rewardFreeUnits || 1,
        rewardVapersDelivered: wh.rewardVapersDelivered || 0,
        cashSettledAmount: wh.cashSettledAmount || 0,
        totalUnits,
        reservedUnits,
        availableUnits,
        productsWithStock,
        lowStockCount,
        outOfStockCount,
        costValuation: parseFloat(costValuation.toFixed(2)),
        retailValuation: parseFloat(retailValuation.toFixed(2)),
        potentialProfit: parseFloat(potentialProfit.toFixed(2)),
        stockSharePercentage
      };
    });

    // Métricas del warehouseId consultado
    let totalStockUnits = 0;
    let totalCostValuation = 0;
    let totalRetailValuation = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let productsWithStock = 0;

    for (const p of products) {
      const stock = (!warehouseId || warehouseId === 'all')
        ? (p.stock || 0)
        : (p.stockByWarehouse[warehouseId] || 0);

      totalStockUnits += stock;
      totalCostValuation += stock * (p.costPrice || 0);
      totalRetailValuation += stock * (p.sellPrice || 0);

      if (stock > 0) productsWithStock++;
      if (stock === 0) outOfStockCount++;
      if (stock <= this.lowStockThreshold) lowStockCount++;
    }

    let totalReservedUnits = 0;
    for (const p of products) {
      const stock = (!warehouseId || warehouseId === 'all')
        ? (p.stock || 0)
        : (p.stockByWarehouse[warehouseId] || 0);
      const prodReserved = activeReservations
        .filter(r => r.productId === p.id && ((!warehouseId || warehouseId === 'all') ? true : (r.warehouseId || MAIN_WAREHOUSE_ID) === warehouseId))
        .reduce((sum, r) => sum + (parseInt(r.quantity, 10) || 0), 0);
      totalReservedUnits += Math.min(stock, prodReserved);
    }

    const totalAvailableUnits = Math.max(0, totalStockUnits - totalReservedUnits);
    const potentialGrossProfit = totalRetailValuation - totalCostValuation;

    return {
      warehouseId,
      totalProducts: products.length,
      productsWithStock,
      totalStockUnits,
      totalReservedUnits,
      totalAvailableUnits,
      totalCostValuation: parseFloat(totalCostValuation.toFixed(2)),
      totalRetailValuation: parseFloat(totalRetailValuation.toFixed(2)),
      potentialGrossProfit: parseFloat(potentialGrossProfit.toFixed(2)),
      lowStockCount,
      outOfStockCount,
      byWarehouse
    };
  }

  /**
   * Genera un mensaje preescrito de stock listo para copiar y pegar en WhatsApp, Telegram o Notas.
   * Por defecto genera el mensaje del Almacén Principal ('wh_main') y descuenta las unidades reservadas
   * (`subtractReservations = true`) para no ofrecer unidades ya apartadas a clientes.
   */
  async generateStockMessage(options = {}) {
    const {
      warehouseId = MAIN_WAREHOUSE_ID,
      onlyAvailable = true,
      showQuantities = true,
      showPrices = false,
      subtractReservations = true,
      style = 'whatsapp',
      customHeader = '',
      customFooter = ''
    } = options;

    const [products, warehouses, allReservations] = await Promise.all([
      this.storage.getAllProducts(),
      this.storage.getAllWarehouses(),
      this.storage.getAllReservations()
    ]);

    const activeReservations = allReservations.filter(r => (r.status || 'active') === 'active');

    let warehouseName = 'Mi Almacén (Principal)';
    if (warehouseId === 'all') {
      warehouseName = 'Stock Total (Todos los almacenes)';
    } else {
      const wh = warehouses.find(w => w.id === warehouseId);
      if (wh) warehouseName = wh.name;
    }

    // Ordenar productos alfabéticamente y calcular su stock libre en el almacén elegido
    const items = products
      .map(p => {
        this._normalizeProductStock(p);
        const physicalQty = warehouseId === 'all'
          ? (p.stock || 0)
          : (p.stockByWarehouse[warehouseId] || 0);

        const reservedQty = activeReservations
          .filter(r => r.productId === p.id && (warehouseId === 'all' ? true : (r.warehouseId || MAIN_WAREHOUSE_ID) === warehouseId))
          .reduce((sum, r) => sum + (parseInt(r.quantity, 10) || 0), 0);

        const qty = subtractReservations ? Math.max(0, physicalQty - reservedQty) : physicalQty;

        return {
          id: p.id,
          name: p.name,
          sellPrice: p.sellPrice || 0,
          physicalQty,
          reservedQty,
          qty
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const totalProductsCount = items.length;
    const availableProductsCount = items.filter(i => i.qty > 0).length;
    const totalUnits = items.reduce((sum, i) => sum + i.qty, 0);
    const totalReservedUnits = items.reduce((sum, i) => sum + i.reservedQty, 0);

    const visibleItems = onlyAvailable ? items.filter(i => i.qty > 0) : items;

    const lines = [];

    // Encabezado
    if (customHeader && customHeader.trim()) {
      lines.push(customHeader.trim());
      lines.push('');
    } else {
      if (style === 'whatsapp') {
        lines.push('🔥 *SABORES DISPONIBLES* 🔥');
        lines.push('');
      } else if (style === 'clean') {
        lines.push('SABORES DISPONIBLES:');
        lines.push('');
      } else if (style === 'compact') {
        lines.push('📋 *Stock disponible:*');
      }
    }

    if (visibleItems.length === 0) {
      lines.push('⚠️ Actualmente no hay unidades libres disponibles en este almacén.');
    } else {
      visibleItems.forEach((item, idx) => {
        const isOut = item.qty <= 0;
        const priceTag = showPrices ? ` (${Number(item.sellPrice || 0).toFixed(2)}€)` : '';

        if (style === 'whatsapp') {
          if (isOut) {
            lines.push(`❌ ~${item.name}~ — *AGOTADO*`);
          } else if (showQuantities) {
            lines.push(`✅ ${item.name}: *${item.qty} ${item.qty === 1 ? 'ud' : 'uds'}*${priceTag}`);
          } else {
            lines.push(`✅ ${item.name}${priceTag}`);
          }
        } else if (style === 'clean') {
          if (isOut) {
            lines.push(`- ${item.name}: AGOTADO`);
          } else if (showQuantities) {
            lines.push(`• ${item.name}: ${item.qty} ${item.qty === 1 ? 'ud' : 'uds'}${priceTag}`);
          } else {
            lines.push(`• ${item.name}${priceTag}`);
          }
        } else {
          // compact
          if (isOut) {
            lines.push(`${idx + 1}. ${item.name} (Agotado)`);
          } else if (showQuantities) {
            lines.push(`${idx + 1}. ${item.name} (${item.qty})${priceTag}`);
          } else {
            lines.push(`${idx + 1}. ${item.name}${priceTag}`);
          }
        }
      });
    }

    // Pie de mensaje
    if (customFooter && customFooter.trim()) {
      lines.push('');
      lines.push(customFooter.trim());
    } else if (style === 'whatsapp' && visibleItems.length > 0) {
      lines.push('');
      if (showQuantities) {
        lines.push(`📦 *Total disponible:* ${totalUnits} uds (${availableProductsCount} sabores)`);
      }
      lines.push('📩 *¡Escríbeme para reservar el tuyo!*');
    }

    return {
      text: lines.join('\n'),
      warehouseId,
      warehouseName,
      totalUnits,
      totalReservedUnits,
      availableProductsCount,
      totalProductsCount,
      generatedAt: new Date().toISOString()
    };
  }

  // ==========================================
  // GESTIÓN DE PEDIDOS / LOTES DE MERCANCÍA (RECUENTO DE LLEGADA)
  // ==========================================

  async getOrders() {
    return await this.storage.getAllOrders();
  }

  async getActiveOrder() {
    return await this.storage.getActiveOrder();
  }

  async closeOrder(orderId) {
    const order = await this.storage.getOrderById(orderId);
    if (!order) {
      throw new Error('Pedido no encontrado.');
    }
    order.status = 'closed';
    order.closedAt = order.closedAt || new Date().toISOString();
    await this.storage.saveOrder(order);
    return {
      success: true,
      order,
      message: `Pedido "${order.name}" marcado como terminado.`
    };
  }

  /**
   * Cierra el pedido anterior (si estaba activo) y registra el recuento de llegada
   * de un nuevo pedido con sabores variables (existentes y/o nuevos).
   *
   * @param {Object} params
   * @param {string} params.name Nombre del pedido (ej. "Pedido Noviembre")
   * @param {string} [params.supplier] Proveedor o etiqueta opcional
   * @param {string} [params.notes] Notas del pedido
   * @param {boolean} [params.resetExistingStock=true] Si true, pone a 0 el stock anterior para empezar recuento limpio
   * @param {Array<{productId: string, quantity: number, costPrice?: number, sellPrice?: number}>} [params.existingItems]
   * @param {Array<{name: string, category?: string, costPrice?: number, sellPrice?: number, quantity: number}>} [params.newItems]
   */
  async startNewOrder({
    name,
    supplier = '',
    notes = '',
    resetExistingStock = true,
    existingItems = [],
    newItems = []
  }) {
    const cleanName = (name || '').trim();
    if (!cleanName) {
      throw new Error('Escribe un nombre para identificar este nuevo pedido.');
    }

    const validExisting = (existingItems || []).filter(it => (parseInt(it.quantity, 10) || 0) > 0);
    const validNew = (newItems || []).filter(
      it => it.name && it.name.trim() && (parseInt(it.quantity, 10) || 0) > 0
    );

    if (validExisting.length === 0 && validNew.length === 0) {
      throw new Error('Añade al menos 1 producto con cantidad mayor que 0 para registrar el pedido.');
    }

    // Pre-validación antes de tocar pedidos o stock existentes
    for (const newIt of validNew) {
      const cp = parseFloat(newIt.costPrice);
      const sp = parseFloat(newIt.sellPrice);
      if (isNaN(cp) || cp < 0 || isNaN(sp) || sp < 0) {
        throw new Error(`Precios inválidos para el nuevo sabor "${newIt.name.trim()}".`);
      }
    }

    const nowIso = new Date().toISOString();

    // 1. Calcular el stock remanente real de pedidos anteriores antes de aplicar el recuento
    const [allOrders, allProducts, allSales] = await Promise.all([
      this.storage.getAllOrders(),
      this.storage.getAllProducts(),
      this.storage.getAllSales()
    ]);

    const keptOldStockByProduct = new Map();
    for (const prod of allProducts) {
      this._normalizeProductStock(prod);
      let keptUnits = 0;
      if (resetExistingStock) {
        // Solo ponemos a 0 el Almacén Principal; el stock en trabajadores se conserva
        Object.entries(prod.stockByWarehouse || {}).forEach(([whId, qty]) => {
          if (whId !== MAIN_WAREHOUSE_ID) {
            keptUnits += Math.max(0, parseInt(qty, 10) || 0);
          }
        });
      } else {
        keptUnits = Math.max(0, parseInt(prod.stock, 10) || 0);
      }
      keptOldStockByProduct.set(prod.id, keptUnits);
    }

    // Fijar límite de arrastre (FIFO) en los pedidos antiguos y cerrar los activos
    const sortedOldOrdersAsc = [...allOrders].sort(
      (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0)
    );
    const salesByOrderAndProduct = new Map();
    for (const s of allSales) {
      if (!s.orderId || !s.productId) continue;
      const key = `${s.orderId}::${s.productId}`;
      salesByOrderAndProduct.set(key, (salesByOrderAndProduct.get(key) || 0) + (parseInt(s.quantity, 10) || 0));
    }
    const remainingKeptPool = new Map(keptOldStockByProduct);

    for (const oldOrder of sortedOldOrdersAsc) {
      let changed = false;
      if (Array.isArray(oldOrder.items)) {
        for (const item of oldOrder.items) {
          const pid = item.productId;
          if (!pid) continue;
          const soldAlready = salesByOrderAndProduct.get(`${oldOrder.id}::${pid}`) || 0;
          const origCap = (item.carryoverLimit !== undefined && item.carryoverLimit !== null)
            ? Number(item.carryoverLimit)
            : (parseInt(item.quantity, 10) || 0);
          const unfilled = Math.max(0, origCap - soldAlready);
          const poolAvail = remainingKeptPool.get(pid) || 0;
          const keptForThisOrder = Math.min(unfilled, poolAvail);
          remainingKeptPool.set(pid, poolAvail - keptForThisOrder);

          const nextLimit = soldAlready + keptForThisOrder;
          if (item.carryoverLimit !== nextLimit) {
            item.carryoverLimit = nextLimit;
            changed = true;
          }
          if (resetExistingStock && !item.carryoverOnlyNonMain) {
            item.carryoverOnlyNonMain = true;
            changed = true;
          }
        }
      }
      if (oldOrder.status === 'active') {
        oldOrder.status = 'closed';
        oldOrder.closedAt = oldOrder.closedAt || nowIso;
        changed = true;
      }
      if (changed) {
        await this.storage.saveOrder(oldOrder);
      }
    }

    // 2. Actualizar stock del Almacén Principal (las reservas y trabajadores se conservan intactos)
    const existingQtyMap = new Map(validExisting.map(it => [it.productId, it]));

    for (const prod of allProducts) {
      this._normalizeProductStock(prod);
      const incoming = existingQtyMap.get(prod.id);

      if (resetExistingStock) {
        // Solo poner a 0 el Almacén Principal; los trabajadores conservan su stock
        prod.stockByWarehouse[MAIN_WAREHOUSE_ID] = 0;
        if (incoming) {
          const qty = Math.max(0, parseInt(incoming.quantity, 10) || 0);
          prod.stockByWarehouse[MAIN_WAREHOUSE_ID] = qty;
          if (incoming.costPrice !== undefined && !isNaN(parseFloat(incoming.costPrice))) {
            prod.costPrice = parseFloat(incoming.costPrice);
          }
          if (incoming.sellPrice !== undefined && !isNaN(parseFloat(incoming.sellPrice))) {
            prod.sellPrice = parseFloat(incoming.sellPrice);
          }
        }
        this._normalizeProductStock(prod);
        await this.storage.saveProduct(prod);
      } else if (incoming) {
        // Sumar las unidades nuevas encima del stock que quedara en el Almacén Principal
        const qty = Math.max(0, parseInt(incoming.quantity, 10) || 0);
        prod.stockByWarehouse[MAIN_WAREHOUSE_ID] =
          (parseInt(prod.stockByWarehouse[MAIN_WAREHOUSE_ID], 10) || 0) + qty;
        if (incoming.costPrice !== undefined && !isNaN(parseFloat(incoming.costPrice))) {
          prod.costPrice = parseFloat(incoming.costPrice);
        }
        if (incoming.sellPrice !== undefined && !isNaN(parseFloat(incoming.sellPrice))) {
          prod.sellPrice = parseFloat(incoming.sellPrice);
        }
        this._normalizeProductStock(prod);
        await this.storage.saveProduct(prod);
      }
    }

    // 3. Crear los sabores nuevos que hayan llegado en este pedido
    const orderItems = [];
    for (const it of validExisting) {
      const p = await this.storage.getProductById(it.productId);
      if (p) {
        const qty = parseInt(it.quantity, 10) || 0;
        const cp = parseFloat(p.costPrice);
        const sp = parseFloat(p.sellPrice);
        orderItems.push({
          productId: p.id,
          productName: p.name,
          quantity: qty,
          costPrice: Number.isFinite(cp) ? cp : 0,
          sellPrice: Number.isFinite(sp) ? sp : 12.00
        });
      }
    }

    for (const newIt of validNew) {
      const qty = Math.max(1, parseInt(newIt.quantity, 10) || 1);
      const parsedCp = parseFloat(newIt.costPrice);
      const parsedSp = parseFloat(newIt.sellPrice);
      const costPrice = Number.isFinite(parsedCp) ? parsedCp : 6.70;
      const sellPrice = Number.isFinite(parsedSp) ? parsedSp : 12.00;
      const createdProd = await this.addProduct({
        name: newIt.name.trim(),
        category: (newIt.category || 'Sabores').trim(),
        costPrice,
        sellPrice,
        stockByWarehouse: { [MAIN_WAREHOUSE_ID]: qty }
      });
      orderItems.push({
        productId: createdProd.id,
        productName: createdProd.name,
        quantity: qty,
        costPrice,
        sellPrice
      });
    }

    // 4. Las reservas activas de clientes permanecen intactas y activas

    const totalUnits = orderItems.reduce((sum, it) => sum + (it.quantity || 0), 0);
    const totalCost = parseFloat(
      orderItems.reduce((sum, it) => sum + ((it.quantity || 0) * (it.costPrice || 0)), 0).toFixed(2)
    );
    const expectedRevenue = parseFloat(
      orderItems.reduce((sum, it) => sum + ((it.quantity || 0) * (it.sellPrice || 12)), 0).toFixed(2)
    );

    const newOrder = await this.storage.saveOrder({
      id: 'ord_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      name: cleanName,
      status: 'active',
      supplier: (supplier || '').trim(),
      notes: (notes || '').trim(),
      items: orderItems,
      totalUnits,
      totalCost,
      expectedRevenue,
      createdAt: nowIso,
      closedAt: null
    });

    return {
      success: true,
      order: newOrder,
      totalUnits,
      totalCost,
      message: `Nuevo pedido "${newOrder.name}" registrado con ${totalUnits} unidades (${orderItems.length} sabores).`
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
