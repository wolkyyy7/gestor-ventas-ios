/**
 * Agente de Analítica Avanzada y Métricas Financieras Multi-Almacén (Dashboard)
 * 
 * Calcula en tiempo real todas las métricas clave del negocio:
 * 1. Métricas del periodo y almacén seleccionado (Facturación, Beneficio, Costes, Ticket Medio, Margen, Cobrado vs Fiado)
 * 2. Resumen General Histórico Global ("Cuánto se factura en general")
 * 3. Desglose Completo por Almacenes / Casas de Trabajadores + Cuentas de Liquidación y Comisiones de Vapers Gratis (`workerAccounts`)
 * 4. Análisis de Descuentos sobre PVP Oficial y Precio Medio Real por Trabajador (`discountMetrics`)
 * 5. Control de Deudas / "Fiados" por Cliente y Reservas Activas (`debtsAndReservations`)
 * 6. Mapa de Calor de Ventas Días de la Semana × Franjas Horarias (`salesHeatmap`)
 * 7. Inteligencia de Sabores por Zona / Trabajador y Sugerencias Inteligentes de Reposición (`warehouseFlavorIntelligence`)
 * 8. Salud Financiera, Capital Invertido, Recuperación de Inversión (Break-even), ROI y Proyecciones (`businessHealth`)
 * 9. Series Temporales Multi-Escala (`timeSeries`) y Ritmo de Venta (`velocityMetrics`)
 */

import { MAIN_WAREHOUSE_ID } from './AgentStorage.js';

export class AgentAnalytics {
  /**
   * @param {import('./AgentStorage.js').AgentStorage} storageAgent 
   */
  constructor(storageAgent) {
    this.storage = storageAgent;
    this.lowStockThreshold = 5;
  }

