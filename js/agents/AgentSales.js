/**
 * Agente de Registro de Ventas, Fiados (Pendientes de Cobro) y Conversión de Reservas
 * 
 * Gestiona el panel de venta rápida y la ejecución atómica de transacciones:
 * - Valida disponibilidad de stock en el almacén seleccionado (Principal o Trabajador)
 * - Descuenta la cantidad del almacén correspondiente
 * - Calcula el margen, beneficio neto y descuentos sobre PVP oficial en tiempo real
 * - Registra la venta con método de pago ("Tarjeta" o "Efectivo"), estado ("paid" o "pending"),
 *   nombre del comprador (`buyerName`), notas concretas (`notes`) y almacén de origen
 * - Permite convertir reservas activas en ventas reales en 1 toque
 * - Permite liquidar ventas "fiadas" (pendientes de cobro) y editar notas/cliente
 * - Proporciona reversión atómica de transacciones erróneas devolviendo el stock a su almacén
 */

import { MAIN_WAREHOUSE_ID } from './AgentStorage.js?v=5.3';

export class AgentSales {
  /**
   * @param {import('./AgentStorage.js').AgentStorage} storageAgent 
   * @param {import('./AgentInventory.js').AgentInventory} inventoryAgent 
   */
  constructor(storageAgent, inventoryAgent) {
    this.storage = storageAgent;
    this.inventory = inventoryAgent;
  }

  /**
   * Ejecuta una transacción de venta de forma atómica desde un almacén específico.
   * 
   * @param {Object} params
   * @param {string} params.productId ID del producto vendido
   * @param {number} params.quantity Cantidad de unidades
   * @param {number} params.finalUnitPrice Precio final de venta por unidad
   * @param {'Tarjeta'|'Efectivo'} params.paymentMethod Método de pago
   * @param {string} [params.warehouseId='wh_main'] ID del almacén desde el que se vende
   * @param {string} [params.buyerName=''] Nombre del comprador / cliente
   * @param {string} [params.notes=''] Comentarios u observaciones concretas (ej. "Rebaja amigo", "Me paga el viernes")
   * @param {'paid'|'pending'} [params.paymentStatus='paid'] Estado de cobro ('paid' = Cobrado, 'pending' = Fiado / Pendiente)
   * @param {string|null} [params.reservationId=null] ID de reserva si viene de una reserva previa
   */
  async executeSale({
    productId,
    quantity,
    finalUnitPrice,
    paymentMethod = 'Efectivo',
    warehouseId = MAIN_WAREHOUSE_ID,
    buyerName = '',
    notes = '',
    paymentStatus = 'paid',
    reservationId = null
  }) {
    // 1. Validaciones básicas de parámetros
    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
      throw new Error('La cantidad vendida debe ser al menos 1 unidad.');
    }

    const unitPrice = parseFloat(finalUnitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error('El precio final de venta debe ser un número válido.');
    }

    if (!['Tarjeta', 'Efectivo'].includes(paymentMethod)) {
      throw new Error('El método de pago debe ser "Tarjeta" o "Efectivo".');
    }

    const normalizedPaymentStatus = paymentStatus === 'pending' ? 'pending' : 'paid';
    const cleanBuyerName = (buyerName || '').trim();

    if (normalizedPaymentStatus === 'pending' && !cleanBuyerName) {
      throw new Error('Para registrar una venta fiada (pendiente de cobro), indica el nombre del cliente.');
    }

    if (warehouseId === 'all') {
      throw new Error('Selecciona un almacén concreto para registrar la venta.');
    }
    const targetWh = warehouseId || MAIN_WAREHOUSE_ID;

    // 2. Obtener producto, almacén, pedido activo y asignar pedido por orden FIFO si quedan unidades de un pedido previo
    const [product, warehouse, activeOrder, allOrders, allSales] = await Promise.all([
      this.inventory.getProduct(productId),
      this.inventory.getWarehouse(targetWh),
      this.storage.getActiveOrder(),
      this.storage.getAllOrders(),
      this.storage.getAllSales()
    ]);

