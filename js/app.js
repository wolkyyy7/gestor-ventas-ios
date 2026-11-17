/**
 * Aplicación Principal - Orquestador UI Mobile-First v4.0 (iOS 18 Spatial Glass Edition)
 * 
 * Conecta los agentes autónomos de Inventario Multi-Almacén, Ventas POS,
 * Reservas de Clientes, Fiados, Comisiones de Trabajadores y Analítica Avanzada
 * con una experiencia nativa iOS 18 Spatial Glassmorphism, Dynamic Island y física elástica.
 */

import { AgentStorage, MAIN_WAREHOUSE_ID } from './agents/AgentStorage.js?v=4.9';
import { AgentInventory } from './agents/AgentInventory.js?v=4.9';
import { AgentSales } from './agents/AgentSales.js?v=4.9';
import { AgentAnalytics } from './agents/AgentAnalytics.js?v=4.9';
import { AgentAuth } from './agents/AgentAuth.js?v=4.9';
import { AgentNotifications } from './agents/AgentNotifications.js?v=4.9';
import { AgentCloudSync } from './agents/AgentCloudSync.js?v=4.9';
import { AgentSupabase } from './agents/AgentSupabase.js?v=4.9';

const APP_VERSION = 'v4.9';

class AppController {
  constructor() {
    this.storageAgent = new AgentStorage();
    this.inventoryAgent = new AgentInventory(this.storageAgent);
    this.salesAgent = new AgentSales(this.storageAgent, this.inventoryAgent);
    this.analyticsAgent = new AgentAnalytics(this.storageAgent);
    this.authAgent = new AgentAuth(this.storageAgent, this.inventoryAgent);
    this.notificationsAgent = new AgentNotifications(this.storageAgent);
    this.cloudSyncAgent = new AgentCloudSync(this.storageAgent, this.notificationsAgent);
    this.supabaseAgent = new AgentSupabase(this.storageAgent);

    // Navegación principal
    this.activeTab = 'sales'; // 'sales' | 'inventory' | 'analytics' | 'settings'

    // Estado Pestaña 1: Vender (POS Multi-Almacén, Fiados y Reservas)
    this.activeSaleWarehouseId = MAIN_WAREHOUSE_ID;
    this.selectedProductForSale = null;
    this.saleWarehouseId = MAIN_WAREHOUSE_ID;
    this.saleQuantity = 1;
    this.saleUnitPrice = 0;
    this.salePaymentMethod = 'Efectivo';
    this.salePaymentStatus = 'paid'; // 'paid' | 'pending'
    this.lastCompletedSale = null;
    this.salesSearchQuery = '';

    // Estado Pestaña 2: Inventario, Almacenes, Reservas, Mensaje Preescrito y Reparto
    this.inventorySubView = 'stock'; // 'stock' | 'reservations' | 'message' | 'transfer'
    this.selectedInventoryWarehouse = 'all'; // 'all' | 'wh_main' | warehouseId
    this.inventorySearchQuery = '';
    this.selectedCategoryFilter = 'all';
    this.editingProductId = null;
    this.editingWarehouseId = null;
    this.selectedWarehouseIcon = '👤';

    // Opciones del Generador de Mensaje Preescrito de Stock (Por defecto: Mi Almacén Principal)
    this.stockMsgOptions = {
      warehouseId: MAIN_WAREHOUSE_ID,
      onlyAvailable: true,
      showQuantities: true,
      showPrices: false,
      subtractReservations: true,
      style: 'whatsapp',
      customHeader: '',
      customFooter: ''
    };

    // Estado del Reparto por Lote (Batch Transfer)
    this.batchTransferFromWh = MAIN_WAREHOUSE_ID;
    this.batchTransferToWh = '';
    this.batchTransferQuantities = {};
    this.batchTransferNotes = '';

    // Estado Pestaña 3: Analítica, Métricas y Series Temporales Interactivas
    this.analyticsTimeframe = 'today'; // 'today' | 'week' | 'month' | 'all'
    this.analyticsWarehouseFilter = 'all'; // 'all' | 'wh_main' | warehouseId
    this.analyticsOrderFilter = 'all'; // 'all' | orderId
    this.newOrderDraft = null;
    this.revenueChartScale = null; // null = sincronizado con timeSeries.defaultScale
    this.revenueChartMode = 'interval'; // 'interval' | 'cumulative'
    this.revenueInspectedIdx = null;
    this.unitsChartScale = null; // null = sincronizado con timeSeries.defaultScale
    this.unitsChartMode = 'interval'; // 'interval' | 'cumulative'
    this.unitsInspectedIdx = null;
    this._lastTimeSeriesData = null;
    this.selectedHeatmapCell = null;

    // Sintetizador de audio web para feedback háptico/acústico
    this.audioCtx = null;
  }

  async init() {
    console.log(`Iniciando Gestor de Ventas e Inventario Multi-Almacén ${APP_VERSION}...`);
    await this.storageAgent.init();
    this.storageAgent.attachSupabaseAgent(this.supabaseAgent);
    await this.notificationsAgent.init();

    // Si Supabase está configurado, es la única fuente de sincronización de datos (ntfy queda solo para push iPhone).
    if (this.supabaseAgent.isConfigured()) {
      await this.supabaseAgent.init((evt) => this.handleRemoteSyncEvent(evt));
    } else {
      await this.cloudSyncAgent.init((evt) => this.handleRemoteSyncEvent(evt));
    }
    await this.authAgent.init();

    // Si inicia en Modo Trabajador, fijar filtros a su almacén asignado
    if (this.authAgent.isWorker()) {
      const assignedWh = this.authAgent.getAssignedWarehouseId();
      if (assignedWh) {
        this.activeSaleWarehouseId = assignedWh;
        this.saleWarehouseId = assignedWh;
        this.selectedInventoryWarehouse = assignedWh;
        this.analyticsWarehouseFilter = assignedWh;
        this.stockMsgOptions.warehouseId = assignedWh;
      }
    }

    // Suscribirse a todos los eventos reactivos de datos (con debounce para no interrumpir tecleo)
    const refreshUI = () => this._scheduleReactiveRefresh();

    this.storageAgent.subscribe('products:changed', refreshUI);
    this.storageAgent.subscribe('sales:changed', refreshUI);
    this.storageAgent.subscribe('warehouses:changed', refreshUI);
    this.storageAgent.subscribe('transfers:changed', refreshUI);
    this.storageAgent.subscribe('reservations:changed', refreshUI);
    this.storageAgent.subscribe('settlements:changed', refreshUI);
    this.storageAgent.subscribe('orders:changed', refreshUI);

    this.setupEventListeners();
    this.setupServiceWorker();
    this.applyRoleUI();
    await this.renderCurrentTab();
    await this.updateHeaderQuickStats();

    if (this.authAgent.urlAuthError) {
      this.showToast(this.authAgent.urlAuthError, '⚠️');
      setTimeout(() => this.openPinAuthModal(), 250);
    }

    // Si es el jefe y no usa Supabase, publicar snapshot inicial en ntfy silenciosamente
    if (this.authAgent.isBoss() && !this.supabaseAgent.isConfigured()) {
      this.scheduleCloudSnapshotPublish();
    }
  }

  _scheduleReactiveRefresh() {
    clearTimeout(this._reactiveRefreshTimer);
    this._reactiveRefreshTimer = setTimeout(() => {
      this.updateHeaderQuickStats();
      const active = document.activeElement;
      const isEditingInput = active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName);
      if (isEditingInput) {
        if (active.id === 'salesSearchInput') {
          this._refreshSalesGridOnly();
          return;
        }
        if (active.id === 'inventorySearchInput') {
          this._refreshInventoryGridOnly();
          return;
        }
        // Evitar perder foco o borrar cambios sin guardar en formularios/ajustes/mensaje
        return;
      }
      this.renderCurrentTab();
    }, 80);
  }

  scheduleCloudSnapshotPublish() {
    if (this.supabaseAgent.isConfigured()) return;
    clearTimeout(this._cloudPublishTimer);
    this._cloudPublishTimer = setTimeout(() => {
      if (this.authAgent.isBoss() && !this.supabaseAgent.isConfigured()) {
        this.cloudSyncAgent.publishFullState().catch(() => {});
      }
    }, 800);
  }

  async handleRemoteSyncEvent(evt) {
    if (!evt) return;
    if (evt.type === 'SALE_EVENT' && evt.sale) {
      const s = evt.sale;
      const whLabel = s.workerName || s.warehouseName || 'Trabajador';
      if (this.authAgent.isBoss()) {
        this._playChime('success');
        this.showToast(`🔔 Venta de ${whLabel}: ${s.quantity}x ${s.productName} (+${Number(s.grossTotal).toFixed(2)}€)`, '📲');
      }
      this._scheduleReactiveRefresh();
    } else if (evt.type === 'STATE_SNAPSHOT' || evt.type === 'RESERVATION_EVENT') {
      if (this.authAgent.isWorker()) {
        this.showToast('Stock y catálogo actualizados desde el Jefe', '☁️');
      }
      this._scheduleReactiveRefresh();
    }
  }

  applyRoleUI() {
    const isWorker = this.authAgent.isWorker();
    const session = this.authAgent.getSession();

    const roleBadge = document.getElementById('headerRoleBadge');
    const subtitleEl = document.getElementById('headerSubtitleText');
    const allTimePill = document.getElementById('headerAllTimeStatsPill');
    const todayProfitEl = document.getElementById('headerTodayProfit');
    const analyticsTabLabel = document.querySelector('.tab-btn[data-tab="analytics"] span');

    if (roleBadge) {
      if (isWorker) {
        roleBadge.textContent = `👤 ${session.workerName || session.warehouseName}`;
        roleBadge.className = 'btn-pressable px-2 py-0.5 rounded-md bg-indigo-500/20 border border-indigo-400/40 text-[9px] font-extrabold text-indigo-200 uppercase tracking-wider whitespace-nowrap';
      } else {
        roleBadge.textContent = '👑 Jefe';
        roleBadge.className = 'btn-pressable px-1.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-[9px] font-extrabold text-emerald-300 uppercase tracking-wider whitespace-nowrap';
      }
    }

    if (subtitleEl) {
      const sbLive = this.supabaseAgent.isConfigured();
      subtitleEl.textContent = isWorker
        ? `Almacén: ${session.warehouseName}${sbLive ? ' • ☁️ Cloud' : ''}`
        : `${sbLive ? 'Supabase Live' : 'Local'} • ntfy: ${this.notificationsAgent.getSettings().topic}`;
    }

    if (allTimePill) {
      allTimePill.classList.toggle('hidden', isWorker);
      allTimePill.classList.toggle('sm:flex', !isWorker);
      allTimePill.style.display = isWorker ? 'none' : '';
    }
    if (todayProfitEl) {
      todayProfitEl.classList.remove('hidden');
    }
    if (analyticsTabLabel) {
      analyticsTabLabel.textContent = isWorker ? 'Mis Ventas' : 'Métricas';
    }
  }

  // ==========================================
  // UTILIDADES Y FEEDBACK AUDITIVO / HÁPTICO
  // ==========================================
  async _runLocked(key, fn) {
    if (!this._inFlightOps) this._inFlightOps = new Set();
    if (this._inFlightOps.has(key)) return;
    this._inFlightOps.add(key);
    try {
      return await fn();
    } finally {
      this._inFlightOps.delete(key);
    }
  }

  _escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  _escJsAttr(str) {
    if (str === null || str === undefined) return '';
    return this._escapeHtml(
      String(str)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r/g, '')
        .replace(/\n/g, ' ')
    );
  }

  /**
   * Genera un tema visual único (orbe, icono, degradado y color de barra) según el sabor.
   */
  _getFlavorVisualTheme(productName = '') {
    const lower = String(productName).toLowerCase();
    const emojiMatch = String(productName).match(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu);
    const mainEmoji = emojiMatch && emojiMatch.length > 0 ? emojiMatch[0] : '✨';

    if (lower.includes('strawberry') || lower.includes('fresa') || lower.includes('dragon')) {
      return {
        emoji: mainEmoji,
        orbBg: 'linear-gradient(135deg, rgba(244, 63, 94, 0.35), rgba(16, 185, 129, 0.25))',
        barBg: 'linear-gradient(90deg, #f43f5e, #10b981)'
      };
    }
    if (lower.includes('blueberry') || lower.includes('ice') || lower.includes('raspberry')) {
      return {
        emoji: mainEmoji,
        orbBg: 'linear-gradient(135deg, rgba(59, 130, 246, 0.38), rgba(139, 92, 246, 0.28))',
        barBg: 'linear-gradient(90deg, #38bdf8, #818cf8)'
      };
    }
    if (lower.includes('lemon') || lower.includes('peach') || lower.includes('passion')) {
      return {
        emoji: mainEmoji,
        orbBg: 'linear-gradient(135deg, rgba(245, 158, 11, 0.38), rgba(249, 115, 22, 0.28))',
        barBg: 'linear-gradient(90deg, #fbbf24, #fb923c)'
      };
    }
    if (lower.includes('love') || lower.includes('watermelon') || lower.includes('sandia')) {
      return {
        emoji: mainEmoji,
        orbBg: 'linear-gradient(135deg, rgba(236, 72, 153, 0.36), rgba(244, 63, 94, 0.26))',
        barBg: 'linear-gradient(90deg, #f472b6, #fb7185)'
      };
    }
    if (lower.includes('coco') || lower.includes('tropical') || lower.includes('pineapple')) {
      return {
        emoji: mainEmoji,
        orbBg: 'linear-gradient(135deg, rgba(20, 184, 166, 0.38), rgba(250, 204, 21, 0.25))',
        barBg: 'linear-gradient(90deg, #2dd4bf, #facc15)'
      };
    }
    return {
      emoji: mainEmoji,
      orbBg: 'linear-gradient(135deg, rgba(16, 185, 129, 0.35), rgba(99, 102, 241, 0.25))',
      barBg: 'linear-gradient(90deg, #10b981, #6366f1)'
    };
  }

  _playChime(type = 'success') {
    try {
      if (!this.audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) this.audioCtx = new AudioContext();
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      if (!this.audioCtx) return;

      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      const now = this.audioCtx.currentTime;

      if (type === 'success') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.1);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
      } else if (type === 'tap') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(420, now);
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
        osc.start(now);
        osc.stop(now + 0.07);
      } else if (type === 'revert') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(310, now + 0.22);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
        osc.start(now);
        osc.stop(now + 0.26);
      }
    } catch (e) {
      // Ignorar si el navegador bloquea audio sin interacción previa
    }

    if (navigator.vibrate) {
      if (type === 'success') navigator.vibrate([30, 40, 60]);
      else if (type === 'tap') navigator.vibrate(12);
    }
  }

  showToast(message, icon = '✓') {
    const toast = document.getElementById('toastNotice');
    if (!toast) return;
    toast.innerHTML = `
      <span class="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-sm flex-shrink-0">${icon}</span>
      <span class="text-xs font-bold tracking-tight text-white">${this._escapeHtml(message)}</span>
    `;
    toast.classList.add('show');
    clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }

  // ==========================================
  // CONFIGURACIÓN DE EVENT LISTENERS GLOBALES
  // ==========================================
  setupEventListeners() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        this.switchTab(tab);
        this._playChime('tap');
      });
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.remove('active');
        }
      });
    });

    document.querySelectorAll('.btn-close-modal').forEach(btn => {
      btn.addEventListener('click', () => {
        const modal = btn.closest('.modal-overlay');
        if (modal) modal.classList.remove('active');
      });
    });

    const handleResumeSync = () => {
      if (!this.supabaseAgent.isConfigured()) return;
      const now = Date.now();
      if (this._lastResumeSyncAt && now - this._lastResumeSyncAt < 5000) return;
      this._lastResumeSyncAt = now;
      this.supabaseAgent.reconnectAndSync().catch(() => {});
    };

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) handleResumeSync();
    });
    window.addEventListener('online', handleResumeSync);
  }

  switchTab(tabName) {
    this.activeTab = tabName;
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    document.querySelectorAll('.tab-view').forEach(view => {
      view.classList.add('hidden');
    });

    const target = document.getElementById(`view-${tabName}`);
    if (target) target.classList.remove('hidden');

    return this.renderCurrentTab();
  }

  async renderCurrentTab() {
    switch (this.activeTab) {
      case 'sales':
        await this.renderSalesView();
        break;
      case 'inventory':
        await this.renderInventoryView();
        break;
      case 'analytics':
        await this.renderAnalyticsView();
        break;
      case 'settings':
        await this.renderSettingsView();
        break;
    }
  }

  async updateHeaderQuickStats() {
    const todayRevEl = document.getElementById('headerTodayRevenue');
    const todayProfEl = document.getElementById('headerTodayProfit');
    const allTimeRevEl = document.getElementById('headerAllTimeRevenue');
    const allTimeProfEl = document.getElementById('headerAllTimeProfit');

    if (this.authAgent.isWorker()) {
      const assignedWh = this.authAgent.getAssignedWarehouseId();
      const workerToday = await this.analyticsAgent.getDashboardMetrics('today', assignedWh);
      if (todayRevEl) todayRevEl.textContent = `${workerToday.totalBilled.toFixed(2)}€`;
      if (todayProfEl) todayProfEl.textContent = `${workerToday.totalUnits} uds hoy`;
      if (allTimeRevEl) allTimeRevEl.textContent = '';
      if (allTimeProfEl) allTimeProfEl.textContent = '';
      return;
    }

    const stats = await this.analyticsAgent.getQuickHeaderStats();
    if (todayRevEl) todayRevEl.textContent = `${stats.todayBilled.toFixed(2)}€`;
    if (todayProfEl) todayProfEl.textContent = `+${stats.todayProfit.toFixed(2)}€ benef.`;
    if (allTimeRevEl) allTimeRevEl.textContent = `${stats.allTimeBilled.toFixed(2)}€`;
    if (allTimeProfEl) allTimeProfEl.textContent = `+${stats.allTimeProfit.toFixed(2)}€ benef.`;
  }

  // =========================================================================
  // PESTAÑA 1: VENDER (POS MULTI-ALMACÉN, FIADOS Y RESERVAS)
  // =========================================================================
  async renderSalesView() {
    const container = document.getElementById('view-sales');
    if (!container) return;

    const isWorker = this.authAgent.isWorker();
    const assignedWhId = this.authAgent.getAssignedWarehouseId();

    const [warehouses, valuation, allActiveReservations, allSalesRaw] = await Promise.all([
      this.inventoryAgent.getWarehouses(),
      this.inventoryAgent.getInventoryValuation('all'),
      this.inventoryAgent.getReservations({ status: 'active', warehouseId: isWorker ? assignedWhId : 'all' }),
      this.storageAgent.getAllSales()
    ]);

    const allSales = isWorker
      ? allSalesRaw.filter(s => (s.warehouseId || MAIN_WAREHOUSE_ID) === assignedWhId)
      : allSalesRaw;
    const activeReservations = allActiveReservations;

    const pendingSales = allSales.filter(s => s.paymentStatus === 'pending');
    const totalPendingDebtAmount = pendingSales.reduce((sum, s) => sum + (parseFloat(s.grossTotal) || 0), 0);

    // En Modo Trabajador bloquear al almacén asignado
    if (isWorker && assignedWhId) {
      this.activeSaleWarehouseId = assignedWhId;
    } else if (!warehouses.some(w => w.id === this.activeSaleWarehouseId)) {
      this.activeSaleWarehouseId = MAIN_WAREHOUSE_ID;
    }

    const activeWhObj = warehouses.find(w => w.id === this.activeSaleWarehouseId) || warehouses[0];
    const whMap = new Map(warehouses.map(w => [w.id, w]));
    const whValuationMap = new Map((valuation.byWarehouse || []).map(wv => [wv.warehouseId, wv]));
    const activeWhVal = whValuationMap.get(this.activeSaleWarehouseId);
    const activeWhUnits = activeWhVal?.availableUnits ?? activeWhVal?.totalUnits ?? 0;
    const activeWhReserved = activeWhVal?.reservedUnits || 0;

    const products = await this.inventoryAgent.getProducts({
      query: this.salesSearchQuery,
      warehouseId: this.activeSaleWarehouseId
    });

    const hasMultipleWarehouses = !isWorker && warehouses.length > 1;
    const availableInActiveCount = products.filter(p => p.availableStock > 0).length;

    let lastSaleWhBadge = '';
    if (this.lastCompletedSale) {
      const saleWh = whMap.get(this.lastCompletedSale.warehouseId);
      const saleIcon = saleWh ? saleWh.icon : '🏠';
      const saleWhName = this.lastCompletedSale.warehouseName || (saleWh ? saleWh.name : 'Mi Almacén (Principal)');
      lastSaleWhBadge = `${saleIcon} ${this._escapeHtml(saleWhName)}`;
    }

    let html = `
      <div class="mb-3.5">
        <!-- Barra Superior de Acceso Rápido: Reservas y Fiados por Cobrar -->
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <button 
            type="button"
            onclick="window.app.openReservationModal(null, '${this.activeSaleWarehouseId}')"
            class="btn-pressable flex-1 py-2 px-3 rounded-xl bg-purple-950/35 hover:bg-purple-900/45 border border-purple-500/40 text-purple-200 text-xs font-bold flex items-center justify-center gap-1.5"
          >
            <span>📌</span>
            <span>Reservas Activas (${activeReservations.length})</span>
          </button>

          <button 
            type="button"
            onclick="window.app.openSalesHistoryModal()"
            class="btn-pressable flex-1 py-2 px-3 rounded-xl ${
              pendingSales.length > 0
                ? 'bg-amber-950/40 hover:bg-amber-900/50 border border-amber-500/50 text-amber-300'
                : 'bg-slate-900/80 hover:bg-slate-800 border border-slate-700/70 text-slate-300'
            } text-xs font-bold flex items-center justify-center gap-1.5"
          >
            <span>⏳</span>
            <span>Fiados por cobrar: ${totalPendingDebtAmount.toFixed(2)}€ (${pendingSales.length})</span>
          </button>
        </div>

        <!-- Selector Horizontal de Almacén de Venta (O Banner de Modo Trabajador) -->
        ${isWorker ? `
          <div class="ios-card ios-card-glow-indigo p-3 mb-3 flex items-center justify-between gap-2">
            <div class="flex items-center gap-2.5 min-w-0">
              <span class="text-xl">${activeWhObj?.icon || '👤'}</span>
              <div class="min-w-0">
                <div class="text-[10px] uppercase tracking-wider text-indigo-300 font-bold">Modo Trabajador • Solo tu almacén</div>
                <div class="text-xs font-black text-white truncate">${this._escapeHtml(activeWhObj?.name || this.authAgent.getSession().warehouseName)}</div>
              </div>
            </div>
            <button
              type="button"
              onclick="window.app.openPinAuthModal()"
              class="btn-pressable px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/15 text-[11px] font-bold flex-shrink-0"
            >🔐 PIN Jefe</button>
          </div>
        ` : `
          <div class="mb-3">
            <div class="flex items-center justify-between text-[11px] text-slate-400 px-1 mb-1.5">
              <span class="font-semibold uppercase tracking-wider text-slate-300">📍 Vendiendo desde:</span>
              <button 
                onclick="window.app.openWarehouseModal()"
                class="text-emerald-400 hover:text-emerald-300 font-bold text-[11px] flex items-center gap-1"
              >
                <span>+ Nuevo Almacén / Trabajador</span>
              </button>
            </div>
            <div class="warehouse-pills-bar no-scrollbar">
              ${warehouses.map(wh => {
                const isSelected = wh.id === this.activeSaleWarehouseId;
                const wv = whValuationMap.get(wh.id);
                const avail = wv ? wv.availableUnits : 0;
                return `
                  <button 
                    type="button"
                    onclick="window.app.setSaleWarehouse('${wh.id}')"
                    class="warehouse-pill btn-pressable ${isSelected ? 'active' : ''}"
                  >
                    <span>${wh.icon || '🏠'}</span>
                    <span>${this._escapeHtml(wh.name)}</span>
                    <span class="px-1.5 py-0.5 rounded-full text-[10px] ${
                      isSelected ? 'bg-emerald-950/80 text-emerald-300' : 'bg-slate-800 text-slate-400'
                    }">${avail} libres</span>
                  </button>
                `;
              }).join('')}
            </div>
          </div>
        `}

        <!-- Banner de Deshacer / Repetir Última Venta -->
        ${this.lastCompletedSale ? `
          <div class="ios-card ${this.lastCompletedSale.paymentStatus === 'pending' ? 'ios-card-glow-amber' : 'ios-card-glow-emerald'} p-3 mb-3 flex items-center justify-between animate-fade-in">
            <div class="pr-2">
              <div class="flex flex-wrap items-center gap-1.5 mb-1">
                <span class="w-2 h-2 rounded-full ${this.lastCompletedSale.paymentStatus === 'pending' ? 'bg-amber-400' : 'bg-emerald-400'} inline-block animate-pulse"></span>
                <span class="text-[10px] ${this.lastCompletedSale.paymentStatus === 'pending' ? 'text-amber-300' : 'text-emerald-300'} font-bold uppercase tracking-wider">
                  ${this.lastCompletedSale.paymentStatus === 'pending' ? '⏳ Venta Fiada' : `Última Venta • ${this.lastCompletedSale.paymentMethod}`}
                </span>
                <span class="badge badge-warehouse text-[10px]">${lastSaleWhBadge}</span>
              </div>
              <div class="text-xs font-bold text-white leading-tight">
                ${this.lastCompletedSale.quantity}x ${this._escapeHtml(this.lastCompletedSale.productName)} • ${this.lastCompletedSale.grossTotal.toFixed(2)}€
              </div>
              <div class="text-[10px] text-emerald-400 font-medium mt-0.5">
                ${isWorker ? '' : `Beneficio: +${this.lastCompletedSale.netProfit.toFixed(2)}€`}
                ${this.lastCompletedSale.buyerName ? `${isWorker ? '' : ' • '}👤 ${this._escapeHtml(this.lastCompletedSale.buyerName)}` : ''}
                ${this.lastCompletedSale.notes ? ` • 📝 ${this._escapeHtml(this.lastCompletedSale.notes)}` : ''}
              </div>
            </div>
            <button 
              onclick="window.app.undoAndRepeatSale('${this.lastCompletedSale.id}')"
              class="btn-pressable bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/50 px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap flex items-center gap-1"
            >
              <span>↩</span> Deshacer
            </button>
          </div>
        ` : ''}

        <!-- Buscador rápido y Botón de Historial / Anular -->
        <div class="flex items-center gap-2 mb-2.5">
          <div class="relative flex-1">
            <input 
              type="text" 
              id="salesSearchInput" 
              value="${this._escapeHtml(this.salesSearchQuery || '')}"
              placeholder="🔍 Buscar sabor o cliente con reserva..." 
              autocomplete="off"
              autocorrect="off"
              spellcheck="false"
              class="w-full bg-slate-900/90 text-white placeholder-slate-400 pl-4 pr-9 py-2.5 rounded-xl border border-slate-700/70 focus:outline-none focus:border-emerald-500 text-sm"
            />
            <button type="button" id="btnClearSalesSearch" class="${this.salesSearchQuery ? '' : 'hidden'} absolute right-3 top-2.5 text-slate-400 hover:text-white text-sm font-bold">✕</button>
          </div>
          <button 
            onclick="window.app.openSalesHistoryModal()"
            class="btn-pressable bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shadow-sm"
            title="Ver ventas, cobrar fiados y cancelar ventas"
          >
            <span>🕒</span> Historial
          </button>
        </div>

        <div class="flex items-center justify-between text-xs text-slate-400 px-1">
          <span>
            Libres en <strong class="text-white">${activeWhObj ? `${activeWhObj.icon} ${this._escapeHtml(activeWhObj.name)}` : 'Almacén'}</strong>:
            <strong class="text-emerald-400">${activeWhUnits} uds</strong>
            ${activeWhReserved > 0 ? `<span class="text-purple-300 ml-1">(📌 ${activeWhReserved} res.)</span>` : ''}
          </span>
          <span id="salesAvailableCount" class="font-medium text-emerald-400">${availableInActiveCount} sabores libres</span>
        </div>
      </div>

      <!-- Cuadrícula de productos listos para venta rápida -->
      <div id="salesProductGrid" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 pb-8">
        ${this._buildSalesProductGridHtml(products, isWorker, hasMultipleWarehouses)}
      </div>
    `;

    container.innerHTML = html;

    const searchInput = document.getElementById('salesSearchInput');
    const btnClear = document.getElementById('btnClearSalesSearch');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.salesSearchQuery = e.target.value;
        if (btnClear) {
          btnClear.classList.toggle('hidden', !this.salesSearchQuery);
        }
        this._refreshSalesGridOnly();
      });
    }
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        this.salesSearchQuery = '';
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
        btnClear.classList.add('hidden');
        this._refreshSalesGridOnly();
      });
    }
  }

  _buildSalesProductGridHtml(products, isWorker, hasMultipleWarehouses) {
    if (!products || products.length === 0) {
      return `
        <div class="col-span-full text-center py-12 px-4 ios-card">
          <div class="text-4xl mb-2">📦</div>
          <p class="text-slate-300 font-semibold">No se encontraron sabores</p>
          <p class="text-xs text-slate-500 mt-1">Añade productos en la pestaña de Inventario o cambia el texto de búsqueda.</p>
        </div>
      `;
    }

    return products.map((p, idx) => {
      const whStock = p.warehouseStock || 0;
      const availStock = p.availableStock !== undefined ? p.availableStock : whStock;
      const whReserved = p.warehouseReserved || 0;
      const globalStock = p.stock || 0;
      const isOutHere = availStock <= 0 && whStock <= 0;
      const isOnlyReservedHere = availStock <= 0 && whStock > 0;
      const isOutEverywhere = globalStock <= 0;
      const isLowHere = availStock > 0 && availStock <= 4;
      const profit = (p.sellPrice - p.costPrice).toFixed(2);
      const reservedCustomers = (p.activeReservations || [])
        .map(r => r.customerName)
        .filter(Boolean)
        .join(', ');
      const theme = this._getFlavorVisualTheme(p.name);
      const stockBarPct = Math.min(100, Math.round((availStock / 10) * 100));
      const animDelay = Math.min(idx * 22, 240);

      return `
        <div 
          style="animation-delay: ${animDelay}ms"
          class="ios-card product-pos-card btn-pressable flex flex-col justify-between cursor-pointer transition-all border mb-0 ${
            (isWorker ? isOutHere : isOutEverywhere)
              ? 'opacity-45 border-rose-900/40 bg-slate-900/50 pointer-events-none'
              : (isOutHere || isOnlyReservedHere)
                ? 'opacity-80 border-amber-500/35 bg-slate-900/75 hover:border-amber-400/60'
                : 'hover:border-emerald-500/60'
          }"
          onclick="window.app.openQuickSaleSheet('${p.id}')"
        >
          <div>
            <div class="flex items-start justify-between gap-2 mb-2">
              <div class="flavor-orb" style="background: ${theme.orbBg};">
                <span>${theme.emoji}</span>
              </div>
              <div class="flex flex-col items-end gap-1">
                <span class="badge ${
                  availStock <= 0
                    ? 'badge-low-stock'
                    : isLowHere ? 'badge-low-stock' : 'badge-ok-stock'
                }">
                  ${availStock <= 0 ? (whReserved > 0 ? '0 libres' : '0 aquí') : `${availStock} libres`}
                </span>
                ${hasMultipleWarehouses ? `
                  <span class="text-[9.5px] font-bold px-1.5 py-0.5 rounded-md bg-slate-900/90 text-slate-300 border border-white/10 tabular-nums" title="Stock global en todos los almacenes">
                    🌐 ${globalStock} tot.
                  </span>
                ` : ''}
              </div>
            </div>

            <h4 class="font-extrabold text-white text-[13.5px] line-clamp-2 leading-snug tracking-tight">${this._escapeHtml(p.name)}</h4>

            <!-- Mini barra de nivel de stock estilo iOS -->
            <div class="stock-mini-bar">
              <div class="stock-mini-fill" style="width: ${stockBarPct}%; background: ${availStock <= 3 ? 'linear-gradient(90deg, #f43f5e, #fbbf24)' : theme.barBg};"></div>
            </div>

            ${whReserved > 0 ? `
              <div 
                onclick="event.stopPropagation(); window.app.openReservationModal('${p.id}', '${this.activeSaleWarehouseId}')"
                class="mt-2 px-2 py-0.5 rounded-lg bg-purple-950/60 border border-purple-500/40 text-[10px] text-purple-300 font-semibold truncate"
                title="Reservado para: ${this._escapeHtml(reservedCustomers)}"
              >
                📌 ${whReserved} res.: ${this._escapeHtml(reservedCustomers || 'Cliente')}
              </div>
            ` : ''}

            ${!isWorker && isOutHere && !isOutEverywhere ? `
              <div class="text-[10px] text-amber-400 font-semibold mt-1">
                Disponible en otro almacén (${globalStock} uds)
              </div>
            ` : ''}
          </div>

          <div class="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between gap-1.5">
            <div>
              <div class="text-[17px] font-black text-white leading-none tabular-nums">${p.sellPrice.toFixed(2)}€</div>
              ${isWorker ? `<div class="text-[10px] text-slate-400 font-semibold mt-0.5">PVP</div>` : `<div class="text-[10px] text-emerald-400 font-extrabold mt-0.5 tabular-nums">+${profit}€ benef.</div>`}
            </div>
            <div class="flex items-center gap-1">
              <button 
                type="button"
                onclick="event.stopPropagation(); window.app.openReservationModal('${p.id}', '${this.activeSaleWarehouseId}')"
                class="btn-pressable px-2 py-1.5 rounded-xl bg-slate-900/90 hover:bg-purple-950/50 text-purple-300 border border-purple-500/35 text-[10px] font-bold flex items-center gap-1"
                title="Reservar este sabor a un cliente"
              >
                <span>📌</span> Res.
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  async _refreshSalesGridOnly() {
    const grid = document.getElementById('salesProductGrid');
    if (!grid) return;

    const token = (this._salesGridToken = (this._salesGridToken || 0) + 1);
    const isWorker = this.authAgent.isWorker();
    const [warehouses, products] = await Promise.all([
      this.inventoryAgent.getWarehouses(),
      this.inventoryAgent.getProducts({
        query: this.salesSearchQuery,
        warehouseId: this.activeSaleWarehouseId
      })
    ]);

    if (token !== this._salesGridToken) return;
    const latestGrid = document.getElementById('salesProductGrid');
    if (!latestGrid) return;

    const hasMultipleWarehouses = !isWorker && warehouses.length > 1;
    const availableInActiveCount = products.filter(p => p.availableStock > 0).length;

    latestGrid.innerHTML = this._buildSalesProductGridHtml(products, isWorker, hasMultipleWarehouses);
    const countEl = document.getElementById('salesAvailableCount');
    if (countEl) {
      countEl.textContent = `${availableInActiveCount} sabores libres`;
    }
  }

  setSaleWarehouse(warehouseId) {
    this.activeSaleWarehouseId = warehouseId || MAIN_WAREHOUSE_ID;
    this._playChime('tap');
    this.renderSalesView();
  }

  // Bottom Sheet Modal: Preparar y Confirmar Venta Multi-Almacén
  async openQuickSaleSheet(productId, prefill = null) {
    const isWorker = this.authAgent.isWorker();
    const assignedWh = this.authAgent.getAssignedWarehouseId();

    const [productsList, warehouses] = await Promise.all([
      this.inventoryAgent.getProducts({ warehouseId: 'all' }),
      this.inventoryAgent.getWarehouses()
    ]);
    const product = productsList.find(p => p.id === productId);
    if (!product) return;

    this.selectedProductForSale = product;
    this._cachedWarehousesForModal = warehouses;

    if (prefill) {
      this.saleQuantity = prefill.quantity || 1;
      this.saleUnitPrice = prefill.finalUnitPrice !== undefined ? prefill.finalUnitPrice : product.sellPrice;
      this.salePaymentMethod = prefill.paymentMethod || 'Efectivo';
      this.salePaymentStatus = prefill.paymentStatus || 'paid';
      this.saleWarehouseId = isWorker && assignedWh ? assignedWh : (prefill.warehouseId || this.activeSaleWarehouseId || MAIN_WAREHOUSE_ID);
    } else {
      this.saleQuantity = 1;
      this.saleUnitPrice = product.sellPrice;
      this.salePaymentMethod = 'Efectivo';
      this.salePaymentStatus = 'paid';
      this.saleWarehouseId = isWorker && assignedWh ? assignedWh : (this.activeSaleWarehouseId || MAIN_WAREHOUSE_ID);

      if (!isWorker) {
        const stockInActive = this.inventoryAgent.getProductStock(product, this.saleWarehouseId);
        if (stockInActive <= 0 && product.stock > 0) {
          const whWithStock = warehouses.find(w => (product.stockByWarehouse?.[w.id] || 0) > 0);
          if (whWithStock) {
            this.saleWarehouseId = whWithStock.id;
          }
        }
      }
    }

    const modal = document.getElementById('saleCheckoutModal');
    if (!modal) return;

    const inputPrice = document.getElementById('modalSalePriceInput');
    if (inputPrice) inputPrice.value = this.saleUnitPrice;

    const inputBuyer = document.getElementById('modalSaleBuyerInput');
    if (inputBuyer) inputBuyer.value = prefill?.buyerName || '';

    const inputNotes = document.getElementById('modalSaleNotesInput');
    if (inputNotes) inputNotes.value = prefill?.notes || '';

    this._updateSaleModalPreview(false);
    modal.classList.add('active');
    this._playChime('tap');
  }

  setModalSaleWarehouse(warehouseId) {
    this.saleWarehouseId = warehouseId || MAIN_WAREHOUSE_ID;
    this._playChime('tap');
    this._updateSaleModalPreview(false);
  }

  setSalePaymentStatus(status) {
    this.salePaymentStatus = status === 'pending' ? 'pending' : 'paid';
    this._playChime('tap');
    this._updateSaleModalPreview(false);
  }

  _updateSaleModalPreview(updatePriceInput = false) {
    const p = this.selectedProductForSale;
    if (!p) return;

    const warehouses = this._cachedWarehousesForModal || [];
    const currentWh = warehouses.find(w => w.id === this.saleWarehouseId) || {
      id: MAIN_WAREHOUSE_ID,
      name: 'Mi Almacén (Principal)',
      icon: '🏠'
    };

    const whPhysicalStock = this.inventoryAgent.getProductStock(p, this.saleWarehouseId);
    const whReserved = p.reservedByWarehouse?.[this.saleWarehouseId] || 0;
    const whAvailableStock = Math.max(0, whPhysicalStock - whReserved);
    const globalStock = p.stock || 0;

    const parsedQty = parseInt(this.saleQuantity, 10);
    const qty = (Number.isFinite(parsedQty) && parsedQty >= 1) ? parsedQty : 1;
    this.saleQuantity = qty;
    const parsedPrice = parseFloat(this.saleUnitPrice);
    const unitPrice = (Number.isFinite(parsedPrice) && parsedPrice >= 0) ? parsedPrice : 0;
    const parsedCat = parseFloat(p.sellPrice);
    const catalogPrice = (Number.isFinite(parsedCat) && parsedCat >= 0) ? parsedCat : 12.00;
    const discountTotal = Math.max(0, parseFloat(((catalogPrice - unitPrice) * qty).toFixed(2)));
    const totalGross = parseFloat((unitPrice * qty).toFixed(2));
    const totalCost = parseFloat(((p.costPrice || 0) * qty).toFixed(2));
    const netProfit = parseFloat((totalGross - totalCost).toFixed(2));
    const remainingPhysical = whPhysicalStock - qty;
    const remainingFree = whAvailableStock - qty;

    const modalTitle = document.getElementById('modalSaleProductName');
    const modalStock = document.getElementById('modalSaleStockBadge');
    const modalGlobalHint = document.getElementById('modalSaleGlobalStockHint');
    const whSection = document.getElementById('modalSaleWarehouseSection');
    const pillsContainer = document.getElementById('modalSaleWarehousePills');
    const inputQty = document.getElementById('modalSaleQtyInput');
    const inputPrice = document.getElementById('modalSalePriceInput');
    const displayTotal = document.getElementById('modalSaleTotalGross');
    const displayDiscount = document.getElementById('modalSaleDiscountBadge');
    const displayProfit = document.getElementById('modalSaleNetProfit');
    const profitWrap = document.getElementById('modalSaleNetProfitWrap');
    const displayRemaining = document.getElementById('modalSaleRemainingStock');
    const btnConfirm = document.getElementById('btnConfirmExecuteSale');

    const isWorker = this.authAgent.isWorker();
    if (whSection) whSection.classList.toggle('hidden', isWorker);
    if (profitWrap) profitWrap.classList.toggle('hidden', isWorker);

    if (modalTitle) modalTitle.textContent = p.name;
    if (modalStock) {
      modalStock.innerHTML = `${currentWh.icon || '🏠'} <strong>${this._escapeHtml(currentWh.name)}</strong>: <strong>${whAvailableStock} libres</strong>${whReserved > 0 ? ` (📌 ${whReserved} res. / ${whPhysicalStock} fís.)` : ''}`;
      modalStock.className = `text-xs ${whAvailableStock <= 3 ? 'text-rose-400 font-semibold' : 'text-emerald-400 font-medium'}`;
    }
    if (modalGlobalHint) {
      modalGlobalHint.textContent = isWorker ? '' : `Global: ${globalStock} uds`;
    }

    if (pillsContainer && warehouses.length > 0) {
      pillsContainer.innerHTML = warehouses.map(wh => {
        const st = p.stockByWarehouse?.[wh.id] || 0;
        const res = p.reservedByWarehouse?.[wh.id] || 0;
        const free = Math.max(0, st - res);
        const isSel = wh.id === this.saleWarehouseId;
        return `
          <button 
            type="button"
            onclick="window.app.setModalSaleWarehouse('${wh.id}')"
            class="warehouse-pill btn-pressable ${isSel ? 'active' : ''} ${st <= 0 ? 'opacity-60' : ''}"
          >
            <span>${wh.icon || '🏠'}</span>
            <span>${this._escapeHtml(wh.name)}</span>
            <span class="px-1.5 py-0.5 rounded-full text-[10px] ${
              free <= 0 ? 'bg-rose-950 text-rose-400' : isSel ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-300'
            }">${free}${res > 0 ? ` (+${res}📌)` : ''}</span>
          </button>
        `;
      }).join('');
    }

    if (inputQty && document.activeElement !== inputQty) inputQty.value = qty;
    if (inputPrice && updatePriceInput) inputPrice.value = unitPrice;

    if (displayTotal) displayTotal.textContent = `${totalGross.toFixed(2)}€`;
    if (displayDiscount) {
      if (discountTotal > 0.009) {
        displayDiscount.textContent = `🏷️ Descuento aplicado: -${discountTotal.toFixed(2)}€ sobre PVP`;
        displayDiscount.classList.remove('hidden');
      } else {
        displayDiscount.classList.add('hidden');
      }
    }

    if (displayProfit) {
      displayProfit.textContent = `${netProfit >= 0 ? '+' : ''}${netProfit.toFixed(2)}€`;
      displayProfit.className = netProfit >= 0 ? 'text-emerald-400 font-bold text-lg' : 'text-rose-400 font-bold text-lg';
    }
    if (displayRemaining) {
      displayRemaining.textContent = remainingPhysical < 0
        ? `¡Faltan ${Math.abs(remainingPhysical)} uds!`
        : remainingFree < 0
          ? `${remainingPhysical} fís. (⚠️ Ocupa ${Math.abs(remainingFree)} res.)`
          : `${remainingFree} uds libres`;
      displayRemaining.className = remainingPhysical < 0
        ? 'text-xs text-rose-400 font-bold'
        : remainingFree < 0
          ? 'text-xs text-amber-400 font-bold'
          : 'text-xs text-slate-300 font-semibold';
    }

    if (btnConfirm) {
      btnConfirm.disabled = remainingPhysical < 0 || qty <= 0;
      if (this.salePaymentStatus === 'pending') {
        btnConfirm.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
        btnConfirm.innerHTML = `<span>⏳ Registrar Fiado ${totalGross.toFixed(2)}€ (Pendiente)</span>`;
      } else {
        btnConfirm.style.background = '';
        btnConfirm.innerHTML = `<span>Cobrar ${totalGross.toFixed(2)}€ (${this.salePaymentMethod}) • ${currentWh.icon || '🏠'}</span>`;
      }
    }

    // Actualizar botones de Método de Pago
    const btnCard = document.getElementById('btnPayCard');
    const btnCash = document.getElementById('btnPayCash');
    if (btnCard && btnCash) {
      if (this.salePaymentMethod === 'Efectivo') {
        btnCash.className = 'flex-1 py-2 px-2.5 rounded-xl border-2 border-emerald-500 bg-emerald-500/20 text-white font-semibold text-xs flex items-center justify-center gap-1 transition-all';
        btnCard.className = 'flex-1 py-2 px-2.5 rounded-xl border border-slate-700 bg-slate-800/80 text-slate-400 font-medium text-xs flex items-center justify-center gap-1 transition-all';
      } else {
        btnCard.className = 'flex-1 py-2 px-2.5 rounded-xl border-2 border-indigo-500 bg-indigo-500/20 text-white font-semibold text-xs flex items-center justify-center gap-1 transition-all';
        btnCash.className = 'flex-1 py-2 px-2.5 rounded-xl border border-slate-700 bg-slate-800/80 text-slate-400 font-medium text-xs flex items-center justify-center gap-1 transition-all';
      }
    }

    // Actualizar botones de Estado del Pago (Cobrado vs Fiado)
    const btnStatusPaid = document.getElementById('btnSaleStatusPaid');
    const btnStatusPending = document.getElementById('btnSaleStatusPending');
    const labelBuyer = document.getElementById('labelSaleBuyerInput');
    if (btnStatusPaid && btnStatusPending) {
      if (this.salePaymentStatus === 'pending') {
        btnStatusPending.className = 'flex-1 py-2 px-2.5 rounded-xl border-2 border-amber-500 bg-amber-500/20 text-amber-200 font-bold text-xs flex items-center justify-center gap-1 transition-all';
        btnStatusPaid.className = 'flex-1 py-2 px-2.5 rounded-xl border border-slate-700 bg-slate-800/80 text-slate-400 font-medium text-xs flex items-center justify-center gap-1 transition-all';
        if (labelBuyer) labelBuyer.innerHTML = '👤 Cliente / Deudor <span class="text-amber-400">* (Obligatorio en Fiados)</span>';
      } else {
        btnStatusPaid.className = 'flex-1 py-2 px-2.5 rounded-xl border-2 border-emerald-500 bg-emerald-500/20 text-white font-semibold text-xs flex items-center justify-center gap-1 transition-all';
        btnStatusPending.className = 'flex-1 py-2 px-2.5 rounded-xl border border-slate-700 bg-slate-800/80 text-slate-400 font-medium text-xs flex items-center justify-center gap-1 transition-all';
        if (labelBuyer) labelBuyer.innerHTML = '👤 Cliente / Comprador (Opcional)';
      }
    }
  }

  setSalePaymentMethod(method) {
    this.salePaymentMethod = method;
    this._playChime('tap');
    this._updateSaleModalPreview(false);
  }

  setSaleQuantity(value) {
    const raw = String(value ?? '').trim();
    if (!raw) {
      this.saleQuantity = 1;
      this._updateSaleModalPreview(false);
      return;
    }
    const parsed = parseInt(raw, 10);
    this.saleQuantity = (Number.isFinite(parsed) && parsed >= 1) ? parsed : 1;
    this._updateSaleModalPreview(false);
  }

  changeSaleQuantity(delta) {
    const parsedDelta = parseInt(delta, 10);
    if (!Number.isFinite(parsedDelta)) return;
    const current = parseInt(this.saleQuantity, 10) || 1;
    const next = Math.max(1, current + parsedDelta);
    this.saleQuantity = next;
    const inputQty = document.getElementById('modalSaleQtyInput');
    if (inputQty) inputQty.value = next;
    this._playChime('tap');
    this._updateSaleModalPreview(false);
  }

  setSaleUnitPrice(value) {
    const raw = String(value ?? '').trim();
    const val = parseFloat(raw);
    if (Number.isFinite(val) && val >= 0) {
      this.saleUnitPrice = val;
    } else if (raw === '' || raw === '0' || val < 0) {
      this.saleUnitPrice = 0;
    }
    this._updateSaleModalPreview(false);
  }

  quickAdjustPrice(delta) {
    const current = parseFloat(this.saleUnitPrice) || 0;
    const next = Math.max(0, parseFloat((current + delta).toFixed(2)));
    this.saleUnitPrice = next;
    const inputPrice = document.getElementById('modalSalePriceInput');
    if (inputPrice) inputPrice.value = next;
    this._playChime('tap');
    this._updateSaleModalPreview(false);
  }

  setPresetPrice(price) {
    this.saleUnitPrice = price;
    const inputPrice = document.getElementById('modalSalePriceInput');
    if (inputPrice) inputPrice.value = price;
    this._playChime('tap');
    this._updateSaleModalPreview(false);
  }

  /**
   * Notifica por ntfy.sh y sincroniza en tiempo real cualquier venta recién registrada.
   */
  async _notifyAndSyncSale(sale) {
    if (!sale) return;
    try {
      const targetWhId = sale.warehouseId || MAIN_WAREHOUSE_ID;
      const [warehouse, updatedProduct, allSales] = await Promise.all([
        this.inventoryAgent.getWarehouse(targetWhId),
        this.inventoryAgent.getProduct(sale.productId),
        this.storageAgent.getAllSales()
      ]);

      const remainingStock = updatedProduct
        ? (updatedProduct.stockByWarehouse?.[targetWhId] ?? updatedProduct.stock ?? 0)
        : 0;

      // Calcular progreso de vapers gratis del trabajador para incluirlo en la notificación ntfy
      let workerPendingFreeVapers = 0;
      let workerProgressText = '';
      if (warehouse && !warehouse.isMain) {
        const whUnitsSold = allSales
          .filter(s => (s.warehouseId || MAIN_WAREHOUSE_ID) === targetWhId && s.paymentStatus !== 'pending')
          .reduce((sum, s) => sum + (parseInt(s.quantity, 10) || 0), 0);
        const everyN = Math.max(1, parseInt(warehouse.rewardEveryNUnits, 10) || 5);
        const freeU = Math.max(1, parseInt(warehouse.rewardFreeUnits, 10) || 1);
        const earned = Math.floor(whUnitsSold / everyN) * freeU;
        const delivered = parseInt(warehouse.rewardVapersDelivered, 10) || 0;
        workerPendingFreeVapers = Math.max(0, earned - delivered);
        workerProgressText = `${whUnitsSold % everyN}/${everyN} para próximo regalo`;
      }

      const isWorkerSession = this.authAgent.isWorker();

      // Enviar notificación push al iPhone del jefe vía ntfy
      this.notificationsAgent.notifySale({
        sale,
        warehouse,
        remainingStock,
        workerPendingFreeVapers,
        workerProgressText,
        isWorkerSession
      }).catch(() => {});

      // Si Supabase no está activo, usar fallback de eventos por ntfy
      if (!this.supabaseAgent.isConfigured()) {
        this.cloudSyncAgent.publishWorkerSale(sale, updatedProduct).catch(() => {});
      }
    } catch (err) {
      console.warn('Error en _notifyAndSyncSale:', err);
    }
  }

  async confirmExecuteSale() {
    return this._runLocked('executeSale', async () => {
      if (!this.selectedProductForSale) return;

      const buyerInput = document.getElementById('modalSaleBuyerInput');
      const notesInput = document.getElementById('modalSaleNotesInput');
      const buyerName = buyerInput ? buyerInput.value.trim() : '';
      const notes = notesInput ? notesInput.value.trim() : '';

      if (this.salePaymentStatus === 'pending' && !buyerName) {
        alert('Para registrar una venta como "Fiado / Pendiente de cobro", escribe el nombre del cliente en el campo "👤 Cliente / Deudor".');
        if (buyerInput) buyerInput.focus();
        return;
      }

      const isWorker = this.authAgent.isWorker();
      const targetWh = isWorker
        ? (this.authAgent.getAssignedWarehouseId() || MAIN_WAREHOUSE_ID)
        : (this.saleWarehouseId || this.activeSaleWarehouseId || MAIN_WAREHOUSE_ID);

      // Avisar si la venta directa va a consumir unidades reservadas para clientes
      if (!this.pendingReservationIdForSale) {
        const freshProducts = await this.inventoryAgent.getProducts({ warehouseId: targetWh });
        const freshProd = freshProducts.find(p => p.id === this.selectedProductForSale.id);
        if (freshProd) {
          const reserved = freshProd.warehouseReserved || 0;
          const free = freshProd.availableStock || 0;
          const physical = freshProd.warehouseStock || 0;
          const requestedQty = parseInt(this.saleQuantity, 10) || 1;
          if (reserved > 0 && requestedQty > free && requestedQty <= physical) {
            const ok = confirm(
              `⚠️ AVISO DE RESERVA\n\n"${freshProd.name}" tiene ${reserved} ud(s) reservadas en este almacén (quedan ${free} libres de ${physical} físicas).\nAl vender ${requestedQty} ud(s) estarás tocando unidades reservadas para un cliente.\n\n¿Deseas continuar con la venta igualmente?`
            );
            if (!ok) return;
          }
        }
      }

      try {
        const result = await this.salesAgent.executeSale({
          productId: this.selectedProductForSale.id,
          quantity: this.saleQuantity,
          finalUnitPrice: this.saleUnitPrice,
          paymentMethod: this.salePaymentMethod,
          paymentStatus: this.salePaymentStatus,
          warehouseId: targetWh,
          buyerName,
          notes
        });

        this.lastCompletedSale = result.sale;
        this.activeSaleWarehouseId = result.sale.warehouseId;

        const modal = document.getElementById('saleCheckoutModal');
        if (modal) modal.classList.remove('active');

        this._playChime('success');
        const toastMsg = isWorker
          ? `Venta registrada: ${result.sale.grossTotal.toFixed(2)}€ (${result.remainingStock} uds restantes)`
          : result.message;
        this.showToast(toastMsg, this.salePaymentStatus === 'pending' ? '⏳' : '💰');

        // Disparar notificación push ntfy y sincronización en vivo
        this._notifyAndSyncSale(result.sale);

        await this.renderSalesView();
        await this.updateHeaderQuickStats();
      } catch (err) {
        alert(`Error en la venta: ${err.message}`);
      }
    });
  }

  async saveSaleModalAsReservation() {
    return this._runLocked('saveSaleModalAsReservation', async () => {
      if (!this.selectedProductForSale) return;

      const buyerInput = document.getElementById('modalSaleBuyerInput');
      const notesInput = document.getElementById('modalSaleNotesInput');
      const customerName = buyerInput ? buyerInput.value.trim() : '';
      const notes = notesInput ? notesInput.value.trim() : '';

      if (!customerName) {
        this.showToast('Escribe primero el nombre del cliente arriba para reservar', '📌');
        if (buyerInput) buyerInput.focus();
        return;
      }

      const isWorker = this.authAgent.isWorker();
      const targetWh = isWorker
        ? (this.authAgent.getAssignedWarehouseId() || MAIN_WAREHOUSE_ID)
        : (this.saleWarehouseId || this.activeSaleWarehouseId || MAIN_WAREHOUSE_ID);

      try {
        const res = await this.inventoryAgent.addReservation({
          productId: this.selectedProductForSale.id,
          warehouseId: targetWh,
          quantity: this.saleQuantity,
          customerName,
          agreedUnitPrice: this.saleUnitPrice,
          notes
        });

        document.getElementById('saleCheckoutModal')?.classList.remove('active');
        this._playChime('success');
        this.showToast(res.message, '📌');

        if (res.reservation) {
          const wh = await this.inventoryAgent.getWarehouse(targetWh);
          this.notificationsAgent.notifyReservation({ reservation: res.reservation, warehouse: wh }).catch(() => {});
          if (!this.supabaseAgent.isConfigured()) {
            this.cloudSyncAgent.publishReservationEvent('add', res.reservation).catch(() => {});
          }
        }

        await this.renderCurrentTab();
      } catch (err) {
        alert(`No se pudo crear la reserva: ${err.message}`);
      }
    });
  }

  async undoAndRepeatSale(saleId) {
    return this._runLocked(`undoRepeat_${saleId}`, async () => {
      try {
        const res = await this.salesAgent.revertSale(saleId);
        this._playChime('revert');
        this.showToast(res.message, '↩️');

        const reverted = res.revertedSale;
        this.lastCompletedSale = null;
        this.scheduleCloudSnapshotPublish();
        await this.renderSalesView();
        await this.updateHeaderQuickStats();

        if (reverted) {
          await this.openQuickSaleSheet(reverted.productId, {
            quantity: reverted.quantity,
            finalUnitPrice: reverted.unitPrice,
            paymentMethod: reverted.paymentMethod,
            paymentStatus: reverted.paymentStatus || 'paid',
            warehouseId: reverted.warehouseId,
            buyerName: reverted.buyerName,
            notes: reverted.notes
          });
        }
      } catch (err) {
        if (this.lastCompletedSale && this.lastCompletedSale.id === saleId) {
          this.lastCompletedSale = null;
          await this.renderSalesView();
        }
        alert(`Error al cancelar la venta: ${err.message}`);
      }
    });
  }

  async openSalesHistoryModal(silent = false) {
    const modal = document.getElementById('salesHistoryModal');
    const content = document.getElementById('salesHistoryModalContent');
    if (!modal || !content) return;

    const isWorker = this.authAgent.isWorker();
    const assignedWh = this.authAgent.getAssignedWarehouseId();

    const [sales, warehouses] = await Promise.all([
      this.salesAgent.getRecentSales(50, isWorker ? assignedWh : 'all'),
      this.inventoryAgent.getWarehouses()
    ]);

    const whMap = new Map(warehouses.map(w => [w.id, w]));

    if (sales.length === 0) {
      content.innerHTML = `
        <div class="text-center py-8 text-slate-400 text-sm">
          No hay ventas registradas aún.
        </div>
      `;
    } else {
      content.innerHTML = sales.map(s => {
        const timeFormatted = new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateFormatted = new Date(s.timestamp).toLocaleDateString([], { day: '2-digit', month: '2-digit' });
        const isCash = s.paymentMethod === 'Efectivo';
        const isPending = s.paymentStatus === 'pending';
        const wh = whMap.get(s.warehouseId);
        const whIcon = wh ? wh.icon : '🏠';
        const whName = s.warehouseName || (wh ? wh.name : 'Mi Almacén (Principal)');

        return `
          <div class="ios-card bg-slate-900/90 border ${isPending ? 'border-amber-500/50' : 'border-slate-700/60'} p-3 mb-2">
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1 min-w-0 pr-2">
                <div class="flex flex-wrap items-center gap-1.5 mb-1">
                  ${isPending ? `
                    <span class="badge badge-fiado">⏳ FIADO / PENDIENTE</span>
                  ` : `
                    <span class="badge ${isCash ? 'badge-payment-cash' : 'badge-payment-card'}">
                      ${isCash ? '💵 Efectivo' : '💳 Tarjeta'}
                    </span>
                  `}
                  <span class="badge badge-warehouse text-[10px]">
                    ${whIcon} ${this._escapeHtml(whName)}
                  </span>
                  <span class="text-[10px] text-slate-400">${dateFormatted} • ${timeFormatted}</span>
                </div>
                <h5 class="text-sm font-bold text-white">${this._escapeHtml(s.productName)}</h5>
                <div class="text-xs text-slate-400">
                  ${s.quantity} x ${s.unitPrice.toFixed(2)}€ = <strong class="text-white">${s.grossTotal.toFixed(2)}€</strong>
                  ${isWorker ? '' : `<span class="text-emerald-400 font-semibold ml-1.5">(+${s.netProfit.toFixed(2)}€)</span>`}
                </div>
                ${s.buyerName ? `<div class="text-[11px] text-indigo-300 font-semibold mt-0.5">👤 Cliente: ${this._escapeHtml(s.buyerName)}</div>` : ''}
                ${s.notes ? `<div class="text-[11px] text-slate-300 mt-0.5">📝 ${this._escapeHtml(s.notes)}</div>` : ''}
              </div>

              <div class="flex flex-col gap-1 items-end flex-shrink-0">
                ${isPending ? `
                  <div class="flex gap-1 mb-1">
                    <button 
                      onclick="window.app.markPendingSalePaid('${s.id}', 'Efectivo', true)"
                      class="btn-pressable bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 px-2 py-1 rounded-lg text-[10px] font-bold"
                    >💵 Cobrar Efec.</button>
                    <button 
                      onclick="window.app.markPendingSalePaid('${s.id}', 'Tarjeta', true)"
                      class="btn-pressable bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 px-2 py-1 rounded-lg text-[10px] font-bold"
                    >💳 Tarjeta</button>
                  </div>
                ` : ''}
                <div class="flex items-center gap-1.5">
                  <button 
                    onclick="window.app.openEditSaleNotesModal('${s.id}')"
                    class="btn-pressable bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-2 py-1 rounded-lg text-[10px] font-semibold"
                  >✏️ Nota/Cliente</button>
                  <button 
                    onclick="window.app.revertSaleFromModal('${s.id}', true)"
                    class="btn-pressable bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 px-2 py-1 rounded-lg text-[10px] font-semibold"
                  >↩ Repetir</button>
                  <button 
                    onclick="window.app.revertSaleFromModal('${s.id}', false)"
                    class="btn-pressable text-[10px] text-rose-400 hover:text-rose-300 underline ml-1"
                  >Anular</button>
                </div>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    modal.classList.add('active');
    if (!silent) this._playChime('tap');
  }

  async markPendingSalePaid(saleId, paymentMethod = 'Efectivo', refreshHistoryModal = false) {
    try {
      const res = await this.salesAgent.markSaleAsPaid(saleId, paymentMethod);
      if (this.lastCompletedSale && this.lastCompletedSale.id === saleId && res.sale) {
        this.lastCompletedSale = res.sale;
      }
      this._playChime('success');
      this.showToast(res.message, '✅');
      this.scheduleCloudSnapshotPublish();
      if (refreshHistoryModal) {
        await this.openSalesHistoryModal(true);
      }
      await this.renderCurrentTab();
      await this.updateHeaderQuickStats();
    } catch (err) {
      alert(`Error al marcar como cobrada: ${err.message}`);
    }
  }

  async revertSaleFromModal(saleId, repeat = false) {
    if (!confirm('¿Deseas cancelar esta venta? Se devolverá el stock al almacén correspondiente y se recalculará el beneficio.')) {
      return;
    }

    try {
      const res = await this.salesAgent.revertSale(saleId);
      this._playChime('revert');
      this.showToast(res.message, '↩️');

      const modal = document.getElementById('salesHistoryModal');
      if (modal) modal.classList.remove('active');

      if (this.lastCompletedSale && this.lastCompletedSale.id === saleId) {
        this.lastCompletedSale = null;
      }
      this.scheduleCloudSnapshotPublish();
      await this.renderSalesView();
      await this.updateHeaderQuickStats();

      if (repeat && res.revertedSale) {
        await this.openQuickSaleSheet(res.revertedSale.productId, {
          quantity: res.revertedSale.quantity,
          finalUnitPrice: res.revertedSale.unitPrice,
          paymentMethod: res.revertedSale.paymentMethod,
          paymentStatus: res.revertedSale.paymentStatus || 'paid',
          warehouseId: res.revertedSale.warehouseId,
          buyerName: res.revertedSale.buyerName,
          notes: res.revertedSale.notes
        });
      }
    } catch (err) {
      alert(`Error al anular la venta: ${err.message}`);
    }
  }

  // =========================================================================
  // PESTAÑA 2: INVENTARIO, ALMACENES, RESERVAS, MENSAJE Y REPARTO
  // =========================================================================
  switchInventorySubView(subView) {
    this.inventorySubView = subView;
    this._playChime('tap');
    this.renderInventoryView();
  }

  openStockMessageForWarehouse(warehouseId) {
    this.stockMsgOptions.warehouseId = warehouseId || MAIN_WAREHOUSE_ID;
    this.inventorySubView = 'message';
    this._playChime('tap');
    this.renderInventoryView();
  }

  openBatchTransferSubView(fromWhId = MAIN_WAREHOUSE_ID, toWhId = '') {
    const modal = document.getElementById('transferStockModal');
    if (modal) modal.classList.remove('active');

    this.batchTransferFromWh = fromWhId || MAIN_WAREHOUSE_ID;
    if (toWhId) this.batchTransferToWh = toWhId;
    this.inventorySubView = 'transfer';
    this._playChime('tap');
    return this.switchTab('inventory');
  }

  async renderInventoryView() {
    const container = document.getElementById('view-inventory');
    if (!container) return;

    const isWorker = this.authAgent.isWorker();
    const assignedWh = this.authAgent.getAssignedWarehouseId();

    if (isWorker) {
      if (this.inventorySubView === 'transfer') this.inventorySubView = 'stock';
      if (assignedWh) {
        this.selectedInventoryWarehouse = assignedWh;
        this.stockMsgOptions.warehouseId = assignedWh;
      }
    }

    const activeReservations = await this.inventoryAgent.getReservations({
      status: 'active',
      warehouseId: isWorker ? assignedWh : 'all'
    });

    const subViewBar = `
      <!-- Sub-navegación de Inventario: Stock | Reservas | Mensaje ${isWorker ? '' : '| Repartir'} -->
      <div class="ios-segmented mb-3.5">
        <button 
          type="button"
          class="segmented-option ${this.inventorySubView === 'stock' ? 'active' : ''}"
          onclick="window.app.switchInventorySubView('stock')"
        >
          <span>📦</span> <span>${isWorker ? 'Mi Stock' : 'Stock'}</span>
        </button>
        <button 
          type="button"
          class="segmented-option ${this.inventorySubView === 'reservations' ? 'active' : ''}"
          onclick="window.app.switchInventorySubView('reservations')"
        >
          <span>📌</span> <span>Reservas (${activeReservations.length})</span>
        </button>
        <button 
          type="button"
          class="segmented-option ${this.inventorySubView === 'message' ? 'active' : ''}"
          onclick="window.app.switchInventorySubView('message')"
        >
          <span>📋</span> <span>Mensaje</span>
        </button>
        ${isWorker ? '' : `
          <button 
            type="button"
            class="segmented-option ${this.inventorySubView === 'transfer' ? 'active' : ''}"
            onclick="window.app.switchInventorySubView('transfer')"
          >
            <span>🚚</span> <span>Repartir</span>
          </button>
        `}
      </div>
    `;

    if (this.inventorySubView === 'reservations') {
      const resHtml = await this._buildInventoryReservationsSubViewHtml();
      container.innerHTML = subViewBar + resHtml;
      return;
    }

    if (this.inventorySubView === 'message') {
      const msgHtml = await this._buildInventoryMessageSubViewHtml();
      container.innerHTML = subViewBar + msgHtml;
      return;
    }

    if (this.inventorySubView === 'transfer') {
      const transferHtml = await this._buildInventoryTransferSubViewHtml();
      container.innerHTML = subViewBar + transferHtml;
      return;
    }

    const stockHtml = await this._buildInventoryStockSubViewHtml();
    container.innerHTML = subViewBar + stockHtml;

    const inputSearch = document.getElementById('inventorySearchInput');
    const btnClearInv = document.getElementById('btnClearInventorySearch');
    if (inputSearch) {
      inputSearch.addEventListener('input', (e) => {
        this.inventorySearchQuery = e.target.value;
        if (btnClearInv) {
          btnClearInv.classList.toggle('hidden', !this.inventorySearchQuery);
        }
        this._refreshInventoryGridOnly();
      });
    }
    if (btnClearInv) {
      btnClearInv.addEventListener('click', () => {
        this.inventorySearchQuery = '';
        if (inputSearch) {
          inputSearch.value = '';
          inputSearch.focus();
        }
        btnClearInv.classList.add('hidden');
        this._refreshInventoryGridOnly();
      });
    }
  }

  // -------------------------------------------------------------------------
  // SUB-VISTA 2.A: ESPACIOS DE ALMACÉN Y CATÁLOGO DE STOCK
  // -------------------------------------------------------------------------
  async _buildInventoryStockSubViewHtml() {
    const isWorker = this.authAgent.isWorker();
    const assignedWh = this.authAgent.getAssignedWarehouseId();

    const [warehouses, valuation, activeOrder] = await Promise.all([
      this.inventoryAgent.getWarehouses(),
      this.inventoryAgent.getInventoryValuation(isWorker ? assignedWh : this.selectedInventoryWarehouse),
      this.inventoryAgent.getActiveOrder()
    ]);

    if (isWorker && assignedWh) {
      this.selectedInventoryWarehouse = assignedWh;
    } else if (this.selectedInventoryWarehouse !== 'all' && !warehouses.some(w => w.id === this.selectedInventoryWarehouse)) {
      this.selectedInventoryWarehouse = 'all';
    }

    const products = await this.inventoryAgent.getProducts({
      query: this.inventorySearchQuery,
      category: this.selectedCategoryFilter,
      warehouseId: this.selectedInventoryWarehouse
    });

    const whById = new Map((valuation.byWarehouse || []).map(w => [w.warehouseId, w]));
    const globalTotalUnits = (valuation.byWarehouse || []).reduce((acc, w) => acc + w.totalUnits, 0);
    const activeWhStats = this.selectedInventoryWarehouse !== 'all'
      ? whById.get(this.selectedInventoryWarehouse)
      : null;

    let html = isWorker ? '' : `
      <!-- Tarjeta de Pedido Activo y Botón de Nuevo Pedido / Recuento -->
      <div class="ios-card p-3 mb-3.5 border-indigo-500/30 bg-gradient-to-r from-indigo-950/35 to-slate-900/90 flex flex-wrap items-center justify-between gap-2.5">
        <div class="min-w-0">
          <div class="text-[10px] uppercase tracking-wider text-indigo-300 font-bold flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full ${activeOrder?.status === 'active' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}"></span>
            <span>${activeOrder?.status === 'active' ? 'Pedido Activo en Curso' : 'Sin Pedido Activo'}</span>
          </div>
          <div class="text-sm font-black text-white truncate mt-0.5">
            📦 ${this._escapeHtml(activeOrder ? activeOrder.name : 'Pedido Inicial')}
            ${activeOrder ? `<span class="text-xs font-semibold text-slate-400 ml-1">(${activeOrder.totalUnits} uds recibidas)</span>` : ''}
          </div>
        </div>
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            onclick="window.app.openNewOrderModal()"
            class="btn-pressable bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-2 rounded-xl shadow-lg shadow-emerald-900/30 flex items-center gap-1.5"
          >
            <span>📦</span> Nuevo Pedido / Recuento
          </button>
          <button
            type="button"
            onclick="window.app.switchTab('analytics')"
            class="btn-pressable bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-indigo-500/35 text-xs font-bold px-2.5 py-2 rounded-xl"
            title="Ver métricas por pedido"
          >📊 Pedidos</button>
        </div>
      </div>

      <!-- Barra de Espacios de Almacenes (General, Principal y Casas de Trabajadores) -->
      <div class="mb-3.5">
        <div class="flex items-center justify-between text-[11px] text-slate-400 px-1 mb-1.5">
          <span class="font-bold uppercase tracking-wider text-slate-300">🏢 Espacios de Almacén:</span>
          <button 
            onclick="window.app.openStockMessageForWarehouse('${this.selectedInventoryWarehouse === 'all' ? MAIN_WAREHOUSE_ID : this.selectedInventoryWarehouse}')"
            class="text-emerald-400 hover:text-emerald-300 font-bold flex items-center gap-1"
          >
            <span>📋 Copiar Mensaje de Stock</span>
          </button>
        </div>

        <div class="warehouse-pills-bar no-scrollbar">
          <button 
            type="button"
            onclick="window.app.setInventoryWarehouse('all')"
            class="warehouse-pill btn-pressable ${this.selectedInventoryWarehouse === 'all' ? 'active-indigo' : ''}"
          >
            <span>🌐</span>
            <span>General (Todos)</span>
            <span class="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-900/90 text-indigo-300">${globalTotalUnits} uds</span>
          </button>

          ${(valuation.byWarehouse || []).map(wh => {
            const isSel = this.selectedInventoryWarehouse === wh.warehouseId;
            return `
              <button 
                type="button"
                onclick="window.app.setInventoryWarehouse('${wh.warehouseId}')"
                class="warehouse-pill btn-pressable ${isSel ? 'active' : ''}"
              >
                <span>${wh.icon || '🏠'}</span>
                <span>${this._escapeHtml(wh.name)}</span>
                <span class="px-1.5 py-0.5 rounded-full text-[10px] ${
                  isSel ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-400'
                }">${wh.totalUnits} uds</span>
              </button>
            `;
          }).join('')}

          <button 
            type="button"
            onclick="window.app.openWarehouseModal()"
            class="warehouse-pill btn-pressable border-dashed border-emerald-500/50 text-emerald-300 bg-emerald-950/20"
          >
            <span>+</span>
            <span>Almacén / Trabajador</span>
          </button>
        </div>
      </div>
    `;

    // Cabecera según si está seleccionado "General (Todos)" o un Almacén específico
    if (this.selectedInventoryWarehouse === 'all') {
      html += `
        <!-- Valoración Global de Todos los Almacenes -->
        <div class="ios-card ios-card-glow-indigo mb-3.5">
          <div class="flex items-center justify-between mb-2.5">
            <div>
              <div class="text-[11px] uppercase tracking-wider text-indigo-300 font-bold">🌐 Valoración Global de Inventario</div>
              <div class="text-xs text-slate-400">${warehouses.length} ${warehouses.length === 1 ? 'almacén activo' : 'almacenes activos'} • ${valuation.totalProducts} sabores</div>
            </div>
            <div class="flex gap-1.5">
              <button 
                onclick="window.app.openStockMessageForWarehouse('${MAIN_WAREHOUSE_ID}')"
                class="btn-pressable bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 px-2.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1"
              >
                <span>📋</span> Mensaje Stock
              </button>
              <button 
                onclick="window.app.switchInventorySubView('transfer')"
                class="btn-pressable bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 px-2.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1"
              >
                <span>🚚</span> Repartir
              </button>
            </div>
          </div>

          <div class="grid grid-cols-3 gap-2 text-center mb-3">
            <div class="bg-slate-900/70 p-2.5 rounded-xl border border-slate-700/50">
              <div class="text-[10px] text-slate-400">Stock Global</div>
              <div class="text-base font-black text-white">${valuation.totalStockUnits} uds</div>
              <div class="text-[9px] text-slate-400">${valuation.productsWithStock} con stock</div>
            </div>
            <div class="bg-slate-900/70 p-2.5 rounded-xl border border-slate-700/50">
              <div class="text-[10px] text-slate-400">Valor Coste</div>
              <div class="text-base font-black text-slate-200">${valuation.totalCostValuation.toFixed(2)}€</div>
              <div class="text-[9px] text-slate-500">Inversión actual</div>
            </div>
            <div class="bg-emerald-950/40 p-2.5 rounded-xl border border-emerald-500/30">
              <div class="text-[10px] text-emerald-400">Valor PVP</div>
              <div class="text-base font-black text-emerald-300">${valuation.totalRetailValuation.toFixed(2)}€</div>
              <div class="text-[9px] text-emerald-400 font-bold">+${valuation.potentialGrossProfit.toFixed(2)}€ benef.</div>
            </div>
          </div>

          <!-- Resumen horizontal compacto de cada Almacén / Casa de Trabajador -->
          <div class="pt-2.5 border-t border-slate-700/50">
            <div class="flex items-center justify-between text-[10px] text-slate-400 mb-2">
              <span class="uppercase font-bold tracking-wider">Resumen por Ubicación (Toca uno para ver su stock):</span>
              <button onclick="window.app.openWarehouseModal()" class="text-emerald-400 font-bold hover:underline">+ Añadir Trabajador</button>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              ${(valuation.byWarehouse || []).map(wh => `
                <div 
                  onclick="window.app.setInventoryWarehouse('${wh.warehouseId}')"
                  class="btn-pressable cursor-pointer bg-slate-900/80 hover:bg-slate-800/90 p-2.5 rounded-xl border ${
                    wh.isMain ? 'border-emerald-500/30' : 'border-slate-700/60'
                  } flex items-center justify-between"
                >
                  <div class="min-w-0 pr-2">
                    <div class="flex items-center gap-1.5">
                      <span class="text-sm">${wh.icon || '🏠'}</span>
                      <span class="text-xs font-bold text-white truncate">${this._escapeHtml(wh.name)}</span>
                    </div>
                    <div class="text-[10px] text-slate-400 truncate">
                      ${wh.workerName ? `👤 ${this._escapeHtml(wh.workerName)} • ` : ''}${wh.productsWithStock} sabores
                    </div>
                  </div>
                  <div class="text-right flex-shrink-0">
                    <div class="text-xs font-black text-white">${wh.totalUnits} uds <span class="text-[10px] text-slate-400 font-normal">(${wh.stockSharePercentage}%)</span></div>
                    <div class="text-[10px] text-emerald-400 font-semibold">PVP: ${wh.retailValuation.toFixed(0)}€ (+${wh.potentialProfit.toFixed(0)}€)</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    } else if (activeWhStats) {
      // Tarjeta de cabecera del Almacén Específico seleccionado
      const whRecord = warehouses.find(w => w.id === activeWhStats.warehouseId);
      html += `
        <div class="ios-card ios-card-glow-emerald mb-3.5">
          <div class="flex flex-wrap items-start justify-between gap-2 mb-3">
            <div>
              <div class="flex items-center gap-2">
                <span class="text-2xl">${activeWhStats.icon || '🏠'}</span>
                <div>
                  <div class="flex items-center gap-1.5">
                    <h3 class="text-base font-black text-white leading-tight">${this._escapeHtml(activeWhStats.name)}</h3>
                    ${isWorker ? '' : `<span class="badge badge-ok-stock text-[10px]">${activeWhStats.stockSharePercentage}% del stock</span>`}
                  </div>
                  <div class="text-xs text-slate-300 mt-0.5">
                    ${activeWhStats.workerName ? `👤 Encargado: <strong>${this._escapeHtml(activeWhStats.workerName)}</strong>` : 'Almacén Principal'}
                    ${whRecord?.notes ? ` • <span class="text-slate-400">${this._escapeHtml(whRecord.notes)}</span>` : ''}
                  </div>
                </div>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-1.5">
              <button 
                onclick="window.app.openStockMessageForWarehouse('${activeWhStats.warehouseId}')"
                class="btn-pressable bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1"
              >
                <span>📋</span> Copiar Stock
              </button>
              ${isWorker ? '' : `
                <button 
                  onclick="window.app.openTransferModal(null, '${activeWhStats.warehouseId}')"
                  class="btn-pressable bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1"
                >
                  <span>🚚</span> Repartir / Mover
                </button>
                <button 
                  onclick="window.app.openWarehouseModal('${activeWhStats.warehouseId}')"
                  class="btn-pressable bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600/60 px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1"
                >
                  <span>✏️</span> Editar
                </button>
              `}
            </div>
          </div>

          <div class="grid ${isWorker ? 'grid-cols-2' : 'grid-cols-3'} gap-2 text-center">
            <div class="bg-slate-900/75 p-2.5 rounded-xl border border-slate-700/50">
              <div class="text-[10px] text-slate-400">Unidades en Almacén</div>
              <div class="text-base font-black text-white">${activeWhStats.totalUnits} uds</div>
              <div class="text-[9px] text-slate-400">${activeWhStats.productsWithStock} sabores disp.</div>
            </div>
            ${isWorker ? '' : `
              <div class="bg-slate-900/75 p-2.5 rounded-xl border border-slate-700/50">
                <div class="text-[10px] text-slate-400">Coste en Sitio</div>
                <div class="text-base font-black text-slate-200">${activeWhStats.costValuation.toFixed(2)}€</div>
                <div class="text-[9px] text-slate-500">Mercancía</div>
              </div>
            `}
            <div class="bg-emerald-950/40 p-2.5 rounded-xl border border-emerald-500/30">
              <div class="text-[10px] text-emerald-400">Valor PVP</div>
              <div class="text-base font-black text-emerald-300">${activeWhStats.retailValuation.toFixed(2)}€</div>
              ${isWorker ? '<div class="text-[9px] text-slate-400">Precio venta</div>' : `<div class="text-[9px] text-emerald-400 font-bold">+${activeWhStats.potentialProfit.toFixed(2)}€ benef.</div>`}
            </div>
          </div>
        </div>
      `;
    }

    // Barra de búsqueda y botones de acción de catálogo
    html += `
      <div class="flex items-center gap-2 mb-3">
        <div class="relative flex-1">
          <input 
            type="text" 
            id="inventorySearchInput" 
            value="${this._escapeHtml(this.inventorySearchQuery || '')}"
            placeholder="🔍 Filtrar sabores o categorías..." 
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
            class="w-full bg-slate-900/90 text-white placeholder-slate-400 pl-3.5 pr-9 py-2.5 rounded-xl border border-slate-700/70 focus:outline-none focus:border-emerald-500 text-sm"
          />
          <button type="button" id="btnClearInventorySearch" class="${this.inventorySearchQuery ? '' : 'hidden'} absolute right-3 top-2.5 text-slate-400 hover:text-white text-sm font-bold">✕</button>
        </div>
        ${isWorker ? '' : `
          <button 
            onclick="window.app.openProductModal()"
            class="btn-pressable bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-3.5 py-2.5 rounded-xl flex items-center gap-1 shadow-lg shadow-emerald-900/40 whitespace-nowrap"
          >
            <span class="text-base leading-none">+</span> Producto
          </button>
        `}
      </div>

      <!-- Lista de productos con desglose por almacenes -->
      <div id="inventoryProductGrid" class="grid grid-cols-1 md:grid-cols-2 gap-2.5 pb-8">
        ${this._buildInventoryProductGridHtml(products, warehouses, isWorker)}
      </div>
    `;

    return html;
  }

  _buildInventoryProductGridHtml(products, warehouses, isWorker) {
    if (!products || products.length === 0) {
      return `
        <div class="col-span-full ios-card text-center py-10 px-4">
          <div class="text-4xl mb-2">🏷️</div>
          <p class="text-slate-300 font-semibold">No hay productos en esta selección</p>
          ${isWorker ? '' : `
            <button onclick="window.app.openProductModal()" class="mt-3 text-sm text-emerald-400 font-bold underline">
              + Crear nuevo producto
            </button>
          `}
        </div>
      `;
    }

    const targetAdjustWh = this.selectedInventoryWarehouse === 'all'
      ? MAIN_WAREHOUSE_ID
      : this.selectedInventoryWarehouse;
    const targetAdjustWhObj = warehouses.find(w => w.id === targetAdjustWh) || warehouses[0];
    const targetAdjustWhLabel = targetAdjustWhObj
      ? (targetAdjustWhObj.isMain ? 'Principal' : targetAdjustWhObj.name)
      : 'Principal';

    return products.map((p, idx) => {
      const displayStock = this.selectedInventoryWarehouse === 'all' ? p.stock : p.warehouseStock;
      const adjustWhStock = p.stockByWarehouse?.[targetAdjustWh] || 0;
      const isLow = displayStock <= 4;
      const profitMargin = p.sellPrice > 0 ? (((p.sellPrice - p.costPrice) / p.sellPrice) * 100).toFixed(0) : 0;
      const theme = this._getFlavorVisualTheme(p.name);
      const animDelay = Math.min(idx * 20, 220);

      // Chips de desglose por almacén (solo visibles para el Jefe)
      const warehouseChipsHtml = isWorker ? '' : warehouses.map(wh => {
        const count = p.stockByWarehouse?.[wh.id] || 0;
        const isCurrentWh = this.selectedInventoryWarehouse === wh.id;
        return `
          <span 
            onclick="event.stopPropagation(); window.app.setInventoryWarehouse('${wh.id}')"
            class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold border cursor-pointer tabular-nums ${
              isCurrentWh
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                : count > 0
                  ? 'bg-slate-800/90 text-slate-200 border-slate-700'
                  : 'bg-slate-900/60 text-slate-500 border-slate-800'
            }"
          >
            <span>${wh.icon || '🏠'}</span>
            <span>${this._escapeHtml(wh.isMain ? 'Mi Almacén' : wh.name)}:</span>
            <strong class="${count > 0 ? 'text-white' : 'text-slate-500'}">${count}</strong>
          </span>
        `;
      }).join('');

      return `
        <div style="animation-delay: ${animDelay}ms" class="ios-card flex items-stretch justify-between gap-3 p-3.5 mb-0">
          <!-- Info básica, orbe de sabor, precios y chips de stock por almacén -->
          <div class="flex-1 min-w-0 ${isWorker ? '' : 'cursor-pointer'}" ${isWorker ? '' : `onclick="window.app.openProductModal('${p.id}')"`}>
            <div class="flex items-start gap-2.5">
              <div class="flavor-orb" style="background: ${theme.orbBg}; width: 38px; height: 38px; font-size: 18px;">
                <span>${theme.emoji}</span>
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-1.5 mb-0.5">
                  <span class="text-[9.5px] uppercase font-bold tracking-wider text-slate-400 px-1.5 py-0.5 rounded bg-slate-900/90 border border-white/10">
                    ${this._escapeHtml(p.category || 'Sabores')}
                  </span>
                  ${isLow ? `<span class="text-[10px] text-rose-400 font-bold">⚠️ ${displayStock === 0 ? 'Agotado' : 'Stock bajo'}</span>` : ''}
                  ${(isWorker ? p.warehouseReserved : p.totalReserved) > 0 ? `<span class="badge badge-reserved text-[9.5px]">📌 ${isWorker ? p.warehouseReserved : p.totalReserved} res.</span>` : ''}
                </div>
                <h4 class="font-extrabold text-white text-sm leading-snug">${this._escapeHtml(p.name)}</h4>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-3 text-xs mt-2 text-slate-400 tabular-nums">
              ${isWorker ? '' : `<span>Coste: <strong class="text-slate-200">${p.costPrice.toFixed(2)}€</strong></span>`}
              <span>PVP: <strong class="text-white">${p.sellPrice.toFixed(2)}€</strong></span>
              ${isWorker ? '' : `<span class="text-emerald-400 text-[11px] font-bold">+${(p.sellPrice - p.costPrice).toFixed(2)}€ (${profitMargin}%)</span>`}
            </div>

            ${isWorker ? '' : `
              <!-- Desglose exacto por almacenes -->
              <div class="flex flex-wrap items-center gap-1.5 mt-2.5 pt-2 border-t border-white/10">
                ${warehouseChipsHtml}
              </div>
            `}
          </div>

          <!-- Controles rápidos de Stock +/- (Jefe) o Solo Lectura + Reservar (Trabajador) -->
          <div class="flex flex-col items-center justify-between bg-slate-900/80 p-2 rounded-xl border border-slate-700/60 min-w-[92px]">
            <div class="text-[9px] text-slate-400 uppercase font-bold truncate max-w-[88px]" title="Stock en ${this._escapeHtml(targetAdjustWhLabel)}">
              ${targetAdjustWhObj?.icon || '🏠'} ${this._escapeHtml(targetAdjustWhLabel)}
            </div>

            ${isWorker ? `
              <div class="my-1.5 text-center">
                <div class="text-xl font-black ${adjustWhStock <= 0 ? 'text-rose-400' : adjustWhStock <= 4 ? 'text-amber-400' : 'text-white'}">
                  ${adjustWhStock}
                </div>
                <div class="text-[9px] text-slate-400">uds físicas</div>
              </div>
              <button 
                type="button"
                onclick="window.app.openReservationModal('${p.id}', '${targetAdjustWh}')"
                class="btn-pressable w-full py-1 px-2 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 text-[10px] font-bold flex items-center justify-center gap-1"
              >
                <span>📌</span> Reservar
              </button>
            ` : `
              <div class="flex items-center gap-2 my-1">
                <button 
                  type="button"
                  onclick="window.app.adjustStockInline('${p.id}', -1, '${targetAdjustWh}')"
                  class="btn-pressable w-7 h-7 rounded-lg bg-slate-800 text-slate-200 font-bold flex items-center justify-center hover:bg-slate-700 border border-slate-600/40 text-sm"
                  ${adjustWhStock <= 0 ? 'disabled style="opacity:0.3"' : ''}
                >-</button>
                <span class="text-base font-black ${adjustWhStock <= 0 ? 'text-rose-400' : adjustWhStock <= 4 ? 'text-amber-400' : 'text-white'} min-w-[22px] text-center">
                  ${adjustWhStock}
                </span>
                <button 
                  type="button"
                  onclick="window.app.adjustStockInline('${p.id}', 1, '${targetAdjustWh}')"
                  class="btn-pressable w-7 h-7 rounded-lg bg-slate-800 text-slate-200 font-bold flex items-center justify-center hover:bg-slate-700 border border-slate-600/40 text-sm"
                >+</button>
              </div>

              <button 
                type="button"
                onclick="window.app.openTransferModal('${p.id}', '${targetAdjustWh}')"
                class="btn-pressable w-full py-1 px-2 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 text-[10px] font-bold flex items-center justify-center gap-1"
              >
                <span>🚚</span> Repartir
              </button>
            `}
          </div>
        </div>
      `;
    }).join('');
  }

  async _refreshInventoryGridOnly() {
    const grid = document.getElementById('inventoryProductGrid');
    if (!grid) return;

    const token = (this._invGridToken = (this._invGridToken || 0) + 1);
    const isWorker = this.authAgent.isWorker();
    const assignedWh = this.authAgent.getAssignedWarehouseId();
    const targetWh = isWorker && assignedWh ? assignedWh : this.selectedInventoryWarehouse;

    const [warehouses, products] = await Promise.all([
      this.inventoryAgent.getWarehouses(),
      this.inventoryAgent.getProducts({
        query: this.inventorySearchQuery,
        category: this.selectedCategoryFilter,
        warehouseId: targetWh
      })
    ]);

    if (token !== this._invGridToken) return;
    const latestGrid = document.getElementById('inventoryProductGrid');
    if (!latestGrid) return;

    latestGrid.innerHTML = this._buildInventoryProductGridHtml(products, warehouses, isWorker);
  }

  setInventoryWarehouse(warehouseId) {
    this.selectedInventoryWarehouse = warehouseId || 'all';
    this._playChime('tap');
    this.renderInventoryView();
  }

  async adjustStockInline(productId, delta, warehouseId = MAIN_WAREHOUSE_ID) {
    try {
      const targetWh = (!warehouseId || warehouseId === 'all') ? MAIN_WAREHOUSE_ID : warehouseId;
      await this.inventoryAgent.adjustStock(productId, delta, targetWh);
      this._playChime('tap');
      this.scheduleCloudSnapshotPublish();
      await this.renderInventoryView();
      await this.updateHeaderQuickStats();
    } catch (err) {
      this.showToast(err.message, '⚠️');
    }
  }

  // -------------------------------------------------------------------------
  // SUB-VISTA 2.B: GENERADOR DE MENSAJE PREESCRITO DE STOCK (COPIAR Y PEGAR)
  // -------------------------------------------------------------------------
  async _buildInventoryMessageSubViewHtml() {
    const isWorker = this.authAgent.isWorker();
    const assignedWh = this.authAgent.getAssignedWarehouseId();
    const warehouses = await this.inventoryAgent.getWarehouses();

    if (isWorker && assignedWh) {
      this.stockMsgOptions.warehouseId = assignedWh;
    } else if (
      this.stockMsgOptions.warehouseId !== 'all' &&
      !warehouses.some(w => w.id === this.stockMsgOptions.warehouseId)
    ) {
      this.stockMsgOptions.warehouseId = MAIN_WAREHOUSE_ID;
    }

    const msgData = await this.inventoryAgent.generateStockMessage(this.stockMsgOptions);
    const visibleWarehouses = isWorker ? warehouses.filter(w => w.id === assignedWh) : warehouses;

    return `
      <div class="ios-card ios-card-glow-emerald mb-4 animate-fade-in">
        <div class="flex items-start justify-between gap-2 mb-3">
          <div>
            <h3 class="text-base font-black text-white flex items-center gap-1.5">
              <span>📋</span> Mensaje Preescrito de Stock (Copiar y Pegar)
            </h3>
            <p class="text-xs text-slate-300 mt-0.5">
              Listo para pegar directamente en WhatsApp, Telegram o Notas con las unidades exactas de tu almacén.
            </p>
          </div>
        </div>

        <!-- Selector de Almacén para el Mensaje (Por defecto: Mi Almacén Principal) -->
        ${isWorker ? '' : `
          <div class="mb-3">
            <label class="text-[10px] uppercase tracking-wider text-emerald-300 font-bold block mb-1.5">
              1. Elige de qué almacén generar el listado:
            </label>
            <div class="warehouse-pills-bar no-scrollbar">
              ${visibleWarehouses.map(wh => {
                const isSel = this.stockMsgOptions.warehouseId === wh.id;
                return `
                  <button 
                    type="button"
                    onclick="window.app.setStockMsgOption('warehouseId', '${wh.id}')"
                    class="warehouse-pill btn-pressable ${isSel ? 'active' : ''}"
                  >
                    <span>${wh.icon || '🏠'}</span>
                    <span>${this._escapeHtml(wh.name)}</span>
                  </button>
                `;
              }).join('')}
              <button 
                type="button"
                onclick="window.app.setStockMsgOption('warehouseId', 'all')"
                class="warehouse-pill btn-pressable ${this.stockMsgOptions.warehouseId === 'all' ? 'active-indigo' : ''}"
              >
                <span>🌐</span>
                <span>Todo el Stock Global</span>
              </button>
            </div>
          </div>
        `}

        <!-- Opciones de Formato y Toggles Rápidos -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-3">
          <div class="bg-slate-900/80 p-2.5 rounded-xl border border-slate-700/60">
            <label class="text-[10px] uppercase tracking-wider text-slate-400 font-bold block mb-1.5">
              2. Estilo del Mensaje:
            </label>
            <div class="grid grid-cols-3 gap-1.5">
              <button 
                type="button"
                onclick="window.app.setStockMsgOption('style', 'whatsapp')"
                class="btn-pressable py-1.5 px-2 rounded-lg text-xs font-bold border ${
                  this.stockMsgOptions.style === 'whatsapp'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }"
              >💬 WhatsApp</button>
              <button 
                type="button"
                onclick="window.app.setStockMsgOption('style', 'clean')"
                class="btn-pressable py-1.5 px-2 rounded-lg text-xs font-bold border ${
                  this.stockMsgOptions.style === 'clean'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }"
              >📝 Limpio</button>
              <button 
                type="button"
                onclick="window.app.setStockMsgOption('style', 'compact')"
                class="btn-pressable py-1.5 px-2 rounded-lg text-xs font-bold border ${
                  this.stockMsgOptions.style === 'compact'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }"
              >🔢 Compacto</button>
            </div>
          </div>

          <div class="bg-slate-900/80 p-2.5 rounded-xl border border-slate-700/60">
            <label class="text-[10px] uppercase tracking-wider text-slate-400 font-bold block mb-1.5">
              3. Qué mostrar en la lista:
            </label>
            <div class="flex flex-wrap gap-1.5">
              <button 
                type="button"
                onclick="window.app.setStockMsgOption('onlyAvailable', ${!this.stockMsgOptions.onlyAvailable})"
                class="btn-pressable flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold border ${
                  this.stockMsgOptions.onlyAvailable
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                    : 'bg-slate-800 text-slate-300 border-slate-700'
                }"
              >
                ${this.stockMsgOptions.onlyAvailable ? '✅ Solo con stock' : '📦 Incluir agotados'}
              </button>

              <button 
                type="button"
                onclick="window.app.setStockMsgOption('showQuantities', ${!this.stockMsgOptions.showQuantities})"
                class="btn-pressable flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold border ${
                  this.stockMsgOptions.showQuantities
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }"
              >
                ${this.stockMsgOptions.showQuantities ? '🔢 Con cantidades' : '🙈 Sin cantidades'}
              </button>

              <button 
                type="button"
                onclick="window.app.setStockMsgOption('showPrices', ${!this.stockMsgOptions.showPrices})"
                class="btn-pressable py-1.5 px-2.5 rounded-lg text-[11px] font-bold border ${
                  this.stockMsgOptions.showPrices
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }"
              >
                💶 PVP ${this.stockMsgOptions.showPrices ? 'Sí' : 'No'}
              </button>

              <button 
                type="button"
                onclick="window.app.setStockMsgOption('subtractReservations', ${!this.stockMsgOptions.subtractReservations})"
                class="btn-pressable w-full py-1.5 px-2.5 rounded-lg text-[11px] font-bold border ${
                  this.stockMsgOptions.subtractReservations
                    ? 'bg-purple-500/20 text-purple-300 border-purple-500/50'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }"
              >
                ${this.stockMsgOptions.subtractReservations ? '📌 Descontar reservados (Solo libres)' : '📌 Incluir también reservados'}
              </button>
            </div>
          </div>
        </div>

        <!-- Cuadro de Texto Preescrito Listo para Copiar -->
        <div class="mb-3">
          <div class="flex items-center justify-between text-xs text-slate-300 mb-1.5 px-1">
            <span>Vista previa editable (<strong>${this._escapeHtml(msgData.warehouseName)}</strong>):</span>
            <span class="text-emerald-400 font-bold">
              ${msgData.availableProductsCount} sabores • ${msgData.totalUnits} uds libres
              ${msgData.totalReservedUnits > 0 ? `<span class="text-purple-300 ml-1">(📌 ${msgData.totalReservedUnits} res.)</span>` : ''}
            </span>
          </div>
          <textarea 
            id="stockMessageTextarea" 
            class="stock-msg-box"
            rows="11"
          >${this._escapeHtml(msgData.text)}</textarea>
        </div>

        <!-- Botones Grandes de Copiar y Compartir -->
        <div class="space-y-2">
          <button 
            type="button"
            id="btnCopyStockMessage"
            onclick="window.app.copyStockMessageToClipboard()"
            class="btn-primary btn-pressable text-base py-4"
          >
            <span>📋</span>
            <span>Copiar Mensaje al Portapapeles</span>
          </button>

          <div class="grid grid-cols-2 gap-2">
            <button 
              type="button"
              onclick="window.app.shareStockMessageWhatsApp()"
              class="btn-pressable py-3 px-3 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-500/40 text-xs font-bold flex items-center justify-center gap-1.5"
            >
              <span>📲</span> Enviar por WhatsApp
            </button>
            <button 
              type="button"
              onclick="window.app.shareStockMessageNative()"
              class="btn-pressable py-3 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center justify-center gap-1.5"
            >
              <span>📤</span> Compartir (iOS...)
            </button>
          </div>
        </div>
      </div>
    `;
  }

  setStockMsgOption(key, value) {
    this.stockMsgOptions[key] = value;
    this._playChime('tap');
    this.renderInventoryView();
  }

  async copyStockMessageToClipboard() {
    const textarea = document.getElementById('stockMessageTextarea');
    const text = textarea ? textarea.value : '';
    if (!text) return;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (textarea) {
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
      }

      this._playChime('success');
      this.showToast('¡Mensaje de stock copiado al portapapeles!', '📋');

      const btn = document.getElementById('btnCopyStockMessage');
      if (btn) {
        if (!btn.dataset.originalHtml) {
          btn.dataset.originalHtml = btn.innerHTML;
        }
        clearTimeout(this._copyStockBtnTimer);
        btn.innerHTML = `<span>✅</span> <span>¡Copiado! Ya puedes pegarlo</span>`;
        this._copyStockBtnTimer = setTimeout(() => {
          const latestBtn = document.getElementById('btnCopyStockMessage');
          if (latestBtn && latestBtn.dataset.originalHtml) {
            latestBtn.innerHTML = latestBtn.dataset.originalHtml;
          }
        }, 2200);
      }
    } catch (err) {
      if (textarea) {
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        this._playChime('success');
        this.showToast('¡Mensaje de stock copiado!', '📋');
      }
    }
  }

  shareStockMessageWhatsApp() {
    const textarea = document.getElementById('stockMessageTextarea');
    const text = textarea ? textarea.value : '';
    if (!text) return;
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  }

  async shareStockMessageNative() {
    const textarea = document.getElementById('stockMessageTextarea');
    const text = textarea ? textarea.value : '';
    if (!text) return;

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Stock Disponible',
          text
        });
      } catch (e) {
        // Cancelado por el usuario
      }
    } else {
      await this.copyStockMessageToClipboard();
    }
  }

  // -------------------------------------------------------------------------
  // SUB-VISTA 2.C: REPARTO / TRANSFERENCIA DE STOCK POR LOTE E HISTORIAL
  // -------------------------------------------------------------------------
  async _buildInventoryTransferSubViewHtml() {
    const [warehouses, products, recentTransfers] = await Promise.all([
      this.inventoryAgent.getWarehouses(),
      this.inventoryAgent.getProducts({ warehouseId: 'all' }),
      this.inventoryAgent.getRecentTransfers(20)
    ]);

    if (!warehouses.some(w => w.id === this.batchTransferFromWh)) {
      this.batchTransferFromWh = MAIN_WAREHOUSE_ID;
    }

    const otherWarehouses = warehouses.filter(w => w.id !== this.batchTransferFromWh);
    if (!this.batchTransferToWh || this.batchTransferToWh === this.batchTransferFromWh || !warehouses.some(w => w.id === this.batchTransferToWh)) {
      this.batchTransferToWh = otherWarehouses.length > 0 ? otherWarehouses[0].id : '';
    }

    const fromWhObj = warehouses.find(w => w.id === this.batchTransferFromWh);
    const toWhObj = warehouses.find(w => w.id === this.batchTransferToWh);

    let totalSelectedUnits = 0;
    let selectedFlavorsCount = 0;
    products.forEach(p => {
      const avail = p.stockByWarehouse?.[this.batchTransferFromWh] || 0;
      const q = Math.min(avail, Math.max(0, parseInt(this.batchTransferQuantities[p.id], 10) || 0));
      this.batchTransferQuantities[p.id] = q;
      if (q > 0) {
        totalSelectedUnits += q;
        selectedFlavorsCount++;
      }
    });

    let html = `
      <div class="ios-card ios-card-glow-indigo mb-4 animate-fade-in">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h3 class="text-base font-black text-white flex items-center gap-1.5">
              <span>🚚</span> Repartir Mercancía entre Almacenes
            </h3>
            <p class="text-xs text-slate-300 mt-0.5">
              Envía unidades de tu Almacén Principal a las casas de tus trabajadores (o viceversa).
            </p>
          </div>
          <button 
            type="button"
            onclick="window.app.openWarehouseModal()"
            class="btn-pressable bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 px-3 py-1.5 rounded-xl text-xs font-bold"
          >
            + Crear Casa / Trabajador
          </button>
        </div>

        ${warehouses.length < 2 ? `
          <div class="bg-slate-900/90 p-5 rounded-2xl border border-amber-500/40 text-center my-2">
            <div class="text-3xl mb-2">🏠 ➡️ 👤</div>
            <h4 class="text-sm font-bold text-white mb-1">Aún no has creado ningún almacén de trabajador</h4>
            <p class="text-xs text-slate-400 mb-3">
              Crea primero el espacio/casa de tu trabajador para poder repartirle stock y llevar sus cuentas por separado.
            </p>
            <button 
              type="button"
              onclick="window.app.openWarehouseModal()"
              class="btn-primary max-w-xs mx-auto py-3 text-xs"
            >
              <span>+ Crear Primer Almacén de Trabajador</span>
            </button>
          </div>
        ` : `
          <!-- Selectores Origen y Destino -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-3">
            <div class="bg-slate-900/80 p-3 rounded-xl border border-slate-700/60">
              <label class="text-[10px] uppercase tracking-wider text-slate-400 font-bold block mb-1">Desde (Origen que entrega):</label>
              <select 
                onchange="window.app.setBatchTransferFromWh(this.value)"
                class="w-full bg-slate-800 text-white px-3 py-2 rounded-lg border border-slate-600 text-xs font-bold focus:outline-none focus:border-emerald-500"
              >
                ${warehouses.map(w => `
                  <option value="${w.id}" ${w.id === this.batchTransferFromWh ? 'selected' : ''}>
                    ${w.icon || '🏠'} ${this._escapeHtml(w.name)} ${w.workerName ? `(${this._escapeHtml(w.workerName)})` : ''}
                  </option>
                `).join('')}
              </select>
            </div>

            <div class="bg-slate-900/80 p-3 rounded-xl border border-emerald-500/40">
              <label class="text-[10px] uppercase tracking-wider text-emerald-400 font-bold block mb-1">Hacia (Destino que recibe):</label>
              <select 
                onchange="window.app.setBatchTransferToWh(this.value)"
                class="w-full bg-slate-800 text-white px-3 py-2 rounded-lg border border-emerald-500/50 text-xs font-bold focus:outline-none focus:border-emerald-500"
              >
                ${otherWarehouses.map(w => `
                  <option value="${w.id}" ${w.id === this.batchTransferToWh ? 'selected' : ''}>
                    ${w.icon || '👤'} ${this._escapeHtml(w.name)} ${w.workerName ? `(${this._escapeHtml(w.workerName)})` : ''}
                  </option>
                `).join('')}
              </select>
            </div>
          </div>

          <!-- Acciones rápidas de lote -->
          <div class="flex items-center justify-between text-xs mb-2 px-1">
            <span class="text-slate-300 font-semibold">Selecciona cantidades a enviar:</span>
            <div class="flex gap-2">
              <button 
                type="button"
                onclick="window.app.batchAddOneToAll()"
                class="text-indigo-300 hover:text-white font-bold underline text-[11px]"
              >+1 a todos</button>
              <button 
                type="button"
                onclick="window.app.batchClearAll()"
                class="text-slate-400 hover:text-white underline text-[11px]"
              >Limpiar</button>
            </div>
          </div>

          <!-- Lista de productos para repartir -->
          <div class="space-y-2 max-h-[46vh] overflow-y-auto pr-1 mb-3">
            ${products.map(p => {
              const availOrigin = p.stockByWarehouse?.[this.batchTransferFromWh] || 0;
              const currentDest = p.stockByWarehouse?.[this.batchTransferToWh] || 0;
              const qtyToSend = this.batchTransferQuantities[p.id] || 0;
              const safeId = this._escJsAttr(p.id);

              return `
                <div id="batchRow_${this._escapeHtml(p.id)}" data-batch-product="${this._escapeHtml(p.id)}" data-current-dest="${currentDest}" data-max-avail="${availOrigin}" class="bg-slate-900/85 p-2.5 rounded-xl border ${
                  qtyToSend > 0 ? 'border-emerald-500/60 bg-emerald-950/20' : 'border-slate-800'
                } flex items-center justify-between gap-2">
                  <div class="min-w-0 flex-1">
                    <div class="text-xs font-bold text-white truncate">${this._escapeHtml(p.name)}</div>
                    <div class="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                      <span>En origen: <strong class="${availOrigin > 0 ? 'text-emerald-400' : 'text-rose-400'}">${availOrigin} uds</strong></span>
                      <span>•</span>
                      <span>En destino: <strong id="batchDest_${this._escapeHtml(p.id)}" class="text-slate-300">${currentDest}${qtyToSend > 0 ? ` → ${currentDest + qtyToSend}` : ''} uds</strong></span>
                    </div>
                  </div>

                  <div class="flex items-center gap-1.5">
                    <button 
                      id="batchDec_${this._escapeHtml(p.id)}"
                      type="button"
                      onclick="window.app.changeBatchTransferQty('${safeId}', -1, ${availOrigin})"
                      class="btn-pressable w-7 h-7 rounded-lg bg-slate-800 text-white font-bold flex items-center justify-center border border-slate-700"
                      ${qtyToSend <= 0 ? 'disabled style="opacity:0.3"' : ''}
                    >-</button>
                    <input 
                      id="batchInput_${this._escapeHtml(p.id)}"
                      type="number"
                      min="0"
                      max="${availOrigin}"
                      value="${qtyToSend}"
                      oninput="window.app.setBatchTransferQty('${safeId}', this.value, ${availOrigin})"
                      class="w-11 text-center text-sm font-black ${qtyToSend > 0 ? 'text-emerald-400' : 'text-slate-400'} bg-slate-950/70 py-1 rounded-lg border border-slate-700"
                    />
                    <button 
                      id="batchInc_${this._escapeHtml(p.id)}"
                      type="button"
                      onclick="window.app.changeBatchTransferQty('${safeId}', 1, ${availOrigin})"
                      class="btn-pressable w-7 h-7 rounded-lg bg-slate-800 text-white font-bold flex items-center justify-center border border-slate-700"
                      ${qtyToSend >= availOrigin ? 'disabled style="opacity:0.3"' : ''}
                    >+</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>

          <div class="mb-3">
            <input 
              type="text"
              id="batchTransferNotesInput"
              value="${this._escapeHtml(this.batchTransferNotes || '')}"
              oninput="window.app.batchTransferNotes = this.value"
              placeholder="📝 Nota opcional del reparto (ej. Reparto viernes tarde)..."
              class="w-full bg-slate-900 text-white px-3.5 py-2.5 rounded-xl border border-slate-700 text-xs focus:outline-none focus:border-emerald-500"
            />
          </div>

          <button 
            id="btnExecuteBatchTransfer"
            data-to-wh-name="${this._escapeHtml(toWhObj ? toWhObj.name : 'Destino')}"
            type="button"
            onclick="window.app.executeBatchTransfer()"
            ${totalSelectedUnits <= 0 ? 'disabled' : ''}
            class="btn-primary btn-pressable"
          >
            <span>🚚</span>
            <span id="btnExecuteBatchTransferLabel">${
              totalSelectedUnits > 0
                ? `Enviar ${totalSelectedUnits} uds (${selectedFlavorsCount} sabores) a ${toWhObj ? this._escapeHtml(toWhObj.name) : 'Destino'}`
                : 'Selecciona unidades para repartir'
            }</span>
          </button>
        `}
      </div>

      <!-- Historial de Últimos Repartos Realizados -->
      <div class="ios-card mb-8">
        <div class="flex items-center justify-between mb-2.5">
          <span class="text-xs font-bold uppercase tracking-wider text-slate-300">🕒 Últimos Repartos / Movimientos</span>
          <span class="text-[11px] text-slate-400">${recentTransfers.length} registros</span>
        </div>

        ${recentTransfers.length === 0 ? `
          <div class="text-center py-6 text-xs text-slate-500">
            Aún no se han registrado movimientos de stock entre almacenes.
          </div>
        ` : `
          <div class="space-y-2">
            ${recentTransfers.map(t => {
              const dt = new Date(t.timestamp);
              const dateStr = dt.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
              const timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              return `
                <div class="bg-slate-900/75 p-2.5 rounded-xl border border-slate-800 flex items-center justify-between text-xs">
                  <div class="pr-2">
                    <div class="font-bold text-white">${this._escapeHtml(t.productName)}</div>
                    <div class="text-[11px] text-slate-300 mt-0.5">
                      <span class="text-slate-400">${this._escapeHtml(t.fromWarehouseName)}</span>
                      <span class="text-emerald-400 font-bold mx-1">→</span>
                      <span class="text-emerald-300 font-semibold">${this._escapeHtml(t.toWarehouseName)}</span>
                    </div>
                    ${t.notes ? `<div class="text-[10px] text-slate-400 mt-0.5">📝 ${this._escapeHtml(t.notes)}</div>` : ''}
                  </div>
                  <div class="text-right flex-shrink-0">
                    <span class="badge badge-ok-stock text-xs">${t.quantity} uds</span>
                    <div class="text-[10px] text-slate-500 mt-1">${dateStr} • ${timeStr}</div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    `;

    return html;
  }

  setBatchTransferFromWh(whId) {
    this.batchTransferFromWh = whId;
    this.batchTransferQuantities = {};
    this._playChime('tap');
    this.renderInventoryView();
  }

  setBatchTransferToWh(whId) {
    this.batchTransferToWh = whId;
    this._playChime('tap');
    this.renderInventoryView();
  }

  changeBatchTransferQty(productId, delta, maxAvail) {
    const cur = parseInt(this.batchTransferQuantities[productId], 10) || 0;
    const next = Math.min(maxAvail, Math.max(0, cur + delta));
    this.batchTransferQuantities[productId] = next;
    this._playChime('tap');
    this._updateBatchTransferDom(productId);
  }

  setBatchTransferQty(productId, val, maxAvail) {
    const raw = String(val ?? '').trim();
    const parsed = raw === '' ? 0 : (parseInt(raw, 10) || 0);
    const next = Math.min(maxAvail, Math.max(0, parsed));
    this.batchTransferQuantities[productId] = next;
    this._updateBatchTransferDom(productId, raw === '');
  }

  _updateBatchTransferDom(onlyProductId = null, keepEmptyInput = false) {
    const updateRow = (row) => {
      const pid = row.dataset.batchProduct;
      if (!pid) return;
      const qtyToSend = parseInt(this.batchTransferQuantities[pid], 10) || 0;
      const currentDest = parseInt(row.dataset.currentDest, 10) || 0;
      const maxAvail = parseInt(row.dataset.maxAvail, 10) || 0;

      row.className = `bg-slate-900/85 p-2.5 rounded-xl border ${
        qtyToSend > 0 ? 'border-emerald-500/60 bg-emerald-950/20' : 'border-slate-800'
      } flex items-center justify-between gap-2`;

      const destEl = document.getElementById(`batchDest_${pid}`);
      if (destEl) {
        destEl.textContent = `${currentDest}${qtyToSend > 0 ? ` → ${currentDest + qtyToSend}` : ''} uds`;
      }
      const decBtn = document.getElementById(`batchDec_${pid}`);
      if (decBtn) {
        decBtn.disabled = qtyToSend <= 0;
        decBtn.style.opacity = qtyToSend <= 0 ? '0.3' : '';
      }
      const incBtn = document.getElementById(`batchInc_${pid}`);
      if (incBtn) {
        incBtn.disabled = qtyToSend >= maxAvail;
        incBtn.style.opacity = qtyToSend >= maxAvail ? '0.3' : '';
      }
      const inp = document.getElementById(`batchInput_${pid}`);
      if (inp) {
        inp.className = `w-11 text-center text-sm font-black ${qtyToSend > 0 ? 'text-emerald-400' : 'text-slate-400'} bg-slate-950/70 py-1 rounded-lg border border-slate-700`;
        if (!keepEmptyInput && document.activeElement !== inp) {
          inp.value = qtyToSend;
        }
      }
    };

    if (onlyProductId) {
      const singleRow = document.getElementById(`batchRow_${onlyProductId}`);
      if (singleRow) updateRow(singleRow);
    } else {
      document.querySelectorAll('[data-batch-product]').forEach(updateRow);
    }

    const totalSelectedUnits = Object.values(this.batchTransferQuantities).reduce((s, q) => s + (parseInt(q, 10) || 0), 0);
    const selectedFlavorsCount = Object.values(this.batchTransferQuantities).filter(q => (parseInt(q, 10) || 0) > 0).length;
    const submitBtn = document.getElementById('btnExecuteBatchTransfer');
    const labelEl = document.getElementById('btnExecuteBatchTransferLabel');
    if (submitBtn) {
      submitBtn.disabled = totalSelectedUnits <= 0;
      if (labelEl) {
        const toName = submitBtn.dataset.toWhName || 'Destino';
        labelEl.textContent = totalSelectedUnits > 0
          ? `Enviar ${totalSelectedUnits} uds (${selectedFlavorsCount} sabores) a ${toName}`
          : 'Selecciona unidades para repartir';
      }
    }
  }

  async batchAddOneToAll() {
    const products = await this.inventoryAgent.getProducts({ warehouseId: this.batchTransferFromWh });
    products.forEach(p => {
      const avail = p.warehouseStock || 0;
      const cur = parseInt(this.batchTransferQuantities[p.id], 10) || 0;
      if (avail > cur) {
        this.batchTransferQuantities[p.id] = cur + 1;
      }
    });
    this._playChime('tap');
    this.renderInventoryView();
  }

  batchClearAll() {
    this.batchTransferQuantities = {};
    this._playChime('tap');
    this.renderInventoryView();
  }

  async executeBatchTransfer() {
    return this._runLocked('executeBatchTransfer', async () => {
      const items = Object.entries(this.batchTransferQuantities)
        .map(([productId, quantity]) => ({ productId, quantity: parseInt(quantity, 10) || 0 }))
        .filter(it => it.quantity > 0);

      if (items.length === 0) return;

      try {
        // Avisar si algún producto del reparto consume unidades reservadas en el almacén de origen
        const originProducts = await this.inventoryAgent.getProducts({ warehouseId: this.batchTransferFromWh });
        const originMap = new Map(originProducts.map(p => [p.id, p]));
        const affectedReserved = [];
        for (const it of items) {
          const p = originMap.get(it.productId);
          if (p && (p.warehouseReserved || 0) > 0 && it.quantity > p.availableStock) {
            affectedReserved.push(`• ${p.name}: envías ${it.quantity} (libres: ${p.availableStock}, reservadas: ${p.warehouseReserved})`);
          }
        }
        if (affectedReserved.length > 0) {
          const proceed = confirm(
            `⚠️ AVISO DE UNIDADES RESERVADAS\n\nVas a mover unidades reservadas del almacén de origen:\n${affectedReserved.join('\n')}\n\n¿Continuar con el reparto igualmente?`
          );
          if (!proceed) return;
        }

        const res = await this.inventoryAgent.batchTransferStock({
          fromWarehouseId: this.batchTransferFromWh,
          toWarehouseId: this.batchTransferToWh,
          items,
          notes: this.batchTransferNotes
        });

        this.batchTransferQuantities = {};
        this.batchTransferNotes = '';
        this._playChime('success');
        this.showToast(res.message, '🚚');
        this.scheduleCloudSnapshotPublish();
        await this.renderInventoryView();
      } catch (err) {
        alert(`Error en el reparto: ${err.message}`);
      }
    });
  }

  // -------------------------------------------------------------------------
  // SUB-VISTA 2.D Y MODAL DE RESERVAS DE CLIENTES
  // -------------------------------------------------------------------------
  async _buildInventoryReservationsSubViewHtml() {
    const isWorker = this.authAgent.isWorker();
    const assignedWh = this.authAgent.getAssignedWarehouseId();

    const [warehouses, products, reservations] = await Promise.all([
      this.inventoryAgent.getWarehouses(),
      this.inventoryAgent.getProducts({ warehouseId: isWorker ? assignedWh : 'all' }),
      this.inventoryAgent.getReservations({ status: 'active', warehouseId: isWorker ? assignedWh : 'all' })
    ]);

    const totalResUnits = reservations.reduce((sum, r) => sum + (parseInt(r.quantity, 10) || 0), 0);
    const totalResValue = reservations.reduce((sum, r) => sum + ((parseInt(r.quantity, 10) || 0) * (parseFloat(r.agreedUnitPrice) || 12)), 0);

    return `
      <div class="ios-card border-purple-500/40 bg-gradient-to-br from-purple-950/35 to-slate-900 mb-4 animate-fade-in">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h3 class="text-base font-black text-white flex items-center gap-1.5">
              <span>📌</span> Reservas Activas de Clientes (${reservations.length})
            </h3>
            <p class="text-xs text-slate-300 mt-0.5">
              Aparta unidades a nombre de un cliente y conviértelas en venta cobrada con 1 toque cuando las recoja.
            </p>
          </div>
          <button 
            type="button"
            onclick="window.app.openReservationModal()"
            class="btn-pressable bg-purple-600 hover:bg-purple-500 text-white px-3.5 py-2 rounded-xl text-xs font-bold shadow-lg shadow-purple-900/40"
          >+ Nueva Reserva</button>
        </div>

        <div class="grid grid-cols-3 gap-2 text-center mb-3">
          <div class="bg-slate-950/60 p-2.5 rounded-xl border border-white/10">
            <div class="text-[10px] text-slate-400">Reservas Activas</div>
            <div class="text-base font-black text-white">${reservations.length}</div>
          </div>
          <div class="bg-slate-950/60 p-2.5 rounded-xl border border-white/10">
            <div class="text-[10px] text-purple-300">Unidades Apartadas</div>
            <div class="text-base font-black text-purple-300">${totalResUnits} uds</div>
          </div>
          <div class="bg-slate-950/60 p-2.5 rounded-xl border border-white/10">
            <div class="text-[10px] text-emerald-400">Valor Acordado</div>
            <div class="text-base font-black text-emerald-300">${totalResValue.toFixed(2)}€</div>
          </div>
        </div>

        ${reservations.length === 0 ? `
          <div class="text-center py-8 bg-slate-900/60 rounded-2xl border border-slate-800">
            <div class="text-3xl mb-1.5">📌</div>
            <div class="text-sm font-bold text-slate-300">No hay reservas activas ahora mismo</div>
            <p class="text-xs text-slate-500 mt-1 mb-3">Puedes reservar sabores a cualquier cliente para que no se vendan por error.</p>
            <button 
              type="button"
              onclick="window.app.openReservationModal()"
              class="btn-pressable bg-purple-600/30 text-purple-200 border border-purple-500/50 px-4 py-2 rounded-xl text-xs font-bold"
            >+ Crear Primera Reserva</button>
          </div>
        ` : `
          <div class="space-y-2.5">
            ${reservations.map(r => {
              const dt = new Date(r.createdAt);
              const dateStr = dt.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
              const totalVal = ((parseInt(r.quantity, 10) || 0) * (parseFloat(r.agreedUnitPrice) || 12)).toFixed(2);
              return `
                <div class="bg-slate-900/90 p-3 rounded-2xl border border-purple-500/35 flex flex-wrap items-center justify-between gap-2">
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-1.5 mb-1">
                      <span class="badge badge-reserved text-[10px]">📌 Cliente: ${this._escapeHtml(r.customerName)}</span>
                      <span class="badge badge-warehouse text-[10px]">${this._escapeHtml(r.warehouseName || 'Principal')}</span>
                      <span class="text-[10px] text-slate-400">${dateStr}</span>
                    </div>
                    <div class="text-sm font-bold text-white">${this._escapeHtml(r.productName)}</div>
                    <div class="text-xs text-slate-300 mt-0.5">
                      <strong>${r.quantity} uds</strong> × ${parseFloat(r.agreedUnitPrice || 12).toFixed(2)}€ = <strong class="text-emerald-400">${totalVal}€</strong>
                    </div>
                    ${r.notes ? `<div class="text-[11px] text-slate-400 mt-0.5">📝 ${this._escapeHtml(r.notes)}</div>` : ''}
                  </div>

                  <div class="flex flex-col gap-1.5 items-end">
                    <div class="flex gap-1.5">
                      <button 
                        type="button"
                        onclick="window.app.completeReservationQuick('${r.id}', 'Efectivo')"
                        class="btn-pressable bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-300 border border-emerald-500/40 px-2.5 py-1.5 rounded-xl text-[11px] font-bold"
                      >💵 Cobrar Efec.</button>
                      <button 
                        type="button"
                        onclick="window.app.completeReservationQuick('${r.id}', 'Tarjeta')"
                        class="btn-pressable bg-indigo-500/20 hover:bg-indigo-500/35 text-indigo-300 border border-indigo-500/40 px-2.5 py-1.5 rounded-xl text-[11px] font-bold"
                      >💳 Tarjeta</button>
                    </div>
                    <button 
                      type="button"
                      onclick="window.app.cancelReservationAction('${r.id}')"
                      class="btn-pressable text-[10px] text-rose-400 hover:text-rose-300 underline"
                    >✕ Cancelar y liberar stock</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    `;
  }

  async openReservationModal(defaultProductId = null, defaultWarehouseId = MAIN_WAREHOUSE_ID) {
    const isWorker = this.authAgent.isWorker();
    const assignedWh = this.authAgent.getAssignedWarehouseId();

    const [allWarehouses, products, reservations] = await Promise.all([
      this.inventoryAgent.getWarehouses(),
      this.inventoryAgent.getProducts({ warehouseId: isWorker ? assignedWh : 'all' }),
      this.inventoryAgent.getReservations({ status: 'active', warehouseId: isWorker ? assignedWh : 'all' })
    ]);

    const warehouses = isWorker ? allWarehouses.filter(w => w.id === assignedWh) : allWarehouses;

    const modal = document.getElementById('reservationFormModal');
    const custInput = document.getElementById('resModalCustomerName');
    const whSelect = document.getElementById('resModalWarehouseSelect');
    const prodSelect = document.getElementById('resModalProductSelect');
    const qtyInput = document.getElementById('resModalQtyInput');
    const priceInput = document.getElementById('resModalPriceInput');
    const notesInput = document.getElementById('resModalNotesInput');
    const activeListEl = document.getElementById('resModalActiveListContainer');

    if (!modal || !whSelect || !prodSelect) return;

    const targetWh = isWorker && assignedWh
      ? assignedWh
      : (defaultWarehouseId && defaultWarehouseId !== 'all' && warehouses.some(w => w.id === defaultWarehouseId))
        ? defaultWarehouseId
        : MAIN_WAREHOUSE_ID;
    const targetProd = defaultProductId || (products[0]?.id || '');

    whSelect.innerHTML = warehouses.map(w => `
      <option value="${w.id}" ${w.id === targetWh ? 'selected' : ''}>
        ${w.icon || '🏠'} ${this._escapeHtml(w.name)}
      </option>
    `).join('');
    whSelect.disabled = isWorker;

    prodSelect.innerHTML = products.map(p => `
      <option value="${p.id}" ${p.id === targetProd ? 'selected' : ''}>
        ${this._escapeHtml(p.name)}
      </option>
    `).join('');

    if (custInput) custInput.value = '';
    if (qtyInput) qtyInput.value = 1;
    const defaultProd = products.find(p => p.id === targetProd);
    const defaultPrice = (defaultProd && Number.isFinite(parseFloat(defaultProd.sellPrice))) ? parseFloat(defaultProd.sellPrice).toFixed(2) : '12.00';
    if (priceInput) priceInput.value = defaultPrice;
    if (notesInput) notesInput.value = '';

    if (activeListEl) {
      if (reservations.length === 0) {
        activeListEl.innerHTML = `<div class="text-xs text-slate-500 text-center py-3">No hay reservas activas.</div>`;
      } else {
        activeListEl.innerHTML = reservations.map(r => {
          const parsedUnit = parseFloat(r.agreedUnitPrice);
          const unitPrice = Number.isFinite(parsedUnit) ? parsedUnit : 12;
          return `
          <div class="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800 flex items-center justify-between gap-2 text-xs">
            <div class="min-w-0 flex-1">
              <div class="font-bold text-purple-300 truncate">👤 ${this._escapeHtml(r.customerName)} • ${r.quantity}x ${this._escapeHtml(r.productName)}</div>
              <div class="text-[10px] text-slate-400">${this._escapeHtml(r.warehouseName)} • ${(r.quantity * unitPrice).toFixed(2)}€</div>
            </div>
            <div class="flex items-center gap-1 flex-shrink-0">
              <button type="button" onclick="window.app.completeReservationQuick('${this._escJsAttr(r.id)}', 'Efectivo', true)" class="btn-pressable bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-1 rounded-lg text-[10px] font-bold">💵 Cobrar</button>
              <button type="button" onclick="window.app.completeReservationQuick('${this._escJsAttr(r.id)}', 'Tarjeta', true)" class="btn-pressable bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-2 py-1 rounded-lg text-[10px] font-bold">💳</button>
              <button type="button" onclick="window.app.cancelReservationAction('${this._escJsAttr(r.id)}', true)" class="btn-pressable text-rose-400 px-1.5 py-1 text-xs font-bold">✕</button>
            </div>
          </div>
        `;
        }).join('');
      }
    }

    await this.onResModalFieldChange();
    modal.classList.add('active');
    this._playChime('tap');
  }

  async onResModalFieldChange() {
    const whId = document.getElementById('resModalWarehouseSelect')?.value || MAIN_WAREHOUSE_ID;
    const prodId = document.getElementById('resModalProductSelect')?.value;
    const badge = document.getElementById('resModalAvailBadge');
    const btn = document.getElementById('btnConfirmResModal');
    const priceInput = document.getElementById('resModalPriceInput');
    if (!prodId) {
      this._currentResModalMax = 0;
      if (btn) btn.disabled = true;
      return;
    }

    const products = await this.inventoryAgent.getProducts({ warehouseId: whId });
    const prod = products.find(p => p.id === prodId);
    const avail = prod ? prod.availableStock : 0;
    this._currentResModalMax = avail;
    if (priceInput && prod && Number.isFinite(parseFloat(prod.sellPrice))) {
      priceInput.value = parseFloat(prod.sellPrice).toFixed(2);
    }

    if (badge) {
      badge.textContent = `Libres: ${avail} uds`;
      badge.className = `text-[10px] font-bold ${avail > 0 ? 'text-emerald-400' : 'text-rose-400'}`;
    }
    if (btn) {
      btn.disabled = avail <= 0;
    }
  }

  stepResModalQty(delta) {
    const input = document.getElementById('resModalQtyInput');
    if (!input) return;
    const max = Math.max(1, Number(this._currentResModalMax || 0));
    const cur = parseInt(input.value, 10) || 1;
    input.value = Math.min(max, Math.max(1, cur + delta));
    this._playChime('tap');
  }

  async confirmReservationFromModal() {
    return this._runLocked('confirmReservationFromModal', async () => {
      const customerName = document.getElementById('resModalCustomerName')?.value || '';
      const isWorker = this.authAgent.isWorker();
      const warehouseId = isWorker
        ? (this.authAgent.getAssignedWarehouseId() || MAIN_WAREHOUSE_ID)
        : (document.getElementById('resModalWarehouseSelect')?.value || MAIN_WAREHOUSE_ID);
      const productId = document.getElementById('resModalProductSelect')?.value || '';
      const quantity = parseInt(document.getElementById('resModalQtyInput')?.value, 10) || 1;
      const rawPrice = parseFloat(document.getElementById('resModalPriceInput')?.value);
      const agreedUnitPrice = Number.isFinite(rawPrice) ? rawPrice : 12.00;
      const notes = document.getElementById('resModalNotesInput')?.value || '';

      try {
        const res = await this.inventoryAgent.addReservation({
          productId,
          warehouseId,
          quantity,
          customerName,
          agreedUnitPrice,
          notes
        });

        document.getElementById('reservationFormModal')?.classList.remove('active');
        this._playChime('success');
        this.showToast(res.message, '📌');

        if (res.reservation) {
          const wh = await this.inventoryAgent.getWarehouse(warehouseId);
          this.notificationsAgent.notifyReservation({ reservation: res.reservation, warehouse: wh }).catch(() => {});
          if (!this.supabaseAgent.isConfigured()) {
            this.cloudSyncAgent.publishReservationEvent('add', res.reservation).catch(() => {});
          }
        }

        await this.renderCurrentTab();
      } catch (err) {
        alert(`Error al reservar: ${err.message}`);
      }
    });
  }

  async completeReservationQuick(reservationId, paymentMethod = 'Efectivo', refreshModal = false) {
    return this._runLocked(`completeRes_${reservationId}`, async () => {
      try {
        const res = await this.salesAgent.completeReservationAsSale(reservationId, {
          paymentMethod,
          paymentStatus: 'paid'
        });
        this.lastCompletedSale = res.sale;
        this._playChime('success');
        this.showToast(res.message, '💰');
        if (refreshModal) {
          document.getElementById('reservationFormModal')?.classList.remove('active');
        }

        if (res.sale) {
          if (!this.supabaseAgent.isConfigured()) {
            this.cloudSyncAgent.publishReservationEvent('complete', { id: reservationId }).catch(() => {});
          }
          this._notifyAndSyncSale(res.sale);
        }

        await this.renderCurrentTab();
        await this.updateHeaderQuickStats();
      } catch (err) {
        alert(`No se pudo completar la reserva: ${err.message}`);
      }
    });
  }

  async cancelReservationAction(reservationId, refreshModal = false) {
    if (!confirm('¿Cancelar esta reserva y liberar las unidades para la venta normal?')) return;
    try {
      const res = await this.inventoryAgent.cancelReservation(reservationId);
      this._playChime('revert');
      this.showToast(res.message, '📌');
      if (!this.supabaseAgent.isConfigured()) {
        this.cloudSyncAgent.publishReservationEvent('cancel', { id: reservationId }).catch(() => {});
      }
      if (refreshModal) {
        await this.openReservationModal();
      }
      await this.renderCurrentTab();
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // MODAL DE REPARTO RÁPIDO INDIVIDUAL (transferStockModal)
  // -------------------------------------------------------------------------
  async openTransferModal(productId = null, defaultFromWh = MAIN_WAREHOUSE_ID, defaultToWh = null, defaultQty = 1) {
    const [warehouses, products] = await Promise.all([
      this.inventoryAgent.getWarehouses(),
      this.inventoryAgent.getProducts({ warehouseId: 'all' })
    ]);

    if (warehouses.length < 2) {
      this.showToast('Crea primero un almacén o casa de trabajador para repartir stock', '🏠');
      await this.openWarehouseModal();
      return;
    }

    const modal = document.getElementById('transferStockModal');
    const prodSelect = document.getElementById('transferModalProductSelect');
    const fromSelect = document.getElementById('transferModalFromWh');
    const toSelect = document.getElementById('transferModalToWh');
    const qtyInput = document.getElementById('transferModalQtyInput');
    const notesInput = document.getElementById('transferModalNotes');

    if (!modal || !prodSelect || !fromSelect || !toSelect) return;

    const initialFrom = warehouses.some(w => w.id === defaultFromWh) ? defaultFromWh : MAIN_WAREHOUSE_ID;
    const initialTo = (defaultToWh && warehouses.some(w => w.id === defaultToWh) && defaultToWh !== initialFrom)
      ? defaultToWh
      : (warehouses.find(w => w.id !== initialFrom)?.id || warehouses[0].id);
    const initialProd = productId || (products[0]?.id || '');

    prodSelect.innerHTML = products.map(p => `
      <option value="${p.id}" ${p.id === initialProd ? 'selected' : ''}>
        ${this._escapeHtml(p.name)} (Total: ${p.stock} uds)
      </option>
    `).join('');

    fromSelect.innerHTML = warehouses.map(w => `
      <option value="${w.id}" ${w.id === initialFrom ? 'selected' : ''}>
        ${w.icon || '🏠'} ${this._escapeHtml(w.name)}
      </option>
    `).join('');

    toSelect.innerHTML = warehouses.map(w => `
      <option value="${w.id}" ${w.id === initialTo ? 'selected' : ''}>
        ${w.icon || '👤'} ${this._escapeHtml(w.name)}
      </option>
    `).join('');

    if (qtyInput) qtyInput.value = Math.max(1, parseInt(defaultQty, 10) || 1);
    if (notesInput) notesInput.value = '';

    await this.onTransferModalFieldChange();
    modal.classList.add('active');
    this._playChime('tap');
  }

  async onTransferModalFieldChange() {
    const prodId = document.getElementById('transferModalProductSelect')?.value;
    const fromWh = document.getElementById('transferModalFromWh')?.value;
    const toWh = document.getElementById('transferModalToWh')?.value;
    const badge = document.getElementById('transferModalAvailableBadge');
    const btn = document.getElementById('btnConfirmSingleTransfer');

    if (!prodId || !fromWh) {
      this._currentTransferModalMax = 0;
      if (btn) btn.disabled = true;
      return;
    }
    const product = await this.inventoryAgent.getProduct(prodId);
    const avail = product ? (product.stockByWarehouse?.[fromWh] || 0) : 0;
    this._currentTransferModalMax = avail;

    if (badge) {
      badge.textContent = `Disponible en origen: ${avail} uds`;
      badge.className = `text-xs font-bold ${avail > 0 ? 'text-emerald-400' : 'text-rose-400'}`;
    }

    if (btn) {
      btn.disabled = avail <= 0 || fromWh === toWh;
    }
  }

  adjustTransferModalQty(delta) {
    const input = document.getElementById('transferModalQtyInput');
    if (!input) return;
    const max = Math.max(1, Number(this._currentTransferModalMax || 0));
    const cur = parseInt(input.value, 10) || 1;
    input.value = Math.min(max, Math.max(1, cur + delta));
    this._playChime('tap');
  }

  setTransferModalMaxQty() {
    const input = document.getElementById('transferModalQtyInput');
    if (!input) return;
    const max = Math.max(1, Number(this._currentTransferModalMax || 0));
    input.value = max;
    this._playChime('tap');
  }

  async confirmSingleTransferFromModal() {
    return this._runLocked('confirmSingleTransfer', async () => {
      const productId = document.getElementById('transferModalProductSelect')?.value;
      const fromWarehouseId = document.getElementById('transferModalFromWh')?.value;
      const toWarehouseId = document.getElementById('transferModalToWh')?.value;
      const quantity = parseInt(document.getElementById('transferModalQtyInput')?.value, 10) || 1;
      const notes = document.getElementById('transferModalNotes')?.value || '';

      try {
        const originProducts = await this.inventoryAgent.getProducts({ warehouseId: fromWarehouseId });
        const prod = originProducts.find(p => p.id === productId);
        if (prod && (prod.warehouseReserved || 0) > 0 && quantity > prod.availableStock) {
          const proceed = confirm(
            `⚠️ AVISO DE RESERVA\n\n"${prod.name}" tiene ${prod.warehouseReserved} ud(s) reservadas en origen (quedan ${prod.availableStock} libres de ${prod.warehouseStock} físicas).\nSi transfieres ${quantity} ud(s) moverás stock reservado.\n\n¿Continuar con el reparto igualmente?`
          );
          if (!proceed) return;
        }

        const res = await this.inventoryAgent.transferStock({
          productId,
          fromWarehouseId,
          toWarehouseId,
          quantity,
          notes
        });

        document.getElementById('transferStockModal')?.classList.remove('active');
        this._playChime('success');
        this.showToast(res.message, '🚚');
        this.scheduleCloudSnapshotPublish();
        await this.renderCurrentTab();
      } catch (err) {
        alert(`No se pudo transferir: ${err.message}`);
      }
    });
  }

  // -------------------------------------------------------------------------
  // MODAL DE CREAR / EDITAR ALMACÉN O CASA DE TRABAJADOR (warehouseFormModal)
  // -------------------------------------------------------------------------
  async openWarehouseModal(warehouseId = null) {
    this.editingWarehouseId = warehouseId;
    const modal = document.getElementById('warehouseFormModal');
    if (!modal) return;

    const titleEl = document.getElementById('warehouseModalTitle');
    const nameInput = document.getElementById('inputWhName');
    const workerInput = document.getElementById('inputWhWorker');
    const notesInput = document.getElementById('inputWhNotes');
    const rewardEveryInput = document.getElementById('inputWhRewardEveryN');
    const rewardFreeInput = document.getElementById('inputWhRewardFreeUnits');
    const pinGroup = document.getElementById('whWorkerPinGroup');
    const pinInput = document.getElementById('inputWhWorkerPin');
    const btnDelete = document.getElementById('btnDeleteWarehouse');

    if (warehouseId) {
      const wh = await this.inventoryAgent.getWarehouse(warehouseId);
      if (!wh) return;
      if (titleEl) titleEl.textContent = wh.isMain ? 'Editar Almacén Principal' : 'Editar Almacén / Trabajador';
      if (nameInput) nameInput.value = wh.name || '';
      if (workerInput) workerInput.value = wh.workerName || '';
      if (notesInput) notesInput.value = wh.notes || '';
      if (rewardEveryInput) rewardEveryInput.value = wh.rewardEveryNUnits || 5;
      if (rewardFreeInput) rewardFreeInput.value = wh.rewardFreeUnits || 1;
      if (pinGroup) pinGroup.classList.toggle('hidden', !!wh.isMain);
      if (pinInput) pinInput.value = wh.workerPin || this.storageAgent._generateDefaultWorkerPin();
      this.selectedWarehouseIcon = wh.icon || '🏠';
      if (btnDelete) {
        btnDelete.classList.toggle('hidden', !!wh.isMain);
      }
    } else {
      if (titleEl) titleEl.textContent = 'Nuevo Almacén / Casa de Trabajador';
      if (nameInput) nameInput.value = '';
      if (workerInput) workerInput.value = '';
      if (notesInput) notesInput.value = '';
      if (rewardEveryInput) rewardEveryInput.value = 5;
      if (rewardFreeInput) rewardFreeInput.value = 1;
      if (pinGroup) pinGroup.classList.remove('hidden');
      if (pinInput) pinInput.value = this.storageAgent._generateDefaultWorkerPin();
      this.selectedWarehouseIcon = '👤';
      if (btnDelete) btnDelete.classList.add('hidden');
    }

    this._renderWarehouseIconPicker();
    this.updateWhRewardPreviewText();
    modal.classList.add('active');
    this._playChime('tap');
  }

  randomizeWarehousePinInput() {
    const pinInput = document.getElementById('inputWhWorkerPin');
    if (pinInput) {
      pinInput.value = this.storageAgent._generateDefaultWorkerPin();
      this._playChime('tap');
    }
  }

  updateWhRewardPreviewText() {
    const everyN = Math.max(1, parseInt(document.getElementById('inputWhRewardEveryN')?.value, 10) || 5);
    const freeU = Math.max(1, parseInt(document.getElementById('inputWhRewardFreeUnits')?.value, 10) || 1);
    const previewEl = document.getElementById('whRewardPreviewText');
    if (previewEl) {
      previewEl.textContent = `Por cada ${everyN} ${everyN === 1 ? 'vaper' : 'vapers'} que venda este trabajador, le regalas ${freeU} ${freeU === 1 ? 'vaper gratis' : 'vapers gratis'}.`;
    }
  }

  _renderWarehouseIconPicker() {
    const container = document.getElementById('warehouseIconSelector');
    if (!container) return;
    const icons = ['🏠', '👤', '📍', '🏪', '📦', '🚗'];
    container.innerHTML = icons.map(ic => `
      <button 
        type="button"
        onclick="window.app.selectWarehouseIcon('${ic}')"
        class="btn-pressable py-2 rounded-xl text-lg flex items-center justify-center border ${
          this.selectedWarehouseIcon === ic
            ? 'bg-emerald-500/25 border-emerald-500 text-white shadow-sm'
            : 'bg-slate-800 border-slate-700 text-slate-300'
        }"
      >${ic}</button>
    `).join('');
  }

  selectWarehouseIcon(icon) {
    this.selectedWarehouseIcon = icon;
    this._playChime('tap');
    this._renderWarehouseIconPicker();
  }

  async saveWarehouseFromModal() {
    const name = document.getElementById('inputWhName')?.value || '';
    const workerName = document.getElementById('inputWhWorker')?.value || '';
    const notes = document.getElementById('inputWhNotes')?.value || '';
    const rewardEveryNUnits = Math.max(1, parseInt(document.getElementById('inputWhRewardEveryN')?.value, 10) || 5);
    const rewardFreeUnits = Math.max(1, parseInt(document.getElementById('inputWhRewardFreeUnits')?.value, 10) || 1);
    const workerPin = document.getElementById('inputWhWorkerPin')?.value || '';
    const icon = this.selectedWarehouseIcon || '👤';

    try {
      if (this.editingWarehouseId) {
        const updatePayload = {
          name,
          workerName,
          icon,
          notes,
          rewardEveryNUnits,
          rewardFreeUnits
        };
        if (this.editingWarehouseId !== MAIN_WAREHOUSE_ID && workerPin) {
          updatePayload.workerPin = workerPin;
        }
        await this.inventoryAgent.updateWarehouse(this.editingWarehouseId, updatePayload);
        this.showToast('Almacén, PIN y comisión actualizados', '🏠');
      } else {
        const created = await this.inventoryAgent.addWarehouse({
          name,
          workerName,
          icon,
          notes,
          workerPin,
          rewardEveryNUnits,
          rewardFreeUnits
        });
        if (this.activeTab === 'inventory' && this.inventorySubView === 'stock') {
          this.selectedInventoryWarehouse = created.id;
        }
        this.showToast(`Almacén "${created.name}" creado (PIN: ${created.workerPin})`, '🏠');
      }

      document.getElementById('warehouseFormModal')?.classList.remove('active');
      this._playChime('success');
      this.scheduleCloudSnapshotPublish();
      await this.renderCurrentTab();
    } catch (err) {
      alert(`Error al guardar almacén: ${err.message}`);
    }
  }

  async deleteCurrentWarehouse() {
    if (!this.editingWarehouseId || this.editingWarehouseId === MAIN_WAREHOUSE_ID) return;
    const wh = await this.inventoryAgent.getWarehouse(this.editingWarehouseId);
    const whName = wh ? wh.name : 'este almacén';

    if (!confirm(`¿Eliminar "${whName}"? Todo el stock que tenga asignado se devolverá automáticamente a "Mi Almacén (Principal)".`)) {
      return;
    }

    try {
      await this.inventoryAgent.deleteWarehouse(this.editingWarehouseId, { returnStockToMain: true });
      if (this.selectedInventoryWarehouse === this.editingWarehouseId) {
        this.selectedInventoryWarehouse = 'all';
      }
      if (this.activeSaleWarehouseId === this.editingWarehouseId) {
        this.activeSaleWarehouseId = MAIN_WAREHOUSE_ID;
      }
      if (this.analyticsWarehouseFilter === this.editingWarehouseId) {
        this.analyticsWarehouseFilter = 'all';
      }

      document.getElementById('warehouseFormModal')?.classList.remove('active');
      this._playChime('revert');
      this.showToast('Almacén eliminado y stock devuelto al Principal', '🗑️');
      this.scheduleCloudSnapshotPublish();
      await this.renderCurrentTab();
    } catch (err) {
      alert(`Error al eliminar almacén: ${err.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // MODAL PARA AÑADIR / EDITAR PRODUCTO CON STOCK POR ALMACÉN
  // -------------------------------------------------------------------------
  async openProductModal(productId = null) {
    this.editingProductId = productId;
    const modal = document.getElementById('productFormModal');
    if (!modal) return;

    const warehouses = await this.inventoryAgent.getWarehouses();
    const titleEl = document.getElementById('productModalTitle');
    const nameInput = document.getElementById('inputProdName');
    const catInput = document.getElementById('inputProdCategory');
    const costInput = document.getElementById('inputProdCost');
    const sellInput = document.getElementById('inputProdSell');
    const btnDelete = document.getElementById('btnDeleteProduct');
    const stocksContainer = document.getElementById('productModalWarehouseStocksContainer');

    let currentStockByWh = { [MAIN_WAREHOUSE_ID]: 10 };

    if (productId) {
      const p = await this.inventoryAgent.getProduct(productId);
      if (!p) return;
      if (titleEl) titleEl.textContent = 'Editar Producto y Stock por Almacén';
      if (nameInput) nameInput.value = p.name;
      if (catInput) catInput.value = p.category || 'Sabores';
      if (costInput) costInput.value = p.costPrice;
      if (sellInput) sellInput.value = p.sellPrice;
      if (btnDelete) btnDelete.classList.remove('hidden');
      currentStockByWh = { ...(p.stockByWarehouse || {}) };
    } else {
      if (titleEl) titleEl.textContent = 'Nuevo Producto';
      if (nameInput) nameInput.value = '';
      if (catInput) catInput.value = 'Sabores';
      if (costInput) costInput.value = '6.70';
      if (sellInput) sellInput.value = '12.00';
      if (btnDelete) btnDelete.classList.add('hidden');
      const targetDefaultWh = (this.selectedInventoryWarehouse && this.selectedInventoryWarehouse !== 'all')
        ? this.selectedInventoryWarehouse
        : MAIN_WAREHOUSE_ID;
      currentStockByWh = { [targetDefaultWh]: 10 };
    }

    if (stocksContainer) {
      stocksContainer.innerHTML = warehouses.map(wh => {
        const val = currentStockByWh[wh.id] !== undefined ? currentStockByWh[wh.id] : 0;
        return `
          <div class="flex items-center justify-between bg-slate-800/80 px-3 py-2 rounded-xl border border-slate-700/60">
            <div class="min-w-0 pr-2">
              <div class="text-xs font-bold text-white truncate">${wh.icon || '🏠'} ${this._escapeHtml(wh.name)}</div>
              ${wh.workerName ? `<div class="text-[10px] text-slate-400 truncate">👤 ${this._escapeHtml(wh.workerName)}</div>` : ''}
            </div>
            <div class="flex items-center gap-1.5">
              <button 
                type="button"
                onclick="window.app.stepProductModalWhStock('${wh.id}', -1)"
                class="btn-pressable w-7 h-7 rounded-lg bg-slate-700 text-white font-bold flex items-center justify-center"
              >-</button>
              <input 
                type="number"
                min="0"
                data-wh-stock-input="${wh.id}"
                id="prodModalWhStock_${wh.id}"
                value="${val}"
                oninput="window.app.updateProductModalTotalStockLive()"
                class="w-14 text-center bg-slate-900 text-white font-black text-sm py-1 rounded-lg border border-slate-600 focus:outline-none focus:border-emerald-500"
              />
              <button 
                type="button"
                onclick="window.app.stepProductModalWhStock('${wh.id}', 1)"
                class="btn-pressable w-7 h-7 rounded-lg bg-slate-700 text-white font-bold flex items-center justify-center"
              >+</button>
            </div>
          </div>
        `;
      }).join('');
    }

    this.updateProductModalTotalStockLive();
    modal.classList.add('active');
    this._playChime('tap');
  }

  stepProductModalWhStock(whId, delta) {
    const input = document.getElementById(`prodModalWhStock_${whId}`);
    if (!input) return;
    const cur = parseInt(input.value, 10) || 0;
    input.value = Math.max(0, cur + delta);
    this._playChime('tap');
    this.updateProductModalTotalStockLive();
  }

  updateProductModalTotalStockLive() {
    const inputs = document.querySelectorAll('[data-wh-stock-input]');
    let total = 0;
    inputs.forEach(inp => {
      total += Math.max(0, parseInt(inp.value, 10) || 0);
    });
    const badge = document.getElementById('productModalTotalStockBadge');
    if (badge) {
      badge.textContent = `Total: ${total} uds`;
    }
  }

  async saveProductFromModal() {
    const name = document.getElementById('inputProdName')?.value;
    const category = document.getElementById('inputProdCategory')?.value || 'Sabores';
    const costPrice = parseFloat(document.getElementById('inputProdCost')?.value) || 0;
    const sellPrice = parseFloat(document.getElementById('inputProdSell')?.value) || 0;

    const stockByWarehouse = {};
    document.querySelectorAll('[data-wh-stock-input]').forEach(inp => {
      const whId = inp.getAttribute('data-wh-stock-input');
      if (whId) {
        stockByWarehouse[whId] = Math.max(0, parseInt(inp.value, 10) || 0);
      }
    });

    try {
      if (this.editingProductId) {
        await this.inventoryAgent.updateProduct(this.editingProductId, {
          name,
          category,
          costPrice,
          sellPrice,
          stockByWarehouse
        });
        this.showToast('Producto y stocks actualizados', '✓');
      } else {
        await this.inventoryAgent.addProduct({
          name,
          category,
          costPrice,
          sellPrice,
          stockByWarehouse
        });
        this.showToast('Producto añadido al catálogo', '✓');
      }

      document.getElementById('productFormModal')?.classList.remove('active');
      this._playChime('success');
      this.scheduleCloudSnapshotPublish();
      await this.renderInventoryView();
      await this.updateHeaderQuickStats();
    } catch (err) {
      alert(`Error al guardar: ${err.message}`);
    }
  }

  async deleteCurrentProduct() {
    if (!this.editingProductId) return;
    if (!confirm('¿Estás seguro de que quieres eliminar este producto del catálogo en todos los almacenes?')) return;

    try {
      await this.inventoryAgent.deleteProduct(this.editingProductId);
      document.getElementById('productFormModal')?.classList.remove('active');
      this.showToast('Producto eliminado', '🗑️');
      this.scheduleCloudSnapshotPublish();
      await this.renderInventoryView();
      await this.updateHeaderQuickStats();
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  }

  // =========================================================================
  // PESTAÑA 3: MÉTRICAS Y ANALÍTICA AVANZADA MULTI-ALMACÉN
  // =========================================================================
  async renderAnalyticsView() {
    const container = document.getElementById('view-analytics');
    if (!container) return;

    if (this.authAgent.isWorker()) {
      await this._renderWorkerAnalyticsView(container);
      return;
    }

    const [warehouses, ordersList] = await Promise.all([
      this.inventoryAgent.getWarehouses(),
      this.inventoryAgent.getOrders()
    ]);

    if (
      this.analyticsWarehouseFilter !== 'all' &&
      !warehouses.some(w => w.id === this.analyticsWarehouseFilter)
    ) {
      this.analyticsWarehouseFilter = 'all';
    }
    if (
      this.analyticsOrderFilter !== 'all' &&
      !ordersList.some(o => o.id === this.analyticsOrderFilter)
    ) {
      this.analyticsOrderFilter = 'all';
    }

    const data = await this.analyticsAgent.getDashboardMetrics(
      this.analyticsTimeframe,
      this.analyticsWarehouseFilter,
      this.analyticsOrderFilter
    );

    const timeframeLabels = {
      today: 'Hoy',
      week: 'Últimos 7 Días',
      month: 'Este Mes',
      all: 'Todo el Histórico'
    };

    const activeWhObj = this.analyticsWarehouseFilter === 'all'
      ? null
      : warehouses.find(w => w.id === this.analyticsWarehouseFilter);
    const activeOrdObj = this.analyticsOrderFilter === 'all'
      ? null
      : ordersList.find(o => o.id === this.analyticsOrderFilter);

    const activeFilterTitle = [
      activeWhObj ? `${activeWhObj.icon || '🏠'} ${this._escapeHtml(activeWhObj.name)}` : '🌐 Todos los Almacenes',
      activeOrdObj ? `📦 ${this._escapeHtml(activeOrdObj.name)}` : null
    ].filter(Boolean).join(' • ');

    const allTime = data.allTimeSummary;
    const health = data.businessHealth;
    const vel = data.velocityMetrics;
    const ts = data.timeSeries;
    this._lastTimeSeriesData = ts;
    const maxDayBilled = Math.max(1, ...vel.last7DaysTrend.map(d => d.billed));

    const ordersMetricsHtml = this._buildOrdersMetricsSectionHtml(data.ordersMetrics);
    const revenueChartCardHtml = this._buildRevenueTimeSeriesCardHtml(ts, activeFilterTitle);
    const unitsChartCardHtml = this._buildUnitsTimeSeriesCardHtml(ts, activeFilterTitle);
    const workerAccountsHtml = this._buildWorkerAccountsSectionHtml(data.workerAccounts);
    const debtsAndReservationsHtml = this._buildDebtsAndReservationsSectionHtml(data.debtsAndReservations);
    const discountMetricsHtml = this._buildDiscountMetricsSectionHtml(data.discountMetrics, timeframeLabels[this.analyticsTimeframe]);
    const salesHeatmapHtml = this._buildSalesHeatmapSectionHtml(data.salesHeatmap, activeFilterTitle);
    const flavorIntelHtml = this._buildFlavorIntelligenceSectionHtml(data.warehouseFlavorIntelligence);

    let html = `
      <!-- 0. CONTROLES DE FILTRO: TIEMPO, ALMACÉN Y PEDIDO -->
      <div class="ios-segmented mb-2.5">
        <button class="segmented-option ${this.analyticsTimeframe === 'today' ? 'active' : ''}" onclick="window.app.setTimeframe('today')">Hoy</button>
        <button class="segmented-option ${this.analyticsTimeframe === 'week' ? 'active' : ''}" onclick="window.app.setTimeframe('week')">7 Días</button>
        <button class="segmented-option ${this.analyticsTimeframe === 'month' ? 'active' : ''}" onclick="window.app.setTimeframe('month')">Este Mes</button>
        <button class="segmented-option ${this.analyticsTimeframe === 'all' ? 'active' : ''}" onclick="window.app.setTimeframe('all')">Todo</button>
      </div>

      <div class="warehouse-pills-bar no-scrollbar mb-2">
        <button 
          type="button"
          onclick="window.app.setAnalyticsWarehouseFilter('all')"
          class="warehouse-pill btn-pressable ${this.analyticsWarehouseFilter === 'all' ? 'active-indigo' : ''}"
        >
          <span>🌐</span>
          <span>Todos los Almacenes</span>
        </button>
        ${warehouses.map(wh => `
          <button 
            type="button"
            onclick="window.app.setAnalyticsWarehouseFilter('${wh.id}')"
            class="warehouse-pill btn-pressable ${this.analyticsWarehouseFilter === wh.id ? 'active' : ''}"
          >
            <span>${wh.icon || '🏠'}</span>
            <span>${this._escapeHtml(wh.name)}</span>
          </button>
        `).join('')}
      </div>

      <!-- Filtro de Pedido / Lote -->
      <div class="warehouse-pills-bar no-scrollbar mb-4">
        <button 
          type="button"
          onclick="window.app.setAnalyticsOrderFilter('all')"
          class="warehouse-pill btn-pressable ${this.analyticsOrderFilter === 'all' ? 'active-indigo' : ''}"
        >
          <span>📦</span>
          <span>Todos los Pedidos (General)</span>
        </button>
        ${ordersList.map(o => `
          <button 
            type="button"
            onclick="window.app.setAnalyticsOrderFilter('${o.id}')"
            class="warehouse-pill btn-pressable ${this.analyticsOrderFilter === o.id ? 'active' : ''}"
          >
            <span>${o.status === 'active' ? '🟢' : '🏁'}</span>
            <span>${this._escapeHtml(o.name)}</span>
          </button>
        `).join('')}
        <button
          type="button"
          onclick="window.app.openNewOrderModal()"
          class="warehouse-pill btn-pressable border-dashed border-emerald-500/50 text-emerald-300 bg-emerald-950/20"
        >
          <span>+</span>
          <span>Nuevo Pedido</span>
        </button>
      </div>

      <!-- 1. TARJETA DESTACADA: FACTURACIÓN GENERAL HISTÓRICA ("Cuánto se factura en general") -->
      <div class="ios-card ios-card-glow-emerald mb-4">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-1.5">
            <span class="text-sm">🏆</span>
            <span class="text-[11px] font-extrabold uppercase tracking-wider text-emerald-300">
              Facturación General Acumulada (Total Negocio)
            </span>
          </div>
          <span class="badge badge-ok-stock text-[10px]">${allTime.transactionCount} ventas totales</span>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-2">
          <div class="bg-slate-950/60 p-3 rounded-xl border border-white/10">
            <div class="text-[10px] text-slate-400 uppercase font-semibold">Total Facturado General</div>
            <div class="text-xl font-black text-white mt-0.5">${allTime.totalBilled.toFixed(2)}€</div>
            <div class="text-[10px] text-slate-400 mt-0.5">Ticket medio: ${allTime.averageTicket.toFixed(2)}€</div>
          </div>

          <div class="bg-emerald-950/50 p-3 rounded-xl border border-emerald-500/30">
            <div class="text-[10px] text-emerald-300 uppercase font-semibold">Beneficio Neto Total</div>
            <div class="text-xl font-black text-emerald-400 mt-0.5">+${allTime.totalProfit.toFixed(2)}€</div>
            <div class="text-[10px] text-emerald-300/80 mt-0.5">Margen global: ${allTime.overallProfitMargin}%</div>
          </div>

          <div class="bg-slate-950/60 p-3 rounded-xl border border-white/10">
            <div class="text-[10px] text-slate-400 uppercase font-semibold">Unidades Vendidas</div>
            <div class="text-xl font-black text-white mt-0.5">${allTime.totalUnits} uds</div>
            <div class="text-[10px] text-slate-400 mt-0.5">Coste merc.: ${allTime.totalCost.toFixed(2)}€</div>
          </div>

          <div class="bg-slate-950/60 p-3 rounded-xl border border-white/10">
            <div class="text-[10px] text-slate-400 uppercase font-semibold">Efectivo vs Tarjeta</div>
            <div class="text-xs font-bold text-emerald-400 mt-1">💵 ${allTime.cashBilled.toFixed(2)}€ (${allTime.cashPercentage}%)</div>
            <div class="text-xs font-bold text-indigo-300 mt-0.5">💳 ${allTime.cardBilled.toFixed(2)}€ (${allTime.cardPercentage}%)</div>
          </div>
        </div>
      </div>

      <!-- 1.B MÉTRICAS Y COMPARATIVA DE CADA PEDIDO / LOTE -->
      ${ordersMetricsHtml}

      <!-- 2. TARJETAS KPI DEL PERIODO Y ALMACÉN SELECCIONADO -->
      <div class="mb-2 px-1 flex items-center justify-between">
        <span class="text-xs font-bold uppercase tracking-wider text-slate-300">
          📊 Resumen de ${timeframeLabels[this.analyticsTimeframe]} (${activeFilterTitle})
        </span>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
        <div class="ios-card mb-0 bg-gradient-to-br from-slate-800/90 to-slate-900 border-indigo-500/30 p-3.5">
          <div class="text-[11px] text-indigo-300 font-bold mb-1">💶 Facturado Periodo</div>
          <div class="text-2xl font-black text-white tracking-tight">${data.totalBilled.toFixed(2)}€</div>
          <div class="text-[10px] text-slate-400 mt-1 flex justify-between">
            <span>${data.transactionCount} ventas</span>
            <span>Coste: ${data.totalCost.toFixed(2)}€</span>
          </div>
        </div>

        <div class="ios-card mb-0 bg-gradient-to-br from-emerald-950/60 to-slate-900 border-emerald-500/30 p-3.5">
          <div class="text-[11px] text-emerald-400 font-bold mb-1">📈 Beneficio Periodo</div>
          <div class="text-2xl font-black text-emerald-400 tracking-tight">+${data.totalProfit.toFixed(2)}€</div>
          <div class="text-[10px] text-emerald-300/90 mt-1 flex justify-between">
            <span>Margen: ${data.overallProfitMargin}%</span>
            <span>+${data.averageUnitProfit.toFixed(2)}€/ud</span>
          </div>
        </div>

        <div class="ios-card mb-0 p-3.5">
          <div class="text-[11px] text-slate-300 font-bold mb-1">📦 Volumen Vendido</div>
          <div class="text-2xl font-black text-white tracking-tight">${data.totalUnits} uds</div>
          <div class="text-[10px] text-slate-400 mt-1 flex justify-between">
            <span>PVP medio: ${data.averageUnitPrice.toFixed(2)}€</span>
          </div>
        </div>

        <div class="ios-card mb-0 p-3.5">
          <div class="text-[11px] text-slate-300 font-bold mb-1">🧾 Ticket Medio</div>
          <div class="text-2xl font-black text-white tracking-tight">${data.averageTicket.toFixed(2)}€</div>
          <div class="text-[10px] text-slate-400 mt-1 flex justify-between">
            <span>💵 ${data.paymentMethods.Efectivo.percentage}%</span>
            <span>💳 ${data.paymentMethods.Tarjeta.percentage}%</span>
          </div>
        </div>
      </div>

      <!-- 2.B GRÁFICAS INTERACTIVAS EN FUNCIÓN DEL TIEMPO: FACTURACIÓN (€) Y UNIDADES (UDS) -->
      ${revenueChartCardHtml}
      ${unitsChartCardHtml}

      <!-- PUNTO 1: CONTROL DE CUENTAS, LIQUIDACIONES Y VAPERS DE REGALO CON TRABAJADORES -->
      ${workerAccountsHtml}

      <!-- PUNTO 4: CONTROL DE FIADOS (PENDIENTES DE COBRO) Y RESERVAS ACTIVAS -->
      ${debtsAndReservationsHtml}

      <!-- PUNTO 3: CONTROL DE DESCUENTOS Y PRECIO MEDIO REAL POR TRABAJADOR -->
      ${discountMetricsHtml}

      <!-- PUNTO 7: INTELIGENCIA DE SABORES POR ZONA / TRABAJADOR Y REPOSICIÓN INTELIGENTE -->
      ${flavorIntelHtml}

      <!-- PUNTO 5: MAPA DE CALOR DE VENTAS DÍAS × FRANJAS HORARIAS -->
      ${salesHeatmapHtml}

      <!-- 3. DESGLOSE COMPLETO POR ALMACENES Y CASAS DE TRABAJADORES ("Cuánto por almacenes y todo") -->
      <div class="ios-card ios-card-glow-indigo mb-4">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h3 class="text-sm font-black uppercase tracking-wider text-white flex items-center gap-1.5">
              <span>🏢</span> Facturación, Beneficio y Stock por Almacenes / Trabajadores
            </h3>
            <p class="text-[11px] text-slate-300 mt-0.5">
              Comparativa detallada de lo que vende y tiene en stock cada almacén o trabajador.
            </p>
          </div>
          <button 
            onclick="window.app.openWarehouseModal()"
            class="btn-pressable bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/40 px-2.5 py-1 rounded-xl text-[11px] font-bold"
          >+ Añadir Almacén</button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          ${data.warehouseBreakdown.map(wh => {
            const isFiltered = this.analyticsWarehouseFilter === wh.warehouseId;
            return `
              <div class="bg-slate-900/85 p-3.5 rounded-2xl border ${
                isFiltered ? 'border-emerald-500' : wh.isMain ? 'border-emerald-500/30' : 'border-slate-700/70'
              }">
                <!-- Cabecera del almacén -->
                <div class="flex items-start justify-between gap-2 mb-2.5">
                  <div class="flex items-center gap-2">
                    <span class="text-xl">${wh.icon || '🏠'}</span>
                    <div>
                      <div class="flex items-center gap-1.5">
                        <h4 class="text-sm font-black text-white">${this._escapeHtml(wh.name)}</h4>
                        ${wh.isMain ? '<span class="badge badge-ok-stock text-[9px]">Principal</span>' : ''}
                      </div>
                      <div class="text-[11px] text-slate-400">
                        ${wh.workerName ? `👤 Trabajador: <strong class="text-slate-200">${this._escapeHtml(wh.workerName)}</strong>` : 'Gestión directa'}
                      </div>
                    </div>
                  </div>
                  <div class="text-right">
                    <span class="badge badge-warehouse text-[10px]">Cuota: ${wh.allTimeRevenueShare}% hist.</span>
                  </div>
                </div>

                <!-- Bloque A: Facturación en el Periodo vs Histórico -->
                <div class="grid grid-cols-2 gap-2 mb-2.5">
                  <div class="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                    <div class="text-[10px] text-indigo-300 font-bold uppercase">En ${timeframeLabels[this.analyticsTimeframe]}</div>
                    <div class="text-base font-black text-white mt-0.5">${wh.periodBilled.toFixed(2)}€</div>
                    <div class="text-[11px] text-emerald-400 font-bold">+${wh.periodProfit.toFixed(2)}€ benef.</div>
                    <div class="text-[10px] text-slate-400 mt-0.5">
                      ${wh.periodUnitsSold} uds (${wh.periodTransactions} ventas • ${wh.periodRevenueShare}%)
                    </div>
                  </div>

                  <div class="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                    <div class="text-[10px] text-emerald-300 font-bold uppercase">Histórico Total</div>
                    <div class="text-base font-black text-white mt-0.5">${wh.allTimeBilled.toFixed(2)}€</div>
                    <div class="text-[11px] text-emerald-400 font-bold">+${wh.allTimeProfit.toFixed(2)}€ benef.</div>
                    <div class="text-[10px] text-slate-400 mt-0.5">
                      ${wh.allTimeUnitsSold} uds vendidas en total
                    </div>
                  </div>
                </div>

                <!-- Bloque B: Stock Actual y Valoración en este Almacén -->
                <div class="bg-slate-800/45 p-2.5 rounded-xl border border-slate-700/50 mb-2.5">
                  <div class="flex items-center justify-between text-[11px] mb-1">
                    <span class="text-slate-300 font-semibold">📦 Stock actual en este almacén:</span>
                    <span class="text-white font-black">${wh.currentStockUnits} uds (${wh.stockSharePercentage}% del total)</span>
                  </div>
                  <div class="grid grid-cols-3 gap-1.5 text-center text-[10px] pt-1 border-t border-slate-700/50">
                    <div>
                      <span class="text-slate-400 block">Coste Stock</span>
                      <strong class="text-slate-200">${wh.stockCostValuation.toFixed(2)}€</strong>
                    </div>
                    <div>
                      <span class="text-slate-400 block">Valor PVP</span>
                      <strong class="text-white">${wh.stockRetailValuation.toFixed(2)}€</strong>
                    </div>
                    <div>
                      <span class="text-slate-400 block">Benef. Potencial</span>
                      <strong class="text-emerald-400">+${wh.stockPotentialProfit.toFixed(2)}€</strong>
                    </div>
                  </div>
                </div>

                <!-- Bloque C: Barra de Rotación / Rendimiento (Sell-through Rate) -->
                <div>
                  <div class="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                    <span>Rotación de mercancía (Vendido vs Asignado):</span>
                    <strong class="text-emerald-400">${wh.sellThroughRate}% vendido</strong>
                  </div>
                  <div class="progress-track">
                    <div class="progress-fill-emerald" style="width: ${Math.min(100, wh.sellThroughRate)}%"></div>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- 4. SALUD FINANCIERA, RECUPERACIÓN DE INVERSIÓN (BREAK-EVEN), ROI Y PROYECCIÓN TOTAL -->
      <div class="ios-card mb-4">
        <div class="flex items-center justify-between mb-2.5">
          <div>
            <h3 class="text-sm font-black uppercase tracking-wider text-white flex items-center gap-1.5">
              <span>🏦</span> Salud Financiera, ROI y Proyección Total
            </h3>
            <p class="text-[11px] text-slate-400">Control de inversión en mercancía, retorno de capital y beneficio proyectado</p>
          </div>
          <span class="badge ${health.netCashBalance >= 0 ? 'badge-ok-stock' : 'badge-low-stock'}">
            ROI: ${health.roiPercentage}%
          </span>
        </div>

        <!-- Barra de Recuperación de Capital Invertido -->
        <div class="bg-slate-900/80 p-3 rounded-xl border border-slate-700/60 mb-3">
          <div class="flex items-center justify-between text-xs mb-1">
            <span class="text-slate-300 font-semibold">Recuperación de Inversión Total (Break-Even):</span>
            <span class="font-black ${health.capitalRecoveryPercentage >= 100 ? 'text-emerald-400' : 'text-amber-400'}">
              ${health.capitalRecoveryPercentage}% recuperado
            </span>
          </div>
          <div class="progress-track mb-2">
            <div 
              class="${health.capitalRecoveryPercentage >= 100 ? 'progress-fill-emerald' : 'progress-fill-amber'}" 
              style="width: ${Math.min(100, health.capitalRecoveryPercentage)}%"
            ></div>
          </div>
          <div class="flex flex-wrap items-center justify-between text-[11px] text-slate-400 gap-2">
            <span>Capital Total Invertido: <strong class="text-white">${health.totalCapitalInvested.toFixed(2)}€</strong></span>
            <span>Recuperado en Ventas: <strong class="text-emerald-400">${health.capitalRecovered.toFixed(2)}€</strong></span>
            <span>
              Balance Caja: 
              <strong class="${health.netCashBalance >= 0 ? 'text-emerald-400' : 'text-amber-400'}">
                ${health.netCashBalance >= 0 ? `+${health.netCashBalance.toFixed(2)}€ limpio` : `${health.netCashBalance.toFixed(2)}€ por cubrir`}
              </strong>
            </span>
          </div>
        </div>

        <!-- Proyección Total al vender todo el stock actual -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-center">
          <div class="bg-slate-900/70 p-3 rounded-xl border border-slate-800">
            <div class="text-[10px] text-slate-400 uppercase font-semibold">Stock Actual por Vender</div>
            <div class="text-base font-black text-white mt-0.5">${health.currentStockRetailValue.toFixed(2)}€ PVP</div>
            <div class="text-[10px] text-emerald-400">${health.currentTotalStockUnits} uds (+${health.currentStockPotentialProfit.toFixed(2)}€ pot.)</div>
          </div>

          <div class="bg-indigo-950/30 p-3 rounded-xl border border-indigo-500/30">
            <div class="text-[10px] text-indigo-300 uppercase font-semibold">Facturación Total Proyectada</div>
            <div class="text-base font-black text-white mt-0.5">${health.totalProjectedRevenue.toFixed(2)}€</div>
            <div class="text-[10px] text-indigo-300/80">Vendido + Stock actual</div>
          </div>

          <div class="bg-emerald-950/35 p-3 rounded-xl border border-emerald-500/30">
            <div class="text-[10px] text-emerald-300 uppercase font-semibold">Beneficio Total Proyectado</div>
            <div class="text-base font-black text-emerald-400 mt-0.5">+${health.totalProjectedProfit.toFixed(2)}€</div>
            <div class="text-[10px] text-emerald-300/80">Rotación global: ${health.globalSellThroughRate}%</div>
          </div>
        </div>
      </div>

      <!-- 5. EVOLUCIÓN DE ÚLTIMOS 7 DÍAS Y RITMO DE VENTA (velocityMetrics) -->
      <div class="ios-card mb-4">
        <div class="flex items-center justify-between mb-2">
          <div>
            <h3 class="text-sm font-black uppercase tracking-wider text-white flex items-center gap-1.5">
              <span>⚡</span> Evolución Últimos 7 Días y Ritmo de Venta
            </h3>
            <span class="text-[11px] text-slate-400">Tendencia diaria (${activeFilterTitle})</span>
          </div>
          <span class="badge badge-warehouse text-[10px]">${vel.activeDaysCount} días activos</span>
        </div>

        <!-- Gráfica de Barras CSS de 7 Días -->
        <div class="bg-slate-900/75 p-3 rounded-2xl border border-slate-800 mb-3">
          <div class="chart-7days-grid">
            ${vel.last7DaysTrend.map((d, idx) => {
              const heightPct = d.billed > 0 ? Math.max(10, Math.round((d.billed / maxDayBilled) * 100)) : 4;
              const isToday = idx === vel.last7DaysTrend.length - 1;
              return `
                <div class="chart-col">
                  <div class="text-[9px] font-bold ${d.billed > 0 ? 'text-white' : 'text-slate-600'} mb-1">
                    ${d.billed > 0 ? `${d.billed.toFixed(0)}€` : '0€'}
                  </div>
                  <div class="chart-bar-wrap">
                    <div class="chart-bar ${isToday ? 'today' : ''}" style="height: ${heightPct}%" title="${d.dayLabel}: ${d.billed.toFixed(2)}€ (${d.units} uds)"></div>
                  </div>
                  <div class="text-[9px] ${isToday ? 'text-emerald-400 font-bold' : 'text-slate-400'} mt-1.5 truncate max-w-full">
                    ${this._escapeHtml(d.dayLabel)}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Indicadores de Velocidad y Hábitos -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          <div class="bg-slate-900/70 p-2.5 rounded-xl border border-slate-800">
            <div class="text-[10px] text-slate-400">Media por Día Activo</div>
            <div class="text-sm font-black text-white">${vel.dailyAverageBilled.toFixed(2)}€/día</div>
            <div class="text-[10px] text-emerald-400">+${vel.dailyAverageProfit.toFixed(2)}€ (${vel.dailyAverageUnits} uds)</div>
          </div>

          <div class="bg-slate-900/70 p-2.5 rounded-xl border border-slate-800">
            <div class="text-[10px] text-slate-400">Proyección Mensual (30d)</div>
            <div class="text-sm font-black text-indigo-300">${vel.projectedMonthlyBilled.toFixed(0)}€/mes</div>
            <div class="text-[10px] text-emerald-400">+${vel.projectedMonthlyProfit.toFixed(0)}€ benef. est.</div>
          </div>

          <div class="bg-slate-900/70 p-2.5 rounded-xl border border-slate-800">
            <div class="text-[10px] text-slate-400">⏰ Hora Punta Ventas</div>
            <div class="text-sm font-black text-white mt-0.5">${this._escapeHtml(vel.peakHourLabel)}</div>
            <div class="text-[10px] text-slate-500">Mayor actividad</div>
          </div>

          <div class="bg-slate-900/70 p-2.5 rounded-xl border border-slate-800">
            <div class="text-[10px] text-slate-400">📅 Mejor Día Semana</div>
            <div class="text-sm font-black text-emerald-300 mt-0.5">${this._escapeHtml(vel.bestDayOfWeek)}</div>
            <div class="text-[10px] text-slate-500">Récord facturación</div>
          </div>
        </div>
      </div>

      <!-- 6. MÉTODOS DE PAGO, TOP SABORES, ROTACIÓN LENTA Y ALERTAS -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <!-- Desglose de Métodos de Pago del Periodo -->
        <div class="ios-card mb-0">
          <div class="flex justify-between items-center mb-2">
            <span class="text-xs font-bold uppercase tracking-wider text-slate-300">💳 Efectivo vs Tarjeta (${timeframeLabels[this.analyticsTimeframe]})</span>
            <span class="text-xs text-slate-400">${data.totalBilled.toFixed(2)}€</span>
          </div>

          <div class="ratio-bar">
            <div class="ratio-segment-cash" style="width: ${data.paymentMethods.Efectivo.percentage}%"></div>
            <div class="ratio-segment-card" style="width: ${data.paymentMethods.Tarjeta.percentage}%"></div>
          </div>

          <div class="grid grid-cols-2 gap-3 mt-3 pt-2 border-t border-slate-700/50">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="w-3 h-3 rounded-full bg-emerald-500 inline-block"></span>
                <span class="text-xs font-medium text-slate-300">💵 Efectivo</span>
              </div>
              <div class="text-right">
                <div class="text-xs font-bold text-white">${data.paymentMethods.Efectivo.billed.toFixed(2)}€</div>
                <div class="text-[10px] text-emerald-400 font-medium">${data.paymentMethods.Efectivo.percentage}% (${data.paymentMethods.Efectivo.count})</div>
              </div>
            </div>

            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="w-3 h-3 rounded-full bg-indigo-500 inline-block"></span>
                <span class="text-xs font-medium text-slate-300">💳 Tarjeta</span>
              </div>
              <div class="text-right">
                <div class="text-xs font-bold text-white">${data.paymentMethods.Tarjeta.billed.toFixed(2)}€</div>
                <div class="text-[10px] text-indigo-400 font-medium">${data.paymentMethods.Tarjeta.percentage}% (${data.paymentMethods.Tarjeta.count})</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Top Sabores Más Vendidos -->
        <div class="ios-card mb-0">
          <div class="text-xs font-bold uppercase tracking-wider text-slate-300 mb-2.5">
            🔥 Top Sabores Más Vendidos (${timeframeLabels[this.analyticsTimeframe]})
          </div>
          ${data.topProducts.length > 0 ? `
            <div class="space-y-2">
              ${data.topProducts.map((tp, idx) => `
                <div class="text-xs py-1 border-b border-slate-800/80 last:border-0">
                  <div class="flex items-center justify-between mb-1">
                    <div class="flex items-center gap-2 min-w-0">
                      <span class="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center font-bold text-[10px] flex-shrink-0">#${idx + 1}</span>
                      <span class="font-bold text-white truncate">${this._escapeHtml(tp.name)}</span>
                    </div>
                    <div class="text-right flex-shrink-0">
                      <span class="font-black text-white">${tp.unitsSold} uds</span>
                      <span class="text-slate-400 ml-1">(${tp.revenue.toFixed(0)}€)</span>
                      <span class="text-emerald-400 font-bold ml-1.5">+${tp.profit.toFixed(2)}€</span>
                    </div>
                  </div>
                  <div class="progress-track" style="height:5px;">
                    <div class="progress-fill-emerald" style="width: ${Math.min(100, tp.shareOfRevenue)}%"></div>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : `
            <div class="text-xs text-slate-500 py-6 text-center">Sin ventas registradas en este periodo</div>
          `}
        </div>
      </div>

      <!-- Menor Rotación y Alertas de Reposición -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div class="ios-card mb-0">
          <div class="text-xs font-bold uppercase tracking-wider text-slate-300 mb-2.5">
            🐢 Sabores con Menor Rotación (Stock Retenido)
          </div>
          ${data.slowMovingProducts.length > 0 ? `
            <div class="space-y-2">
              ${data.slowMovingProducts.map(sp => `
                <div class="flex items-center justify-between text-xs py-1 border-b border-slate-800/80 last:border-0">
                  <div class="min-w-0 pr-2">
                    <div class="font-semibold text-white truncate">${this._escapeHtml(sp.name)}</div>
                    <div class="text-[10px] text-slate-400">Vendidas: ${sp.unitsSold} uds • Rotación: ${sp.sellThroughRate}%</div>
                  </div>
                  <div class="text-right flex-shrink-0">
                    <span class="badge badge-warehouse">${sp.currentStock} uds en stock</span>
                    <div class="text-[10px] text-slate-400 mt-0.5">PVP: ${sp.stockRetailValue.toFixed(0)}€</div>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : `
            <div class="text-xs text-slate-500 py-4 text-center">No hay stock retenido</div>
          `}
        </div>

        <div class="ios-card mb-0">
          <div class="text-xs font-bold uppercase tracking-wider text-slate-300 mb-2.5">
            ⚠️ Alertas de Stock Bajo / Agotado
          </div>
          ${data.lowStockAlerts.length > 0 ? `
            <div class="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              ${data.lowStockAlerts.map(al => `
                <div class="flex items-center justify-between text-xs py-1.5 px-2.5 rounded-xl bg-slate-900/75 border border-slate-800">
                  <div class="min-w-0 pr-2">
                    <div class="font-bold text-white truncate">${this._escapeHtml(al.productName)}</div>
                    <div class="text-[10px] text-slate-400">${this._escapeHtml(al.warehouseName)} • Global: ${al.globalStock} uds</div>
                  </div>
                  <span class="badge badge-low-stock flex-shrink-0">
                    ${al.status === 'out' ? '❌ Agotado (0)' : `⚠️ Quedan ${al.stock}`}
                  </span>
                </div>
              `).join('')}
            </div>
          ` : `
            <div class="text-xs text-emerald-400 py-6 text-center font-semibold">
              ✅ Todos los sabores tienen buen nivel de stock
            </div>
          `}
        </div>
      </div>

      <!-- Historial de Ventas Recientes del Periodo -->
      <div class="mb-4">
        <div class="flex items-center justify-between mb-2 px-1">
          <span class="text-xs font-bold uppercase tracking-wider text-slate-300">🕒 Últimas Ventas del Periodo</span>
          <span class="text-xs text-slate-400">${data.recentSales.length} mostradas</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-2 pb-10">
    `;

    const whMap = new Map(warehouses.map(w => [w.id, w]));

    if (data.recentSales.length === 0) {
      html += `
        <div class="col-span-full ios-card text-center py-8 text-slate-400 text-sm">
          No hay transacciones registradas en este filtro.
        </div>
      `;
    } else {
      data.recentSales.forEach(s => {
        const timeFormatted = new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateFormatted = new Date(s.timestamp).toLocaleDateString([], { day: '2-digit', month: '2-digit' });
        const isCard = s.paymentMethod === 'Tarjeta';
        const isPending = s.paymentStatus === 'pending';
        const wh = whMap.get(s.warehouseId);
        const whIcon = wh ? wh.icon : '🏠';
        const whName = s.warehouseName || (wh ? wh.name : 'Mi Almacén (Principal)');

        html += `
          <div class="ios-card flex items-start justify-between p-3.5 mb-0 ${isPending ? 'border-amber-500/45' : ''}">
            <div class="flex-1 min-w-0 pr-2">
              <div class="flex flex-wrap items-center gap-1.5 mb-1">
                ${isPending ? `
                  <span class="badge badge-fiado">⏳ FIADO</span>
                ` : `
                  <span class="badge ${isCard ? 'badge-payment-card' : 'badge-payment-cash'}">
                    ${isCard ? '💳 Tarjeta' : '💵 Efectivo'}
                  </span>
                `}
                <span class="badge badge-warehouse text-[10px]">
                  ${whIcon} ${this._escapeHtml(whName)}
                </span>
                <span class="text-[10px] text-slate-400">${dateFormatted} • ${timeFormatted}</span>
              </div>
              <h5 class="text-sm font-bold text-white truncate">${this._escapeHtml(s.productName)}</h5>
              <div class="text-xs text-slate-400">
                ${s.quantity} x ${s.unitPrice.toFixed(2)}€
              </div>
              ${s.buyerName ? `<div class="text-[11px] text-indigo-300 font-semibold mt-0.5">👤 ${this._escapeHtml(s.buyerName)}</div>` : ''}
              ${s.notes ? `<div class="text-[11px] text-slate-300 mt-0.5">📝 ${this._escapeHtml(s.notes)}</div>` : ''}
            </div>

            <div class="text-right flex flex-col items-end flex-shrink-0 gap-1">
              <div class="text-base font-black text-white leading-none">${s.grossTotal.toFixed(2)}€</div>
              <div class="text-xs text-emerald-400 font-bold">+${s.netProfit.toFixed(2)}€</div>
              ${isPending ? `
                <div class="flex gap-1 mt-0.5">
                  <button onclick="window.app.markPendingSalePaid('${s.id}', 'Efectivo')" class="btn-pressable bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.5 rounded text-[9px] font-bold">💵 Cobrar</button>
                  <button onclick="window.app.markPendingSalePaid('${s.id}', 'Tarjeta')" class="btn-pressable bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-1.5 py-0.5 rounded text-[9px] font-bold">💳</button>
                </div>
              ` : ''}
              <div class="flex items-center gap-2 mt-0.5">
                <button 
                  onclick="window.app.openEditSaleNotesModal('${s.id}')"
                  class="btn-pressable text-[10px] text-slate-300 hover:text-white underline"
                >
                  ✏️ Nota
                </button>
                <button 
                  onclick="window.app.revertSaleAction('${s.id}')"
                  class="btn-pressable text-[10px] text-rose-400 hover:text-rose-300 underline"
                >
                  Anular
                </button>
              </div>
            </div>
          </div>
        `;
      });
    }

    html += `
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  // -------------------------------------------------------------------------
  // CONSTRUCCIÓN DE LOS 5 NUEVOS BLOQUES DE ANALÍTICA AVANZADA
  // -------------------------------------------------------------------------
  _buildWorkerAccountsSectionHtml(workerAccounts) {
    if (!workerAccounts) return '';
    const workersList = workerAccounts.workerWarehousesOnly || [];

    return `
      <div class="ios-card ios-card-glow-emerald mb-4">
        <div class="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div>
            <h3 class="text-sm font-black uppercase tracking-wider text-white flex items-center gap-1.5">
              <span>🤝</span> Cuentas con Trabajadores: Liquidaciones y Vapers de Regalo
            </h3>
            <p class="text-[11px] text-slate-300 mt-0.5">
              Controla cuánto dinero te tiene que entregar cada trabajador y cuántos vapers gratis le corresponden por comisión.
            </p>
          </div>
          <button 
            type="button"
            onclick="window.app.openWarehouseModal()"
            class="btn-pressable bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 px-2.5 py-1.5 rounded-xl text-[11px] font-bold"
          >+ Nuevo Trabajador</button>
        </div>

        <!-- Resumen Global de Trabajadores Secundarios -->
        <div class="grid grid-cols-2 gap-2.5 mb-3">
          <div class="bg-slate-950/65 p-3 rounded-xl border border-amber-500/35">
            <div class="text-[10px] text-amber-300 uppercase font-bold">💶 Dinero en Manos de Trabajadores</div>
            <div class="text-xl font-black text-white mt-0.5">${workerAccounts.totalPendingMoneyFromWorkers.toFixed(2)}€</div>
            <div class="text-[10px] text-slate-400">Pendiente de entregarte a ti</div>
          </div>

          <div class="bg-slate-950/65 p-3 rounded-xl border border-emerald-500/35">
            <div class="text-[10px] text-emerald-300 uppercase font-bold">🎁 Vapers de Regalo Pendientes</div>
            <div class="text-xl font-black text-emerald-400 mt-0.5">${workerAccounts.totalPendingFreeVapersAllWorkers} vaper(s)</div>
            <div class="text-[10px] text-slate-400">Ganados por tus trabajadores</div>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          ${workersList.length === 0 ? `
            <div class="col-span-full bg-slate-900/70 p-4 rounded-2xl border border-slate-800 text-center text-xs text-slate-400">
              Aún no has creado almacenes de trabajadores secundarios. Pulsa <strong>+ Nuevo Trabajador</strong> para empezar.
            </div>
          ` : workersList.map(w => `
            <div class="bg-slate-900/90 p-3.5 rounded-2xl border ${w.pendingFreeVapers > 0 ? 'border-emerald-500/50' : 'border-slate-700/70'}">
              <div class="flex items-start justify-between gap-2 mb-2.5">
                <div class="flex items-center gap-2">
                  <span class="text-xl">${w.icon || '👤'}</span>
                  <div>
                    <h4 class="text-sm font-black text-white">${this._escapeHtml(w.name)}</h4>
                    <div class="text-[11px] text-slate-300">
                      ${w.workerName ? `👤 ${this._escapeHtml(w.workerName)} • ` : ''}Vendidos: <strong>${w.allTimeUnitsSold} uds</strong>
                    </div>
                  </div>
                </div>
                <button 
                  type="button"
                  onclick="window.app.openWarehouseModal('${w.warehouseId}')"
                  class="btn-pressable bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2 py-1 rounded-lg text-[10px] font-bold"
                  title="Cambiar regla de comisión de este trabajador"
                >⚙️ ${w.rewardFreeUnits} gratis / ${w.rewardEveryNUnits} uds</button>
              </div>

              <!-- Recuadro Destacado de Vapers de Regalo -->
              <div class="bg-emerald-950/35 p-3 rounded-xl border border-emerald-500/30 mb-2.5">
                <div class="flex items-center justify-between mb-1">
                  <span class="text-xs font-extrabold text-emerald-300">🎁 Le tienes que regalar:</span>
                  <span class="text-base font-black ${w.pendingFreeVapers > 0 ? 'text-emerald-400 animate-pulse' : 'text-slate-300'}">
                    ${w.pendingFreeVapers} ${w.pendingFreeVapers === 1 ? 'vaper' : 'vapers'}
                  </span>
                </div>
                <div class="flex items-center justify-between text-[10px] text-slate-300 mb-2">
                  <span>Ganados total: <strong>${w.earnedFreeVapers}</strong></span>
                  <span>Ya entregados: <strong>${w.deliveredFreeVapers}</strong></span>
                </div>

                <!-- Barra de progreso hacia el próximo vaper gratis -->
                <div class="text-[10px] text-slate-300 mb-1 flex justify-between">
                  <span>Progreso próximo regalo: <strong>${w.unitsTowardNextFreeVaper}/${w.rewardEveryNUnits} vendidos</strong></span>
                  <span class="text-emerald-300 font-semibold">Faltan ${w.unitsNeededForNextFreeVaper} uds</span>
                </div>
                <div class="progress-track mb-2.5">
                  <div class="progress-fill-emerald" style="width: ${Math.min(100, w.nextFreeVaperProgressPct)}%"></div>
                </div>

                <button 
                  type="button"
                  onclick="window.app.openDeliverRewardModal('${w.warehouseId}', ${Math.max(1, w.pendingFreeVapers)})"
                  class="btn-pressable w-full py-2 px-3 rounded-xl bg-emerald-500/25 hover:bg-emerald-500/35 border border-emerald-500/50 text-emerald-200 text-xs font-bold flex items-center justify-center gap-1.5"
                >
                  <span>🎁</span> Entregar Vaper Gratis a ${this._escapeHtml(w.workerName || w.name)}
                </button>
              </div>

              <!-- Recuadro de Liquidación de Dinero -->
              <div class="bg-slate-950/65 p-3 rounded-xl border border-slate-800">
                <div class="flex items-center justify-between mb-1">
                  <span class="text-xs font-bold text-slate-300">💶 Pendiente de entregarte:</span>
                  <span class="text-base font-black ${w.pendingMoneyToDeliver > 0 ? 'text-amber-400' : 'text-emerald-400'}">
                    ${w.pendingMoneyToDeliver.toFixed(2)}€
                  </span>
                </div>
                <div class="flex flex-wrap items-center justify-between text-[10px] text-slate-400 mb-2.5 gap-1">
                  <span>Recaudado: <strong class="text-white">${w.totalCollectedPaid.toFixed(2)}€</strong> (💵 ${w.collectedCash.toFixed(0)}€ / 💳 ${w.collectedCard.toFixed(0)}€)</span>
                  <span>Liquidado: <strong class="text-emerald-400">${w.cashSettledAmount.toFixed(2)}€</strong></span>
                </div>

                <button 
                  type="button"
                  onclick="window.app.openSettleCashModal('${w.warehouseId}', ${w.pendingMoneyToDeliver})"
                  class="btn-pressable w-full py-2 px-3 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-200 text-xs font-bold flex items-center justify-center gap-1.5"
                >
                  <span>💶</span> Recibir / Liquidar Dinero
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  _buildDebtsAndReservationsSectionHtml(dr) {
    if (!dr) return '';
    const debtors = dr.debtorsByCustomer || [];
    const reservations = dr.activeReservations || [];

    return `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <!-- Control de Fiados / Deudas Pendientes -->
        <div class="ios-card ios-card-glow-amber mb-0">
          <div class="flex items-center justify-between mb-2">
            <div>
              <h3 class="text-xs font-black uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                <span>⏳</span> Control de "Fiados" (Pendientes de Cobro)
              </h3>
              <span class="text-[10px] text-slate-300">${dr.pendingDebtUnits} uds entregadas pendientes de pago</span>
            </div>
            <span class="badge badge-fiado text-xs font-black">${dr.totalPendingDebtAmount.toFixed(2)}€</span>
          </div>

          ${debtors.length === 0 ? `
            <div class="text-xs text-emerald-400 py-6 text-center font-semibold bg-slate-950/40 rounded-xl border border-slate-800/80">
              ✅ No hay ninguna deuda ni venta fiada pendiente de cobro
            </div>
          ` : `
            <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
              ${debtors.map(d => `
                <div class="bg-slate-950/70 p-2.5 rounded-xl border border-amber-500/35">
                  <div class="flex items-center justify-between mb-1.5">
                    <span class="text-xs font-black text-white">👤 ${this._escapeHtml(d.customerName)}</span>
                    <span class="text-xs font-black text-amber-400">Debe: ${d.totalDebt.toFixed(2)}€ (${d.totalUnits} uds)</span>
                  </div>
                  <div class="space-y-1.5">
                    ${d.sales.map(s => `
                      <div class="flex items-center justify-between text-[11px] bg-slate-900/90 px-2.5 py-1.5 rounded-lg border border-slate-800">
                        <div class="min-w-0 pr-2">
                          <div class="font-semibold text-slate-200 truncate">${s.quantity}x ${this._escapeHtml(s.productName)} (${s.grossTotal.toFixed(2)}€)</div>
                          <div class="text-[10px] text-slate-400">${this._escapeHtml(s.warehouseName)}${s.notes ? ` • 📝 ${this._escapeHtml(s.notes)}` : ''}</div>
                        </div>
                        <div class="flex items-center gap-1 flex-shrink-0">
                          <button onclick="window.app.markPendingSalePaid('${s.id}', 'Efectivo')" class="btn-pressable bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-1 rounded text-[10px] font-bold">💵 Efec.</button>
                          <button onclick="window.app.markPendingSalePaid('${s.id}', 'Tarjeta')" class="btn-pressable bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-2 py-1 rounded text-[10px] font-bold">💳 Tarj.</button>
                        </div>
                      </div>
                    `).join('')}
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>

        <!-- Control de Reservas Activas -->
        <div class="ios-card border-purple-500/35 bg-gradient-to-br from-purple-950/30 to-slate-900 mb-0">
          <div class="flex items-center justify-between mb-2">
            <div>
              <h3 class="text-xs font-black uppercase tracking-wider text-purple-300 flex items-center gap-1.5">
                <span>📌</span> Reservas Activas (${reservations.length})
              </h3>
              <span class="text-[10px] text-slate-300">${dr.totalReservedUnits} uds apartadas (${dr.totalReservedValue.toFixed(2)}€)</span>
            </div>
            <button 
              type="button"
              onclick="window.app.openReservationModal()"
              class="btn-pressable bg-purple-600/30 hover:bg-purple-600/45 text-purple-200 border border-purple-500/40 px-2.5 py-1 rounded-xl text-[10px] font-bold"
            >+ Reservar</button>
          </div>

          ${reservations.length === 0 ? `
            <div class="text-xs text-slate-400 py-6 text-center bg-slate-950/40 rounded-xl border border-slate-800/80">
              No hay unidades reservadas actualmente.
            </div>
          ` : `
            <div class="space-y-1.5 max-h-60 overflow-y-auto pr-1">
              ${reservations.map(r => `
                <div class="bg-slate-950/70 p-2.5 rounded-xl border border-purple-500/30 flex items-center justify-between gap-2 text-xs">
                  <div class="min-w-0 flex-1">
                    <div class="font-bold text-white truncate">👤 ${this._escapeHtml(r.customerName)} • ${r.quantity}x ${this._escapeHtml(r.productName)}</div>
                    <div class="text-[10px] text-slate-400">
                      ${this._escapeHtml(r.warehouseName)} • ${(r.quantity * (r.agreedUnitPrice || 12)).toFixed(2)}€
                      ${r.notes ? ` • 📝 ${this._escapeHtml(r.notes)}` : ''}
                    </div>
                  </div>
                  <div class="flex items-center gap-1 flex-shrink-0">
                    <button onclick="window.app.completeReservationQuick('${r.id}', 'Efectivo')" class="btn-pressable bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-1 rounded text-[10px] font-bold">💵 Cobrar</button>
                    <button onclick="window.app.completeReservationQuick('${r.id}', 'Tarjeta')" class="btn-pressable bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-2 py-1 rounded text-[10px] font-bold">💳</button>
                    <button onclick="window.app.cancelReservationAction('${r.id}')" class="btn-pressable text-rose-400 px-1.5 py-1 text-xs font-bold">✕</button>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    `;
  }

  _buildDiscountMetricsSectionHtml(dm, periodLabel) {
    if (!dm) return '';
    return `
      <div class="ios-card mb-4">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h3 class="text-sm font-black uppercase tracking-wider text-white flex items-center gap-1.5">
              <span>🏷️</span> Control de Descuentos y Precio Medio por Trabajador
            </h3>
            <p class="text-[11px] text-slate-400">
              Detecta cuánto beneficio se escapa por rebajas respecto al PVP oficial (12,00€)
            </p>
          </div>
          <span class="badge ${dm.allTimeTotalDiscount > 0 ? 'badge-fiado' : 'badge-ok-stock'} text-[10px]">
            Histórico descontado: -${dm.allTimeTotalDiscount.toFixed(2)}€
          </span>
        </div>

        <div class="grid grid-cols-3 gap-2 text-center mb-3">
          <div class="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
            <div class="text-[10px] text-slate-400">Descontado (${periodLabel})</div>
            <div class="text-base font-black ${dm.periodTotalDiscount > 0 ? 'text-amber-400' : 'text-emerald-400'}">-${dm.periodTotalDiscount.toFixed(2)}€</div>
            <div class="text-[9px] text-slate-500">${dm.periodDiscountPct}% sobre PVP teórico</div>
          </div>
          <div class="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
            <div class="text-[10px] text-slate-400">Uds. con Descuento</div>
            <div class="text-base font-black text-white">${dm.periodDiscountedUnits} uds</div>
            <div class="text-[9px] text-slate-500">${dm.periodDiscountedTransactions} ventas rebajadas</div>
          </div>
          <div class="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
            <div class="text-[10px] text-slate-400">Uds. a PVP Completo</div>
            <div class="text-base font-black text-emerald-400">${dm.periodFullPriceUnits} uds</div>
            <div class="text-[9px] text-slate-500">Sin rebaja</div>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
          ${(dm.byWarehouse || []).map(w => `
            <div class="bg-slate-900/85 p-2.5 rounded-xl border border-slate-800 flex items-center justify-between">
              <div class="min-w-0 pr-2">
                <div class="text-xs font-bold text-white truncate">${w.icon || '🏠'} ${this._escapeHtml(w.name)}</div>
                <div class="text-[10px] text-slate-400">
                  Rebajadas: <strong>${w.discountedUnits} uds</strong> (${w.discountedSalesPct}% ventas)
                </div>
              </div>
              <div class="text-right flex-shrink-0">
                <div class="text-xs font-black ${w.avgRealUnitPrice < 11.5 ? 'text-amber-400' : 'text-emerald-400'}">
                  Media: ${w.avgRealUnitPrice.toFixed(2)}€/ud
                </div>
                <div class="text-[10px] text-slate-400">Desc: -${w.totalDiscountGiven.toFixed(2)}€</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  _buildFlavorIntelligenceSectionHtml(intelList) {
    if (!intelList || intelList.length === 0) return '';
    return `
      <div class="ios-card mb-4">
        <div class="flex items-center justify-between mb-3">
          <div>
            <h3 class="text-sm font-black uppercase tracking-wider text-white flex items-center gap-1.5">
              <span>🧭</span> Inteligencia de Sabores por Zona y Reposición Inteligente
            </h3>
            <p class="text-[11px] text-slate-400">
              Qué sabor triunfa en cada ubicación y qué sabores enviar a cada trabajador antes de que se quede sin ellos
            </p>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          ${intelList.map(wh => `
            <div class="bg-slate-900/85 p-3 rounded-2xl border border-slate-800">
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-1.5">
                  <span>${wh.icon || '🏠'}</span>
                  <span class="text-xs font-black text-white">${this._escapeHtml(wh.name)}</span>
                </div>
                <span class="text-[10px] text-slate-400">${wh.totalUnitsSold} uds vendidas</span>
              </div>

              ${wh.starFlavor ? `
                <div class="bg-emerald-950/35 px-3 py-2 rounded-xl border border-emerald-500/30 mb-2 flex items-center justify-between">
                  <div class="min-w-0 pr-2">
                    <div class="text-[9px] uppercase font-bold text-emerald-300">⭐ Sabor Estrella en esta zona</div>
                    <div class="text-xs font-bold text-white truncate">${this._escapeHtml(wh.starFlavor.name)}</div>
                  </div>
                  <div class="text-right flex-shrink-0">
                    <div class="text-xs font-black text-emerald-400">${wh.starFlavor.unitsSold} uds (${wh.starFlavor.sharePct}%)</div>
                    <div class="text-[9px] text-slate-400">Quedan ${wh.starFlavor.currentWhStock} aquí</div>
                  </div>
                </div>
              ` : `
                <div class="text-[11px] text-slate-500 py-2 text-center">Aún sin ventas registradas en esta ubicación</div>
              `}

              ${wh.smartRestockSuggestions && wh.smartRestockSuggestions.length > 0 ? `
                <div class="mt-2 pt-2 border-t border-slate-800">
                  <div class="text-[10px] uppercase font-bold text-indigo-300 mb-1.5">💡 Sugerencias de Reposición desde Principal:</div>
                  <div class="space-y-1.5">
                    ${wh.smartRestockSuggestions.map(sug => `
                      <div class="flex items-center justify-between bg-slate-950/70 px-2.5 py-1.5 rounded-xl border border-indigo-500/30 text-[11px]">
                        <div class="min-w-0 pr-2">
                          <div class="font-bold text-white truncate">${this._escapeHtml(sug.productName)}</div>
                          <div class="text-[9px] text-slate-400">${this._escapeHtml(sug.reason)}</div>
                        </div>
                        <button 
                          type="button"
                          onclick="window.app.openTransferModal('${sug.productId}', '${MAIN_WAREHOUSE_ID}', '${wh.warehouseId}', ${sug.suggestedTransferQty})"
                          class="btn-pressable bg-indigo-500/25 hover:bg-indigo-500/40 text-indigo-200 border border-indigo-500/40 px-2 py-1 rounded-lg text-[10px] font-bold flex-shrink-0"
                        >🚚 Enviar ${sug.suggestedTransferQty} uds</button>
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  _buildSalesHeatmapSectionHtml(hm, activeFilterTitle) {
    if (!hm || !hm.days) return '';
    this._lastHeatmapData = hm;
    const hotspots = hm.topHotspots || [];

    return `
      <div class="ios-card mb-4">
        <div class="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div>
            <h3 class="text-sm font-black uppercase tracking-wider text-white flex items-center gap-1.5">
              <span>🔥</span> Mapa de Calor de Ventas (Días × Horas)
            </h3>
            <p class="text-[11px] text-slate-400">
              Descubre qué días y a qué horas exactas se concentran tus ventas (${activeFilterTitle})
            </p>
          </div>
          ${hotspots.length > 0 ? `
            <span class="badge badge-ok-stock text-[10px]">
              🔥 Pico: ${this._escapeHtml(hotspots[0].dayShort)} ${this._escapeHtml(hotspots[0].slotLabel)} (${hotspots[0].units} uds)
            </span>
          ` : ''}
        </div>

        ${hotspots.length > 0 ? `
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
            ${hotspots.map((hs, idx) => `
              <div class="bg-slate-900/80 px-3 py-2 rounded-xl border border-emerald-500/30 flex items-center justify-between text-xs">
                <div>
                  <span class="text-[10px] text-emerald-400 font-bold">#${idx + 1} Momento Estrella</span>
                  <div class="font-black text-white">${this._escapeHtml(hs.dayName)} • ${this._escapeHtml(hs.slotLabel)}</div>
                </div>
                <div class="text-right">
                  <div class="font-black text-emerald-300">${hs.units} uds</div>
                  <div class="text-[10px] text-slate-400">${hs.billed.toFixed(0)}€</div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <div id="heatmapInspectorBar" class="ts-inspector-bar text-xs mb-2.5">
          <span class="text-slate-300">👆 Toca cualquier celda del mapa para ver cuántas unidades y euros se vendieron en esa franja.</span>
        </div>

        <div class="overflow-x-auto no-scrollbar">
          <div class="min-w-[420px]">
            <!-- Cabecera de franjas horarias -->
            <div class="heatmap-grid mb-1">
              <div></div>
              ${(hm.slotLabels || []).map(sl => `
                <div class="text-[9px] text-slate-400 font-bold text-center">${this._escapeHtml(sl)}</div>
              `).join('')}
            </div>

            <!-- Filas de Lun a Dom -->
            <div class="space-y-1">
              ${hm.days.map(dRow => `
                <div class="heatmap-grid">
                  <div class="text-[10px] font-bold text-slate-300">${this._escapeHtml(dRow.dayShort)}</div>
                  ${dRow.slots.map(cell => {
                    const pct = cell.intensityPct || 0;
                    let bgStyle = 'background: rgba(15, 23, 42, 0.75); color: #475569;';
                    if (cell.units > 0) {
                      if (pct >= 75) {
                        bgStyle = 'background: rgba(16, 185, 129, 0.85); color: #ffffff; border-color: #34d399;';
                      } else if (pct >= 40) {
                        bgStyle = 'background: rgba(16, 185, 129, 0.45); color: #ecfdf5;';
                      } else {
                        bgStyle = 'background: rgba(16, 185, 129, 0.2); color: #6ee7b7;';
                      }
                    }
                    return `
                      <div 
                        id="hmCell_${dRow.dayIndex}_${cell.slotIndex}"
                        class="heatmap-cell" 
                        style="${bgStyle}"
                        onclick="window.app.inspectHeatmapCell(${dRow.dayIndex}, ${cell.slotIndex})"
                      >
                        ${cell.units > 0 ? `${cell.units}u` : '·'}
                      </div>
                    `;
                  }).join('')}
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  inspectHeatmapCell(dayIdx, slotIdx) {
    const hm = this._lastHeatmapData;
    if (!hm || !hm.days || !hm.days[dayIdx]) return;
    const cell = hm.days[dayIdx].slots[slotIdx];
    if (!cell) return;
    document.querySelectorAll('.heatmap-cell.active').forEach(el => el.classList.remove('active'));
    document.getElementById(`hmCell_${dayIdx}_${slotIdx}`)?.classList.add('active');
    this._playChime('tap');
    const bar = document.getElementById('heatmapInspectorBar');
    if (bar) {
      bar.innerHTML = `
        <div class="flex items-center gap-2">
          <span class="badge badge-ok-stock text-[10px]">🔥 ${this._escapeHtml(cell.dayName)} (${this._escapeHtml(cell.slotLabel)})</span>
        </div>
        <div class="flex flex-wrap items-center gap-3 text-xs">
          <span>Unidades: <strong class="text-white">${cell.units} uds</strong></span>
          <span>Facturado: <strong class="text-emerald-400">${cell.billed.toFixed(2)}€</strong></span>
          <span>Beneficio: <strong class="text-emerald-300">+${cell.profit.toFixed(2)}€</strong> (${cell.transactions} ventas)</span>
        </div>
      `;
    }
  }

  // -------------------------------------------------------------------------
  // MODALES DE ACCIONES DE TRABAJADORES (VAPER DE REGALO, LIQUIDACIÓN Y NOTA)
  // -------------------------------------------------------------------------
  async openDeliverRewardModal(workerWarehouseId, suggestedCount = 1) {
    const [warehouse, products, warehouses] = await Promise.all([
      this.inventoryAgent.getWarehouse(workerWarehouseId),
      this.inventoryAgent.getProducts({ warehouseId: 'all' }),
      this.inventoryAgent.getWarehouses()
    ]);
    if (!warehouse) return;

    const modal = document.getElementById('workerActionModal');
    const body = document.getElementById('workerActionModalBody');
    if (!modal || !body) return;

    const renderProdOptions = (fromWhId, selectedProdId = 'none') => `
      <option value="none" ${selectedProdId === 'none' ? 'selected' : ''}>No descontar stock (solo anotar regalo entregado)</option>
      ${products.map(p => {
        const whSt = p.stockByWarehouse?.[fromWhId] || 0;
        return `<option value="${this._escapeHtml(p.id)}" ${p.id === selectedProdId ? 'selected' : ''}>Descontar: ${this._escapeHtml(p.name)} (Stock ahí: ${whSt} uds)</option>`;
      }).join('')}
    `;
    this._rewardModalProductsCache = products;

    body.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <div>
          <h3 class="text-base font-bold text-white">🎁 Entregar Vaper Gratis por Comisión</h3>
          <span class="text-xs text-slate-400">Trabajador: ${this._escapeHtml(warehouse.workerName || warehouse.name)}</span>
        </div>
        <button onclick="document.getElementById('workerActionModal').classList.remove('active')" class="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center font-bold">✕</button>
      </div>

      <form onsubmit="event.preventDefault(); window.app.confirmDeliverRewardVaper('${this._escJsAttr(warehouse.id)}');" class="space-y-3">
        <div>
          <label class="text-xs text-slate-300 font-bold block mb-1">Cuántos vapers gratis le entregas ahora:</label>
          <input 
            type="number" 
            id="rewardModalCount" 
            min="1" 
            value="${Math.max(1, parseInt(suggestedCount, 10) || 1)}" 
            class="w-full bg-slate-800 text-emerald-400 font-black text-center py-2.5 rounded-xl border border-slate-700 text-lg"
          />
        </div>

        <div>
          <label class="text-xs text-slate-300 font-bold block mb-1">¿Descontar el vaper de regalo del stock físico?</label>
          <select id="rewardModalProductId" class="w-full bg-slate-800 text-white px-3 py-2.5 rounded-xl border border-slate-700 text-xs font-semibold">
            ${renderProdOptions(warehouse.id, 'none')}
          </select>
        </div>

        <div>
          <label class="text-xs text-slate-300 font-bold block mb-1">Almacén del que sale el vaper de regalo:</label>
          <select id="rewardModalFromWh" onchange="window.app.onRewardModalFromWhChange()" class="w-full bg-slate-800 text-white px-3 py-2.5 rounded-xl border border-slate-700 text-xs font-semibold">
            ${warehouses.map(w => `
              <option value="${this._escapeHtml(w.id)}" ${w.id === warehouse.id ? 'selected' : ''}>
                ${this._escapeHtml(w.icon || '🏠')} ${this._escapeHtml(w.name)}
              </option>
            `).join('')}
          </select>
        </div>

        <div>
          <input 
            type="text" 
            id="rewardModalNotes" 
            placeholder="📝 Nota opcional (ej. Regalo por sus 10 ventas)..." 
            class="w-full bg-slate-800 text-white px-3 py-2 rounded-xl border border-slate-700 text-xs"
          />
        </div>

        <button type="submit" class="btn-primary btn-pressable">
          <span>🎁 Confirmar Entrega de Vaper Gratis</span>
        </button>
      </form>
    `;

    modal.classList.add('active');
    this._playChime('tap');
  }

  onRewardModalFromWhChange() {
    const fromWhId = document.getElementById('rewardModalFromWh')?.value || MAIN_WAREHOUSE_ID;
    const prodSelect = document.getElementById('rewardModalProductId');
    const products = this._rewardModalProductsCache || [];
    if (!prodSelect) return;
    const currentSel = prodSelect.value || 'none';
    prodSelect.innerHTML = `
      <option value="none" ${currentSel === 'none' ? 'selected' : ''}>No descontar stock (solo anotar regalo entregado)</option>
      ${products.map(p => {
        const whSt = p.stockByWarehouse?.[fromWhId] || 0;
        return `<option value="${this._escapeHtml(p.id)}" ${p.id === currentSel ? 'selected' : ''}>Descontar: ${this._escapeHtml(p.name)} (Stock ahí: ${whSt} uds)</option>`;
      }).join('')}
    `;
  }

  async confirmDeliverRewardVaper(workerWarehouseId) {
    const count = Math.max(1, parseInt(document.getElementById('rewardModalCount')?.value, 10) || 1);
    const productId = document.getElementById('rewardModalProductId')?.value || 'none';
    const fromWarehouseId = document.getElementById('rewardModalFromWh')?.value || MAIN_WAREHOUSE_ID;
    const notes = document.getElementById('rewardModalNotes')?.value || '';

    try {
      const res = await this.inventoryAgent.deliverWorkerRewardVaper({
        workerWarehouseId,
        count,
        productId: productId === 'none' ? null : productId,
        fromWarehouseId,
        notes
      });
      document.getElementById('workerActionModal')?.classList.remove('active');
      this._playChime('success');
      this.showToast(res.message, '🎁');
      this.scheduleCloudSnapshotPublish();
      await this.renderCurrentTab();
    } catch (err) {
      alert(`No se pudo registrar: ${err.message}`);
    }
  }

  async openSettleCashModal(workerWarehouseId, pendingAmount = 0) {
    const warehouse = await this.inventoryAgent.getWarehouse(workerWarehouseId);
    if (!warehouse) return;

    const modal = document.getElementById('workerActionModal');
    const body = document.getElementById('workerActionModalBody');
    if (!modal || !body) return;

    const defaultVal = pendingAmount > 0 ? pendingAmount.toFixed(2) : '';

    body.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <div>
          <h3 class="text-base font-bold text-white">💶 Recibir / Liquidar Dinero de Trabajador</h3>
          <span class="text-xs text-slate-400">${this._escapeHtml(warehouse.name)} (${this._escapeHtml(warehouse.workerName || 'Trabajador')})</span>
        </div>
        <button onclick="document.getElementById('workerActionModal').classList.remove('active')" class="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center font-bold">✕</button>
      </div>

      <form onsubmit="event.preventDefault(); window.app.confirmSettleWorkerCash('${warehouse.id}');" class="space-y-3">
        <div class="bg-slate-900/90 p-3 rounded-xl border border-slate-800 text-xs flex justify-between">
          <span class="text-slate-400">Pendiente actual de entregarte:</span>
          <strong class="text-amber-400">${pendingAmount.toFixed(2)}€</strong>
        </div>

        <div>
          <label class="text-xs text-slate-300 font-bold block mb-1">Importe que te entrega ahora (€) *</label>
          <input 
            type="number" 
            step="0.01" 
            id="settleModalAmount" 
            required 
            value="${defaultVal}" 
            placeholder="0.00" 
            class="w-full bg-slate-800 text-white font-black text-center py-2.5 rounded-xl border border-slate-700 text-lg focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div>
          <input 
            type="text" 
            id="settleModalNotes" 
            placeholder="📝 Nota opcional (ej. Entregado en mano / Bizum)..." 
            class="w-full bg-slate-800 text-white px-3 py-2 rounded-xl border border-slate-700 text-xs"
          />
        </div>

        <button type="submit" class="btn-primary btn-pressable">
          <span>💶 Confirmar Recepción de Dinero</span>
        </button>
      </form>
    `;

    modal.classList.add('active');
    this._playChime('tap');
  }

  async confirmSettleWorkerCash(workerWarehouseId) {
    const amount = parseFloat(document.getElementById('settleModalAmount')?.value);
    const notes = document.getElementById('settleModalNotes')?.value || '';

    try {
      const res = await this.inventoryAgent.settleWorkerCash({
        workerWarehouseId,
        amount,
        notes
      });
      document.getElementById('workerActionModal')?.classList.remove('active');
      this._playChime('success');
      this.showToast(res.message, '💶');
      this.scheduleCloudSnapshotPublish();
      await this.renderCurrentTab();
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  }

  async openEditSaleNotesModal(saleId) {
    const allSales = await this.storageAgent.getAllSales();
    const sale = allSales.find(s => s.id === saleId);
    if (!sale) return;

    const modal = document.getElementById('workerActionModal');
    const body = document.getElementById('workerActionModalBody');
    if (!modal || !body) return;

    body.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <div>
          <h3 class="text-base font-bold text-white">✏️ Editar Cliente y Nota de Venta</h3>
          <span class="text-xs text-slate-400">${sale.quantity}x ${this._escapeHtml(sale.productName)} (${sale.grossTotal.toFixed(2)}€)</span>
        </div>
        <button onclick="document.getElementById('workerActionModal').classList.remove('active')" class="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center font-bold">✕</button>
      </div>

      <form onsubmit="event.preventDefault(); window.app.confirmEditSaleNotes('${sale.id}');" class="space-y-3">
        <div>
          <label class="text-xs text-slate-300 font-bold block mb-1">👤 Cliente / Comprador</label>
          <input 
            type="text" 
            id="editSaleBuyerInput" 
            value="${this._escapeHtml(sale.buyerName || '')}" 
            placeholder="Nombre del comprador..." 
            class="w-full bg-slate-800 text-white px-3.5 py-2.5 rounded-xl border border-slate-700 text-sm"
          />
        </div>

        <div>
          <label class="text-xs text-slate-300 font-bold block mb-1">📝 Nota concreta de la venta</label>
          <input 
            type="text" 
            id="editSaleNotesInput" 
            value="${this._escapeHtml(sale.notes || '')}" 
            placeholder="Información relevante, descuento, detalle..." 
            class="w-full bg-slate-800 text-white px-3.5 py-2.5 rounded-xl border border-slate-700 text-sm"
          />
        </div>

        <button type="submit" class="btn-primary btn-pressable">
          <span>Guardar Cambios</span>
        </button>
      </form>
    `;

    modal.classList.add('active');
    this._playChime('tap');
  }

  async confirmEditSaleNotes(saleId) {
    const buyerName = document.getElementById('editSaleBuyerInput')?.value || '';
    const notes = document.getElementById('editSaleNotesInput')?.value || '';

    try {
      const res = await this.salesAgent.updateSaleNotes(saleId, { buyerName, notes });
      if (this.lastCompletedSale && this.lastCompletedSale.id === saleId && res.sale) {
        this.lastCompletedSale = res.sale;
      }
      document.getElementById('workerActionModal')?.classList.remove('active');
      this._playChime('success');
      this.showToast(res.message, '✏️');
      this.scheduleCloudSnapshotPublish();
      if (document.getElementById('salesHistoryModal')?.classList.contains('active')) {
        await this.openSalesHistoryModal(true);
      }
      await this.renderCurrentTab();
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // CONSTRUCCIÓN E INTERACTIVIDAD DE GRÁFICAS SVG DE SERIES TEMPORALES
  // -------------------------------------------------------------------------
  _buildSmoothSvgPath(coords) {
    if (!coords || coords.length === 0) return '';
    if (coords.length === 1) return `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
    let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
    for (let i = 0; i < coords.length - 1; i++) {
      const p0 = coords[i];
      const p1 = coords[i + 1];
      const midX = ((p0.x + p1.x) / 2).toFixed(1);
      d += ` C ${midX} ${p0.y.toFixed(1)}, ${midX} ${p1.y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
    }
    return d;
  }

  _shouldShowXAxisLabel(idx, totalPoints) {
    if (totalPoints <= 12) return true;
    if (totalPoints === 24) return idx % 3 === 0 || idx === 23;
    if (totalPoints >= 28) return idx % 5 === 0 || idx === totalPoints - 1;
    return idx % 2 === 0 || idx === totalPoints - 1;
  }

  _buildRevenueTimeSeriesCardHtml(ts, activeFilterTitle) {
    if (!ts) return '';
    const scale = this.revenueChartScale || ts.defaultScale || 'daily7Days';
    const mode = this.revenueChartMode || 'interval'; // 'interval' | 'cumulative'
    const series = ts[scale] || ts.daily7Days || [];
    const meta = (ts.seriesMeta && ts.seriesMeta[scale]) || {
      maxBilled: 0,
      maxBilledLabel: 'Sin ventas',
      totalBilled: 0,
      totalProfit: 0,
      avgBilledPerPoint: 0,
      trendPercentageBilled: 0
    };

    const scaleLabels = {
      hourlyToday: 'Hoy (24h)',
      daily7Days: '7 Días',
      daily30Days: '30 Días',
      monthlyYear: '12 Meses'
    };

    // Determinar índice inspeccionado por defecto (último punto con actividad o el último de la serie)
    let activeIdx = this.revenueInspectedIdx;
    if (activeIdx === null || activeIdx === undefined || activeIdx < 0 || activeIdx >= series.length) {
      let lastActive = series.length - 1;
      for (let i = series.length - 1; i >= 0; i--) {
        if (series[i].billed > 0) {
          lastActive = i;
          break;
        }
      }
      activeIdx = Math.max(0, lastActive);
      this.revenueInspectedIdx = activeIdx;
    }

    const inspectedPt = series[activeIdx] || {
      label: '-',
      billed: 0,
      profit: 0,
      transactions: 0,
      cumulativeBilled: 0,
      cumulativeProfit: 0
    };

    // Geometría SVG
    const svgW = 640;
    const svgH = 195;
    const padLeft = 46;
    const padRight = 14;
    const padTop = 18;
    const padBottom = 28;
    const plotW = svgW - padLeft - padRight;
    const plotH = svgH - padTop - padBottom;
    const baseLineY = padTop + plotH;

    const valuesBilled = series.map(pt => (mode === 'cumulative' ? pt.cumulativeBilled : pt.billed));
    const valuesProfit = series.map(pt => (mode === 'cumulative' ? pt.cumulativeProfit : pt.profit));
    const rawMax = Math.max(10, ...valuesBilled);
    const maxY = rawMax * 1.12;

    const stepX = series.length > 1 ? plotW / (series.length - 1) : plotW;
    const colW = series.length > 0 ? plotW / series.length : plotW;

    const coordsBilled = series.map((pt, i) => {
      const val = valuesBilled[i] || 0;
      const x = series.length > 1 ? padLeft + i * stepX : padLeft + plotW / 2;
      const y = baseLineY - Math.min(1, Math.max(0, val / maxY)) * plotH;
      return { x, y, val, pt };
    });

    const coordsProfit = series.map((pt, i) => {
      const val = valuesProfit[i] || 0;
      const x = series.length > 1 ? padLeft + i * stepX : padLeft + plotW / 2;
      const y = baseLineY - Math.min(1, Math.max(0, val / maxY)) * plotH;
      return { x, y, val };
    });

    const linePathBilled = this._buildSmoothSvgPath(coordsBilled);
    const areaPathBilled = coordsBilled.length > 0
      ? `${linePathBilled} L ${coordsBilled[coordsBilled.length - 1].x.toFixed(1)} ${baseLineY} L ${coordsBilled[0].x.toFixed(1)} ${baseLineY} Z`
      : '';
    const linePathProfit = this._buildSmoothSvgPath(coordsProfit);

    const avgY = baseLineY - Math.min(1, Math.max(0, (meta.avgBilledPerPoint || 0) / maxY)) * plotH;
    const trendVal = meta.trendPercentageBilled || 0;
    const trendPositive = trendVal >= 0;

    return `
      <!-- GRÁFICA 1: FACTURACIÓN EN FUNCIÓN DEL TIEMPO (€) -->
      <div class="ios-card ios-card-glow-emerald mb-4">
        <div class="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div>
            <h3 class="text-sm font-black uppercase tracking-wider text-white flex items-center gap-1.5">
              <span>📈</span> Gráfica 1: Facturación en Función del Tiempo (€)
            </h3>
            <p class="text-[11px] text-slate-300 mt-0.5">
              Curva de ingresos y beneficio neto (${activeFilterTitle}) • Toca cualquier punto para inspeccionar
            </p>
          </div>
          <span class="badge ${trendPositive ? 'badge-ok-stock' : 'badge-low-stock'} text-[10px]">
            ${trendPositive ? '↗' : '↘'} ${trendPositive ? '+' : ''}${trendVal}% tendencia
          </span>
        </div>

        <!-- Controles de Escala y Modo -->
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div class="flex items-center gap-1 overflow-x-auto no-scrollbar">
            ${Object.entries(scaleLabels).map(([scKey, scLabel]) => `
              <button 
                type="button"
                onclick="window.app.setTimeSeriesScale('revenue', '${scKey}')"
                class="ts-mini-pill btn-pressable ${scale === scKey ? 'active-emerald' : ''}"
              >${scLabel}</button>
            `).join('')}
          </div>

          <div class="flex items-center gap-1">
            <button 
              type="button"
              onclick="window.app.setTimeSeriesMode('revenue', 'interval')"
              class="ts-mini-pill btn-pressable ${mode === 'interval' ? 'active-emerald' : ''}"
            >📊 Por Tramo</button>
            <button 
              type="button"
              onclick="window.app.setTimeSeriesMode('revenue', 'cumulative')"
              class="ts-mini-pill btn-pressable ${mode === 'cumulative' ? 'active-emerald' : ''}"
            >📈 Curva Acumulada</button>
          </div>
        </div>

        <!-- Resumen de KPIs de la Serie -->
        <div class="grid grid-cols-3 gap-2 text-center mb-3">
          <div class="bg-slate-950/60 p-2 rounded-xl border border-white/10">
            <div class="text-[9px] text-slate-400 uppercase font-bold">Total en Serie (${scaleLabels[scale]})</div>
            <div class="text-sm font-black text-white">${meta.totalBilled.toFixed(2)}€</div>
            <div class="text-[10px] text-emerald-400 font-semibold">+${meta.totalProfit.toFixed(2)}€ benef.</div>
          </div>
          <div class="bg-slate-950/60 p-2 rounded-xl border border-white/10">
            <div class="text-[9px] text-slate-400 uppercase font-bold">Pico Máximo</div>
            <div class="text-sm font-black text-emerald-300">${meta.maxBilled.toFixed(2)}€</div>
            <div class="text-[10px] text-slate-400 truncate">${this._escapeHtml(meta.maxBilledLabel)}</div>
          </div>
          <div class="bg-slate-950/60 p-2 rounded-xl border border-white/10">
            <div class="text-[9px] text-slate-400 uppercase font-bold">Media por Tramo</div>
            <div class="text-sm font-black text-indigo-300">${meta.avgBilledPerPoint.toFixed(2)}€</div>
            <div class="text-[10px] text-slate-400">Promedio</div>
          </div>
        </div>

        <!-- Panel Inspector Táctil del Punto Seleccionado -->
        <div id="revenueChartInspector" class="ts-inspector-bar">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block"></span>
            <span class="text-xs font-black text-white">${this._escapeHtml(inspectedPt.label)}</span>
            <span class="text-[10px] text-slate-400">(${inspectedPt.transactions} ${inspectedPt.transactions === 1 ? 'venta' : 'ventas'})</span>
          </div>
          <div class="flex flex-wrap items-center gap-3 text-xs">
            <span>Tramo: <strong class="text-white">${inspectedPt.billed.toFixed(2)}€</strong></span>
            <span>Beneficio: <strong class="text-emerald-400">+${inspectedPt.profit.toFixed(2)}€</strong></span>
            <span>Acumulado: <strong class="text-indigo-300">${inspectedPt.cumulativeBilled.toFixed(2)}€</strong></span>
          </div>
        </div>

        <!-- Lienzo SVG Interactivo -->
        <div class="ts-chart-wrapper">
          <svg viewBox="0 0 ${svgW} ${svgH}" class="ts-svg-canvas">
            <defs>
              <linearGradient id="revAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#10b981" stop-opacity="0.45"/>
                <stop offset="100%" stop-color="#10b981" stop-opacity="0.02"/>
              </linearGradient>
              <linearGradient id="revBarGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#34d399" stop-opacity="0.32"/>
                <stop offset="100%" stop-color="#10b981" stop-opacity="0.08"/>
              </linearGradient>
            </defs>

            <!-- Líneas guía horizontales y etiquetas del Eje Y (€) -->
            <line x1="${padLeft}" y1="${padTop}" x2="${svgW - padRight}" y2="${padTop}" stroke="rgba(255,255,255,0.07)" stroke-dasharray="3,3"/>
            <text x="${padLeft - 6}" y="${padTop + 4}" text-anchor="end" fill="#94a3b8" font-size="9.5" font-weight="600">${Math.round(maxY)}€</text>

            <line x1="${padLeft}" y1="${(padTop + plotH / 2).toFixed(1)}" x2="${svgW - padRight}" y2="${(padTop + plotH / 2).toFixed(1)}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3,3"/>
            <text x="${padLeft - 6}" y="${(padTop + plotH / 2 + 3).toFixed(1)}" text-anchor="end" fill="#64748b" font-size="9.5">${Math.round(maxY / 2)}€</text>

            <line x1="${padLeft}" y1="${baseLineY}" x2="${svgW - padRight}" y2="${baseLineY}" stroke="rgba(255,255,255,0.14)"/>
            <text x="${padLeft - 6}" y="${baseLineY + 3}" text-anchor="end" fill="#64748b" font-size="9.5">0€</text>

            <!-- Línea punteada de Media (en modo por tramo) -->
            ${mode === 'interval' && meta.avgBilledPerPoint > 0 ? `
              <line x1="${padLeft}" y1="${avgY.toFixed(1)}" x2="${svgW - padRight}" y2="${avgY.toFixed(1)}" stroke="#fbbf24" stroke-width="1.2" stroke-dasharray="4,4" opacity="0.75"/>
            ` : ''}

            <!-- Barras sutiles de fondo cuando estamos en modo Por Tramo -->
            ${mode === 'interval' ? coordsBilled.map((c) => {
              if (c.val <= 0) return '';
              const bw = Math.max(4, Math.min(20, colW * 0.55));
              const bh = Math.max(2, baseLineY - c.y);
              return `<rect x="${(c.x - bw / 2).toFixed(1)}" y="${c.y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="url(#revBarGrad)" />`;
            }).join('') : ''}

            <!-- Área bajo la curva y curvas de Facturación y Beneficio -->
            ${areaPathBilled ? `<path d="${areaPathBilled}" fill="url(#revAreaGrad)" />` : ''}
            ${linePathProfit ? `<path d="${linePathProfit}" fill="none" stroke="#818cf8" stroke-width="1.8" stroke-dasharray="3,2" opacity="0.85" />` : ''}
            ${linePathBilled ? `<path d="${linePathBilled}" fill="none" stroke="#10b981" stroke-width="2.6" stroke-linecap="round" />` : ''}

            <!-- Puntos, etiquetas del eje X y columnas interactivas -->
            ${coordsBilled.map((c, i) => {
              const isSelected = i === activeIdx;
              const showLabel = this._shouldShowXAxisLabel(i, series.length);
              const leftBound = i === 0 ? padLeft : (coordsBilled[i - 1].x + c.x) / 2;
              const rightBound = i === coordsBilled.length - 1 ? (padLeft + plotW) : (c.x + coordsBilled[i + 1].x) / 2;
              const hitX = leftBound;
              const hitW = Math.max(4, rightBound - leftBound);
              return `
                <g>
                  <line id="revCrosshair_${i}" x1="${c.x.toFixed(1)}" y1="${padTop}" x2="${c.x.toFixed(1)}" y2="${baseLineY}" stroke="#34d399" stroke-width="1.2" stroke-dasharray="2,2" opacity="${isSelected ? '0.8' : '0'}"/>
                  <circle 
                    id="revDot_${i}"
                    data-has-val="${c.val > 0 ? '1' : '0'}"
                    cx="${c.x.toFixed(1)}" 
                    cy="${c.y.toFixed(1)}" 
                    r="${isSelected ? '5.2' : (c.val > 0 ? '3.2' : '2')}" 
                    fill="${isSelected ? '#ffffff' : (c.val > 0 ? '#10b981' : '#334155')}" 
                    stroke="${isSelected ? '#10b981' : '#0f172a'}" 
                    stroke-width="${isSelected ? '2.5' : '1.2'}"
                    class="ts-point-dot"
                  />
                  ${showLabel ? `
                    <text id="revXLabel_${i}" x="${c.x.toFixed(1)}" y="${svgH - 7}" text-anchor="middle" fill="${isSelected ? '#34d399' : '#94a3b8'}" font-size="9.5" font-weight="${isSelected ? '700' : '500'}">
                      ${this._escapeHtml(c.pt.shortLabel)}
                    </text>
                  ` : ''}
                  <rect 
                    id="revHit_${i}"
                    x="${hitX.toFixed(1)}" 
                    y="${padTop}" 
                    width="${hitW.toFixed(1)}" 
                    height="${plotH + padBottom}" 
                    class="ts-hit-col ${isSelected ? 'active' : ''}"
                    onclick="window.app.inspectTimeSeriesPoint('revenue', ${i})"
                    onmouseenter="window.app.inspectTimeSeriesPoint('revenue', ${i})"
                  />
                </g>
              `;
            }).join('')}
          </svg>
          <div class="flex items-center justify-center gap-4 text-[10px] text-slate-400 mt-1">
            <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block"></span> Facturación (€)</span>
            <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-indigo-400 inline-block"></span> Beneficio Neto (€)</span>
            ${mode === 'interval' ? '<span class="flex items-center gap-1"><span class="w-2.5 h-0.5 bg-amber-400 inline-block"></span> Media</span>' : ''}
          </div>
        </div>
      </div>
    `;
  }

  _buildUnitsTimeSeriesCardHtml(ts, activeFilterTitle) {
    if (!ts) return '';
    const scale = this.unitsChartScale || ts.defaultScale || 'daily7Days';
    const mode = this.unitsChartMode || 'interval'; // 'interval' | 'cumulative'
    const series = ts[scale] || ts.daily7Days || [];
    const meta = (ts.seriesMeta && ts.seriesMeta[scale]) || {
      maxUnits: 0,
      maxUnitsLabel: 'Sin ventas',
      totalUnits: 0,
      avgUnitsPerPoint: 0,
      trendPercentageUnits: 0
    };

    const scaleLabels = {
      hourlyToday: 'Hoy (24h)',
      daily7Days: '7 Días',
      daily30Days: '30 Días',
      monthlyYear: '12 Meses'
    };

    let activeIdx = this.unitsInspectedIdx;
    if (activeIdx === null || activeIdx === undefined || activeIdx < 0 || activeIdx >= series.length) {
      let lastActive = series.length - 1;
      for (let i = series.length - 1; i >= 0; i--) {
        if (series[i].units > 0) {
          lastActive = i;
          break;
        }
      }
      activeIdx = Math.max(0, lastActive);
      this.unitsInspectedIdx = activeIdx;
    }

    const inspectedPt = series[activeIdx] || {
      label: '-',
      units: 0,
      cumulativeUnits: 0,
      transactions: 0,
      billed: 0
    };

    // Geometría SVG
    const svgW = 640;
    const svgH = 195;
    const padLeft = 42;
    const padRight = 14;
    const padTop = 18;
    const padBottom = 28;
    const plotW = svgW - padLeft - padRight;
    const plotH = svgH - padTop - padBottom;
    const baseLineY = padTop + plotH;

    const valuesUnits = series.map(pt => (mode === 'cumulative' ? pt.cumulativeUnits : pt.units));
    const rawMax = Math.max(4, ...valuesUnits);
    const maxY = Math.ceil(rawMax * 1.15);

    const stepX = series.length > 1 ? plotW / (series.length - 1) : plotW;
    const colW = series.length > 0 ? plotW / series.length : plotW;

    const coordsUnits = series.map((pt, i) => {
      const val = valuesUnits[i] || 0;
      const x = series.length > 1 ? padLeft + i * stepX : padLeft + plotW / 2;
      const y = baseLineY - Math.min(1, Math.max(0, val / maxY)) * plotH;
      return { x, y, val, pt };
    });

    const linePathUnits = this._buildSmoothSvgPath(coordsUnits);
    const areaPathUnits = coordsUnits.length > 0
      ? `${linePathUnits} L ${coordsUnits[coordsUnits.length - 1].x.toFixed(1)} ${baseLineY} L ${coordsUnits[0].x.toFixed(1)} ${baseLineY} Z`
      : '';

    const avgY = baseLineY - Math.min(1, Math.max(0, (meta.avgUnitsPerPoint || 0) / maxY)) * plotH;
    const trendVal = meta.trendPercentageUnits || 0;
    const trendPositive = trendVal >= 0;

    return `
      <!-- GRÁFICA 2: UNIDADES VENDIDAS EN FUNCIÓN DEL TIEMPO (UDS.) -->
      <div class="ios-card ios-card-glow-cyan mb-4">
        <div class="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div>
            <h3 class="text-sm font-black uppercase tracking-wider text-white flex items-center gap-1.5">
              <span>📦</span> Gráfica 2: Unidades Vendidas en Función del Tiempo (uds.)
            </h3>
            <p class="text-[11px] text-slate-300 mt-0.5">
              Ritmo físico de salida de producto (${activeFilterTitle}) • Toca cualquier punto para ver el detalle
            </p>
          </div>
          <span class="badge ${trendPositive ? 'badge-ok-stock' : 'badge-low-stock'} text-[10px]">
            ${trendPositive ? '↗' : '↘'} ${trendPositive ? '+' : ''}${trendVal}% ritmo uds.
          </span>
        </div>

        <!-- Controles de Escala y Modo -->
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div class="flex items-center gap-1 overflow-x-auto no-scrollbar">
            ${Object.entries(scaleLabels).map(([scKey, scLabel]) => `
              <button 
                type="button"
                onclick="window.app.setTimeSeriesScale('units', '${scKey}')"
                class="ts-mini-pill btn-pressable ${scale === scKey ? 'active-cyan' : ''}"
              >${scLabel}</button>
            `).join('')}
          </div>

          <div class="flex items-center gap-1">
            <button 
              type="button"
              onclick="window.app.setTimeSeriesMode('units', 'interval')"
              class="ts-mini-pill btn-pressable ${mode === 'interval' ? 'active-cyan' : ''}"
            >📊 Unidades por Tramo</button>
            <button 
              type="button"
              onclick="window.app.setTimeSeriesMode('units', 'cumulative')"
              class="ts-mini-pill btn-pressable ${mode === 'cumulative' ? 'active-cyan' : ''}"
            >📈 Unidades Acumuladas</button>
          </div>
        </div>

        <!-- Resumen de KPIs de Unidades -->
        <div class="grid grid-cols-3 gap-2 text-center mb-3">
          <div class="bg-slate-950/60 p-2 rounded-xl border border-white/10">
            <div class="text-[9px] text-slate-400 uppercase font-bold">Total Unidades (${scaleLabels[scale]})</div>
            <div class="text-sm font-black text-white">${meta.totalUnits} uds</div>
            <div class="text-[10px] text-cyan-400 font-semibold">Volumen serie</div>
          </div>
          <div class="bg-slate-950/60 p-2 rounded-xl border border-white/10">
            <div class="text-[9px] text-slate-400 uppercase font-bold">Pico de Unidades</div>
            <div class="text-sm font-black text-cyan-300">${meta.maxUnits} uds</div>
            <div class="text-[10px] text-slate-400 truncate">${this._escapeHtml(meta.maxUnitsLabel)}</div>
          </div>
          <div class="bg-slate-950/60 p-2 rounded-xl border border-white/10">
            <div class="text-[9px] text-slate-400 uppercase font-bold">Media por Tramo</div>
            <div class="text-sm font-black text-purple-300">${meta.avgUnitsPerPoint} uds</div>
            <div class="text-[10px] text-slate-400">Promedio</div>
          </div>
        </div>

        <!-- Panel Inspector Táctil de Unidades -->
        <div id="unitsChartInspector" class="ts-inspector-bar">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block"></span>
            <span class="text-xs font-black text-white">${this._escapeHtml(inspectedPt.label)}</span>
          </div>
          <div class="flex flex-wrap items-center gap-3 text-xs">
            <span>Vendidas tramo: <strong class="text-cyan-300">${inspectedPt.units} uds</strong></span>
            <span>Acumuladas: <strong class="text-purple-300">${inspectedPt.cumulativeUnits} uds</strong></span>
            <span>Operaciones: <strong class="text-white">${inspectedPt.transactions} ventas (${inspectedPt.billed.toFixed(2)}€)</strong></span>
          </div>
        </div>

        <!-- Lienzo SVG Interactivo de Unidades -->
        <div class="ts-chart-wrapper">
          <svg viewBox="0 0 ${svgW} ${svgH}" class="ts-svg-canvas">
            <defs>
              <linearGradient id="unitsAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#06b6d4" stop-opacity="0.45"/>
                <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0.02"/>
              </linearGradient>
              <linearGradient id="unitsBarGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.38"/>
                <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0.1"/>
              </linearGradient>
            </defs>

            <!-- Líneas guía horizontales y etiquetas del Eje Y (uds) -->
            <line x1="${padLeft}" y1="${padTop}" x2="${svgW - padRight}" y2="${padTop}" stroke="rgba(255,255,255,0.07)" stroke-dasharray="3,3"/>
            <text x="${padLeft - 6}" y="${padTop + 4}" text-anchor="end" fill="#94a3b8" font-size="9.5" font-weight="600">${maxY}u</text>

            <line x1="${padLeft}" y1="${(padTop + plotH / 2).toFixed(1)}" x2="${svgW - padRight}" y2="${(padTop + plotH / 2).toFixed(1)}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3,3"/>
            <text x="${padLeft - 6}" y="${(padTop + plotH / 2 + 3).toFixed(1)}" text-anchor="end" fill="#64748b" font-size="9.5">${Math.round(maxY / 2)}u</text>

            <line x1="${padLeft}" y1="${baseLineY}" x2="${svgW - padRight}" y2="${baseLineY}" stroke="rgba(255,255,255,0.14)"/>
            <text x="${padLeft - 6}" y="${baseLineY + 3}" text-anchor="end" fill="#64748b" font-size="9.5">0u</text>

            <!-- Línea punteada de Media de Unidades -->
            ${mode === 'interval' && meta.avgUnitsPerPoint > 0 ? `
              <line x1="${padLeft}" y1="${avgY.toFixed(1)}" x2="${svgW - padRight}" y2="${avgY.toFixed(1)}" stroke="#c084fc" stroke-width="1.2" stroke-dasharray="4,4" opacity="0.75"/>
            ` : ''}

            <!-- Barras de Unidades -->
            ${coordsUnits.map((c) => {
              if (c.val <= 0) return '';
              const bw = Math.max(4, Math.min(22, colW * 0.58));
              const bh = Math.max(2, baseLineY - c.y);
              return `<rect x="${(c.x - bw / 2).toFixed(1)}" y="${c.y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="3.5" fill="url(#unitsBarGrad)" />`;
            }).join('')}

            <!-- Área y Curva de Unidades -->
            ${areaPathUnits ? `<path d="${areaPathUnits}" fill="url(#unitsAreaGrad)" />` : ''}
            ${linePathUnits ? `<path d="${linePathUnits}" fill="none" stroke="#22d3ee" stroke-width="2.5" stroke-linecap="round" />` : ''}

            <!-- Puntos, etiquetas del eje X y columnas interactivas -->
            ${coordsUnits.map((c, i) => {
              const isSelected = i === activeIdx;
              const showLabel = this._shouldShowXAxisLabel(i, series.length);
              const leftBound = i === 0 ? padLeft : (coordsUnits[i - 1].x + c.x) / 2;
              const rightBound = i === coordsUnits.length - 1 ? (padLeft + plotW) : (c.x + coordsUnits[i + 1].x) / 2;
              const hitX = leftBound;
              const hitW = Math.max(4, rightBound - leftBound);
              return `
                <g>
                  <line id="unitsCrosshair_${i}" x1="${c.x.toFixed(1)}" y1="${padTop}" x2="${c.x.toFixed(1)}" y2="${baseLineY}" stroke="#22d3ee" stroke-width="1.2" stroke-dasharray="2,2" opacity="${isSelected ? '0.8' : '0'}"/>
                  <circle 
                    id="unitsDot_${i}"
                    data-has-val="${c.val > 0 ? '1' : '0'}"
                    cx="${c.x.toFixed(1)}" 
                    cy="${c.y.toFixed(1)}" 
                    r="${isSelected ? '5.2' : (c.val > 0 ? '3.2' : '2')}" 
                    fill="${isSelected ? '#ffffff' : (c.val > 0 ? '#06b6d4' : '#334155')}" 
                    stroke="${isSelected ? '#06b6d4' : '#0f172a'}" 
                    stroke-width="${isSelected ? '2.5' : '1.2'}"
                    class="ts-point-dot"
                  />
                  ${showLabel ? `
                    <text id="unitsXLabel_${i}" x="${c.x.toFixed(1)}" y="${svgH - 7}" text-anchor="middle" fill="${isSelected ? '#22d3ee' : '#94a3b8'}" font-size="9.5" font-weight="${isSelected ? '700' : '500'}">
                      ${this._escapeHtml(c.pt.shortLabel)}
                    </text>
                  ` : ''}
                  <rect 
                    id="unitsHit_${i}"
                    x="${hitX.toFixed(1)}" 
                    y="${padTop}" 
                    width="${hitW.toFixed(1)}" 
                    height="${plotH + padBottom}" 
                    class="ts-hit-col ${isSelected ? 'active' : ''}"
                    onclick="window.app.inspectTimeSeriesPoint('units', ${i})"
                    onmouseenter="window.app.inspectTimeSeriesPoint('units', ${i})"
                  />
                </g>
              `;
            }).join('')}
          </svg>
          <div class="flex items-center justify-center gap-4 text-[10px] text-slate-400 mt-1">
            <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block"></span> Unidades Vendidas (uds.)</span>
            ${mode === 'interval' ? '<span class="flex items-center gap-1"><span class="w-2.5 h-0.5 bg-purple-400 inline-block"></span> Media por tramo</span>' : ''}
          </div>
        </div>
      </div>
    `;
  }

  setTimeSeriesScale(chartType, scale) {
    if (chartType === 'revenue') {
      this.revenueChartScale = scale;
      this.revenueInspectedIdx = null;
    } else {
      this.unitsChartScale = scale;
      this.unitsInspectedIdx = null;
    }
    this._playChime('tap');
    this.renderAnalyticsView();
  }

  setTimeSeriesMode(chartType, mode) {
    if (chartType === 'revenue') {
      this.revenueChartMode = mode;
    } else {
      this.unitsChartMode = mode;
    }
    this._playChime('tap');
    this.renderAnalyticsView();
  }

  inspectTimeSeriesPoint(chartType, idx) {
    const ts = this._lastTimeSeriesData;
    if (!ts) return;

    const updateChartHighlight = (prefix, count, activeColor) => {
      for (let i = 0; i < count; i++) {
        const selected = i === idx;
        const dot = document.getElementById(`${prefix}Dot_${i}`);
        if (dot) {
          const hasVal = dot.dataset?.hasVal === '1';
          dot.setAttribute('r', selected ? '5.2' : (hasVal ? '3.2' : '2'));
          dot.setAttribute('fill', selected ? '#ffffff' : (hasVal ? activeColor : '#334155'));
          dot.setAttribute('stroke', selected ? activeColor : '#0f172a');
          dot.setAttribute('stroke-width', selected ? '2.5' : '1.2');
        }
        const crosshair = document.getElementById(`${prefix}Crosshair_${i}`);
        if (crosshair) {
          crosshair.setAttribute('opacity', selected ? '0.8' : '0');
        }
        const xLabel = document.getElementById(`${prefix}XLabel_${i}`);
        if (xLabel) {
          xLabel.setAttribute('fill', selected ? (prefix === 'rev' ? '#34d399' : '#22d3ee') : '#94a3b8');
          xLabel.setAttribute('font-weight', selected ? '700' : '500');
        }
        const hit = document.getElementById(`${prefix}Hit_${i}`);
        if (hit) {
          hit.classList.toggle('active', selected);
        }
      }
    };

    if (chartType === 'revenue') {
      this.revenueInspectedIdx = idx;
      const scale = this.revenueChartScale || ts.defaultScale || 'daily7Days';
      const series = ts[scale] || [];
      const pt = series[idx];
      if (!pt) return;
      updateChartHighlight('rev', series.length, '#10b981');
      const inspector = document.getElementById('revenueChartInspector');
      if (inspector) {
        inspector.innerHTML = `
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block"></span>
            <span class="text-xs font-black text-white">${this._escapeHtml(pt.label)}</span>
            <span class="text-[10px] text-slate-400">(${pt.transactions} ${pt.transactions === 1 ? 'venta' : 'ventas'})</span>
          </div>
          <div class="flex flex-wrap items-center gap-3 text-xs">
            <span>Tramo: <strong class="text-white">${pt.billed.toFixed(2)}€</strong></span>
            <span>Beneficio: <strong class="text-emerald-400">+${pt.profit.toFixed(2)}€</strong></span>
            <span>Acumulado: <strong class="text-indigo-300">${pt.cumulativeBilled.toFixed(2)}€</strong></span>
          </div>
        `;
      }
    } else {
      this.unitsInspectedIdx = idx;
      const scale = this.unitsChartScale || ts.defaultScale || 'daily7Days';
      const series = ts[scale] || [];
      const pt = series[idx];
      if (!pt) return;
      updateChartHighlight('units', series.length, '#06b6d4');
      const inspector = document.getElementById('unitsChartInspector');
      if (inspector) {
        inspector.innerHTML = `
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block"></span>
            <span class="text-xs font-black text-white">${this._escapeHtml(pt.label)}</span>
          </div>
          <div class="flex flex-wrap items-center gap-3 text-xs">
            <span>Vendidas tramo: <strong class="text-cyan-300">${pt.units} uds</strong></span>
            <span>Acumuladas: <strong class="text-purple-300">${pt.cumulativeUnits} uds</strong></span>
            <span>Operaciones: <strong class="text-white">${pt.transactions} ventas (${pt.billed.toFixed(2)}€)</strong></span>
          </div>
        `;
      }
    }
  }

  setTimeframe(tf) {
    this.analyticsTimeframe = tf;
    this.revenueChartScale = null;
    this.unitsChartScale = null;
    this.revenueInspectedIdx = null;
    this.unitsInspectedIdx = null;
    this._playChime('tap');
    this.renderAnalyticsView();
  }

  setAnalyticsWarehouseFilter(whId) {
    this.analyticsWarehouseFilter = whId || 'all';
    this.revenueInspectedIdx = null;
    this.unitsInspectedIdx = null;
    this._playChime('tap');
    this.renderAnalyticsView();
  }

  async revertSaleAction(saleId) {
    if (!confirm('¿Deseas anular esta venta? Se devolverá automáticamente el stock a su almacén de origen.')) {
      return;
    }

    try {
      const res = await this.salesAgent.revertSale(saleId);
      if (this.lastCompletedSale && this.lastCompletedSale.id === saleId) {
        this.lastCompletedSale = null;
      }
      this._playChime('revert');
      this.showToast(res.message, '↩️');
      if (this.authAgent.isBoss()) {
        this.scheduleCloudSnapshotPublish();
      }
      await this.renderAnalyticsView();
      await this.updateHeaderQuickStats();
    } catch (err) {
      alert(`Error anulando la venta: ${err.message}`);
    }
  }

  /**
   * Vista limitada de Analítica para el Modo Trabajador:
   * Muestra únicamente sus ventas, efectivo a entregar al jefe, sus fiados y su progreso de vapers gratis.
   * Oculta por completo costes, márgenes y ventas de otros almacenes.
   */
  async _renderWorkerAnalyticsView(container) {
    const assignedWh = this.authAgent.getAssignedWarehouseId();
    const data = await this.analyticsAgent.getDashboardMetrics(this.analyticsTimeframe, assignedWh);
    const workerAcct = (data.workerAccounts?.warehouses || []).find(w => w.warehouseId === assignedWh);
    const myWarehouse = (data.warehouseBreakdown || []).find(w => w.warehouseId === assignedWh);
    const pendingDebts = (data.debtsAndReservations?.pendingSales || []).filter(
      s => (s.warehouseId || MAIN_WAREHOUSE_ID) === assignedWh
    );

    const timeframeLabels = {
      today: 'Hoy',
      week: '7 Días',
      month: 'Este Mes',
      all: 'Todo'
    };

    container.innerHTML = `
      <div class="ios-segmented mb-3">
        <button class="segmented-option ${this.analyticsTimeframe === 'today' ? 'active' : ''}" onclick="window.app.setTimeframe('today')">Hoy</button>
        <button class="segmented-option ${this.analyticsTimeframe === 'week' ? 'active' : ''}" onclick="window.app.setTimeframe('week')">7 Días</button>
        <button class="segmented-option ${this.analyticsTimeframe === 'month' ? 'active' : ''}" onclick="window.app.setTimeframe('month')">Este Mes</button>
        <button class="segmented-option ${this.analyticsTimeframe === 'all' ? 'active' : ''}" onclick="window.app.setTimeframe('all')">Todo</button>
      </div>

      <!-- KPIs de Ventas del Trabajador (Sin Costes ni Márgenes del Jefe) -->
      <div class="grid grid-cols-2 gap-3 mb-4">
        <div class="ios-card ios-card-glow-emerald mb-0 p-3.5">
          <div class="text-[11px] text-emerald-300 font-bold mb-1">💶 Vendido (${timeframeLabels[this.analyticsTimeframe]})</div>
          <div class="text-2xl font-black text-white tabular-nums">${data.totalBilled.toFixed(2)}€</div>
          <div class="text-[10px] text-slate-400 mt-1">${data.totalUnits} vapers en ${data.transactionCount} ventas</div>
        </div>

        <div class="ios-card ios-card-glow-indigo mb-0 p-3.5">
          <div class="text-[11px] text-indigo-300 font-bold mb-1">📦 Tu Stock Actual</div>
          <div class="text-2xl font-black text-white tabular-nums">${myWarehouse ? myWarehouse.currentStockUnits : 0} uds</div>
          <div class="text-[10px] text-slate-400 mt-1">Disponibles en tu almacén</div>
        </div>
      </div>

      ${workerAcct ? `
        <!-- Progreso de Vapers de Regalo y Liquidación -->
        <div class="ios-card ios-card-glow-emerald mb-4">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-sm font-black text-white flex items-center gap-1.5">
              <span>🎁</span> Tus Vapers de Regalo (Comisión)
            </h3>
            <span class="badge badge-ok-stock text-[10px]">${workerAcct.rewardFreeUnits} gratis cada ${workerAcct.rewardEveryNUnits} uds</span>
          </div>

          <div class="bg-emerald-950/35 p-3 rounded-xl border border-emerald-500/30 mb-3">
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs font-bold text-emerald-200">Vapers gratis disponibles para ti:</span>
              <span class="text-lg font-black text-emerald-400">${workerAcct.pendingFreeVapers} ${workerAcct.pendingFreeVapers === 1 ? 'vaper' : 'vapers'}</span>
            </div>
            <div class="text-[11px] text-slate-300 mb-2 flex justify-between">
              <span>Llevas <strong>${workerAcct.unitsTowardNextFreeVaper}/${workerAcct.rewardEveryNUnits}</strong> para el próximo</span>
              <span class="text-emerald-300 font-semibold">Faltan ${workerAcct.unitsNeededForNextFreeVaper} uds</span>
            </div>
            <div class="progress-track">
              <div class="progress-fill-emerald" style="width: ${Math.min(100, workerAcct.nextFreeVaperProgressPct)}%"></div>
            </div>
            <div class="text-[10px] text-slate-400 mt-2 flex justify-between">
              <span>Total vendidos histórico: <strong class="text-white">${workerAcct.allTimeUnitsSold} uds</strong></span>
              <span>Ya recibidos: <strong class="text-emerald-300">${workerAcct.deliveredFreeVapers}</strong></span>
            </div>
          </div>

          <div class="bg-slate-900/80 p-3 rounded-xl border border-slate-700/60">
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs font-bold text-slate-300">💶 Dinero por entregar al Jefe:</span>
              <span class="text-lg font-black ${workerAcct.pendingMoneyToDeliver > 0 ? 'text-amber-400' : 'text-emerald-400'} tabular-nums">
                ${workerAcct.pendingMoneyToDeliver.toFixed(2)}€
              </span>
            </div>
            <div class="text-[10px] text-slate-400 flex flex-wrap justify-between gap-2">
              <span>Cobrado total: <strong class="text-white">${workerAcct.totalCollectedPaid.toFixed(2)}€</strong> (💵 ${workerAcct.collectedCash.toFixed(0)}€ / 💳 ${workerAcct.collectedCard.toFixed(0)}€)</span>
              <span>Entregado ya: <strong class="text-emerald-400">${workerAcct.cashSettledAmount.toFixed(2)}€</strong></span>
            </div>
          </div>
        </div>
      ` : ''}

      ${pendingDebts.length > 0 ? `
        <div class="ios-card ios-card-glow-amber mb-4">
          <h3 class="text-xs font-black uppercase tracking-wider text-amber-300 mb-2">⏳ Tus Fiados Pendientes de Cobro (${pendingDebts.length})</h3>
          <div class="space-y-2">
            ${pendingDebts.map(s => `
              <div class="bg-slate-900/85 p-2.5 rounded-xl border border-amber-500/35 flex items-center justify-between gap-2 text-xs">
                <div class="min-w-0">
                  <div class="font-bold text-white truncate">👤 ${this._escapeHtml(s.buyerName || 'Cliente')} • ${s.quantity}x ${this._escapeHtml(s.productName)}</div>
                  <div class="text-[10px] text-amber-300 font-bold">${s.grossTotal.toFixed(2)}€ pendiente</div>
                </div>
                <div class="flex gap-1">
                  <button onclick="window.app.markPendingSalePaid('${s.id}', 'Efectivo')" class="btn-pressable bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-1 rounded-lg text-[10px] font-bold">💵 Efec.</button>
                  <button onclick="window.app.markPendingSalePaid('${s.id}', 'Tarjeta')" class="btn-pressable bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-2 py-1 rounded-lg text-[10px] font-bold">💳 Tarj.</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Últimas Ventas del Trabajador -->
      <div class="mb-8">
        <div class="flex items-center justify-between mb-2 px-1">
          <span class="text-xs font-bold uppercase tracking-wider text-slate-300">🕒 Tus Últimas Ventas</span>
          <span class="text-xs text-slate-400">${data.recentSales.length} mostradas</span>
        </div>
        ${data.recentSales.length === 0 ? `
          <div class="ios-card text-center py-8 text-slate-400 text-sm">No has registrado ventas en este periodo.</div>
        ` : `
          <div class="space-y-2">
            ${data.recentSales.map(s => {
              const dt = new Date(s.timestamp);
              const tStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const dStr = dt.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
              const isPending = s.paymentStatus === 'pending';
              return `
                <div class="ios-card flex items-center justify-between p-3 mb-0">
                  <div class="min-w-0 pr-2">
                    <div class="flex items-center gap-1.5 mb-1">
                      <span class="badge ${isPending ? 'badge-fiado' : s.paymentMethod === 'Tarjeta' ? 'badge-payment-card' : 'badge-payment-cash'}">
                        ${isPending ? '⏳ Fiado' : s.paymentMethod === 'Tarjeta' ? '💳 Tarjeta' : '💵 Efectivo'}
                      </span>
                      <span class="text-[10px] text-slate-400">${dStr} • ${tStr}</span>
                    </div>
                    <div class="text-sm font-bold text-white truncate">${s.quantity}x ${this._escapeHtml(s.productName)}</div>
                    ${s.buyerName ? `<div class="text-[11px] text-indigo-300">👤 ${this._escapeHtml(s.buyerName)}</div>` : ''}
                    ${s.notes ? `<div class="text-[11px] text-slate-400">📝 ${this._escapeHtml(s.notes)}</div>` : ''}
                  </div>
                  <div class="text-right flex-shrink-0">
                    <div class="text-base font-black text-white tabular-nums">${s.grossTotal.toFixed(2)}€</div>
                    <button onclick="window.app.revertSaleAction('${s.id}')" class="text-[10px] text-rose-400 underline mt-1">Anular</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    `;
  }

  // =========================================================================
  // PESTAÑA 4: AJUSTES, NOTIFICACIONES NTFY, ROLES/PIN Y RESPALDO
  // =========================================================================
  async renderSettingsView() {
    const container = document.getElementById('view-settings');
    if (!container) return;

    const isWorker = this.authAgent.isWorker();
    const session = this.authAgent.getSession();

    if (isWorker) {
      container.innerHTML = `
        <div class="ios-card ios-card-glow-indigo mb-4">
          <div class="flex items-center gap-3 mb-3">
            <div class="w-12 h-12 rounded-2xl bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-2xl">👤</div>
            <div>
              <div class="text-[10px] uppercase font-bold tracking-wider text-indigo-300">Sesión Activa: Modo Trabajador</div>
              <h3 class="text-base font-black text-white">${this._escapeHtml(session.workerName || session.warehouseName)}</h3>
              <div class="text-xs text-slate-400">Almacén asignado: ${this._escapeHtml(session.warehouseName)}</div>
            </div>
          </div>
          <p class="text-xs text-slate-300 leading-relaxed mb-3">
            Cada venta o reserva que registras se sincroniza con el almacén del jefe y le envía una notificación automática al instante.
          </p>
          <div class="grid grid-cols-1 gap-2">
            <button
              type="button"
              onclick="window.app.pullCloudSyncNow()"
              class="btn-pressable bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 py-3 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2"
            >
              <span>☁️</span> Actualizar Stock desde la Nube Ahora
            </button>
            <button
              type="button"
              onclick="window.app.openPinAuthModal()"
              class="btn-pressable bg-slate-800 hover:bg-slate-700 text-white border border-slate-600 py-3 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2"
            >
              <span>🔐</span> Cambiar de Perfil / Entrar como Jefe (PIN)
            </button>
          </div>
        </div>
      `;
      return;
    }

    const [products, sales, warehouses, transfers, bossPin] = await Promise.all([
      this.storageAgent.getAllProducts(),
      this.storageAgent.getAllSales(),
      this.storageAgent.getAllWarehouses(),
      this.storageAgent.getAllTransfers(),
      this.authAgent.getBossPin()
    ]);

    const ntfy = this.notificationsAgent.getSettings();
    const sbCfg = this.supabaseAgent.getConfig();
    const sbConfigured = this.supabaseAgent.isConfigured();
    const sbConnected = this.supabaseAgent.isConnected;
    const workerWarehouses = warehouses.filter(w => !w.isMain);

    let html = `
      <!-- 0. BASE DE DATOS PERMANENTE EN LA NUBE (SUPABASE POSTGRESQL + REALTIME) -->
      <div class="ios-card ${sbConnected ? 'ios-card-glow-emerald' : 'ios-card-glow-amber'} mb-4">
        <div class="flex items-start justify-between gap-2 mb-2">
          <div>
            <h3 class="text-sm font-black text-white flex items-center gap-2">
              <span>🗄️</span> Base de Datos Permanente (Supabase)
            </h3>
            <p class="text-[11px] text-slate-300 mt-0.5">
              Guarda todo tu catálogo, almacenes, ventas, reservas y liquidaciones para siempre en la nube con sincronización en vivo.
            </p>
          </div>
          <span class="badge ${sbConnected ? 'badge-ok-stock' : sbConfigured ? 'badge-fiado' : 'badge-low-stock'} text-[10px] flex-shrink-0">
            ${sbConnected ? '● En Vivo' : sbConfigured ? 'Configurado' : 'Solo Local'}
          </span>
        </div>

        <div class="bg-slate-950/70 p-3 rounded-2xl border border-white/10 space-y-2.5 mb-2.5">
          <div>
            <label class="text-[10px] uppercase tracking-wider text-slate-400 font-bold block mb-1">Supabase Project URL</label>
            <input
              type="url"
              id="inputSupabaseUrl"
              value="${this._escapeHtml(sbCfg.url || '')}"
              placeholder="https://xxxxxxxxxxxx.supabase.co"
              class="w-full bg-slate-900 text-white font-mono text-xs px-3 py-2 rounded-xl border border-slate-700 focus:outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label class="text-[10px] uppercase tracking-wider text-slate-400 font-bold block mb-1">Supabase Anon Public Key</label>
            <input
              type="text"
              id="inputSupabaseAnonKey"
              value="${this._escapeHtml(sbCfg.anonKey || '')}"
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              class="w-full bg-slate-900 text-white font-mono text-xs px-3 py-2 rounded-xl border border-slate-700 focus:outline-none focus:border-emerald-500"
            />
          </div>
          ${this.supabaseAgent.lastError ? `
            <div class="text-[11px] text-rose-400 font-semibold">⚠️ Error: ${this._escapeHtml(this.supabaseAgent.lastError)}</div>
          ` : ''}

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
            <button
              type="button"
              onclick="window.app.saveSupabaseConfigFromView()"
              class="btn-pressable bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-2.5 px-3 rounded-xl shadow-lg shadow-emerald-900/30"
            >🔗 Conectar Supabase</button>
            <button
              type="button"
              onclick="window.app.pushLocalToSupabaseNow()"
              class="btn-pressable bg-indigo-600/80 hover:bg-indigo-500 text-white text-xs font-bold py-2.5 px-3 rounded-xl"
              ${!sbConfigured ? 'disabled style="opacity:0.45"' : ''}
            >⬆️ Subir Datos Locales</button>
            <button
              type="button"
              onclick="window.app.pullFromSupabaseNow()"
              class="btn-pressable bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold py-2.5 px-3 rounded-xl border border-slate-700"
              ${!sbConfigured ? 'disabled style="opacity:0.45"' : ''}
            >⬇️ Descargar Nube</button>
          </div>
        </div>
      </div>

      <!-- 1. NOTIFICACIONES AL MÓVIL CON NTFY.SH Y SINCRONIZACIÓN EN LA NUBE -->
      <div class="ios-card ios-card-glow-emerald mb-4">
        <div class="flex items-start justify-between gap-2 mb-2">
          <div>
            <h3 class="text-sm font-black text-white flex items-center gap-2">
              <span>🔔</span> Notificaciones al iPhone (ntfy) & Nube en Vivo
            </h3>
            <p class="text-[11px] text-slate-300 mt-0.5">
              Recibe una notificación en tu iPhone al instante cada vez que un trabajador venda o reserve un vaper.
            </p>
          </div>
          <span id="ntfyStatusBadge" class="badge ${ntfy.enabled ? 'badge-ok-stock' : 'badge-low-stock'} text-[10px]">
            ${ntfy.enabled ? '● Activo' : 'Pausado'}
          </span>
        </div>

        <div class="bg-slate-950/70 p-3 rounded-2xl border border-emerald-500/30 mb-3 space-y-2.5">
          <div>
            <label class="text-[10px] uppercase tracking-wider text-emerald-300 font-bold block mb-1">Tu Canal Privado de ntfy (Topic)</label>
            <div class="flex gap-1.5">
              <input
                type="text"
                id="inputNtfyTopic"
                value="${this._escapeHtml(ntfy.topic)}"
                class="flex-1 bg-slate-900 text-white font-mono text-xs px-3 py-2 rounded-xl border border-slate-700 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                onclick="window.app.copyNtfyTopic()"
                class="btn-pressable bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold px-3 py-2 rounded-xl border border-slate-700"
              >📋 Copiar</button>
            </div>
          </div>

          <div class="flex flex-wrap gap-2 text-[11px]">
            <label class="flex items-center gap-1.5 bg-slate-900 px-2.5 py-1.5 rounded-xl border border-slate-800 cursor-pointer">
              <input type="checkbox" id="chkNtfyEnabled" ${ntfy.enabled ? 'checked' : ''} onchange="window.app.saveNtfySettingsFromView()" class="accent-emerald-500" />
              <span class="text-slate-200 font-semibold">Activar avisos</span>
            </label>
            <label class="flex items-center gap-1.5 bg-slate-900 px-2.5 py-1.5 rounded-xl border border-slate-800 cursor-pointer">
              <input type="checkbox" id="chkNtfyWorkers" ${ntfy.notifyWorkerSales ? 'checked' : ''} onchange="window.app.saveNtfySettingsFromView()" class="accent-emerald-500" />
              <span class="text-slate-200">Ventas trabajadores</span>
            </label>
            <label class="flex items-center gap-1.5 bg-slate-900 px-2.5 py-1.5 rounded-xl border border-slate-800 cursor-pointer">
              <input type="checkbox" id="chkNtfyRes" ${ntfy.notifyReservations ? 'checked' : ''} onchange="window.app.saveNtfySettingsFromView()" class="accent-emerald-500" />
              <span class="text-slate-200">Reservas</span>
            </label>
            <label class="flex items-center gap-1.5 bg-slate-900 px-2.5 py-1.5 rounded-xl border border-slate-800 cursor-pointer">
              <input type="checkbox" id="chkNtfyBoss" ${ntfy.notifyBossSales ? 'checked' : ''} onchange="window.app.saveNtfySettingsFromView()" class="accent-emerald-500" />
              <span class="text-slate-200">Mis propias ventas</span>
            </label>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
            <button
              type="button"
              onclick="window.app.saveNtfySettingsFromView(true)"
              class="btn-pressable bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold py-2.5 px-3 rounded-xl border border-slate-700"
            >💾 Guardar Canal</button>
            <button
              type="button"
              onclick="window.app.testNtfyNotification()"
              class="btn-pressable bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-2.5 px-3 rounded-xl shadow-lg shadow-emerald-900/30"
            >🔔 Probar Notificación</button>
            <button
              type="button"
              onclick="window.app.syncFullStateToCloud()"
              class="btn-pressable bg-indigo-600/80 hover:bg-indigo-500 text-white text-xs font-bold py-2.5 px-3 rounded-xl"
            >☁️ Sincronizar Trabajadores</button>
          </div>
        </div>

        <div class="bg-slate-900/75 p-3 rounded-xl border border-slate-800 text-[11px] text-slate-300 space-y-1.5 leading-relaxed">
          <div class="font-bold text-emerald-300">📱 Cómo conectar tu iPhone en 20 segundos:</div>
          <ol class="list-decimal list-inside space-y-1">
            <li>Descarga gratis la app <strong>ntfy</strong> en la App Store de tu iPhone.</li>
            <li>Abre <strong>ntfy</strong>, toca el botón <strong>+</strong> y escribe tu canal: <code id="ntfyGuideTopicCode" class="px-1.5 py-0.5 rounded bg-slate-800 text-emerald-300 font-bold">${this._escapeHtml(ntfy.topic)}</code></li>
            <li>¡Listo! Toca <strong>"🔔 Probar Notificación"</strong> arriba para comprobar que te vibra el iPhone.</li>
          </ol>
        </div>
      </div>

      <!-- 2. ACCESO LIMITADO DE TRABAJADORES Y PIN DE JEFE -->
      <div class="ios-card ios-card-glow-indigo mb-4">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-sm font-black text-white flex items-center gap-2">
            <span>🔐</span> Acceso Limitado de Trabajadores & PINs
          </h3>
          <button
            type="button"
            onclick="window.app.openPinAuthModal()"
            class="btn-pressable bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-indigo-500/40 text-[11px] font-bold px-2.5 py-1 rounded-xl"
          >🔑 Cambiar Perfil</button>
        </div>

        <div class="bg-slate-950/60 p-3 rounded-xl border border-slate-800 mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div class="text-xs font-bold text-white">👑 Tu PIN de Jefe</div>
            <div class="text-[10px] text-slate-400">Sirve para volver al Modo Jefe desde el móvil de un trabajador</div>
          </div>
          <div class="flex items-center gap-1.5">
            <input
              type="text"
              inputmode="numeric"
              id="inputSettingsBossPin"
              value="${this._escapeHtml(bossPin)}"
              class="w-20 text-center bg-slate-900 text-white font-black tracking-widest text-xs py-1.5 rounded-lg border border-slate-700"
            />
            <button
              type="button"
              onclick="window.app.saveBossPinFromSettings()"
              class="btn-pressable bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg"
            >Guardar</button>
          </div>
        </div>

        <div class="flex items-center justify-between mb-2">
          <span class="text-xs font-bold text-slate-300">Enlaces Directos y PINs por Trabajador (${workerWarehouses.length})</span>
          <button
            type="button"
            onclick="window.app.openWarehouseModal()"
            class="text-emerald-400 hover:text-emerald-300 text-xs font-bold"
          >+ Añadir Trabajador</button>
        </div>

        ${workerWarehouses.length === 0 ? `
          <div class="text-xs text-slate-400 py-4 text-center bg-slate-900/60 rounded-xl border border-slate-800">
            Añade un almacén para cada trabajador y aquí aparecerá su enlace privado de acceso limitado.
          </div>
        ` : `
          <div class="space-y-2">
            ${workerWarehouses.map(wh => `
              <div class="bg-slate-900/85 p-3 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <div class="font-bold text-white">${wh.icon || '👤'} ${this._escapeHtml(wh.name)}</div>
                  <div class="text-[10px] text-slate-400">
                    ${wh.workerName ? `👤 ${this._escapeHtml(wh.workerName)} • ` : ''}PIN: <strong class="text-indigo-300 font-mono tracking-wider">${this._escapeHtml(wh.workerPin || '----')}</strong>
                  </div>
                </div>
                <div class="flex items-center gap-1.5">
                  <button
                    type="button"
                    onclick="window.app.openWorkerInviteModal('${wh.id}')"
                    class="btn-pressable bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 px-2.5 py-1.5 rounded-lg text-[11px] font-bold"
                  >📲 Enlace / Invitar</button>
                  <button
                    type="button"
                    onclick="window.app.enterWorkerView('${wh.id}')"
                    class="btn-pressable bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 px-2.5 py-1.5 rounded-lg text-[11px] font-bold"
                  >👁️ Probar</button>
                  <button
                    type="button"
                    onclick="window.app.openWarehouseModal('${wh.id}')"
                    class="btn-pressable bg-slate-800 hover:bg-slate-700 text-slate-200 px-2 py-1.5 rounded-lg border border-slate-700 text-[11px]"
                  >✏️</button>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>

      <!-- 3. Gestión rápida de Almacenes y Trabajadores -->
      <div class="ios-card mb-4">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-sm font-bold text-white flex items-center gap-2">
            <span>🏢</span> Todos los Almacenes (${warehouses.length})
          </h3>
          <button 
            onclick="window.app.openWarehouseModal()"
            class="btn-pressable bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-xl"
          >+ Añadir</button>
        </div>
        <div class="space-y-2">
          ${warehouses.map(wh => `
            <div class="flex items-center justify-between bg-slate-900/80 p-2.5 rounded-xl border border-slate-800 text-xs">
              <div class="flex items-center gap-2">
                <span class="text-base">${wh.icon || '🏠'}</span>
                <div>
                  <div class="font-bold text-white">${this._escapeHtml(wh.name)}</div>
                  <div class="text-[10px] text-slate-400">${wh.isMain ? 'Almacén Principal' : `👤 ${this._escapeHtml(wh.workerName || 'Trabajador')} • PIN: ${this._escapeHtml(wh.workerPin || '----')}`}</div>
                </div>
              </div>
              <button 
                onclick="window.app.openWarehouseModal('${wh.id}')"
                class="btn-pressable bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1 rounded-lg border border-slate-700 text-[11px] font-semibold"
              >✏️ Editar</button>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Copias de Seguridad -->
      <div class="ios-card mb-4">
        <h3 class="text-sm font-bold text-white mb-2 flex items-center gap-2">
          <span>💾</span> Copias de Seguridad Locales (${APP_VERSION})
        </h3>
        <p class="text-xs text-slate-400 mb-3 leading-relaxed">
          Tus datos (productos, stock por almacén, trabajadores, repartos y ventas) se guardan en este dispositivo (${this.storageAgent.isIndexedDBSupported ? 'IndexedDB' : 'LocalStorage'}).
        </p>

        <div class="grid grid-cols-2 gap-2">
          <button 
            onclick="window.app.exportDataBackup()"
            class="btn-pressable bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold py-3 px-3 rounded-xl border border-slate-700 flex items-center justify-center gap-1.5"
          >
            <span>📥</span> Descargar Copia
          </button>
          
          <label class="btn-pressable bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold py-3 px-3 rounded-xl border border-slate-700 flex items-center justify-center gap-1.5 cursor-pointer text-center">
            <span>📤</span> Restaurar Copia
            <input type="file" id="importBackupInput" accept=".json" class="hidden" onchange="window.app.importDataBackup(event)"/>
          </label>
        </div>
      </div>

      <!-- Estado y Gestión de Datos -->
      <div class="ios-card mb-4">
        <h3 class="text-sm font-bold text-white mb-2">Estado del Almacenamiento</h3>
        <div class="text-xs text-slate-400 space-y-1.5 mb-4">
          <div class="flex justify-between">
            <span>Sabores / Productos registrados:</span>
            <span class="font-bold text-white">${products.length}</span>
          </div>
          <div class="flex justify-between">
            <span>Almacenes / Casas de trabajadores:</span>
            <span class="font-bold text-white">${warehouses.length}</span>
          </div>
          <div class="flex justify-between">
            <span>Ventas históricas registradas:</span>
            <span class="font-bold text-white">${sales.length}</span>
          </div>
          <div class="flex justify-between">
            <span>Repartos de stock registrados:</span>
            <span class="font-bold text-white">${transfers.length}</span>
          </div>
          <div class="flex justify-between">
            <span>Modo Offline:</span>
            <span class="font-bold text-emerald-400">Activo (Cache PWA ${APP_VERSION})</span>
          </div>
        </div>

        <div class="space-y-2 pt-2 border-t border-slate-700/60">
          <button 
            onclick="window.app.resetDemoData()"
            class="w-full text-xs font-semibold text-emerald-400 hover:text-emerald-300 py-3 px-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-center flex items-center justify-center gap-1.5"
          >
            <span>🔄</span> Reiniciar Catálogo Oficial (10 Sabores • 6,70€ / 12€)
          </button>
        </div>
      </div>

      <div class="text-center text-[11px] text-slate-500 pb-12">
        Gestor Privado de Inventario y Ventas Multi-Almacén ${APP_VERSION} (iOS 18 + Supabase + ntfy Live)<br/>
        Arquitectura Modular por Agentes • Diseñado para iOS
      </div>
    `;

    container.innerHTML = html;
  }

  // =========================================================================
  // CONTROLADORES DE ROLES / PIN, INVITACIONES DE TRABAJADOR, NTFY Y CLOUD SYNC
  // =========================================================================
  async openPinAuthModal() {
    const modal = document.getElementById('pinAuthModal');
    const body = document.getElementById('pinAuthModalBody');
    if (!modal || !body) return;

    const session = this.authAgent.getSession();
    const isWorker = this.authAgent.isWorker();
    const warehouses = await this.inventoryAgent.getWarehouses();
    const workerWhs = warehouses.filter(w => !w.isMain);

    body.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <div>
          <h3 class="text-lg font-black text-white">🔐 Acceso y Cambio de Perfil</h3>
          <span class="text-xs text-slate-400">
            Sesión actual: ${isWorker ? `👤 ${this._escapeHtml(session.workerName)} (${this._escapeHtml(session.warehouseName)})` : '👑 Jefe (Acceso Total)'}
          </span>
        </div>
        <button onclick="document.getElementById('pinAuthModal').classList.remove('active')" class="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center font-bold">✕</button>
      </div>

      <form onsubmit="event.preventDefault(); window.app.submitPinAuthModal();" class="space-y-3 mb-4">
        <div class="bg-slate-900/80 p-3.5 rounded-2xl border border-white/10">
          <label class="text-xs text-slate-300 font-bold block mb-2 text-center">
            ${isWorker ? 'Introduce el PIN del Jefe para desbloquear todo (o el PIN de otro trabajador)' : 'Introduce un PIN de Trabajador o PIN de Jefe'}
          </label>
          <input
            type="password"
            inputmode="numeric"
            id="pinAuthInput"
            placeholder="••••"
            autofocus
            class="w-full bg-slate-950 text-white text-center text-2xl font-black tracking-[0.5em] py-3 rounded-xl border border-slate-700 focus:outline-none focus:border-emerald-500"
          />
        </div>
        <button type="submit" class="btn-primary btn-pressable">
          <span>🔓 Confirmar PIN</span>
        </button>
      </form>

      ${!isWorker && workerWhs.length > 0 ? `
        <div class="pt-3 border-t border-slate-800">
          <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Entrar rápido en vista de un trabajador:</div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            ${workerWhs.map(w => `
              <button
                type="button"
                onclick="window.app.enterWorkerView('${w.id}')"
                class="btn-pressable bg-slate-900/90 hover:bg-slate-800 p-2.5 rounded-xl border border-slate-700 flex items-center justify-between text-xs"
              >
                <span class="font-bold text-white">${w.icon || '👤'} ${this._escapeHtml(w.name)}</span>
                <span class="text-[10px] text-indigo-300 font-mono">PIN: ${this._escapeHtml(w.workerPin)}</span>
              </button>
            `).join('')}
          </div>
        </div>
      ` : ''}
    `;

    modal.classList.add('active');
    this._playChime('tap');
  }

  async submitPinAuthModal() {
    const pin = document.getElementById('pinAuthInput')?.value || '';
    const res = await this.authAgent.loginWithPin(pin);
    if (!res.success) {
      this.showToast(res.error || 'PIN incorrecto', '⚠️');
      return;
    }

    document.getElementById('pinAuthModal')?.classList.remove('active');
    this._applySessionStateAndRefresh(res.session);
  }

  async enterWorkerView(warehouseId) {
    try {
      const res = await this.authAgent.enterWorkerMode(warehouseId);
      document.getElementById('pinAuthModal')?.classList.remove('active');
      document.getElementById('workerInviteModal')?.classList.remove('active');
      this._applySessionStateAndRefresh(res.session);
    } catch (err) {
      alert(err.message);
    }
  }

  async _applySessionStateAndRefresh(session) {
    this.lastCompletedSale = null;
    this.selectedProductForSale = null;
    this.salesSearchQuery = '';
    this.inventorySearchQuery = '';
    this.analyticsOrderFilter = 'all';
    this.newOrderDraft = null;
    this.batchTransferQuantities = {};

    if (session.role === 'worker' && session.warehouseId) {
      this.activeSaleWarehouseId = session.warehouseId;
      this.saleWarehouseId = session.warehouseId;
      this.selectedInventoryWarehouse = session.warehouseId;
      this.analyticsWarehouseFilter = session.warehouseId;
      this.stockMsgOptions.warehouseId = session.warehouseId;
      this.inventorySubView = 'stock';
      this.showToast(`Modo Trabajador: ${session.workerName || session.warehouseName}`, '👤');
    } else {
      this.activeSaleWarehouseId = MAIN_WAREHOUSE_ID;
      this.selectedInventoryWarehouse = 'all';
      this.analyticsWarehouseFilter = 'all';
      this.stockMsgOptions.warehouseId = MAIN_WAREHOUSE_ID;
      this.showToast('Modo Jefe Activado (Acceso Total)', '👑');
    }

    this._playChime('success');
    this.applyRoleUI();
    await this.switchTab('sales');
    await this.updateHeaderQuickStats();
  }

  async openWorkerInviteModal(warehouseId) {
    const wh = await this.inventoryAgent.getWarehouse(warehouseId);
    if (!wh || wh.isMain) return;

    const modal = document.getElementById('workerInviteModal');
    const body = document.getElementById('workerInviteModalBody');
    if (!modal || !body) return;

    if (!this.supabaseAgent.isConfigured()) {
      this.cloudSyncAgent.publishFullState().catch(() => {});
    }

    const topic = this.notificationsAgent.getSettings().topic;
    const sbCfg = this.supabaseAgent.isConfigured() ? this.supabaseAgent.getConfig() : null;
    const invite = this.authAgent.buildWorkerInviteData(wh, topic, sbCfg);
    this._lastWorkerInviteData = invite;

    body.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <div>
          <h3 class="text-base font-black text-white">📲 Invitar a ${this._escapeHtml(invite.workerName)}</h3>
          <span class="text-xs text-slate-400">Acceso limitado solo a: ${this._escapeHtml(invite.warehouseName)}</span>
        </div>
        <button onclick="document.getElementById('workerInviteModal').classList.remove('active')" class="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center font-bold">✕</button>
      </div>

      <div class="bg-slate-900/90 p-3 rounded-2xl border border-indigo-500/35 mb-3 space-y-2">
        <div class="flex items-center justify-between text-xs">
          <span class="text-slate-400">PIN Personal del Trabajador:</span>
          <span class="px-2.5 py-1 rounded-lg bg-indigo-500/20 border border-indigo-500/40 text-indigo-200 font-black font-mono tracking-widest">${this._escapeHtml(invite.pin)}</span>
        </div>
        <div>
          <div class="text-[10px] text-slate-400 mb-1">Enlace directo de acceso automático:</div>
          <div class="text-[11px] font-mono text-emerald-300 bg-slate-950 p-2 rounded-xl border border-slate-800 break-all select-all">
            ${this._escapeHtml(invite.inviteUrl)}
          </div>
        </div>
      </div>

      <div class="space-y-2">
        <a
          href="https://wa.me/?text=${encodeURIComponent(invite.whatsappText)}"
          target="_blank"
          rel="noopener noreferrer"
          class="btn-primary btn-pressable"
          style="text-decoration:none;"
        >
          <span>💬</span> Enviar Acceso por WhatsApp
        </a>
        <div class="grid grid-cols-2 gap-2">
          <button
            type="button"
            onclick="window.app.copyWorkerInviteLink()"
            class="btn-pressable bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold py-2.5 px-3 rounded-xl border border-slate-700"
          >🔗 Copiar Enlace</button>
          <button
            type="button"
            onclick="window.app.copyWorkerInviteMessage()"
            class="btn-pressable bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold py-2.5 px-3 rounded-xl border border-slate-700"
          >📋 Copiar Mensaje</button>
        </div>
        <button
          type="button"
          onclick="window.app.enterWorkerView('${wh.id}')"
          class="w-full py-2.5 text-xs font-bold text-indigo-300 hover:text-white rounded-xl border border-indigo-500/30 bg-indigo-950/30"
        >👁️ Probar en este móvil cómo lo verá ${this._escapeHtml(invite.workerName)}</button>
      </div>
    `;

    modal.classList.add('active');
    this._playChime('tap');
  }

  async _copyTextToClipboard(text, okMessage) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      this._playChime('success');
      this.showToast(okMessage, '📋');
    } catch (err) {
      alert('No se pudo copiar automáticamente.');
    }
  }

  async copyWorkerInviteLink() {
    if (!this._lastWorkerInviteData) return;
    await this._copyTextToClipboard(this._lastWorkerInviteData.inviteUrl, 'Enlace del trabajador copiado');
  }

  async copyWorkerInviteMessage() {
    if (!this._lastWorkerInviteData) return;
    await this._copyTextToClipboard(this._lastWorkerInviteData.whatsappText, 'Mensaje de invitación copiado');
  }

  async copyNtfyTopic() {
    const raw = document.getElementById('inputNtfyTopic')?.value || '';
    const cleaned = raw.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    const topic = cleaned || this.notificationsAgent.getSettings().topic;
    await this._copyTextToClipboard(topic, `Canal ntfy "${topic}" copiado`);
  }

  saveNtfySettingsFromView(showSuccessToast = false) {
    const topic = document.getElementById('inputNtfyTopic')?.value;
    const enabled = document.getElementById('chkNtfyEnabled')?.checked;
    const notifyWorkerSales = document.getElementById('chkNtfyWorkers')?.checked;
    const notifyReservations = document.getElementById('chkNtfyRes')?.checked;
    const notifyBossSales = document.getElementById('chkNtfyBoss')?.checked;

    const saved = this.notificationsAgent.saveSettings({
      ...(topic !== undefined ? { topic } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
      ...(notifyWorkerSales !== undefined ? { notifyWorkerSales } : {}),
      ...(notifyReservations !== undefined ? { notifyReservations } : {}),
      ...(notifyBossSales !== undefined ? { notifyBossSales } : {})
    });

    const badge = document.getElementById('ntfyStatusBadge');
    if (badge) {
      badge.textContent = saved.enabled ? '● Activo' : 'Pausado';
      badge.className = `badge ${saved.enabled ? 'badge-ok-stock' : 'badge-low-stock'} text-[10px]`;
    }
    const codeEl = document.getElementById('ntfyGuideTopicCode');
    if (codeEl) {
      codeEl.textContent = saved.topic;
    }

    if (this.supabaseAgent.isConfigured()) {
      this.cloudSyncAgent._closeLiveStream();
    } else {
      this.cloudSyncAgent.restartLiveStream();
    }
    this.applyRoleUI();

    if (showSuccessToast) {
      this._playChime('success');
      this.showToast('Canal ntfy guardado y sincronización reconectada', '🔔');
      this.renderSettingsView();
    }
  }

  async testNtfyNotification() {
    this.saveNtfySettingsFromView(false);
    try {
      const res = await this.notificationsAgent.sendTestNotification();
      if (res && res.success) {
        this._playChime('success');
        this.showToast(`Notificación enviada al canal "${res.topic}"`, '🔔');
      } else {
        this.showToast('Error enviando prueba a ntfy.sh (revisa tu conexión)', '⚠️');
      }
    } catch (err) {
      alert(`Error enviando notificación: ${err.message}`);
    }
  }

  async syncFullStateToCloud() {
    this.saveNtfySettingsFromView(false);
    if (this.supabaseAgent.isConfigured()) {
      await this.pushLocalToSupabaseNow();
      return;
    }
    const res = await this.cloudSyncAgent.publishFullState();
    if (res && res.published) {
      this._playChime('success');
      this.showToast('Catálogo y stock sincronizados en la nube', '☁️');
    } else {
      this.showToast('No se pudo publicar en la nube (revisa conexión)', '⚠️');
    }
  }

  async pullCloudSyncNow() {
    try {
      if (this.supabaseAgent.isConfigured()) {
        await this.supabaseAgent.syncFromCloud();
      } else {
        const res = await this.cloudSyncAgent.pullCachedEvents();
        if (res && res.synced === false) {
          this.showToast('No hay cambios nuevos o falla la conexión', '⚠️');
          return;
        }
      }
      this._playChime('success');
      this.showToast('Stock sincronizado desde la nube', '☁️');
      await this.renderCurrentTab();
      await this.updateHeaderQuickStats();
    } catch (err) {
      this.showToast(`Error sincronizando: ${err?.message || 'sin conexión'}`, '⚠️');
    }
  }

  async saveSupabaseConfigFromView() {
    const url = document.getElementById('inputSupabaseUrl')?.value || '';
    const anonKey = document.getElementById('inputSupabaseAnonKey')?.value || '';

    try {
      const res = await this.supabaseAgent.saveConfig({
        url,
        anonKey,
        onRemoteEvent: (evt) => this.handleRemoteSyncEvent(evt)
      });
      if (this.supabaseAgent.isConfigured()) {
        this.cloudSyncAgent._closeLiveStream();
      } else {
        await this.cloudSyncAgent.init((evt) => this.handleRemoteSyncEvent(evt));
      }
      if (res && res.connected) {
        this._playChime('success');
        this.showToast('¡Conectado a Supabase PostgreSQL en vivo!', '🗄️');
      } else if (res && res.error) {
        this.showToast(`Error conectando: ${res.error}`, '⚠️');
      } else {
        this.showToast('Configuración de Supabase guardada', '💾');
      }
      this.applyRoleUI();
      await this.renderCurrentTab();
      await this.updateHeaderQuickStats();
    } catch (err) {
      alert(`Error conectando con Supabase: ${err.message}`);
    }
  }

  async pushLocalToSupabaseNow() {
    try {
      await this.supabaseAgent.pushAllLocalToCloud();
      this._playChime('success');
      this.showToast('Todos tus datos locales subidos a Supabase', '⬆️');
      await this.renderSettingsView();
    } catch (err) {
      alert(`Error subiendo datos a Supabase: ${err.message}`);
    }
  }

  async pullFromSupabaseNow() {
    try {
      await this.supabaseAgent.syncFromCloud();
      this._playChime('success');
      this.showToast('Datos descargados desde Supabase', '⬇️');
      await this.renderCurrentTab();
      await this.updateHeaderQuickStats();
    } catch (err) {
      alert(`Error descargando de Supabase: ${err.message}`);
    }
  }

  async saveBossPinFromSettings() {
    const newPin = document.getElementById('inputSettingsBossPin')?.value || '';
    try {
      await this.authAgent.setBossPin(newPin);
      this._playChime('success');
      this.showToast('PIN de Jefe actualizado correctamente', '🔐');
    } catch (err) {
      alert(err.message);
    }
  }

  async exportDataBackup() {
    try {
      const backup = await this.storageAgent.exportBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `backup_inventario_ventas_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this.showToast('Copia descargada correctamente', '💾');
    } catch (e) {
      alert(`Error al exportar: ${e.message}`);
    }
  }

  async importDataBackup(event) {
    const inputEl = event.target;
    const file = inputEl?.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const json = JSON.parse(e.target.result);
        if (confirm('¿Restaurar esta copia de seguridad? Se reemplazarán los datos actuales.')) {
          await this.storageAgent.importBackup(json);
          this.lastCompletedSale = null;
          this.analyticsOrderFilter = 'all';
          this.newOrderDraft = null;
          this.batchTransferQuantities = {};
          if (this.supabaseAgent.isConfigured()) {
            await this.supabaseAgent.replaceCloudWithLocal();
          }
          this.scheduleCloudSnapshotPublish();
          this._playChime('success');
          this.showToast('Copia restaurada con éxito', '✓');
          await this.renderSettingsView();
          await this.updateHeaderQuickStats();
        }
      } catch (err) {
        alert('Archivo de copia no válido: ' + err.message);
      } finally {
        if (inputEl) inputEl.value = '';
      }
    };
    reader.readAsText(file);
  }

  async resetDemoData() {
    if (!confirm('¿Reiniciar el catálogo a los 10 sabores oficiales con 10 unidades cada uno en el Almacén Principal? (Se borrarán las ventas, pedidos y reservas actuales tanto en local como en Supabase)')) {
      return;
    }
    try {
      await this.storageAgent.setNewProductCatalog();
      this.lastCompletedSale = null;
      this.analyticsOrderFilter = 'all';
      this.batchTransferQuantities = {};
      this.newOrderDraft = null;
      if (this.supabaseAgent.isConfigured()) {
        await this.supabaseAgent.replaceCloudWithLocal();
      } else {
        this.scheduleCloudSnapshotPublish();
      }
      this._playChime('success');
      this.showToast('¡10 Sabores cargados en local y nube!', '✓');
      await this.switchTab('sales');
      await this.updateHeaderQuickStats();
    } catch (err) {
      alert(`Catálogo reiniciado en local, pero hubo un error sincronizando borrados en Supabase: ${err.message}`);
    }
  }

  // =========================================================================
  // MÉTRICAS DE CADA PEDIDO Y MODAL DE NUEVO PEDIDO / RECUENTO
  // =========================================================================

  _buildOrdersMetricsSectionHtml(ordersMetrics) {
    if (!ordersMetrics || !ordersMetrics.orders || ordersMetrics.orders.length === 0) {
      return '';
    }

    const orders = ordersMetrics.orders;

    return `
      <div class="ios-card ios-card-glow-indigo mb-4">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h3 class="text-sm font-black uppercase tracking-wider text-white flex items-center gap-1.5">
              <span>📦</span> Rendimiento y Métricas por Pedido (${orders.length})
            </h3>
            <p class="text-[11px] text-slate-300 mt-0.5">
              Compara cuánto has invertido, facturado y ganado en cada pedido al proveedor.
            </p>
          </div>
          <button
            type="button"
            onclick="window.app.openNewOrderModal()"
            class="btn-pressable bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-xl text-[11px] font-bold shadow-md shadow-emerald-900/30"
          >+ Nuevo Pedido / Recuento</button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          ${orders.map(ord => {
            const isSelected = this.analyticsOrderFilter === ord.id;
            const isActive = ord.status === 'active';
            const dateStr = ord.createdAt
              ? new Date(ord.createdAt).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })
              : '';

            return `
              <div class="bg-slate-900/90 p-3.5 rounded-2xl border ${
                isSelected ? 'border-emerald-400' : isActive ? 'border-emerald-500/40' : 'border-slate-700/70'
              }">
                <div class="flex items-start justify-between gap-2 mb-2.5">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <h4 class="text-sm font-black text-white truncate">${this._escapeHtml(ord.name)}</h4>
                      <span class="badge ${isActive ? 'badge-ok-stock' : 'badge-warehouse'} text-[9.5px]">
                        ${isActive ? '🟢 Activo' : '🏁 Terminado'}
                      </span>
                    </div>
                    <div class="text-[10px] text-slate-400 mt-0.5">
                      ${dateStr}${(ord.supplier || ord.notes) ? ` • ${this._escapeHtml(ord.supplier || ord.notes)}` : ''} • ${ord.flavorsCount} sabores (${ord.initialUnits} uds)
                    </div>
                  </div>
                  <span class="badge ${ord.roiPct >= 0 ? 'badge-ok-stock' : 'badge-low-stock'} text-[10px] flex-shrink-0">
                    ROI: ${ord.roiPct}%
                  </span>
                </div>

                <!-- 4 cifras clave del pedido -->
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-center mb-2.5 tabular-nums">
                  <div class="bg-slate-950/65 p-2 rounded-xl border border-slate-800">
                    <div class="text-[9.5px] text-slate-400 uppercase">Inversión</div>
                    <div class="text-xs font-black text-slate-200 mt-0.5">${ord.initialCost.toFixed(2)}€</div>
                  </div>
                  <div class="bg-slate-950/65 p-2 rounded-xl border border-slate-800">
                    <div class="text-[9.5px] text-indigo-300 uppercase">Facturado</div>
                    <div class="text-xs font-black text-white mt-0.5">${ord.billed.toFixed(2)}€</div>
                  </div>
                  <div class="bg-emerald-950/40 p-2 rounded-xl border border-emerald-500/30">
                    <div class="text-[9.5px] text-emerald-300 uppercase">Beneficio</div>
                    <div class="text-xs font-black text-emerald-400 mt-0.5">+${ord.profit.toFixed(2)}€</div>
                  </div>
                  <div class="bg-slate-950/65 p-2 rounded-xl border border-slate-800">
                    <div class="text-[9.5px] text-slate-400 uppercase">Margen</div>
                    <div class="text-xs font-black text-white mt-0.5">${ord.profitMargin}%</div>
                  </div>
                </div>

                <!-- Barra de progreso de unidades vendidas del pedido -->
                <div class="mb-2.5">
                  <div class="flex items-center justify-between text-[10px] text-slate-300 mb-1">
                    <span>Progreso del pedido: <strong>${ord.unitsSold} / ${ord.initialUnits} uds</strong> vendidas</span>
                    <span class="text-emerald-400 font-bold">${ord.sellThroughPct}% (${ord.remainingUnits} rest.)</span>
                  </div>
                  <div class="progress-track">
                    <div class="progress-fill-emerald" style="width: ${Math.min(100, ord.sellThroughPct)}%"></div>
                  </div>
                </div>

                <div class="flex flex-wrap items-center justify-between text-[10px] text-slate-400 mb-2.5 gap-1">
                  <span>💵 ${ord.cashBilled.toFixed(0)}€ • 💳 ${ord.cardBilled.toFixed(0)}€${ord.pendingDebtBilled > 0 ? ` • ⏳ ${ord.pendingDebtBilled.toFixed(0)}€` : ''}</span>
                  <span>${ord.transactionCount} ventas (ticket ${ord.avgTicket.toFixed(2)}€)</span>
                </div>

                ${ord.topFlavors && ord.topFlavors.length > 0 ? `
                  <div class="text-[10px] text-slate-300 bg-slate-950/50 px-2.5 py-1.5 rounded-xl border border-slate-800/80 mb-2.5 truncate">
                    ⭐ Top: ${ord.topFlavors.map(f => `${this._escapeHtml(f.name)} (${f.unitsSold})`).join(' · ')}
                  </div>
                ` : ''}

                <div class="flex items-center gap-1.5">
                  <button
                    type="button"
                    onclick="window.app.setAnalyticsOrderFilter('${this._escJsAttr(isSelected ? 'all' : ord.id)}')"
                    class="btn-pressable flex-1 py-1.5 px-2.5 rounded-xl text-[11px] font-bold border ${
                      isSelected
                        ? 'bg-emerald-500/25 text-emerald-200 border-emerald-500/50'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                    }"
                  >
                    ${isSelected ? '✓ Viendo este pedido (Ver Todos)' : '🔍 Filtrar Métricas por este Pedido'}
                  </button>
                  ${isActive ? `
                    <button
                      type="button"
                      onclick="window.app.closeOrderAction('${this._escJsAttr(ord.id)}')"
                      class="btn-pressable py-1.5 px-2.5 rounded-xl text-[11px] font-bold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40"
                      title="Marcar este pedido como terminado"
                    >🏁 Terminar</button>
                  ` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  setAnalyticsOrderFilter(orderId) {
    this.analyticsOrderFilter = orderId || 'all';
    this.revenueInspectedIdx = null;
    this.unitsInspectedIdx = null;
    this._playChime('tap');
    this.renderAnalyticsView();
  }

  async closeOrderAction(orderId) {
    if (!confirm('¿Marcar este pedido como terminado/cerrado? Podrás seguir consultando sus métricas en todo momento y abrir un nuevo pedido cuando te llegue mercancía.')) {
      return;
    }
    try {
      const res = await this.inventoryAgent.closeOrder(orderId);
      this._playChime('success');
      this.showToast(res.message, '🏁');
      this.scheduleCloudSnapshotPublish();
      await this.renderCurrentTab();
    } catch (err) {
      alert(err.message);
    }
  }

  async openNewOrderModal() {
    const [products, existingOrders] = await Promise.all([
      this.inventoryAgent.getProducts({ warehouseId: 'all' }),
      this.inventoryAgent.getOrders()
    ]);

    const nextNum = existingOrders.length + 1;
    const monthLabel = new Date().toLocaleDateString('es-ES', { month: 'short' }).replace('.', '');
    const suggestedName = `Pedido #${nextNum} (${monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)})`;

    this.newOrderDraft = {
      name: suggestedName,
      supplier: '',
      notes: '',
      resetExistingStock: true,
      newFlavorForm: {
        name: '',
        costPrice: '6.70',
        sellPrice: '12.00',
        quantity: '10'
      },
      existingItems: products.map(p => {
        const cp = parseFloat(p.costPrice);
        const sp = parseFloat(p.sellPrice);
        return {
          productId: p.id,
          name: p.name,
          currentStock: p.stock || 0,
          costPrice: Number.isFinite(cp) ? cp : 6.70,
          sellPrice: Number.isFinite(sp) ? sp : 12.00,
          quantity: 0
        };
      }),
      newItems: []
    };

    this.renderNewOrderModalBody();
    document.getElementById('newOrderModal')?.classList.add('active');
    this._playChime('tap');
  }

  _calcNewOrderTotals() {
    const draft = this.newOrderDraft;
    if (!draft) return { totalUnits: 0, totalFlavors: 0, totalCost: 0, totalExpected: 0 };
    const existingActive = draft.existingItems.filter(it => (parseInt(it.quantity, 10) || 0) > 0);
    const totalUnits = existingActive.reduce((s, it) => s + (parseInt(it.quantity, 10) || 0), 0)
      + draft.newItems.reduce((s, it) => s + (parseInt(it.quantity, 10) || 0), 0);
    const totalFlavors = existingActive.length + draft.newItems.length;
    const totalCost = existingActive.reduce((s, it) => s + ((parseInt(it.quantity, 10) || 0) * (Number.isFinite(parseFloat(it.costPrice)) ? parseFloat(it.costPrice) : 0)), 0)
      + draft.newItems.reduce((s, it) => s + ((parseInt(it.quantity, 10) || 0) * (Number.isFinite(parseFloat(it.costPrice)) ? parseFloat(it.costPrice) : 0)), 0);
    const totalExpected = existingActive.reduce((s, it) => s + ((parseInt(it.quantity, 10) || 0) * (Number.isFinite(parseFloat(it.sellPrice)) ? parseFloat(it.sellPrice) : 12)), 0)
      + draft.newItems.reduce((s, it) => s + ((parseInt(it.quantity, 10) || 0) * (Number.isFinite(parseFloat(it.sellPrice)) ? parseFloat(it.sellPrice) : 12)), 0);
    return { totalUnits, totalFlavors, totalCost, totalExpected };
  }

  _updateNewOrderSummaryDom(changedIdx = null, keepEmptyQty = false) {
    const draft = this.newOrderDraft;
    if (!draft) return;

    if (changedIdx !== null && draft.existingItems[changedIdx]) {
      const item = draft.existingItems[changedIdx];
      const rowEl = document.getElementById(`orderExistingRow_${changedIdx}`);
      if (rowEl) {
        rowEl.className = `bg-slate-900/85 p-2 rounded-xl border ${item.quantity > 0 ? 'border-emerald-500/50 bg-emerald-950/20' : 'border-slate-800'} flex items-center justify-between gap-2`;
      }
      const qtyInput = document.getElementById(`orderExistingQty_${changedIdx}`);
      if (qtyInput && !keepEmptyQty && document.activeElement !== qtyInput) {
        qtyInput.value = item.quantity;
      }
    }

    const { totalUnits, totalFlavors, totalCost, totalExpected } = this._calcNewOrderTotals();
    const unitsEl = document.getElementById('newOrderTotalUnitsText');
    if (unitsEl) unitsEl.textContent = `${totalUnits} uds (${totalFlavors} sabores)`;
    const moneyEl = document.getElementById('newOrderTotalMoneyText');
    if (moneyEl) moneyEl.innerHTML = `${totalCost.toFixed(2)}€ <span class="text-emerald-400">→ ${totalExpected.toFixed(2)}€</span>`;
    const btn = document.getElementById('btnConfirmNewOrder');
    if (btn) {
      btn.disabled = totalUnits <= 0;
      const lbl = document.getElementById('btnConfirmNewOrderLabel');
      if (lbl) lbl.textContent = `📦 Guardar Nuevo Pedido y Actualizar Stock (${totalUnits} uds)`;
    }
  }

  renderNewOrderModalBody() {
    const body = document.getElementById('newOrderModalBody');
    const draft = this.newOrderDraft;
    if (!body || !draft) return;

    const form = draft.newFlavorForm || (draft.newFlavorForm = { name: '', costPrice: '6.70', sellPrice: '12.00', quantity: '10' });
    const { totalUnits, totalFlavors, totalCost, totalExpected } = this._calcNewOrderTotals();

    body.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <div>
          <h3 class="text-base font-black text-white">📦 Nuevo Pedido / Recuento de Llegada</h3>
          <span class="text-xs text-slate-400">Cierra el pedido anterior y cuenta los sabores nuevos que han llegado</span>
        </div>
        <button type="button" onclick="document.getElementById('newOrderModal').classList.remove('active')" class="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center font-bold">✕</button>
      </div>

      <div class="space-y-3">
        <!-- Nombre del pedido y proveedor -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label class="text-[10px] uppercase font-bold text-slate-400 block mb-1">Nombre del Nuevo Pedido *</label>
            <input
              type="text"
              value="${this._escapeHtml(draft.name)}"
              oninput="window.app.newOrderDraft.name = this.value"
              placeholder="Ej: Pedido Noviembre..."
              class="w-full bg-slate-900 text-white px-3 py-2 rounded-xl border border-slate-700 text-xs font-bold focus:outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label class="text-[10px] uppercase font-bold text-slate-400 block mb-1">Nota o Proveedor (Opcional)</label>
            <input
              type="text"
              value="${this._escapeHtml(draft.notes)}"
              oninput="window.app.newOrderDraft.notes = this.value; window.app.newOrderDraft.supplier = this.value;"
              placeholder="Ej: Caja grande, nuevos sabores..."
              class="w-full bg-slate-900 text-white px-3 py-2 rounded-xl border border-slate-700 text-xs focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        <!-- Qué hacer con el stock anterior -->
        <div class="grid grid-cols-2 gap-2">
          <button
            type="button"
            onclick="window.app.setNewOrderMode(true)"
            class="btn-pressable p-2.5 rounded-xl border text-left transition-all ${
              draft.resetExistingStock
                ? 'border-emerald-500 bg-emerald-500/20 text-white'
                : 'border-slate-700 bg-slate-900/80 text-slate-400'
            }"
          >
            <div class="text-xs font-bold">🧹 Recuento desde 0</div>
            <div class="text-[10px] opacity-80 mt-0.5">Pone a 0 tu Almacén Principal (trabajadores y reservas se mantienen)</div>
          </button>

          <button
            type="button"
            onclick="window.app.setNewOrderMode(false)"
            class="btn-pressable p-2.5 rounded-xl border text-left transition-all ${
              !draft.resetExistingStock
                ? 'border-indigo-500 bg-indigo-500/20 text-white'
                : 'border-slate-700 bg-slate-900/80 text-slate-400'
            }"
          >
            <div class="text-xs font-bold">➕ Sumar al stock restante</div>
            <div class="text-[10px] opacity-80 mt-0.5">Mantiene lo que queda sin vender y suma lo nuevo</div>
          </button>
        </div>

        <!-- Añadir un sabor nuevo que no estaba en el catálogo -->
        <div class="bg-emerald-950/25 p-3 rounded-2xl border border-emerald-500/35">
          <div class="text-xs font-bold text-emerald-300 mb-2">✨ Añadir Sabor Nuevo que llega en este Pedido</div>
          <div class="grid grid-cols-12 gap-1.5 mb-2">
            <input
              type="text"
              id="orderNewFlavorName"
              value="${this._escapeHtml(form.name)}"
              oninput="window.app.newOrderDraft.newFlavorForm.name = this.value"
              placeholder="Nombre del sabor (ej. Watermelon Ice 🍉🧊)"
              class="col-span-12 sm:col-span-6 bg-slate-900 text-white px-2.5 py-2 rounded-xl border border-slate-700 text-xs"
            />
            <input
              type="number"
              step="0.01"
              min="0"
              id="orderNewFlavorCost"
              value="${this._escapeHtml(form.costPrice)}"
              oninput="window.app.newOrderDraft.newFlavorForm.costPrice = this.value"
              placeholder="Coste"
              title="Coste (€)"
              class="col-span-4 sm:col-span-2 bg-slate-900 text-slate-200 text-center px-2 py-2 rounded-xl border border-slate-700 text-xs"
            />
            <input
              type="number"
              step="0.01"
              min="0"
              id="orderNewFlavorSell"
              value="${this._escapeHtml(form.sellPrice)}"
              oninput="window.app.newOrderDraft.newFlavorForm.sellPrice = this.value"
              placeholder="PVP"
              title="PVP (€)"
              class="col-span-4 sm:col-span-2 bg-slate-900 text-white font-bold text-center px-2 py-2 rounded-xl border border-slate-700 text-xs"
            />
            <input
              type="number"
              min="1"
              id="orderNewFlavorQty"
              value="${this._escapeHtml(form.quantity)}"
              oninput="window.app.newOrderDraft.newFlavorForm.quantity = this.value"
              placeholder="Uds"
              title="Unidades"
              class="col-span-4 sm:col-span-2 bg-slate-900 text-emerald-400 font-black text-center px-2 py-2 rounded-xl border border-slate-700 text-xs"
            />
          </div>
          <button
            type="button"
            onclick="window.app.addNewFlavorToOrderDraft()"
            class="btn-pressable w-full py-2 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/45 text-emerald-200 border border-emerald-500/40 text-xs font-bold"
          >+ Añadir Nuevo Sabor al Recuento</button>

          ${draft.newItems.length > 0 ? `
            <div class="mt-2.5 space-y-1.5">
              ${draft.newItems.map((ni, idx) => `
                <div class="flex items-center justify-between bg-slate-900/90 px-2.5 py-1.5 rounded-xl border border-emerald-500/40 text-xs">
                  <div class="min-w-0 pr-2">
                    <span class="font-bold text-white">${this._escapeHtml(ni.name)}</span>
                    <span class="text-[10px] text-slate-400 ml-1">(${ni.costPrice.toFixed(2)}€ / ${ni.sellPrice.toFixed(2)}€)</span>
                  </div>
                  <div class="flex items-center gap-2 flex-shrink-0">
                    <span class="badge badge-ok-stock text-[11px]">${ni.quantity} uds</span>
                    <button type="button" onclick="window.app.removeNewFlavorFromOrderDraft(${idx})" class="text-rose-400 font-bold text-xs px-1">✕</button>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>

        <!-- Recuento rápido de sabores ya existentes -->
        <div>
          <div class="flex items-center justify-between text-[11px] text-slate-300 font-bold mb-1.5">
            <span>🍓 Sabores que ya conoces (pon 0 si no vinieron ahora):</span>
          </div>
          <div class="space-y-1.5 max-h-52 overflow-y-auto pr-1">
            ${draft.existingItems.map((item, idx) => `
              <div id="orderExistingRow_${idx}" class="bg-slate-900/85 p-2 rounded-xl border ${item.quantity > 0 ? 'border-emerald-500/50 bg-emerald-950/20' : 'border-slate-800'} flex items-center justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <div class="text-xs font-bold text-white truncate">${this._escapeHtml(item.name)}</div>
                  <div class="flex items-center gap-1.5 text-[10px] text-slate-400 mt-0.5">
                    <span>Coste:</span>
                    <input type="number" step="0.01" min="0" value="${item.costPrice}" oninput="window.app.setOrderExistingPrice(${idx}, 'costPrice', this.value)" class="w-12 bg-slate-950 text-slate-200 text-center rounded border border-slate-700 py-0.5 text-[10px]" />
                    <span>PVP:</span>
                    <input type="number" step="0.01" min="0" value="${item.sellPrice}" oninput="window.app.setOrderExistingPrice(${idx}, 'sellPrice', this.value)" class="w-12 bg-slate-950 text-white text-center rounded border border-slate-700 py-0.5 text-[10px]" />
                    <span class="text-slate-500">(había ${item.currentStock})</span>
                  </div>
                </div>
                <div class="flex items-center gap-1 flex-shrink-0">
                  <button type="button" onclick="window.app.stepOrderExistingQty(${idx}, -1)" class="btn-pressable w-7 h-7 rounded-lg bg-slate-800 text-white font-bold text-xs">-</button>
                  <input
                    id="orderExistingQty_${idx}"
                    type="number"
                    min="0"
                    value="${item.quantity}"
                    oninput="window.app.setOrderExistingQty(${idx}, this.value)"
                    class="w-11 text-center bg-slate-950 text-white font-black text-xs py-1 rounded-lg border border-slate-700"
                  />
                  <button type="button" onclick="window.app.stepOrderExistingQty(${idx}, 1)" class="btn-pressable w-7 h-7 rounded-lg bg-slate-800 text-white font-bold text-xs">+</button>
                  <button type="button" onclick="window.app.stepOrderExistingQty(${idx}, 5)" class="btn-pressable px-1.5 h-7 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold text-[10px]">+5</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Resumen financiero en vivo del recuento -->
        <div class="bg-slate-900/90 p-3 rounded-2xl border border-white/10 flex items-center justify-between text-xs tabular-nums">
          <div>
            <div class="text-[10px] text-slate-400">Total Recuento Nuevo Pedido</div>
            <div id="newOrderTotalUnitsText" class="text-base font-black text-white">${totalUnits} uds (${totalFlavors} sabores)</div>
          </div>
          <div class="text-right">
            <div class="text-[10px] text-slate-400">Inversión / Venta Est.</div>
            <div id="newOrderTotalMoneyText" class="text-xs font-bold text-slate-200">${totalCost.toFixed(2)}€ <span class="text-emerald-400">→ ${totalExpected.toFixed(2)}€</span></div>
          </div>
        </div>

        <button
          id="btnConfirmNewOrder"
          type="button"
          onclick="window.app.confirmSaveNewOrder()"
          ${totalUnits <= 0 ? 'disabled' : ''}
          class="btn-primary btn-pressable"
        >
          <span id="btnConfirmNewOrderLabel">📦 Guardar Nuevo Pedido y Actualizar Stock (${totalUnits} uds)</span>
        </button>
      </div>
    `;
  }

  setNewOrderMode(resetExisting) {
    if (!this.newOrderDraft) return;
    this.newOrderDraft.resetExistingStock = !!resetExisting;
    this._playChime('tap');
    this.renderNewOrderModalBody();
  }

  stepOrderExistingQty(idx, delta) {
    if (!this.newOrderDraft || !this.newOrderDraft.existingItems[idx]) return;
    const item = this.newOrderDraft.existingItems[idx];
    item.quantity = Math.max(0, (parseInt(item.quantity, 10) || 0) + delta);
    this._playChime('tap');
    this._updateNewOrderSummaryDom(idx, false);
  }

  setOrderExistingQty(idx, val) {
    if (!this.newOrderDraft || !this.newOrderDraft.existingItems[idx]) return;
    const raw = String(val ?? '').trim();
    const parsed = raw === '' ? 0 : (parseInt(raw, 10) || 0);
    this.newOrderDraft.existingItems[idx].quantity = Math.max(0, parsed);
    this._updateNewOrderSummaryDom(idx, raw === '');
  }

  setOrderExistingPrice(idx, field, val) {
    if (!this.newOrderDraft || !this.newOrderDraft.existingItems[idx]) return;
    const parsed = parseFloat(val);
    if (Number.isFinite(parsed) && parsed >= 0) {
      this.newOrderDraft.existingItems[idx][field] = parsed;
      this._updateNewOrderSummaryDom(null, true);
    }
  }

  addNewFlavorToOrderDraft() {
    if (!this.newOrderDraft) return;
    const nameEl = document.getElementById('orderNewFlavorName');
    const costEl = document.getElementById('orderNewFlavorCost');
    const sellEl = document.getElementById('orderNewFlavorSell');
    const qtyEl = document.getElementById('orderNewFlavorQty');

    const name = (nameEl?.value || '').trim();
    if (!name) {
      alert('Escribe el nombre del sabor nuevo.');
      if (nameEl) nameEl.focus();
      return;
    }

    const parsedCost = parseFloat(costEl?.value);
    const parsedSell = parseFloat(sellEl?.value);
    const parsedQty = parseInt(qtyEl?.value, 10);
    if (!Number.isFinite(parsedQty) || parsedQty < 1) {
      alert('Las unidades deben ser al menos 1.');
      if (qtyEl) qtyEl.focus();
      return;
    }
    const costPrice = (Number.isFinite(parsedCost) && parsedCost >= 0) ? parsedCost : 6.70;
    const sellPrice = (Number.isFinite(parsedSell) && parsedSell >= 0) ? parsedSell : 12.00;
    const quantity = parsedQty;

    this.newOrderDraft.newItems.push({
      name,
      category: 'Sabores',
      costPrice,
      sellPrice,
      quantity
    });

    if (this.newOrderDraft.newFlavorForm) {
      this.newOrderDraft.newFlavorForm.name = '';
    }
    this._playChime('success');
    this.renderNewOrderModalBody();
  }

  removeNewFlavorFromOrderDraft(idx) {
    if (!this.newOrderDraft) return;
    this.newOrderDraft.newItems.splice(idx, 1);
    this._playChime('tap');
    this.renderNewOrderModalBody();
  }

  async confirmSaveNewOrder() {
    return this._runLocked('confirmSaveNewOrder', async () => {
      const draft = this.newOrderDraft;
      if (!draft) return;

      try {
        const res = await this.inventoryAgent.startNewOrder({
          name: draft.name,
          supplier: draft.supplier,
          notes: draft.notes,
          resetExistingStock: draft.resetExistingStock,
          existingItems: draft.existingItems,
          newItems: draft.newItems
        });

        this.newOrderDraft = null;
        document.getElementById('newOrderModal')?.classList.remove('active');
        this._playChime('success');
        this.showToast(res.message, '📦');
        this.scheduleCloudSnapshotPublish();
        await this.renderCurrentTab();
        await this.updateHeaderQuickStats();
      } catch (err) {
        alert(`No se pudo registrar el pedido: ${err.message}`);
      }
    });
  }

  // ==========================================
  // SERVICE WORKER PARA OFFLINE
  // ==========================================
  setupServiceWorker() {
    if ('serviceWorker' in navigator) {
      const registerSW = () => {
        navigator.serviceWorker.register(`./sw.js?v=${APP_VERSION.replace(/^v/, '')}`)
          .then(reg => {
            console.log(`Service Worker ${APP_VERSION} registrado correctamente`);
            reg.update();
          })
          .catch(err => console.log('Registro SW opcional omitido:', err));

        navigator.serviceWorker.addEventListener('controllerchange', () => {
          console.log('Nuevo Service Worker activado. Recargando interfaz...');
          window.location.reload();
        });
      };

      if (document.readyState === 'complete') {
        registerSW();
      } else {
        window.addEventListener('load', registerSW, { once: true });
      }
    }
  }
}

// Inicializar y exponer al ámbito global
window.app = new AppController();
document.addEventListener('DOMContentLoaded', () => {
  window.app.init();
});