  /**
   * Calcula el conjunto completo de métricas financieras, comparativas por almacén,
   * comisiones de trabajadores, descuentos, fiados, reservas, mapa de calor,
   * inteligencia de sabores, series temporales y proyecciones.
   * 
   * @param {'today'|'week'|'month'|'all'} [timeframe='today'] Rango temporal
   * @param {string} [warehouseFilter='all'] ID del almacén ('all' o un warehouseId específico)
   */
  async getDashboardMetrics(timeframe = 'today', warehouseFilter = 'all', orderFilter = 'all') {
    const [allProducts, allWarehouses, rawAllSales, allReservations, allSettlements, allOrders] = await Promise.all([
      this.storage.getAllProducts(),
      this.storage.getAllWarehouses(),
      this.storage.getAllSales(),
      this.storage.getAllReservations(),
      this.storage.getAllSettlements(),
      this.storage.getAllOrders()
    ]);

    // Calcular métricas por cada Pedido/Lote sobre todo el histórico antes de filtrar
    const ordersMetrics = this._computeOrdersMetrics(allOrders, rawAllSales);

    // Si hay un pedido concreto seleccionado en el filtro, acotar allSales a ese pedido
    const allSales = (!orderFilter || orderFilter === 'all')
      ? rawAllSales
      : rawAllSales.filter(s => {
          const fallbackOrdId = ordersMetrics.fallbackOrderId;
          const saleOrdId = s.orderId || fallbackOrdId;
          return saleOrdId === orderFilter;
        });

    const productPriceMap = new Map();

    // Normalizar stock por almacén de los productos en memoria para cálculo exacto
    const normalizedProducts = allProducts.map(p => {
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
      productPriceMap.set(copy.id, parseFloat(copy.sellPrice) || 12.00);
      return copy;
    });

    // Ventas filtradas por rango temporal (todas las ubicaciones)
    const periodSalesAllWarehouses = this._filterSalesByTimeframe(allSales, timeframe);

    // Ventas filtradas por rango temporal Y por almacén seleccionado
    const filteredSales = (!warehouseFilter || warehouseFilter === 'all')
      ? periodSalesAllWarehouses
      : periodSalesAllWarehouses.filter(s => (s.warehouseId || MAIN_WAREHOUSE_ID) === warehouseFilter);

    // =========================================================================
    // 1. MÉTRICAS DEL PERIODO Y ALMACÉN SELECCIONADO
    // =========================================================================
    let totalBilled = 0;
    let totalCost = 0;
    let totalProfit = 0;
    let totalUnits = 0;
    let periodPaidBilled = 0;
    let periodPendingBilled = 0;

    const paymentMethods = {
      Tarjeta: { count: 0, billed: 0, profit: 0, units: 0, percentage: 0 },
      Efectivo: { count: 0, billed: 0, profit: 0, units: 0, percentage: 0 }
    };

    const productSalesMap = new Map();

    filteredSales.forEach(sale => {
      const gross = parseFloat(sale.grossTotal) || 0;
      const profit = parseFloat(sale.netProfit) || 0;
      const cost = parseFloat(sale.totalCost) || 0;
      const qty = parseInt(sale.quantity, 10) || 0;

      totalBilled += gross;
      totalProfit += profit;
      totalCost += cost;
      totalUnits += qty;

      if (sale.paymentStatus === 'pending') {
        periodPendingBilled += gross;
      } else {
        periodPaidBilled += gross;
      }

      const method = sale.paymentMethod === 'Efectivo' ? 'Efectivo' : 'Tarjeta';
      paymentMethods[method].count += 1;
      paymentMethods[method].billed += gross;
      paymentMethods[method].profit += profit;
      paymentMethods[method].units += qty;

      const pId = sale.productId;
      if (!productSalesMap.has(pId)) {
        productSalesMap.set(pId, {
          id: pId,
          name: sale.productName,
          category: sale.productCategory || 'General',
          unitsSold: 0,
          revenue: 0,
          profit: 0,
          cost: 0
        });
      }
      const pStats = productSalesMap.get(pId);
      pStats.unitsSold += qty;
      pStats.revenue += gross;
      pStats.profit += profit;
      pStats.cost += cost;
    });

    paymentMethods.Tarjeta.billed = parseFloat(paymentMethods.Tarjeta.billed.toFixed(2));
    paymentMethods.Tarjeta.profit = parseFloat(paymentMethods.Tarjeta.profit.toFixed(2));
    paymentMethods.Efectivo.billed = parseFloat(paymentMethods.Efectivo.billed.toFixed(2));
    paymentMethods.Efectivo.profit = parseFloat(paymentMethods.Efectivo.profit.toFixed(2));

    if (totalBilled > 0) {
      paymentMethods.Tarjeta.percentage = parseFloat(((paymentMethods.Tarjeta.billed / totalBilled) * 100).toFixed(1));
      paymentMethods.Efectivo.percentage = parseFloat(((paymentMethods.Efectivo.billed / totalBilled) * 100).toFixed(1));
    }

    const transactionCount = filteredSales.length;
    const averageTicket = transactionCount > 0 ? parseFloat((totalBilled / transactionCount).toFixed(2)) : 0;
    const overallProfitMargin = totalBilled > 0 ? parseFloat(((totalProfit / totalBilled) * 100).toFixed(1)) : 0;
    const averageUnitPrice = totalUnits > 0 ? parseFloat((totalBilled / totalUnits).toFixed(2)) : 0;
    const averageUnitProfit = totalUnits > 0 ? parseFloat((totalProfit / totalUnits).toFixed(2)) : 0;

    // Top productos más vendidos en el filtro activo
    const topProducts = Array.from(productSalesMap.values())
      .map(p => ({
        ...p,
        revenue: parseFloat(p.revenue.toFixed(2)),
        profit: parseFloat(p.profit.toFixed(2)),
        cost: parseFloat(p.cost.toFixed(2)),
        margin: p.revenue > 0 ? parseFloat(((p.profit / p.revenue) * 100).toFixed(1)) : 0,
        shareOfRevenue: totalBilled > 0 ? parseFloat(((p.revenue / totalBilled) * 100).toFixed(1)) : 0
      }))
      .sort((a, b) => b.unitsSold - a.unitsSold || b.revenue - a.revenue)
      .slice(0, 5);

    // =========================================================================
    // 2. RESUMEN GENERAL HISTÓRICO GLOBAL ("Cuánto se factura en general" - todos los pedidos)
    // =========================================================================
    let allTimeBilled = 0;
    let allTimeProfit = 0;
    let allTimeCost = 0;
    let allTimeUnits = 0;
    let allTimeCashBilled = 0;
    let allTimeCardBilled = 0;
    let allTimePaidBilled = 0;
    let allTimePendingBilled = 0;

    const allTimeProductUnitsMap = new Map();

    rawAllSales.forEach(s => {
      const gross = parseFloat(s.grossTotal) || 0;
      const profit = parseFloat(s.netProfit) || 0;
      const cost = parseFloat(s.totalCost) || 0;
      const qty = parseInt(s.quantity, 10) || 0;

      allTimeBilled += gross;
      allTimeProfit += profit;
      allTimeCost += cost;
      allTimeUnits += qty;

      if (s.paymentMethod === 'Efectivo') {
        allTimeCashBilled += gross;
      } else {
        allTimeCardBilled += gross;
      }

      if (s.paymentStatus === 'pending') {
        allTimePendingBilled += gross;
      } else {
        allTimePaidBilled += gross;
      }
    });

    const warehouseScopedUnitsMap = new Map();
    allSales.forEach(s => {
      const qty = parseInt(s.quantity, 10) || 0;
      allTimeProductUnitsMap.set(s.productId, (allTimeProductUnitsMap.get(s.productId) || 0) + qty);
      if (!warehouseFilter || warehouseFilter === 'all' || (s.warehouseId || MAIN_WAREHOUSE_ID) === warehouseFilter) {
        warehouseScopedUnitsMap.set(s.productId, (warehouseScopedUnitsMap.get(s.productId) || 0) + qty);
      }
    });

    const allTimeTransactionCount = rawAllSales.length;
    const allTimeSummary = {
      totalBilled: parseFloat(allTimeBilled.toFixed(2)),
      totalProfit: parseFloat(allTimeProfit.toFixed(2)),
      totalCost: parseFloat(allTimeCost.toFixed(2)),
      transactionCount: allTimeTransactionCount,
      totalUnits: allTimeUnits,
      averageTicket: allTimeTransactionCount > 0 ? parseFloat((allTimeBilled / allTimeTransactionCount).toFixed(2)) : 0,
      overallProfitMargin: allTimeBilled > 0 ? parseFloat(((allTimeProfit / allTimeBilled) * 100).toFixed(1)) : 0,
      cashBilled: parseFloat(allTimeCashBilled.toFixed(2)),
      cardBilled: parseFloat(allTimeCardBilled.toFixed(2)),
      paidBilled: parseFloat(allTimePaidBilled.toFixed(2)),
      pendingBilled: parseFloat(allTimePendingBilled.toFixed(2)),
      cashPercentage: allTimeBilled > 0 ? parseFloat(((allTimeCashBilled / allTimeBilled) * 100).toFixed(1)) : 0,
      cardPercentage: allTimeBilled > 0 ? parseFloat(((allTimeCardBilled / allTimeBilled) * 100).toFixed(1)) : 0
    };

    // =========================================================================
    // 3. VALORACIÓN DE STOCK ACTUAL, DESGLOSE POR ALMACENES Y CUENTAS/COMISIONES DE TRABAJADORES
    // =========================================================================
    let currentTotalStockUnits = 0;
    let currentStockCostValue = 0;
    let currentStockRetailValue = 0;

    normalizedProducts.forEach(p => {
      const st = p.stock || 0;
      currentTotalStockUnits += st;
      currentStockCostValue += st * (p.costPrice || 0);
      currentStockRetailValue += st * (p.sellPrice || 0);
    });

    const currentStockPotentialProfit = currentStockRetailValue - currentStockCostValue;
    const periodGlobalBilled = periodSalesAllWarehouses.reduce((sum, s) => sum + (parseFloat(s.grossTotal) || 0), 0);

    let totalPendingFreeVapersAllWorkers = 0;
    let totalPendingMoneyFromWorkers = 0;

    const warehouseBreakdown = allWarehouses.map(wh => {
      const whId = wh.id;
      const rewardEveryNUnits = Math.max(1, parseInt(wh.rewardEveryNUnits, 10) || 5);
      const rewardFreeUnits = Math.max(1, parseInt(wh.rewardFreeUnits, 10) || 1);
      const deliveredFreeVapers = Math.max(0, parseInt(wh.rewardVapersDelivered, 10) || 0);
      const cashSettledAmount = Math.max(0, parseFloat(wh.cashSettledAmount) || 0);

      // Ventas de este almacén en el periodo seleccionado
      const whPeriodSales = periodSalesAllWarehouses.filter(s => (s.warehouseId || MAIN_WAREHOUSE_ID) === whId);
      let periodBilled = 0;
      let periodProfit = 0;
      let periodCost = 0;
      let periodUnitsSold = 0;
      let periodCashBilled = 0;
      let periodCardBilled = 0;
      let periodPendingFiados = 0;

      whPeriodSales.forEach(s => {
        const gross = parseFloat(s.grossTotal) || 0;
        periodBilled += gross;
        periodProfit += parseFloat(s.netProfit) || 0;
        periodCost += parseFloat(s.totalCost) || 0;
        periodUnitsSold += parseInt(s.quantity, 10) || 0;
        if (s.paymentMethod === 'Efectivo') periodCashBilled += gross;
        else periodCardBilled += gross;
        if (s.paymentStatus === 'pending') periodPendingFiados += gross;
      });

      const periodTransactions = whPeriodSales.length;
      const periodAvgTicket = periodTransactions > 0 ? parseFloat((periodBilled / periodTransactions).toFixed(2)) : 0;
      const periodMargin = periodBilled > 0 ? parseFloat(((periodProfit / periodBilled) * 100).toFixed(1)) : 0;
      const periodRevenueShare = periodGlobalBilled > 0 ? parseFloat(((periodBilled / periodGlobalBilled) * 100).toFixed(1)) : 0;

      // Ventas históricas totales de este almacén
      const whAllTimeSales = allSales.filter(s => (s.warehouseId || MAIN_WAREHOUSE_ID) === whId);
      let whAllTimeBilled = 0;
      let whAllTimeProfit = 0;
      let whAllTimeUnitsSold = 0;
      let totalCollectedPaid = 0;
      let collectedCash = 0;
      let collectedCard = 0;
      let totalPendingFiados = 0;

      whAllTimeSales.forEach(s => {
        const gross = parseFloat(s.grossTotal) || 0;
        whAllTimeBilled += gross;
        whAllTimeProfit += parseFloat(s.netProfit) || 0;
        whAllTimeUnitsSold += parseInt(s.quantity, 10) || 0;

        if (s.paymentStatus === 'pending') {
          totalPendingFiados += gross;
        } else {
          totalCollectedPaid += gross;
          if (s.paymentMethod === 'Efectivo') collectedCash += gross;
          else collectedCard += gross;
        }
      });

      const whAllTimeTransactions = whAllTimeSales.length;
      const allTimeRevenueShare = allTimeBilled > 0 ? parseFloat(((whAllTimeBilled / allTimeBilled) * 100).toFixed(1)) : 0;

      // Cálculos de Comisión de Vapers Gratis (ej. 1 vaper gratis cada 5 vendidos)
      const earnedFreeVapers = Math.floor(whAllTimeUnitsSold / rewardEveryNUnits) * rewardFreeUnits;
      const pendingFreeVapers = Math.max(0, earnedFreeVapers - deliveredFreeVapers);
      const unitsTowardNextFreeVaper = whAllTimeUnitsSold % rewardEveryNUnits;
      const unitsNeededForNextFreeVaper = rewardEveryNUnits - unitsTowardNextFreeVaper;
      const nextFreeVaperProgressPct = parseFloat(((unitsTowardNextFreeVaper / rewardEveryNUnits) * 100).toFixed(1));

      // Cuentas de liquidación de dinero con el trabajador
      const pendingMoneyToDeliver = Math.max(0, parseFloat((totalCollectedPaid - cashSettledAmount).toFixed(2)));

      if (!wh.isMain) {
        totalPendingFreeVapersAllWorkers += pendingFreeVapers;
        totalPendingMoneyFromWorkers += pendingMoneyToDeliver;
      }

      // Stock actual en este almacén
      let currentStockUnits = 0;
      let stockCostValuation = 0;
      let stockRetailValuation = 0;
      let lowStockCount = 0;
      let outOfStockCount = 0;
      let productsWithStock = 0;

      normalizedProducts.forEach(p => {
        const u = p.stockByWarehouse[whId] || 0;
        currentStockUnits += u;
        stockCostValuation += u * (p.costPrice || 0);
        stockRetailValuation += u * (p.sellPrice || 0);
        if (u > 0) productsWithStock++;
        if (u === 0) outOfStockCount++;
        if (u <= this.lowStockThreshold) lowStockCount++;
      });

      const stockPotentialProfit = stockRetailValuation - stockCostValuation;
      const stockSharePercentage = currentTotalStockUnits > 0
        ? parseFloat(((currentStockUnits / currentTotalStockUnits) * 100).toFixed(1))
        : 0;

      const totalManagedUnits = whAllTimeUnitsSold + currentStockUnits;
      const sellThroughRate = totalManagedUnits > 0
        ? parseFloat(((whAllTimeUnitsSold / totalManagedUnits) * 100).toFixed(1))
        : 0;

      return {
        warehouseId: whId,
        name: wh.name,
        workerName: wh.workerName || '',
        icon: wh.icon || '🏠',
        color: wh.color || 'indigo',
        isMain: !!wh.isMain,
        // Periodo
        periodBilled: parseFloat(periodBilled.toFixed(2)),
        periodProfit: parseFloat(periodProfit.toFixed(2)),
        periodCost: parseFloat(periodCost.toFixed(2)),
        periodUnitsSold,
        periodTransactions,
        periodAvgTicket,
        periodMargin,
        periodRevenueShare,
        periodCashBilled: parseFloat(periodCashBilled.toFixed(2)),
        periodCardBilled: parseFloat(periodCardBilled.toFixed(2)),
        periodPendingFiados: parseFloat(periodPendingFiados.toFixed(2)),
        // Histórico
        allTimeBilled: parseFloat(whAllTimeBilled.toFixed(2)),
        allTimeProfit: parseFloat(whAllTimeProfit.toFixed(2)),
        allTimeUnitsSold: whAllTimeUnitsSold,
        allTimeTransactions: whAllTimeTransactions,
        allTimeRevenueShare,
        // Comisiones de Vapers Gratis (Punto 1)
        rewardEveryNUnits,
        rewardFreeUnits,
        earnedFreeVapers,
        deliveredFreeVapers,
        pendingFreeVapers,
        unitsTowardNextFreeVaper,
        unitsNeededForNextFreeVaper,
        nextFreeVaperProgressPct,
        // Liquidaciones de Dinero (Punto 1)
        totalCollectedPaid: parseFloat(totalCollectedPaid.toFixed(2)),
        collectedCash: parseFloat(collectedCash.toFixed(2)),
        collectedCard: parseFloat(collectedCard.toFixed(2)),
        totalPendingFiados: parseFloat(totalPendingFiados.toFixed(2)),
        cashSettledAmount: parseFloat(cashSettledAmount.toFixed(2)),
        pendingMoneyToDeliver,
        // Stock en almacén
        currentStockUnits,
        productsWithStock,
        stockCostValuation: parseFloat(stockCostValuation.toFixed(2)),
        stockRetailValuation: parseFloat(stockRetailValuation.toFixed(2)),
        stockPotentialProfit: parseFloat(stockPotentialProfit.toFixed(2)),
        stockSharePercentage,
        lowStockCount,
        outOfStockCount,
        // Rotación
        sellThroughRate
      };
    });

    const workerAccounts = {
      warehouses: warehouseBreakdown,
      workerWarehousesOnly: warehouseBreakdown.filter(w => !w.isMain),
      totalPendingFreeVapersAllWorkers,
      totalPendingMoneyFromWorkers: parseFloat(totalPendingMoneyFromWorkers.toFixed(2)),
      recentSettlements: allSettlements.slice(0, 25)
    };

    // =========================================================================
    // 4. ANÁLISIS DE DESCUENTOS Y PRECIO MEDIO REAL POR TRABAJADOR (Punto 3)
    // =========================================================================
    const discountMetrics = this._computeDiscountMetrics(
      filteredSales,
      allSales,
      allWarehouses,
      productPriceMap
    );

    // =========================================================================
    // 5. CONTROL DE "FIADOS" (DEUDAS DE CLIENTES) Y RESERVAS ACTIVAS (Punto 4)
    // =========================================================================
    const debtsAndReservations = this._computeDebtsAndReservations(
      allSales,
      allReservations,
      warehouseFilter
    );

    // =========================================================================
    // 6. MAPA DE CALOR DE VENTAS DÍAS × FRANJAS HORARIAS (Punto 5)
    // =========================================================================
    const salesHeatmap = this._computeSalesHeatmap(allSales, warehouseFilter);

    // =========================================================================
    // 7. INTELIGENCIA DE SABORES POR ZONA / TRABAJADOR (Punto 7)
    // =========================================================================
    const warehouseFlavorIntelligence = this._computeWarehouseFlavorIntelligence(
      allWarehouses,
      normalizedProducts,
      allSales
    );

    // =========================================================================
    // 8. SALUD FINANCIERA, INVERSIÓN, ROI Y PROYECCIONES (businessHealth)
    // =========================================================================
    const totalCapitalInvested = parseFloat((allTimeCost + currentStockCostValue).toFixed(2));
    const capitalRecovered = parseFloat(allTimeBilled.toFixed(2));
    const capitalRecoveryPercentage = totalCapitalInvested > 0
      ? parseFloat(((capitalRecovered / totalCapitalInvested) * 100).toFixed(1))
      : 0;
    const netCashBalance = parseFloat((capitalRecovered - totalCapitalInvested).toFixed(2));
    const roiPercentage = totalCapitalInvested > 0
      ? parseFloat(((allTimeProfit / totalCapitalInvested) * 100).toFixed(1))
      : 0;
    const totalProjectedRevenue = parseFloat((allTimeBilled + currentStockRetailValue).toFixed(2));
    const totalProjectedProfit = parseFloat((allTimeProfit + currentStockPotentialProfit).toFixed(2));
    const totalGlobalUnitsEver = allTimeUnits + currentTotalStockUnits;
    const globalSellThroughRate = totalGlobalUnitsEver > 0
      ? parseFloat(((allTimeUnits / totalGlobalUnitsEver) * 100).toFixed(1))
      : 0;

    const businessHealth = {
      currentTotalStockUnits,
      currentStockCostValue: parseFloat(currentStockCostValue.toFixed(2)),
      currentStockRetailValue: parseFloat(currentStockRetailValue.toFixed(2)),
      currentStockPotentialProfit: parseFloat(currentStockPotentialProfit.toFixed(2)),
      totalCapitalInvested,
      capitalRecovered,
      capitalRecoveryPercentage,
      netCashBalance,
      roiPercentage,
      totalProjectedRevenue,
      totalProjectedProfit,
      globalSellThroughRate
    };

    // =========================================================================
    // 9. SERIES TEMPORALES MULTI-ESCALA (timeSeries) Y RITMO DE VENTA
    // =========================================================================
    const timeSeries = this._computeTimeSeries(allSales, timeframe, warehouseFilter);
    const velocityMetrics = this._computeVelocityAndTrends(allSales, warehouseFilter);

    // =========================================================================
    // 10. RANKINGS DE BAJA ROTACIÓN Y ALERTAS DE STOCK
    // =========================================================================
    const slowMovingProducts = normalizedProducts
      .map(p => {
        const sold = warehouseScopedUnitsMap.get(p.id) || 0;
        const currentStock = (!warehouseFilter || warehouseFilter === 'all')
          ? (p.stock || 0)
          : (p.stockByWarehouse[warehouseFilter] || 0);
        const totalEver = sold + currentStock;
        const sellThroughRate = totalEver > 0 ? parseFloat(((sold / totalEver) * 100).toFixed(1)) : 0;
        return {
          id: p.id,
          name: p.name,
          currentStock,
          unitsSold: sold,
          sellThroughRate,
          stockCostValue: parseFloat((currentStock * (p.costPrice || 0)).toFixed(2)),
          stockRetailValue: parseFloat((currentStock * (p.sellPrice || 0)).toFixed(2))
        };
      })
      .filter(p => p.currentStock > 0)
      .sort((a, b) => a.sellThroughRate - b.sellThroughRate || b.currentStock - a.currentStock)
      .slice(0, 5);

    const lowStockAlerts = [];
    const targetWhForAlerts = (!warehouseFilter || warehouseFilter === 'all') ? MAIN_WAREHOUSE_ID : warehouseFilter;
    const targetWhObj = allWarehouses.find(w => w.id === targetWhForAlerts);
    const targetWhName = targetWhObj ? targetWhObj.name : 'Mi Almacén (Principal)';

    normalizedProducts.forEach(p => {
      const st = p.stockByWarehouse[targetWhForAlerts] || 0;
      if (st <= this.lowStockThreshold) {
        lowStockAlerts.push({
          productId: p.id,
          productName: p.name,
          warehouseId: targetWhForAlerts,
          warehouseName: targetWhName,
          stock: st,
          globalStock: p.stock || 0,
          status: st === 0 ? 'out' : 'low'
        });
      }
    });
    lowStockAlerts.sort((a, b) => a.stock - b.stock);

    return {
      timeframe,
      warehouseFilter,
      orderFilter,
      totalBilled: parseFloat(totalBilled.toFixed(2)),
      totalProfit: parseFloat(totalProfit.toFixed(2)),
      totalCost: parseFloat(totalCost.toFixed(2)),
      periodPaidBilled: parseFloat(periodPaidBilled.toFixed(2)),
      periodPendingBilled: parseFloat(periodPendingBilled.toFixed(2)),
      transactionCount,
      totalUnits,
      averageTicket,
      overallProfitMargin,
      averageUnitPrice,
      averageUnitProfit,
      paymentMethods,
      topProducts,
      recentSales: filteredSales.slice(0, 15),
      allTimeSummary,
      ordersMetrics,
      warehouseBreakdown,
      workerAccounts,
      discountMetrics,
      debtsAndReservations,
      salesHeatmap,
      warehouseFlavorIntelligence,
      businessHealth,
      timeSeries,
      velocityMetrics,
      slowMovingProducts,
      lowStockAlerts
    };
  }