    if (!product) {
      throw new Error(`Producto no encontrado en inventario (ID: ${productId}).`);
    }
    if (!warehouse) {
      throw new Error('El almacén seleccionado ya no existe.');
    }

    const warehouseName = warehouse.name || 'Mi Almacén (Principal)';
    const workerName = warehouse?.workerName || '';
    const availableInWarehouse = this.inventory.getProductStock(product, targetWh);

    if (availableInWarehouse < qty) {
      throw new Error(
        `Stock insuficiente en "${warehouseName}" para "${product.name}". Disponible en este almacén: ${availableInWarehouse}, solicitado: ${qty}.`
      );
    }

    // Selección FIFO del pedido: si quedan unidades sin vender del pedido anterior para este sabor,
    // la facturación y el beneficio siguen asignándose al pedido anterior hasta agotarlo.
    let targetOrder = activeOrder;
    let batchCostPrice = null;
    const sortedOrdersAsc = [...(allOrders || [])].sort(
      (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0)
    );
    for (const ord of sortedOrdersAsc) {
      if (activeOrder && ord.id === activeOrder.id) continue;
      const ordItem = Array.isArray(ord.items) ? ord.items.find(it => it.productId === productId) : null;
      if (!ordItem) continue;
      if (ordItem.carryoverOnlyNonMain && targetWh === MAIN_WAREHOUSE_ID) continue;

      const cap = (ordItem.carryoverLimit !== undefined && ordItem.carryoverLimit !== null)
        ? Number(ordItem.carryoverLimit)
        : 0;
      if (cap <= 0) continue;

      const soldInOrd = (allSales || []).reduce(
        (sum, s) => sum + (s.orderId === ord.id && s.productId === productId ? (parseInt(s.quantity, 10) || 0) : 0),
        0
      );
      if (soldInOrd < cap) {
        targetOrder = ord;
        const itemCp = parseFloat(ordItem.costPrice);
        if (Number.isFinite(itemCp) && itemCp >= 0) {
          batchCostPrice = itemCp;
        }
        break;
      }
    }

    // 3. Cálculos financieros y de descuentos atómicos
    const parsedProdCost = parseFloat(product.costPrice);
    const costPrice = batchCostPrice !== null ? batchCostPrice : (Number.isFinite(parsedProdCost) ? parsedProdCost : 0);
    const parsedCatSell = parseFloat(product.sellPrice);
    const catalogUnitPrice = (Number.isFinite(parsedCatSell) && parsedCatSell >= 0) ? parsedCatSell : 12.00;
    const discountPerUnit = Math.max(0, parseFloat((catalogUnitPrice - unitPrice).toFixed(2)));
    const totalDiscount = Math.max(0, parseFloat(((catalogUnitPrice - unitPrice) * qty).toFixed(2)));

    const grossTotal = parseFloat((unitPrice * qty).toFixed(2));
    const totalCost = parseFloat((costPrice * qty).toFixed(2));
    const netProfit = parseFloat((grossTotal - totalCost).toFixed(2));
    const profitMargin = grossTotal > 0 ? parseFloat(((netProfit / grossTotal) * 100).toFixed(1)) : 0;

    // 4. Paso atómico A: Descontar stock del almacén correspondiente
    await this.inventory.adjustStock(productId, -qty, targetWh);

    const nowIso = new Date().toISOString();

    // 5. Paso atómico B: Crear el registro de la venta
    const saleRecord = {
      id: 'sale_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      timestamp: nowIso,
      productId: product.id,
      productName: product.name,
      productCategory: product.category || 'General',
      warehouseId: targetWh,
      warehouseName,
      workerName,
      costPrice,
      catalogUnitPrice,
      unitPrice,
      discountPerUnit,
      totalDiscount,
      quantity: qty,
      grossTotal,
      totalCost,
      netProfit,
      profitMargin,
      paymentMethod,
      paymentStatus: normalizedPaymentStatus,
      paidAt: normalizedPaymentStatus === 'paid' ? nowIso : null,
      buyerName: cleanBuyerName,
      notes: (notes || '').trim(),
      reservationId: reservationId || null,
      orderId: targetOrder ? targetOrder.id : null,
      orderName: targetOrder ? targetOrder.name : '',
      status: 'completed'
    };

