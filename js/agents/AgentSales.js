/**
 * Agente de Registro de Ventas y Transacciones
 * 
 * Gestiona el panel de venta rápida y la ejecución atómica de transacciones:
 * - Valida disponibilidad de stock
 * - Descuenta la cantidad del inventario
 * - Calcula el margen y beneficio neto exacto en tiempo real
 * - Registra la venta con método de pago ("Tarjeta" o "Efectivo")
 * - Proporciona reversión atómica de transacciones erróneas
 */

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
   * Ejecuta una transacción de venta de forma atómica.
   * 
   * @param {Object} params
   * @param {string} params.productId ID del producto vendido
   * @param {number} params.quantity Cantidad de unidades
   * @param {number} params.finalUnitPrice Precio final de venta por unidad
   * @param {'Tarjeta'|'Efectivo'} params.paymentMethod Método de pago
   * @param {string} [params.notes] Comentarios u observaciones opcionales
   */
  async executeSale({ productId, quantity, finalUnitPrice, paymentMethod, notes = '' }) {
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

    // 2. Obtener producto y comprobar stock
    const product = await this.inventory.getProduct(productId);
    if (!product) {
      throw new Error(`Producto no encontrado en inventario (ID: ${productId}).`);
    }

    if (product.stock < qty) {
      throw new Error(
        `Stock insuficiente para "${product.name}". Stock disponible: ${product.stock}, solicitado: ${qty}.`
      );
    }

    // 3. Cálculos financieros atómicos
    const costPrice = parseFloat(product.costPrice) || 0;
    const grossTotal = parseFloat((unitPrice * qty).toFixed(2));
    const totalCost = parseFloat((costPrice * qty).toFixed(2));
    const netProfit = parseFloat((grossTotal - totalCost).toFixed(2));
    const profitMargin = grossTotal > 0 ? parseFloat(((netProfit / grossTotal) * 100).toFixed(1)) : 0;

    // 4. Paso atómico A: Descontar stock del producto
    await this.inventory.adjustStock(productId, -qty);

    // 5. Paso atómico B: Crear el registro de la venta
    const saleRecord = {
      id: 'sale_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      timestamp: new Date().toISOString(),
      productId: product.id,
      productName: product.name,
      productCategory: product.category || 'General',
      costPrice: costPrice,
      unitPrice: unitPrice,
      quantity: qty,
      grossTotal: grossTotal,
      totalCost: totalCost,
      netProfit: netProfit,
      profitMargin: profitMargin,
      paymentMethod: paymentMethod,
      notes: notes.trim(),
      status: 'completed'
    };

    try {
      await this.storage.saveSale(saleRecord);
    } catch (saveErr) {
      // Revertir descuento de stock si falla el guardado
      await this.inventory.adjustStock(productId, qty);
      throw new Error(`Error guardando la venta. Operación revertida: ${saveErr.message}`);
    }

    return {
      success: true,
      sale: saleRecord,
      remainingStock: product.stock - qty,
      message: `Venta registrada con éxito: ${grossTotal.toFixed(2)}€ (${netProfit >= 0 ? '+' : ''}${netProfit.toFixed(2)}€ de beneficio)`
    };
  }

  /**
   * Revierte (anula) una venta realizada previamente,
   * restaurando atómicamente el stock en el inventario.
   * 
   * @param {string} saleId 
   */
  async revertSale(saleId) {
    const allSales = await this.storage.getAllSales();
    const sale = allSales.find(s => s.id === saleId);
    if (!sale) {
      throw new Error('Venta no encontrada para reversión.');
    }

    // Devolver el stock al inventario
    try {
      await this.inventory.adjustStock(sale.productId, sale.quantity);
    } catch (err) {
      console.warn('No se pudo reponer stock (posiblemente el producto fue eliminado):', err);
    }

    // Eliminar la venta del registro
    await this.storage.deleteSale(saleId);

    return {
      success: true,
      revertedSale: sale,
      message: `Venta anulada. Se han devuelto ${sale.quantity} unidades de "${sale.productName}" al inventario.`
    };
  }

  /**
   * Obtiene la lista de transacciones recientes.
   * @param {number} [limit=50]
   */
  async getRecentSales(limit = 50) {
    const sales = await this.storage.getAllSales();
    return sales.slice(0, limit);
  }
}
