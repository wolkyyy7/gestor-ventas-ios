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

import { MAIN_WAREHOUSE_ID } from './AgentStorage.js';

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
    if (isNaN(unitPrice) || unitPrice < 0) {
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

    const targetWh = (!warehouseId || warehouseId === 'all') ? MAIN_WAREHOUSE_ID : warehouseId;

    // 2. Obtener producto, almacén y comprobar stock en dicho almacén
    const [product, warehouse] = await Promise.all([
      this.inventory.getProduct(productId),
      this.inventory.getWarehouse(targetWh)
    ]);

    if (!product) {
      throw new Error(`Producto no encontrado en inventario (ID: ${productId}).`);
    }

    const warehouseName = warehouse?.name || 'Mi Almacén (Principal)';
    const workerName = warehouse?.workerName || '';
    const availableInWarehouse = this.inventory.getProductStock(product, targetWh);

    if (availableInWarehouse < qty) {
      throw new Error(
        `Stock insuficiente en "${warehouseName}" para "${product.name}". Disponible en este almacén: ${availableInWarehouse}, solicitado: ${qty}.`
      );
    }

    // 3. Cálculos financieros y de descuentos atómicos
    const costPrice = parseFloat(product.costPrice) || 0;
    const catalogUnitPrice = parseFloat(product.sellPrice) || 13.00;
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
    if (!res) {
      throw new Error('La reserva seleccionada ya no existe.');
    }

    const unitPrice = (finalUnitPrice !== null && finalUnitPrice !== undefined && finalUnitPrice !== '')
      ? parseFloat(finalUnitPrice)
      : (parseFloat(res.agreedUnitPrice) || 13.00);

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

    sale.paymentStatus = 'paid';
    sale.paidAt = new Date().toISOString();
    if (paymentMethod && ['Efectivo', 'Tarjeta'].includes(paymentMethod)) {
      sale.paymentMethod = paymentMethod;
    }

    await this.storage.saveSale(sale);

    return {
      success: true,
      sale,
      message: `Deuda cobrada: ${sale.grossTotal.toFixed(2)}€ de ${sale.buyerName || 'Cliente'} (${sale.paymentMethod}).`
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

    if (buyerName !== undefined) sale.buyerName = buyerName.trim();
    if (notes !== undefined) sale.notes = notes.trim();

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

    const targetWh = sale.warehouseId || MAIN_WAREHOUSE_ID;
    const targetWhName = sale.warehouseName || 'Mi Almacén (Principal)';

    // Devolver el stock al almacén original
    try {
      await this.inventory.adjustStock(sale.productId, sale.quantity, targetWh);
    } catch (err) {
      console.warn('No se pudo reponer stock (posiblemente el producto fue eliminado):', err);
    }

    // Eliminar la venta del registro
    await this.storage.deleteSale(saleId);

    return {
      success: true,
      revertedSale: sale,
      message: `Venta anulada. Devueltas ${sale.quantity} uds de "${sale.productName}" a "${targetWhName}".`
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