    try {
      await this.storage.saveSale(saleRecord);
    } catch (saveErr) {
      // Revertir descuento de stock en el mismo almacén si falla el guardado
      await this.inventory.adjustStock(productId, qty, targetWh);
      throw new Error(`Error guardando la venta. Operación revertida: ${saveErr.message}`);
    }

    // Si provenía de una reserva activa, eliminar la reserva ya completada
    if (reservationId) {
      try {
        await this.storage.deleteReservation(reservationId);
      } catch (resErr) {
        console.warn('No se pudo eliminar la reserva asociada:', resErr);
      }
    }

    const statusBadge = normalizedPaymentStatus === 'pending'
      ? `⏳ PENDIENTE DE COBRO (${cleanBuyerName})`
      : `✅ Cobrado (${paymentMethod})`;

    return {
      success: true,
      sale: saleRecord,
      remainingStock: availableInWarehouse - qty,
      remainingGlobalStock: (product.stock || 0) - qty,
      message: `Venta en ${warehouseName}: ${grossTotal.toFixed(2)}€ · ${statusBadge}`
    };
  }

  /**
   * Convierte una reserva activa de un cliente en una venta real en 1 toque.
   */
  async completeReservationAsSale(
    reservationId,
    { paymentMethod = 'Efectivo', paymentStatus = 'paid', finalUnitPrice = null, notes = '' } = {}
  ) {
    const allReservations = await this.storage.getAllReservations();
    const res = allReservations.find(r => r.id === reservationId);
    if (!res || (res.status || 'active') !== 'active') {
      throw new Error('La reserva seleccionada ya no existe o ya fue entregada.');
    }

    const parsedOverride = (finalUnitPrice !== null && finalUnitPrice !== undefined && finalUnitPrice !== '')
      ? parseFloat(finalUnitPrice)
      : NaN;
    const parsedAgreed = parseFloat(res.agreedUnitPrice);
    const unitPrice = Number.isFinite(parsedOverride)
      ? parsedOverride
      : (Number.isFinite(parsedAgreed) ? parsedAgreed : 12.00);

    const combinedNotes = (notes && notes.trim())
      ? notes.trim()
      : (res.notes || 'Reserva entregada');

    return await this.executeSale({
      productId: res.productId,
      quantity: res.quantity,
      finalUnitPrice: unitPrice,
      paymentMethod,
      warehouseId: res.warehouseId || MAIN_WAREHOUSE_ID,
      buyerName: res.customerName || '',
      notes: combinedNotes,
      paymentStatus,
      reservationId: res.id
    });
  }

  /**
   * Marca una venta fiada (`paymentStatus === 'pending'`) como cobrada (`'paid'`).
   */
  async markSaleAsPaid(saleId, paymentMethod = null) {
    const allSales = await this.storage.getAllSales();
    const sale = allSales.find(s => s.id === saleId);
    if (!sale) {
      throw new Error('Venta no encontrada.');
    }

    if (paymentMethod && !['Efectivo', 'Tarjeta'].includes(paymentMethod)) {
      throw new Error('El método de pago debe ser "Efectivo" o "Tarjeta".');
    }

    sale.paymentStatus = 'paid';
    if (!sale.paidAt) {
      sale.paidAt = new Date().toISOString();
    }
    if (paymentMethod) {
      sale.paymentMethod = paymentMethod;
    }

    await this.storage.saveSale(sale);

    return {
      success: true,
      sale,
      message: `Deuda cobrada: ${Number(sale.grossTotal || 0).toFixed(2)}€ de ${sale.buyerName || 'Cliente'} (${sale.paymentMethod}).`
    };
  }

  /**
   * Permite añadir o editar el nombre del comprador (`buyerName`) y la nota (`notes`) de una venta.
   */
  async updateSaleNotes(saleId, { buyerName, notes } = {}) {
    const allSales = await this.storage.getAllSales();
    const sale = allSales.find(s => s.id === saleId);
    if (!sale) {
      throw new Error('Venta no encontrada.');
    }

    if (buyerName !== undefined && buyerName !== null) {
      const cleanBuyer = String(buyerName).trim();
      if (sale.paymentStatus === 'pending' && !cleanBuyer) {
        throw new Error('Las ventas fiadas deben conservar el nombre del cliente.');
      }
      sale.buyerName = cleanBuyer;
    }
    if (notes !== undefined && notes !== null) {
      sale.notes = String(notes).trim();
    }

    await this.storage.saveSale(sale);

    return {
      success: true,
      sale,
      message: 'Nota y datos de la venta actualizados.'
    };
  }

  /**
   * Revierte (anula) una venta realizada previamente,
   * restaurando atómicamente el stock en el almacén original de la venta.
   * 
   * @param {string} saleId 
   */
  async revertSale(saleId) {
    const allSales = await this.storage.getAllSales();
    const sale = allSales.find(s => s.id === saleId);
    if (!sale) {
      throw new Error('Venta no encontrada para reversión.');
    }

    const originalWhId = sale.warehouseId || MAIN_WAREHOUSE_ID;
    const existingWh = originalWhId === MAIN_WAREHOUSE_ID
      ? await this.inventory.getWarehouse(MAIN_WAREHOUSE_ID)
      : await this.inventory.getWarehouse(originalWhId);
    const targetWh = existingWh ? originalWhId : MAIN_WAREHOUSE_ID;
    const targetWhName = existingWh
      ? (sale.warehouseName || existingWh.name || 'Mi Almacén (Principal)')
      : 'Mi Almacén (Principal)';

    // Devolver el stock al almacén original (o al Principal si el almacén secundario fue eliminado)
    let stockRestored = false;
    try {
      await this.inventory.adjustStock(sale.productId, sale.quantity, targetWh);
      stockRestored = true;
    } catch (err) {
      console.warn('No se pudo reponer stock (posiblemente el producto fue eliminado):', err);
    }

    // Si se anula una venta de Principal perteneciente a un pedido antiguo reiniciado, ajustar su límite FIFO
    if (sale.orderId && originalWhId === MAIN_WAREHOUSE_ID && this.storage.getOrderById) {
      try {
        const saleOrder = await this.storage.getOrderById(sale.orderId);
        if (saleOrder && Array.isArray(saleOrder.items)) {
          const item = saleOrder.items.find(it => it.productId === sale.productId);
          if (item && item.carryoverOnlyNonMain && item.carryoverLimit !== undefined && item.carryoverLimit !== null) {
            item.carryoverLimit = Math.max(0, Number(item.carryoverLimit) - (parseInt(sale.quantity, 10) || 0));
            await this.storage.saveOrder(saleOrder);
          }
        }
      } catch (_) {}
    }

    // Eliminar la venta del registro
    await this.storage.deleteSale(saleId);

    return {
      success: true,
      revertedSale: sale,
      stockRestored,
      message: stockRestored
        ? `Venta anulada. Devueltas ${sale.quantity} uds de "${sale.productName}" a "${targetWhName}".`
        : `Venta anulada (no se pudo reponer el stock en inventario).`
    };
  }

  /**
   * Obtiene la lista de transacciones recientes (opcionalmente filtradas por almacén).
   * @param {number} [limit=50]
   * @param {string} [warehouseId='all']
   */
  async getRecentSales(limit = 50, warehouseId = 'all') {
    const sales = await this.storage.getAllSales();
    const filtered = (!warehouseId || warehouseId === 'all')
      ? sales
      : sales.filter(s => (s.warehouseId || MAIN_WAREHOUSE_ID) === warehouseId);
    return filtered.slice(0, limit);
  }
}
