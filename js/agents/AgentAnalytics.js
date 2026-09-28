/**
 * Agente de Analítica y Métricas (Dashboard)
 * 
 * Calcula en tiempo real las métricas financieras clave:
 * - Dinero Facturado (Ingresos brutos)
 * - Dinero de Beneficio (Ganancia neta)
 * - Desglose comparativo de métodos de pago (Tarjeta vs. Efectivo)
 * - Ticket medio, margen medio y ranking de productos más vendidos
 * - Filtrado temporal (Hoy, 7 días, Este mes, Todo el historial)
 */

export class AgentAnalytics {
  /**
   * @param {import('./AgentStorage.js').AgentStorage} storageAgent 
   */
  constructor(storageAgent) {
    this.storage = storageAgent;
  }

  /**
   * Calcula el conjunto completo de métricas según el rango temporal seleccionado.
   * 
   * @param {'today'|'week'|'month'|'all'} [timeframe='today']
   */
  async getDashboardMetrics(timeframe = 'today') {
    const allSales = await this.storage.getAllSales();
    const filteredSales = this._filterSalesByTimeframe(allSales, timeframe);

    let totalBilled = 0; // Dinero Facturado
    let totalCost = 0;   // Coste total de la mercancía vendida
    let totalProfit = 0; // Dinero de Beneficio
    let totalUnits = 0;  // Unidades físicas vendidas

    const paymentMethods = {
      Tarjeta: { count: 0, billed: 0, profit: 0, percentage: 0 },
      Efectivo: { count: 0, billed: 0, profit: 0, percentage: 0 }
    };

    const productSalesMap = new Map();

    filteredSales.forEach(sale => {
      const gross = sale.grossTotal || 0;
      const profit = sale.netProfit || 0;
      const cost = sale.totalCost || 0;
      const qty = sale.quantity || 0;

      totalBilled += gross;
      totalProfit += profit;
      totalCost += cost;
      totalUnits += qty;

      // Métodos de pago
      const method = sale.paymentMethod === 'Efectivo' ? 'Efectivo' : 'Tarjeta';
      paymentMethods[method].count += 1;
      paymentMethods[method].billed += gross;
      paymentMethods[method].profit += profit;

      // Agrupación por producto para ranking
      const pId = sale.productId;
      if (!productSalesMap.has(pId)) {
        productSalesMap.set(pId, {
          id: pId,
          name: sale.productName,
          category: sale.productCategory || 'General',
          unitsSold: 0,
          revenue: 0,
          profit: 0
        });
      }
      const pStats = productSalesMap.get(pId);
      pStats.unitsSold += qty;
      pStats.revenue += gross;
      pStats.profit += profit;
    });

    // Calcular porcentajes de métodos de pago
    if (totalBilled > 0) {
      paymentMethods.Tarjeta.percentage = parseFloat(((paymentMethods.Tarjeta.billed / totalBilled) * 100).toFixed(1));
      paymentMethods.Efectivo.percentage = parseFloat(((paymentMethods.Efectivo.billed / totalBilled) * 100).toFixed(1));
    }

    const transactionCount = filteredSales.length;
    const averageTicket = transactionCount > 0 ? parseFloat((totalBilled / transactionCount).toFixed(2)) : 0;
    const overallProfitMargin = totalBilled > 0 ? parseFloat(((totalProfit / totalBilled) * 100).toFixed(1)) : 0;

    // Top productos más vendidos
    const topProducts = Array.from(productSalesMap.values())
      .sort((a, b) => b.unitsSold - a.unitsSold)
      .slice(0, 5);

    return {
      timeframe,
      totalBilled: parseFloat(totalBilled.toFixed(2)),
      totalProfit: parseFloat(totalProfit.toFixed(2)),
      totalCost: parseFloat(totalCost.toFixed(2)),
      transactionCount,
      totalUnits,
      averageTicket,
      overallProfitMargin,
      paymentMethods,
      topProducts,
      recentSales: filteredSales.slice(0, 15)
    };
  }

  /**
   * Filtra las ventas según el intervalo de tiempo seleccionado.
   */
  _filterSalesByTimeframe(sales, timeframe) {
    if (timeframe === 'all') return sales;

    const now = new Date();
    let startDate = new Date();

    if (timeframe === 'today') {
      startDate.setHours(0, 0, 0, 0);
    } else if (timeframe === 'week') {
      // Últimos 7 días naturales
      startDate.setDate(now.getDate() - 7);
      startDate.setHours(0, 0, 0, 0);
    } else if (timeframe === 'month') {
      // Desde el 1 del mes actual
      startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
    }

    const startTimestamp = startDate.getTime();

    return sales.filter(s => {
      const saleTime = new Date(s.timestamp).getTime();
      return saleTime >= startTimestamp;
    });
  }

  /**
   * Obtiene resumen para el banner superior o badge de estado rápido.
   */
  async getQuickHeaderStats() {
    const todayMetrics = await this.getDashboardMetrics('today');
    return {
      todayBilled: todayMetrics.totalBilled,
      todayProfit: todayMetrics.totalProfit,
      todayCount: todayMetrics.transactionCount
    };
  }
}