  /**
   * Calcula las métricas completas de cada Pedido/Lote (facturado, beneficio, ROI,
   * unidades vendidas vs recibidas, efectivo vs tarjeta, top sabores de ese pedido).
   */
  _computeOrdersMetrics(allOrders = [], allSales = []) {
    const sortedOrders = [...(allOrders || [])].sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );
    const activeOrder = sortedOrders.find(o => o.status === 'active') || sortedOrders[0] || null;
    const fallbackOrderId = sortedOrders.length > 0
      ? sortedOrders[sortedOrders.length - 1].id
      : null;

    const salesByOrder = new Map();
    sortedOrders.forEach(o => salesByOrder.set(o.id, []));

    allSales.forEach(sale => {
      const ordId = sale.orderId || fallbackOrderId;
      if (!ordId) return;
      if (!salesByOrder.has(ordId)) {
        salesByOrder.set(ordId, []);
      }
      salesByOrder.get(ordId).push(sale);
    });

    const orders = sortedOrders.map(order => {
      const orderSales = salesByOrder.get(order.id) || [];
      let billed = 0;
      let profit = 0;
      let costOfSold = 0;
      let unitsSold = 0;
      let cashBilled = 0;
      let cardBilled = 0;
      let pendingDebtBilled = 0;
      const flavorMap = new Map();

      orderSales.forEach(s => {
        const g = parseFloat(s.grossTotal) || 0;
        const p = parseFloat(s.netProfit) || 0;
        const c = parseFloat(s.totalCost) || 0;
        const q = parseInt(s.quantity, 10) || 0;

        billed += g;
        profit += p;
        costOfSold += c;
        unitsSold += q;

        if (s.paymentStatus === 'pending') {
          pendingDebtBilled += g;
        } else if (s.paymentMethod === 'Tarjeta') {
          cardBilled += g;
        } else {
          cashBilled += g;
        }

        const fKey = s.productId || s.productName;
        if (!flavorMap.has(fKey)) {
          flavorMap.set(fKey, { name: s.productName, unitsSold: 0, billed: 0 });
        }
        const fObj = flavorMap.get(fKey);
        fObj.unitsSold += q;
        fObj.billed += g;
      });

      const initialUnits = parseInt(order.totalUnits, 10) || 0;
      const initialCost = parseFloat(order.totalCost) || 0;
      const expectedRevenue = parseFloat(order.expectedRevenue) || 0;
      const remainingUnits = Math.max(0, initialUnits - unitsSold);
      const sellThroughPct = initialUnits > 0
        ? parseFloat(Math.min(100, (unitsSold / initialUnits) * 100).toFixed(1))
        : 0;
      const roiPct = initialCost > 0
        ? parseFloat(((profit / initialCost) * 100).toFixed(1))
        : 0;
      const recoveryPct = initialCost > 0
        ? parseFloat(((billed / initialCost) * 100).toFixed(1))
        : 0;
      const profitMargin = billed > 0
        ? parseFloat(((profit / billed) * 100).toFixed(1))
        : 0;
      const transactionCount = orderSales.length;
      const avgTicket = transactionCount > 0
        ? parseFloat((billed / transactionCount).toFixed(2))
        : 0;

      const topFlavors = Array.from(flavorMap.values())
        .sort((a, b) => b.unitsSold - a.unitsSold)
        .slice(0, 3);

      return {
        id: order.id,
        name: order.name,
        status: order.status || 'active',
        supplier: order.supplier || '',
        notes: order.notes || '',
        createdAt: order.createdAt,
        closedAt: order.closedAt || null,
        items: Array.isArray(order.items) ? order.items : [],
        flavorsCount: Array.isArray(order.items) ? order.items.length : 0,
        initialUnits,
        initialCost: parseFloat(initialCost.toFixed(2)),
        expectedRevenue: parseFloat(expectedRevenue.toFixed(2)),
        unitsSold,
        remainingUnits,
        sellThroughPct,
        billed: parseFloat(billed.toFixed(2)),
        profit: parseFloat(profit.toFixed(2)),
        costOfSold: parseFloat(costOfSold.toFixed(2)),
        transactionCount,
        avgTicket,
        profitMargin,
        roiPct,
        recoveryPct,
        cashBilled: parseFloat(cashBilled.toFixed(2)),
        cardBilled: parseFloat(cardBilled.toFixed(2)),
        pendingDebtBilled: parseFloat(pendingDebtBilled.toFixed(2)),
        topFlavors
      };
    });

    return {
      activeOrder,
      fallbackOrderId,
      totalOrdersCount: orders.length,
      orders
    };
  }

  /**
   * Punto 3: Calcula el análisis detallado de descuentos aplicados respecto al PVP oficial
   * y el precio medio real de venta por almacén/trabajador.
   */
  _computeDiscountMetrics(filteredSales, allSales, allWarehouses, productPriceMap) {
    const evalSaleDiscount = (sale) => {
      const qty = parseInt(sale.quantity, 10) || 0;
      const unitPrice = parseFloat(sale.unitPrice) || 0;
      const parsedCat = parseFloat(sale.catalogUnitPrice);
      const mapPrice = productPriceMap.get(sale.productId);
      const catPrice = (sale.catalogUnitPrice !== undefined && sale.catalogUnitPrice !== null && Number.isFinite(parsedCat))
        ? parsedCat
        : (Number.isFinite(mapPrice) ? mapPrice : 12.00);
      const discPerUnit = Math.max(0, catPrice - unitPrice);
      const totalDisc = parseFloat((discPerUnit * qty).toFixed(2));
      const theoretical = parseFloat((catPrice * qty).toFixed(2));
      return {
        qty,
        unitPrice,
        catPrice,
        totalDisc,
        theoretical,
        isDiscounted: discPerUnit > 0.009
      };
    };

    let periodTotalDiscount = 0;
    let periodDiscountedUnits = 0;
    let periodFullPriceUnits = 0;
    let periodDiscountedTransactions = 0;
    let periodTheoreticalBilled = 0;

    filteredSales.forEach(s => {
      const d = evalSaleDiscount(s);
      periodTotalDiscount += d.totalDisc;
      periodTheoreticalBilled += d.theoretical;
      if (d.isDiscounted) {
        periodDiscountedUnits += d.qty;
        periodDiscountedTransactions += 1;
      } else {
        periodFullPriceUnits += d.qty;
      }
    });

    let allTimeTotalDiscount = 0;
    let allTimeDiscountedUnits = 0;
    let allTimeFullPriceUnits = 0;
    let allTimeTheoreticalBilled = 0;

    allSales.forEach(s => {
      const d = evalSaleDiscount(s);
      allTimeTotalDiscount += d.totalDisc;
      allTimeTheoreticalBilled += d.theoretical;
      if (d.isDiscounted) {
        allTimeDiscountedUnits += d.qty;
      } else {
        allTimeFullPriceUnits += d.qty;
      }
    });

    const byWarehouse = allWarehouses.map(wh => {
      const whSales = allSales.filter(s => (s.warehouseId || MAIN_WAREHOUSE_ID) === wh.id);
      let whBilled = 0;
      let whUnits = 0;
      let whTheoretical = 0;
      let whDiscountGiven = 0;
      let discountedUnits = 0;
      let fullPriceUnits = 0;
      let discountedSalesCount = 0;

      whSales.forEach(s => {
        const d = evalSaleDiscount(s);
        whBilled += parseFloat(s.grossTotal) || 0;
        whUnits += d.qty;
        whTheoretical += d.theoretical;
        whDiscountGiven += d.totalDisc;
        if (d.isDiscounted) {
          discountedUnits += d.qty;
          discountedSalesCount += 1;
        } else {
          fullPriceUnits += d.qty;
        }
      });

      const avgRealUnitPrice = whUnits > 0 ? parseFloat((whBilled / whUnits).toFixed(2)) : 0;
      const avgCatalogUnitPrice = whUnits > 0 ? parseFloat((whTheoretical / whUnits).toFixed(2)) : 0;
      const discountedSalesPct = whSales.length > 0
        ? parseFloat(((discountedSalesCount / whSales.length) * 100).toFixed(1))
        : 0;

      return {
        warehouseId: wh.id,
        name: wh.name,
        workerName: wh.workerName || '',
        icon: wh.icon || '🏠',
        color: wh.color || 'indigo',
        isMain: !!wh.isMain,
        avgRealUnitPrice,
        avgCatalogUnitPrice,
        totalDiscountGiven: parseFloat(whDiscountGiven.toFixed(2)),
        discountedUnits,
        fullPriceUnits,
        discountedSalesCount,
        totalSalesCount: whSales.length,
        discountedSalesPct
      };
    });

    return {
      periodTotalDiscount: parseFloat(periodTotalDiscount.toFixed(2)),
      periodDiscountedUnits,
      periodFullPriceUnits,
      periodDiscountedTransactions,
      periodTheoreticalBilled: parseFloat(periodTheoreticalBilled.toFixed(2)),
      periodDiscountPct: periodTheoreticalBilled > 0
        ? parseFloat(((periodTotalDiscount / periodTheoreticalBilled) * 100).toFixed(1))
        : 0,
      allTimeTotalDiscount: parseFloat(allTimeTotalDiscount.toFixed(2)),
      allTimeDiscountedUnits,
      allTimeFullPriceUnits,
      allTimeTheoreticalBilled: parseFloat(allTimeTheoreticalBilled.toFixed(2)),
      byWarehouse
    };
  }

  /**
   * Punto 4: Calcula las deudas pendientes de clientes ("Fiados") y las reservas activas.
   */
  _computeDebtsAndReservations(allSales, allReservations, warehouseFilter = 'all') {
    const relevantSales = (!warehouseFilter || warehouseFilter === 'all')
      ? allSales
      : allSales.filter(s => (s.warehouseId || MAIN_WAREHOUSE_ID) === warehouseFilter);

    const pendingSales = relevantSales.filter(s => s.paymentStatus === 'pending');

    let totalPendingDebtAmount = 0;
    let pendingDebtUnits = 0;
    const customerMap = new Map();

    pendingSales.forEach(s => {
      const amount = parseFloat(s.grossTotal) || 0;
      const qty = parseInt(s.quantity, 10) || 0;
      totalPendingDebtAmount += amount;
      pendingDebtUnits += qty;

      const customerKey = (s.buyerName && s.buyerName.trim()) ? s.buyerName.trim() : 'Cliente sin nombre';
      if (!customerMap.has(customerKey)) {
        customerMap.set(customerKey, {
          customerName: customerKey,
          totalDebt: 0,
          totalUnits: 0,
          salesCount: 0,
          oldestSaleDate: s.timestamp,
          sales: []
        });
      }
      const cEntry = customerMap.get(customerKey);
      cEntry.totalDebt = parseFloat((cEntry.totalDebt + amount).toFixed(2));
      cEntry.totalUnits += qty;
      cEntry.salesCount += 1;
      if (new Date(s.timestamp) < new Date(cEntry.oldestSaleDate)) {
        cEntry.oldestSaleDate = s.timestamp;
      }
      cEntry.sales.push(s);
    });

    const debtorsByCustomer = Array.from(customerMap.values()).sort((a, b) => b.totalDebt - a.totalDebt);

    const activeReservations = allReservations.filter(r => {
      if ((r.status || 'active') !== 'active') return false;
      if (warehouseFilter && warehouseFilter !== 'all' && (r.warehouseId || MAIN_WAREHOUSE_ID) !== warehouseFilter) {
        return false;
      }
      return true;
    });

    let totalReservedUnits = 0;
    let totalReservedValue = 0;

    activeReservations.forEach(r => {
      const qty = parseInt(r.quantity, 10) || 0;
      const price = parseFloat(r.agreedUnitPrice) || 12.00;
      totalReservedUnits += qty;
      totalReservedValue += qty * price;
    });

    return {
      pendingSales,
      totalPendingDebtAmount: parseFloat(totalPendingDebtAmount.toFixed(2)),
      pendingDebtUnits,
      debtorsByCustomer,
      activeReservations,
      totalReservedUnits,
      totalReservedValue: parseFloat(totalReservedValue.toFixed(2))
    };
  }

  /**
   * Punto 5: Construye el Mapa de Calor de Ventas (7 días de Lunes a Domingo × 6 franjas de 4h).
   */
  _computeSalesHeatmap(allSales, warehouseFilter = 'all') {
    const relevantSales = (!warehouseFilter || warehouseFilter === 'all')
      ? allSales
      : allSales.filter(s => (s.warehouseId || MAIN_WAREHOUSE_ID) === warehouseFilter);

    // Orden europeo de lunes (0) a domingo (6)
    const orderedDays = [
      { jsDay: 1, name: 'Lunes', short: 'Lun' },
      { jsDay: 2, name: 'Martes', short: 'Mar' },
      { jsDay: 3, name: 'Miércoles', short: 'Mié' },
      { jsDay: 4, name: 'Jueves', short: 'Jue' },
      { jsDay: 5, name: 'Viernes', short: 'Vie' },
      { jsDay: 6, name: 'Sábado', short: 'Sáb' },
      { jsDay: 0, name: 'Domingo', short: 'Dom' }
    ];

    const slotLabels = ['00-04h', '04-08h', '08-12h', '12-16h', '16-20h', '20-24h'];

    const days = orderedDays.map((d, dIdx) => ({
      dayIndex: dIdx,
      jsDay: d.jsDay,
      dayName: d.name,
      dayShort: d.short,
      totalUnits: 0,
      totalBilled: 0,
      slots: slotLabels.map((sLabel, sIdx) => ({
        dayIndex: dIdx,
        dayName: d.name,
        dayShort: d.short,
        slotIndex: sIdx,
        slotLabel: sLabel,
        units: 0,
        billed: 0,
        profit: 0,
        transactions: 0,
        intensityPct: 0
      }))
    }));

    const jsDayToRowMap = new Map();
    days.forEach(row => jsDayToRowMap.set(row.jsDay, row));

    relevantSales.forEach(s => {
      const dt = new Date(s.timestamp);
      if (isNaN(dt.getTime())) return;

      const row = jsDayToRowMap.get(dt.getDay());
      if (!row) return;

      const hr = dt.getHours();
      const slotIdx = Math.min(5, Math.floor(hr / 4));
      const cell = row.slots[slotIdx];

      const qty = parseInt(s.quantity, 10) || 0;
      const gross = parseFloat(s.grossTotal) || 0;
      const profit = parseFloat(s.netProfit) || 0;

      cell.units += qty;
      cell.billed = parseFloat((cell.billed + gross).toFixed(2));
      cell.profit = parseFloat((cell.profit + profit).toFixed(2));
      cell.transactions += 1;

      row.totalUnits += qty;
      row.totalBilled = parseFloat((row.totalBilled + gross).toFixed(2));
    });

    let maxSlotUnits = 0;
    let maxSlotBilled = 0;
    const allCells = [];

    days.forEach(row => {
      row.slots.forEach(cell => {
        if (cell.units > maxSlotUnits) maxSlotUnits = cell.units;
        if (cell.billed > maxSlotBilled) maxSlotBilled = cell.billed;
        allCells.push(cell);
      });
    });

    allCells.forEach(cell => {
      cell.intensityPct = maxSlotUnits > 0
        ? parseFloat(((cell.units / maxSlotUnits) * 100).toFixed(1))
        : 0;
    });

    const topHotspots = allCells
      .filter(c => c.units > 0)
      .sort((a, b) => b.units - a.units || b.billed - a.billed)
      .slice(0, 3);

    return {
      slotLabels,
      days,
      maxSlotUnits,
      maxSlotBilled: parseFloat(maxSlotBilled.toFixed(2)),
      topHotspots
    };
  }

  /**
   * Punto 7: Calcula la Inteligencia de Sabores por Zona / Trabajador y sugerencias de reposición.
   */
  _computeWarehouseFlavorIntelligence(allWarehouses, normalizedProducts, allSales) {
    return allWarehouses.map(wh => {
      const whId = wh.id;
      const whSales = allSales.filter(s => (s.warehouseId || MAIN_WAREHOUSE_ID) === whId);

      let totalWhUnitsSold = 0;
      const flavorMap = new Map();

      whSales.forEach(s => {
        const pId = s.productId;
        const qty = parseInt(s.quantity, 10) || 0;
        const gross = parseFloat(s.grossTotal) || 0;
        const profit = parseFloat(s.netProfit) || 0;

        totalWhUnitsSold += qty;

        if (!flavorMap.has(pId)) {
          flavorMap.set(pId, {
            id: pId,
            name: s.productName,
            unitsSold: 0,
            revenue: 0,
            profit: 0
          });
        }
        const entry = flavorMap.get(pId);
        entry.unitsSold += qty;
        entry.revenue = parseFloat((entry.revenue + gross).toFixed(2));
        entry.profit = parseFloat((entry.profit + profit).toFixed(2));
      });

      const rankedFlavors = Array.from(flavorMap.values())
        .map(f => {
          const prodObj = normalizedProducts.find(p => p.id === f.id);
          const currentWhStock = prodObj ? (prodObj.stockByWarehouse[whId] || 0) : 0;
          const mainWhStock = prodObj ? (prodObj.stockByWarehouse[MAIN_WAREHOUSE_ID] || 0) : 0;
          return {
            ...f,
            sharePct: totalWhUnitsSold > 0 ? parseFloat(((f.unitsSold / totalWhUnitsSold) * 100).toFixed(1)) : 0,
            currentWhStock,
            mainWhStock
          };
        })
        .sort((a, b) => b.unitsSold - a.unitsSold || b.revenue - a.revenue);

      const starFlavor = rankedFlavors.length > 0 ? rankedFlavors[0] : null;
      const topFlavors = rankedFlavors.slice(0, 5);

      // Sugerencias inteligentes de reposición desde el Almacén Principal hacia este trabajador
      const smartRestockSuggestions = [];
      if (!wh.isMain) {
        normalizedProducts.forEach(p => {
          const currentWhStock = p.stockByWarehouse[whId] || 0;
          const mainWhStock = p.stockByWarehouse[MAIN_WAREHOUSE_ID] || 0;
          const soldInfo = flavorMap.get(p.id);
          const unitsSold = soldInfo ? soldInfo.unitsSold : 0;

          if (currentWhStock <= 2 && mainWhStock > 0 && (unitsSold > 0 || currentWhStock === 0)) {
            const suggestedQty = Math.min(mainWhStock, Math.max(2, Math.min(5, unitsSold || 3)));
            smartRestockSuggestions.push({
              productId: p.id,
              productName: p.name,
              unitsSoldByWorker: unitsSold,
              currentWhStock,
              mainWhStock,
              suggestedTransferQty: suggestedQty,
              reason: unitsSold > 0
                ? `Vende bien (${unitsSold} vendidos) y solo le quedan ${currentWhStock} uds`
                : `Agotado en ${wh.name} (${mainWhStock} uds disponibles en Principal)`
            });
          }
        });

        smartRestockSuggestions.sort((a, b) => b.unitsSoldByWorker - a.unitsSoldByWorker || a.currentWhStock - b.currentWhStock);
      }

      return {
        warehouseId: whId,
        name: wh.name,
        workerName: wh.workerName || '',
        icon: wh.icon || '🏠',
        color: wh.color || 'indigo',
        isMain: !!wh.isMain,
        totalUnitsSold: totalWhUnitsSold,
        starFlavor,
        topFlavors,
        smartRestockSuggestions: smartRestockSuggestions.slice(0, 4)
      };
    });
  }

  /**
   * Construye las 4 series temporales completas para las gráficas de:
   * - Facturación en función del tiempo (€)
   * - Unidades vendidas en función del tiempo (uds.)
   */
  _computeTimeSeries(allSales, timeframe = 'today', warehouseFilter = 'all') {
    const relevantSales = (!warehouseFilter || warehouseFilter === 'all')
      ? allSales
      : allSales.filter(s => (s.warehouseId || MAIN_WAREHOUSE_ID) === warehouseFilter);

    const now = new Date();
    const todayY = now.getFullYear();
    const todayM = now.getMonth();
    const todayD = now.getDate();

    const shortDayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const ultraShortDayNames = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
    const shortMonthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

    // 1. Serie por horas de hoy (24 puntos: 00:00 a 23:00)
    const hourlyToday = [];
    const hourlyMap = new Map();
    for (let h = 0; h < 24; h++) {
      const hh = String(h).padStart(2, '0');
      const key = `${hh}:00`;
      const point = {
        key,
        label: `${hh}:00`,
        shortLabel: `${h}h`,
        billed: 0,
        profit: 0,
        units: 0,
        transactions: 0,
        cumulativeBilled: 0,
        cumulativeProfit: 0,
        cumulativeUnits: 0
      };
      hourlyToday.push(point);
      hourlyMap.set(h, point);
    }

    // 2. Serie diaria últimos 7 días (7 puntos)
    const daily7Days = [];
    const daily7Map = new Map();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayY, todayM, todayD - i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const key = `${yyyy}-${mm}-${dd}`;
      const point = {
        key,
        label: i === 0 ? 'Hoy' : `${shortDayNames[d.getDay()]} ${dd}`,
        shortLabel: i === 0 ? 'Hoy' : `${ultraShortDayNames[d.getDay()]}${dd}`,
        billed: 0,
        profit: 0,
        units: 0,
        transactions: 0,
        cumulativeBilled: 0,
        cumulativeProfit: 0,
        cumulativeUnits: 0
      };
      daily7Days.push(point);
      daily7Map.set(key, point);
    }

    // 3. Serie diaria últimos 30 días (30 puntos)
    const daily30Days = [];
    const daily30Map = new Map();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(todayY, todayM, todayD - i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const key = `${yyyy}-${mm}-${dd}`;
      const point = {
        key,
        label: i === 0 ? 'Hoy' : `${dd} ${shortMonthNames[d.getMonth()]}`,
        shortLabel: `${dd}/${mm}`,
        billed: 0,
        profit: 0,
        units: 0,
        transactions: 0,
        cumulativeBilled: 0,
        cumulativeProfit: 0,
        cumulativeUnits: 0
      };
      daily30Days.push(point);
      daily30Map.set(key, point);
    }

    // 4. Serie mensual últimos 12 meses (12 puntos)
    const monthlyYear = [];
    const monthlyMap = new Map();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(todayY, todayM - i, 1);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const key = `${yyyy}-${mm}`;
      const point = {
        key,
        label: `${shortMonthNames[d.getMonth()]} ${yyyy}`,
        shortLabel: shortMonthNames[d.getMonth()],
        billed: 0,
        profit: 0,
        units: 0,
        transactions: 0,
        cumulativeBilled: 0,
        cumulativeProfit: 0,
        cumulativeUnits: 0
      };
      monthlyYear.push(point);
      monthlyMap.set(key, point);
    }

    const distinctMonthsWithSales = new Set();

    relevantSales.forEach(s => {
      const dt = new Date(s.timestamp);
      if (isNaN(dt.getTime())) return;

      const yyyy = dt.getFullYear();
      const mIdx = dt.getMonth();
      const mm = String(mIdx + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      const dateKey = `${yyyy}-${mm}-${dd}`;
      const monthKey = `${yyyy}-${mm}`;

      const gross = parseFloat(s.grossTotal) || 0;
      const profit = parseFloat(s.netProfit) || 0;
      const qty = parseInt(s.quantity, 10) || 0;

      distinctMonthsWithSales.add(monthKey);

      if (yyyy === todayY && mIdx === todayM && dt.getDate() === todayD) {
        const hPoint = hourlyMap.get(dt.getHours());
        if (hPoint) {
          hPoint.billed += gross;
          hPoint.profit += profit;
          hPoint.units += qty;
          hPoint.transactions += 1;
        }
      }

      if (daily7Map.has(dateKey)) {
        const d7Point = daily7Map.get(dateKey);
        d7Point.billed += gross;
        d7Point.profit += profit;
        d7Point.units += qty;
        d7Point.transactions += 1;
      }

      if (daily30Map.has(dateKey)) {
        const d30Point = daily30Map.get(dateKey);
        d30Point.billed += gross;
        d30Point.profit += profit;
        d30Point.units += qty;
        d30Point.transactions += 1;
      }

      if (monthlyMap.has(monthKey)) {
        const mPoint = monthlyMap.get(monthKey);
        mPoint.billed += gross;
        mPoint.profit += profit;
        mPoint.units += qty;
        mPoint.transactions += 1;
      }
    });

    const finalizeSeries = (seriesArray) => {
      let cumBilled = 0;
      let cumProfit = 0;
      let cumUnits = 0;

      let maxBilled = 0;
      let maxBilledLabel = 'Sin ventas';
      let maxUnits = 0;
      let maxUnitsLabel = 'Sin ventas';

      const halfIdx = Math.floor(seriesArray.length / 2);
      let firstHalfBilled = 0;
      let secondHalfBilled = 0;
      let firstHalfUnits = 0;
      let secondHalfUnits = 0;

      seriesArray.forEach((pt, idx) => {
        pt.billed = parseFloat(pt.billed.toFixed(2));
        pt.profit = parseFloat(pt.profit.toFixed(2));
        cumBilled += pt.billed;
        cumProfit += pt.profit;
        cumUnits += pt.units;

        pt.cumulativeBilled = parseFloat(cumBilled.toFixed(2));
        pt.cumulativeProfit = parseFloat(cumProfit.toFixed(2));
        pt.cumulativeUnits = cumUnits;

        if (pt.billed > maxBilled) {
          maxBilled = pt.billed;
          maxBilledLabel = pt.label;
        }
        if (pt.units > maxUnits) {
          maxUnits = pt.units;
          maxUnitsLabel = pt.label;
        }

        if (idx < halfIdx) {
          firstHalfBilled += pt.billed;
          firstHalfUnits += pt.units;
        } else {
          secondHalfBilled += pt.billed;
          secondHalfUnits += pt.units;
        }
      });

      const calcTrend = (first, second) => {
        if (first <= 0 && second <= 0) return 0;
        if (first <= 0 && second > 0) return 100;
        return parseFloat((((second - first) / first) * 100).toFixed(1));
      };

      const pointCount = seriesArray.length || 1;

      return {
        maxBilled: parseFloat(maxBilled.toFixed(2)),
        maxBilledLabel,
        maxUnits,
        maxUnitsLabel,
        totalBilled: parseFloat(cumBilled.toFixed(2)),
        totalProfit: parseFloat(cumProfit.toFixed(2)),
        totalUnits: cumUnits,
        avgBilledPerPoint: parseFloat((cumBilled / pointCount).toFixed(2)),
        avgUnitsPerPoint: parseFloat((cumUnits / pointCount).toFixed(1)),
        trendPercentageBilled: calcTrend(firstHalfBilled, secondHalfBilled),
        trendPercentageUnits: calcTrend(firstHalfUnits, secondHalfUnits)
      };
    };

    const seriesMeta = {
      hourlyToday: finalizeSeries(hourlyToday),
      daily7Days: finalizeSeries(daily7Days),
      daily30Days: finalizeSeries(daily30Days),
      monthlyYear: finalizeSeries(monthlyYear)
    };

    let defaultScale = 'hourlyToday';
    if (timeframe === 'week') {
      defaultScale = 'daily7Days';
    } else if (timeframe === 'month') {
      defaultScale = 'daily30Days';
    } else if (timeframe === 'all') {
      defaultScale = distinctMonthsWithSales.size > 1 ? 'monthlyYear' : 'daily30Days';
    }

    return {
      defaultScale,
      hourlyToday,
      daily7Days,
      daily30Days,
      monthlyYear,
      seriesMeta
    };
  }

  /**
   * Calcula el ritmo de venta diario, proyección mensual, franja horaria pico,
   * mejor día de la semana y la serie temporal de los últimos 7 días.
   */
  _computeVelocityAndTrends(allSales, warehouseFilter = 'all') {
    const relevantSales = (!warehouseFilter || warehouseFilter === 'all')
      ? allSales
      : allSales.filter(s => (s.warehouseId || MAIN_WAREHOUSE_ID) === warehouseFilter);

    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const shortDayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

    const now = new Date();
    const last7DaysMap = new Map();
    const last7DaysTrend = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const dateKey = `${yyyy}-${mm}-${dd}`;
      const entry = {
        date: dateKey,
        dayLabel: i === 0 ? 'Hoy' : `${shortDayNames[d.getDay()]} ${dd}`,
        billed: 0,
        profit: 0,
        units: 0,
        count: 0
      };
      last7DaysMap.set(dateKey, entry);
      last7DaysTrend.push(entry);
    }

    const activeDaysSet = new Set();
    const hourCounts = new Array(24).fill(0);
    const weekdayBilled = new Array(7).fill(0);

    let totalBilled = 0;
    let totalProfit = 0;
    let totalUnits = 0;

    relevantSales.forEach(s => {
      const dt = new Date(s.timestamp);
      if (isNaN(dt.getTime())) return;

      const yyyy = dt.getFullYear();
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      const dateKey = `${yyyy}-${mm}-${dd}`;

      const gross = parseFloat(s.grossTotal) || 0;
      const profit = parseFloat(s.netProfit) || 0;
      const qty = parseInt(s.quantity, 10) || 0;

      activeDaysSet.add(dateKey);
      totalBilled += gross;
      totalProfit += profit;
      totalUnits += qty;

      hourCounts[dt.getHours()] += qty || 1;
      weekdayBilled[dt.getDay()] += gross;

      if (last7DaysMap.has(dateKey)) {
        const dayEntry = last7DaysMap.get(dateKey);
        dayEntry.billed = parseFloat((dayEntry.billed + gross).toFixed(2));
        dayEntry.profit = parseFloat((dayEntry.profit + profit).toFixed(2));
        dayEntry.units += qty;
        dayEntry.count += 1;
      }
    });

    const activeDaysCount = activeDaysSet.size;
    const dailyAverageBilled = activeDaysCount > 0 ? parseFloat((totalBilled / activeDaysCount).toFixed(2)) : 0;
    const dailyAverageProfit = activeDaysCount > 0 ? parseFloat((totalProfit / activeDaysCount).toFixed(2)) : 0;
    const dailyAverageUnits = activeDaysCount > 0 ? parseFloat((totalUnits / activeDaysCount).toFixed(1)) : 0;

    const projectedMonthlyBilled = parseFloat((dailyAverageBilled * 30).toFixed(2));
    const projectedMonthlyProfit = parseFloat((dailyAverageProfit * 30).toFixed(2));

    let peakHourLabel = 'Sin datos';
    let maxHourVal = 0;
    hourCounts.forEach((val, hr) => {
      if (val > maxHourVal) {
        maxHourVal = val;
        const startH = String(hr).padStart(2, '0') + ':00';
        const endH = String((hr + 1) % 24).padStart(2, '0') + ':00';
        peakHourLabel = `${startH} - ${endH}`;
      }
    });

    let bestDayOfWeek = 'Sin datos';
    let maxDayBilled = 0;
    weekdayBilled.forEach((billed, dayIdx) => {
      if (billed > maxDayBilled) {
        maxDayBilled = billed;
        bestDayOfWeek = dayNames[dayIdx];
      }
    });

    return {
      activeDaysCount,
      dailyAverageBilled,
      dailyAverageProfit,
      dailyAverageUnits,
      projectedMonthlyBilled,
      projectedMonthlyProfit,
      peakHourLabel,
      bestDayOfWeek,
      last7DaysTrend
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
      startDate.setDate(now.getDate() - 7);
      startDate.setHours(0, 0, 0, 0);
    } else if (timeframe === 'month') {
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
    const todayMetrics = await this.getDashboardMetrics('today', 'all');
    return {
      todayBilled: todayMetrics.totalBilled,
      todayProfit: todayMetrics.totalProfit,
      todayCount: todayMetrics.transactionCount,
      allTimeBilled: todayMetrics.allTimeSummary.totalBilled,
      allTimeProfit: todayMetrics.allTimeSummary.totalProfit
    };
  }
}
