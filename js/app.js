/**
 * Aplicación Principal - Orquestador UI Mobile-First v4.0 (iOS 18 Spatial Glass Edition)
 * 
 * Conecta los agentes autónomos de Inventario Multi-Almacén, Ventas POS,
 * Reservas de Clientes, Fiados, Comisiones de Trabajadores y Analítica Avanzada
 * con una experiencia nativa iOS 18 Spatial Glassmorphism, Dynamic Island y física elástica.
 */

import { AgentStorage, MAIN_WAREHOUSE_ID } from './agents/AgentStorage.js?v=5.6';
import { AgentInventory } from './agents/AgentInventory.js?v=5.6';
import { AgentSales } from './agents/AgentSales.js?v=5.6';
import { AgentAnalytics } from './agents/AgentAnalytics.js?v=5.6';
import { AgentAuth } from './agents/AgentAuth.js?v=5.6';
import { AgentNotifications } from './agents/AgentNotifications.js?v=5.6';
import { AgentCloudSync } from './agents/AgentCloudSync.js?v=5.6';
import { AgentSupabase } from './agents/AgentSupabase.js?v=5.6';

const APP_VERSION = 'v5.6';

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
    this.analyticsSubView = 'resumen'; // 'resumen' | 'pedidos' | 'vendedores' | 'avanzado'
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
    await this.notificationsAgent.syncWithCloudConfig({ isBoss: this.authAgent.isBoss() });

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

    if (this.authAgent.isLocked()) {
      if (this.authAgent.urlAuthError) {
        this.showToast(this.authAgent.urlAuthError, '⚠️');
      }
      setTimeout(() => this.openPinAuthModal(true), 120);
    } else if (this.authAgent.urlAuthError) {
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
    if (evt.type === 'CONFIG_SYNC' && evt.key === 'ntfy_config') {
      await this.notificationsAgent.syncWithCloudConfig({ isBoss: false });
      this.applyRoleUI();
      this._scheduleReactiveRefresh();
    } else if (evt.type === 'SALE_EVENT' && evt.sale) {
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
    const isLocked = this.authAgent.isLocked();
    const isWorker = this.authAgent.isWorker();
    const session = this.authAgent.getSession();

    const roleBadge = document.getElementById('headerRoleBadge');
    const subtitleEl = document.getElementById('headerSubtitleText');
    const allTimePill = document.getElementById('headerAllTimeStatsPill');
    const todayProfitEl = document.getElementById('headerTodayProfit');
    const analyticsTabLabel = document.querySelector('.tab-btn[data-tab="analytics"] span');

    if (roleBadge) {
      if (isLocked) {
        roleBadge.textContent = '🔒 PIN';
        roleBadge.className = 'btn-pressable px-3 py-1.5 rounded-full text-xs font-medium bg-amber-500/20 border border-amber-400/35 text-amber-200 transition whitespace-nowrap';
      } else if (isWorker) {
        roleBadge.textContent = session.workerName || session.warehouseName || 'Trabajador';
        roleBadge.className = 'btn-pressable px-3 py-1.5 rounded-full text-xs font-medium bg-indigo-500/20 border border-indigo-400/30 text-indigo-200 hover:bg-indigo-500/30 transition whitespace-nowrap';
      } else {
        roleBadge.textContent = 'Jefe';
        roleBadge.className = 'btn-pressable px-3 py-1.5 rounded-full text-xs font-medium bg-white/10 border border-white/15 text-slate-200 hover:bg-white/15 transition whitespace-nowrap';
      }
    }

    if (subtitleEl) {
      const sbLive = this.supabaseAgent.isConfigured();
      subtitleEl.textContent = isWorker
        ? `${session.warehouseName}${sbLive ? ' • Cloud' : ''}`
        : `${sbLive ? 'Supabase Live' : 'Modo Local'} • ${this.notificationsAgent.getSettings().topic}`;
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
    let mainEmoji = emojiMatch && emojiMatch.length > 0 ? emojiMatch[0] : null;

    if (!mainEmoji) {
      if (lower.includes('juicy peach')) mainEmoji = '🍑';
      else if (lower.includes('blueberry watermelon')) mainEmoji = '🍉';
      else if (lower.includes('lemon peach')) mainEmoji = '🍑';
      else if (lower.includes('dragon')) mainEmoji = '🐉';
      else if (lower.includes('mixed berries')) mainEmoji = '🫐';
      else if (lower.includes('love 66') || lower.includes('love')) mainEmoji = '🍈';
      else if (lower.includes('tropical')) mainEmoji = '🍍';
      else if (lower.includes('lemon lime')) mainEmoji = '🍋';
      else if (lower.includes('cola')) mainEmoji = '🥤';
      else if (lower.includes('energy')) mainEmoji = '⚡';
      else if (lower.includes('pineapple')) mainEmoji = '🍍';
      else if (lower.includes('pink lemonade')) mainEmoji = '🌸';
      else if (lower.includes('strawberry')) mainEmoji = '🍓';
      else if (lower.includes('coconut') || lower.includes('coco')) mainEmoji = '🥥';
      else mainEmoji = '✨';
    }

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
          if (overlay.id === 'pinAuthModal' && this.authAgent.isLocked()) return;
          overlay.classList.remove('active');
        }
      });
    });

    document.querySelectorAll('.btn-close-modal').forEach(btn => {
      btn.addEventListener('click', () => {
        const modal = btn.closest('.modal-overlay');
        if (modal) {
          if (modal.id === 'pinAuthModal' && this.authAgent.isLocked()) return;
          modal.classList.remove('active');
        }
      });
    });

    const handleResumeSync = () => {
      if (!this.supabaseAgent.isConfigured()) return;
      const now = Date.now();
      if (this._lastResumeSyncAt && now - this._lastResumeSyncAt < 5000) return;
      this._lastResumeSyncAt = now;
      this.supabaseAgent.reconnectAndSync()
        .then(() => this.notificationsAgent.syncWithCloudConfig({ isBoss: this.authAgent.isBoss() }))
        .catch(() => {});
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
    const navTitleEl = document.getElementById('headerNavTitle');
    if (navTitleEl) {
      const titles = {
        sales: 'Vender',
        inventory: 'Almacén',
        analytics: this.authAgent.isWorker() ? 'Mis Ventas' : 'Métricas',
        settings: 'Ajustes'
      };
      navTitleEl.textContent = titles[tabName] || 'Vender';
    }

    document.querySelectorAll('.tab-view').forEach(view => {
      view.classList.add('hidden');
    });

    const target = document.getElementById(`view-${tabName}`);
    if (target) target.classList.remove('hidden');

    return this.renderCurrentTab();
  }

  async renderCurrentTab() {
    if (this.authAgent.isLocked()) {
      ['view-sales', 'view-inventory', 'view-analytics', 'view-settings'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = `
          <div class="ios-glass-card p-6 text-center space-y-3 mt-4">
            <div class="text-3xl">🔐</div>
            <h3 class="text-base font-bold text-white">Acceso bloqueado con PIN</h3>
            <p class="text-xs text-slate-400">Introduce tu PIN personal (Trabajador o Jefe) para continuar.</p>
            <button
              type="button"
              onclick="window.app.openPinAuthModal(true)"
              class="btn-pressable px-5 py-2.5 rounded-full bg-white text-slate-950 text-xs font-semibold"
            >Introducir PIN</button>
          </div>
        `;
      });
      return;
    }

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

    if (this.authAgent.isLocked()) {
      if (todayRevEl) todayRevEl.textContent = '0.00€';
      if (todayProfEl) todayProfEl.textContent = '';
      if (allTimeRevEl) allTimeRevEl.textContent = '';
      if (allTimeProfEl) allTimeProfEl.textContent = '';
      return;
    }

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

    const [warehouses, valuation, allActiveReservations, allSalesRaw, allSettlementsRaw] = await Promise.all([
      this.inventoryAgent.getWarehouses(),
      this.inventoryAgent.getInventoryValuation('all'),
      this.inventoryAgent.getReservations({ status: 'active', warehouseId: isWorker ? assignedWhId : 'all' }),
      this.storageAgent.getAllSales(),
      this.storageAgent.getAllSettlements()
    ]);

    const allSales = isWorker
      ? allSalesRaw.filter(s => (s.warehouseId || MAIN_WAREHOUSE_ID) === assignedWhId)
      : allSalesRaw;
    const activeReservations = allActiveReservations;

    const customerAccountsSummary = this.analyticsAgent.computeCustomerAccounts(
      allSalesRaw,
      allSettlementsRaw,
      isWorker ? assignedWhId : 'all'
    );
    const pendingSales = customerAccountsSummary.pendingSales || [];
    const totalPendingDebtAmount = customerAccountsSummary.totalPendingDebtAmount || 0;

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
      <div class="space-y-3 mb-4">
        <!-- Search Bar iOS 27 -->
        <div class="relative">
          <input 
            type="text" 
            id="salesSearchInput" 
            value="${this._escapeHtml(this.salesSearchQuery || '')}"
            placeholder="Buscar sabor o reserva" 
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
            class="w-full bg-white/10 border border-white/10 rounded-2xl px-4 py-2.5 pr-9 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-white/25"
          />
          <button type="button" id="btnClearSalesSearch" class="${this.salesSearchQuery ? '' : 'hidden'} absolute right-3.5 top-2.5 text-slate-400 hover:text-white text-sm font-bold">✕</button>
        </div>

        <!-- Compact Quick Bar: Warehouse Pills + Pending Badges + Actions -->
        <div class="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
          ${isWorker ? `
            <span class="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-white text-slate-950 whitespace-nowrap">
              ${this._escapeHtml(activeWhObj?.name || this.authAgent.getSession().warehouseName)}
            </span>
          ` : warehouses.map(wh => {
            const isSelected = wh.id === this.activeSaleWarehouseId;
            const shortName = wh.isMain ? 'Principal' : (wh.workerName || wh.name);
            return `
              <button 
                type="button"
                onclick="window.app.setSaleWarehouse('${wh.id}')"
                class="btn-pressable px-3.5 py-1.5 rounded-full text-xs whitespace-nowrap transition ${
                  isSelected
                    ? 'bg-white text-slate-950 font-semibold'
                    : 'bg-white/10 text-slate-300 border border-white/10 font-medium hover:bg-white/15'
                }"
              >${this._escapeHtml(shortName)}</button>
            `;
          }).join('')}

          <button 
            type="button"
            onclick="window.app.openReservationModal(null, '${this.activeSaleWarehouseId}')"
            class="btn-pressable px-3 py-1.5 rounded-full text-xs font-medium bg-purple-400/15 text-purple-200 border border-purple-400/20 whitespace-nowrap"
          >${activeReservations.length} reservas</button>

          <button 
            type="button"
            onclick="window.app.openCustomerDebtorsModal()"
            class="btn-pressable px-3 py-1.5 rounded-full text-xs font-medium ${
              totalPendingDebtAmount > 0
                ? 'bg-amber-400/15 text-amber-200 border border-amber-400/20'
                : 'bg-white/10 text-slate-300 border border-white/10'
            } whitespace-nowrap tabular-nums"
          >${totalPendingDebtAmount.toFixed(0)} € fiados</button>

          <button 
            type="button"
            onclick="window.app.openSalesHistoryModal()"
            class="btn-pressable px-3 py-1.5 rounded-full text-xs font-medium bg-white/10 text-slate-300 border border-white/10 whitespace-nowrap"
          >Historial</button>

          ${isWorker ? `
            <button
              type="button"
              onclick="window.app.openPinAuthModal()"
              class="btn-pressable px-3 py-1.5 rounded-full text-xs font-medium bg-white/10 text-slate-300 border border-white/10 whitespace-nowrap"
            >PIN Jefe</button>
          ` : `
            <button 
              type="button"
              onclick="window.app.openWarehouseModal()"
              class="btn-pressable px-3 py-1.5 rounded-full text-xs font-medium bg-white/10 text-emerald-300 border border-white/10 whitespace-nowrap"
            >+ Almacén</button>
          `}
        </div>

        <!-- Banner compacto de Última Venta (si acaba de cobrar) -->
        ${this.lastCompletedSale ? `
          <div class="ios-glass-card px-3.5 py-2.5 flex items-center justify-between gap-2 animate-fade-in">
            <div class="min-w-0 pr-2 text-xs">
              <span class="font-semibold text-white">${this.lastCompletedSale.quantity}x ${this._escapeHtml(this.lastCompletedSale.productName)}</span>
              <span class="text-slate-400 ml-1 tabular-nums">· ${this.lastCompletedSale.grossTotal.toFixed(2)} € (${this.lastCompletedSale.paymentStatus === 'pending' ? 'Fiado' : this.lastCompletedSale.paymentMethod})</span>
            </div>
            <button 
              onclick="window.app.undoAndRepeatSale('${this.lastCompletedSale.id}')"
              class="btn-pressable px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[11px] font-semibold whitespace-nowrap"
            >Deshacer</button>
          </div>
        ` : ''}

        <span id="salesAvailableCount" class="hidden">${availableInActiveCount} sabores libres</span>
      </div>

      <!-- Cuadrícula limpia de productos estilo iOS 27 -->
      <div id="salesProductGrid" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pb-8">
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
          class="ios-glass-card p-3.5 text-left flex flex-col justify-between gap-3 hover:bg-white/10 transition cursor-pointer btn-pressable ${
            (isWorker ? isOutHere : isOutEverywhere)
              ? 'opacity-40 pointer-events-none'
              : (isOutHere || isOnlyReservedHere)
                ? 'opacity-75 border-amber-400/30'
                : ''
          }"
          onclick="window.app.openQuickSaleSheet('${p.id}')"
        >
          <div class="flex items-start justify-between gap-1">
            <span class="text-2xl leading-none">${theme.emoji}</span>
            <div class="text-right">
              <span class="text-xs font-semibold tabular-nums ${availStock <= 4 ? 'text-rose-400' : 'text-emerald-400'}">
                ${availStock} uds
              </span>
              ${hasMultipleWarehouses && globalStock !== availStock ? `
                <div class="text-[10px] text-slate-500 tabular-nums" title="Stock global">🌐 ${globalStock}</div>
              ` : ''}
            </div>
          </div>

          <div>
            <div class="text-sm font-semibold text-white leading-snug line-clamp-2">${this._escapeHtml(p.name)}</div>
            <div class="flex items-center justify-between mt-1.5">
              <span class="text-xs font-medium text-slate-300 tabular-nums">${p.sellPrice.toFixed(2)} €</span>
              ${whReserved > 0 ? `
                <span 
                  onclick="event.stopPropagation(); window.app.openReservationModal('${p.id}', '${this.activeSaleWarehouseId}')"
                  class="text-xs text-purple-300 font-medium hover:underline"
                  title="Reservado para: ${this._escapeHtml(reservedCustomers)}"
                >${whReserved} res.</span>
              ` : `
                <span 
                  onclick="event.stopPropagation(); window.app.openReservationModal('${p.id}', '${this.activeSaleWarehouseId}')"
                  class="text-[11px] text-slate-500 hover:text-purple-300 transition"
                  title="Reservar a un cliente"
                >Reservar</span>
              `}
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

  _normalizeCustomerKey(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  async _getPendingCustomersDirectory() {
    const isWorker = this.authAgent.isWorker();
    const assignedWh = this.authAgent.getAssignedWarehouseId();
    const scopeWh = (isWorker && assignedWh) ? assignedWh : 'all';

    const [allSales, allSettlements, activeReservations] = await Promise.all([
      this.storageAgent.getAllSales(),
      this.storageAgent.getAllSettlements(),
      this.inventoryAgent.getReservations({ status: 'active', warehouseId: scopeWh })
    ]);

    const accounts = this.analyticsAgent.computeCustomerAccounts(allSales, allSettlements, scopeWh);
    const map = new Map();

    const ensureEntry = (rawName, whId = MAIN_WAREHOUSE_ID) => {
      const cleanName = String(rawName || '').trim();
      const key = this._normalizeCustomerKey(cleanName);
      if (!key) return null;
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: cleanName,
          debtBalance: 0,
          openDebtCount: 0,
          reservedUnits: 0,
          reservedValue: 0,
          reservationsCount: 0,
          primaryWarehouseId: whId || MAIN_WAREHOUSE_ID
        });
      }
      return map.get(key);
    };

    (accounts.debtorsByCustomer || []).forEach(d => {
      const entry = ensureEntry(d.customerName, d.primaryWarehouseId);
      if (!entry) return;
      entry.debtBalance = parseFloat((Number(d.liveBalance) || 0).toFixed(2));
      entry.openDebtCount = Number(d.openSalesCount) || 0;
    });

    (activeReservations || []).forEach(r => {
      const entry = ensureEntry(r.customerName, r.warehouseId);
      if (!entry) return;
      const qty = parseInt(r.quantity, 10) || 0;
      const price = parseFloat(r.agreedUnitPrice);
      const unitPrice = Number.isFinite(price) ? price : 12;
      entry.reservedUnits += qty;
      entry.reservedValue = parseFloat((entry.reservedValue + qty * unitPrice).toFixed(2));
      entry.reservationsCount += 1;
      if (!entry.primaryWarehouseId && r.warehouseId) {
        entry.primaryWarehouseId = r.warehouseId;
      }
    });

    const list = Array.from(map.values()).filter(item => item.debtBalance > 0.009 || item.reservationsCount > 0);
    this._pendingCustomersCache = list;
    return list;
  }

  _populatePendingCustomerSelect(selectEl, list = [], mode = 'fiado', selectedName = '') {
    if (!selectEl) return;
    if (!Array.isArray(list) || list.length === 0) {
      selectEl.classList.add('hidden');
      selectEl.innerHTML = '';
      return;
    }

    selectEl.classList.remove('hidden');
    const selectedKey = this._normalizeCustomerKey(selectedName);
    let html = `<option value="">➕ Nuevo cliente (escribir nombre abajo)...</option>`;

    const renderOpt = (item, label) => {
      const isSel = selectedKey && item.key === selectedKey ? 'selected' : '';
      return `<option value="${this._escapeHtml(item.name)}" ${isSel}>${this._escapeHtml(label)}</option>`;
    };

    if (mode === 'reservation') {
      const withRes = list
        .filter(i => i.reservationsCount > 0)
        .sort((a, b) => b.reservedUnits - a.reservedUnits || a.name.localeCompare(b.name));
      const onlyDebt = list
        .filter(i => i.reservationsCount === 0 && i.debtBalance > 0.009)
        .sort((a, b) => b.debtBalance - a.debtBalance || a.name.localeCompare(b.name));

      if (withRes.length > 0) {
        html += `<optgroup label="📌 Ya tienen reservas activas">` +
          withRes.map(i => {
            const debtNote = i.debtBalance > 0.009 ? ` · Debe ${i.debtBalance.toFixed(2)}€` : '';
            return renderOpt(i, `${i.name} (${i.reservedUnits} uds res. · ${i.reservedValue.toFixed(2)}€${debtNote})`);
          }).join('') +
          `</optgroup>`;
      }
      if (onlyDebt.length > 0) {
        html += `<optgroup label="⏳ Con fiados pendientes">` +
          onlyDebt.map(i => renderOpt(i, `${i.name} (Debe ${i.debtBalance.toFixed(2)}€)`)).join('') +
          `</optgroup>`;
      }
    } else {
      const withDebt = list
        .filter(i => i.debtBalance > 0.009)
        .sort((a, b) => b.debtBalance - a.debtBalance || a.name.localeCompare(b.name));
      const onlyRes = list
        .filter(i => i.debtBalance <= 0.009 && i.reservationsCount > 0)
        .sort((a, b) => b.reservedUnits - a.reservedUnits || a.name.localeCompare(b.name));

      if (withDebt.length > 0) {
        html += `<optgroup label="⏳ Con fiados pendientes">` +
          withDebt.map(i => {
            const resNote = i.reservedUnits > 0 ? ` · ${i.reservedUnits} uds res.` : '';
            return renderOpt(i, `${i.name} (Debe ${i.debtBalance.toFixed(2)}€${resNote})`);
          }).join('') +
          `</optgroup>`;
      }
      if (onlyRes.length > 0) {
        html += `<optgroup label="📌 Con reservas activas">` +
          onlyRes.map(i => renderOpt(i, `${i.name} (${i.reservedUnits} uds reservadas · ${i.reservedValue.toFixed(2)}€)`)).join('') +
          `</optgroup>`;
      }
    }

    selectEl.innerHTML = html;
    if (selectedKey) {
      const matched = list.find(i => i.key === selectedKey);
      selectEl.value = matched ? matched.name : '';
    } else {
      selectEl.value = '';
    }
  }

  _groupReservationsByCustomer(reservations = []) {
    const groupsMap = new Map();
    (reservations || []).forEach(r => {
      const cleanName = String(r.customerName || 'Cliente').trim() || 'Cliente';
      const key = this._normalizeCustomerKey(cleanName);
      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          customerName: cleanName,
          customerKey: key,
          items: [],
          totalUnits: 0,
          totalValue: 0,
          primaryWarehouseId: r.warehouseId || MAIN_WAREHOUSE_ID,
          latestDate: r.createdAt || new Date(0).toISOString()
        });
      }
      const g = groupsMap.get(key);
      const qty = parseInt(r.quantity, 10) || 0;
      const parsedPrice = parseFloat(r.agreedUnitPrice);
      const unitPrice = Number.isFinite(parsedPrice) ? parsedPrice : 12;
      g.items.push(r);
      g.totalUnits += qty;
      g.totalValue = parseFloat((g.totalValue + qty * unitPrice).toFixed(2));
      if (r.createdAt && new Date(r.createdAt) >= new Date(g.latestDate)) {
        g.latestDate = r.createdAt;
        g.primaryWarehouseId = r.warehouseId || g.primaryWarehouseId;
      }
    });

    const groups = Array.from(groupsMap.values());
    groups.forEach(g => {
      g.items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    });
    return groups.sort((a, b) => new Date(b.latestDate || 0) - new Date(a.latestDate || 0));
  }

  // Bottom Sheet Modal: Preparar y Confirmar Venta Multi-Almacén
  async openQuickSaleSheet(productId, prefill = null) {
    const isWorker = this.authAgent.isWorker();
    const assignedWh = this.authAgent.getAssignedWarehouseId();

    const [productsList, warehouses, allSales, allReservations, pendingList] = await Promise.all([
      this.inventoryAgent.getProducts({ warehouseId: 'all' }),
      this.inventoryAgent.getWarehouses(),
      this.storageAgent.getAllSales(),
      this.storageAgent.getAllReservations(),
      this._getPendingCustomersDirectory()
    ]);
    const datalist = document.getElementById('existingCustomersDatalist');
    if (datalist) {
      const uniqueNames = new Set();
      (allSales || []).forEach(s => { if (s.buyerName && s.buyerName.trim()) uniqueNames.add(s.buyerName.trim()); });
      (allReservations || []).forEach(r => { if (r.customerName && r.customerName.trim()) uniqueNames.add(r.customerName.trim()); });
      (pendingList || []).forEach(p => { if (p.name && p.name.trim()) uniqueNames.add(p.name.trim()); });
      datalist.innerHTML = Array.from(uniqueNames)
        .sort((a, b) => a.localeCompare(b))
        .map(n => `<option value="${this._escapeHtml(n)}"></option>`)
        .join('');
    }
    const existingSelect = document.getElementById('modalSaleExistingCustomerSelect');
    this._populatePendingCustomerSelect(existingSelect, pendingList, 'fiado', prefill?.buyerName || '');
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
    this._updateSaleCustomerPendingHint();
    modal.classList.add('active');
    this._playChime('tap');
  }

  onSaleExistingCustomerSelect(customerName) {
    const inputBuyer = document.getElementById('modalSaleBuyerInput');
    if (inputBuyer) {
      inputBuyer.value = customerName || '';
      if (!customerName) {
        inputBuyer.focus();
      }
    }
    this._playChime('tap');
    this._updateSaleCustomerPendingHint();
  }

  onSaleBuyerInputChange() {
    const inputBuyer = document.getElementById('modalSaleBuyerInput');
    const existingSelect = document.getElementById('modalSaleExistingCustomerSelect');
    const key = this._normalizeCustomerKey(inputBuyer?.value || '');
    const matched = (this._pendingCustomersCache || []).find(i => i.key === key);
    if (existingSelect) {
      existingSelect.value = matched ? matched.name : '';
    }
    this._updateSaleCustomerPendingHint();
  }

  _updateSaleCustomerPendingHint() {
    const hintEl = document.getElementById('modalSaleCustomerPendingHint');
    if (!hintEl) return;
    const rawName = document.getElementById('modalSaleBuyerInput')?.value || '';
    const key = this._normalizeCustomerKey(rawName);
    const m = key ? (this._pendingCustomersCache || []).find(i => i.key === key) : null;

    if (!m) {
      hintEl.classList.add('hidden');
      hintEl.textContent = '';
      return;
    }

    const parsedQty = parseInt(this.saleQuantity, 10) || 1;
    const parsedPrice = parseFloat(this.saleUnitPrice);
    const unitPrice = Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : 0;
    const saleTotal = parseFloat((parsedQty * unitPrice).toFixed(2));

    hintEl.classList.remove('hidden');
    if (this.salePaymentStatus === 'pending') {
      const nextDebt = parseFloat((m.debtBalance + saleTotal).toFixed(2));
      hintEl.className = 'text-[10px] text-amber-300 font-semibold mt-1';
      hintEl.textContent = `⏳ Se sumará a la deuda de ${m.name}: ${m.debtBalance.toFixed(2)}€ + ${saleTotal.toFixed(2)}€ = ${nextDebt.toFixed(2)}€`;
    } else {
      const parts = [];
      if (m.debtBalance > 0.009) parts.push(`Debe ${m.debtBalance.toFixed(2)}€`);
      if (m.reservedUnits > 0) parts.push(`${m.reservedUnits} uds reservadas`);
      hintEl.className = 'text-[10px] text-slate-300 font-semibold mt-1';
      hintEl.textContent = `📌 ${m.name}: ${parts.join(' · ')}`;
    }
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
      const whShort = currentWh.isMain ? 'Almacén Principal' : currentWh.name;
      const profitInfo = isWorker ? '' : ` · Beneficio ${netProfit >= 0 ? '+' : ''}${netProfit.toFixed(2)} €`;
      modalStock.textContent = `${whShort} · ${whAvailableStock} libres${whReserved > 0 ? ` (${whReserved} res.)` : ''}${profitInfo}`;
      modalStock.className = 'text-xs text-slate-400';
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
      displayProfit.className = netProfit >= 0 ? 'text-emerald-400 font-bold text-sm tabular-nums' : 'text-rose-400 font-bold text-sm tabular-nums';
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
        btnConfirm.className = 'w-full py-3.5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm shadow-lg shadow-amber-500/20 mb-1.5 btn-pressable';
        btnConfirm.innerHTML = `<span>Registrar fiado ${totalGross.toFixed(2)} €</span>`;
        const moreDetails = document.getElementById('modalSaleMoreOptions');
        if (moreDetails) moreDetails.open = true;
      } else {
        btnConfirm.className = 'w-full py-3.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm shadow-lg shadow-emerald-500/20 mb-1.5 btn-pressable';
        btnConfirm.innerHTML = `<span>Cobrar ${totalGross.toFixed(2)} €</span>`;
      }
    }

    // Actualizar botones de Método de Pago estilo píldora iOS 27
    const btnCard = document.getElementById('btnPayCard');
    const btnCash = document.getElementById('btnPayCash');
    if (btnCard && btnCash) {
      if (this.salePaymentMethod === 'Efectivo') {
        btnCash.className = 'px-3 py-1 rounded-full text-xs font-semibold bg-white/20 text-white transition';
        btnCard.className = 'px-3 py-1 rounded-full text-xs font-medium bg-white/5 text-slate-400 hover:text-white transition';
      } else {
        btnCard.className = 'px-3 py-1 rounded-full text-xs font-semibold bg-white/20 text-white transition';
        btnCash.className = 'px-3 py-1 rounded-full text-xs font-medium bg-white/5 text-slate-400 hover:text-white transition';
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

    this._updateSaleCustomerPendingHint();
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
      const [warehouse, updatedProduct, allSales, allSettlements, commCfg] = await Promise.all([
        this.inventoryAgent.getWarehouse(targetWhId),
        this.inventoryAgent.getProduct(sale.productId),
        this.storageAgent.getAllSales(),
        this.storageAgent.getAllSettlements(),
        this.inventoryAgent.getWorkerCommissionsConfig()
      ]);

      const remainingStock = updatedProduct
        ? (updatedProduct.stockByWarehouse?.[targetWhId] ?? updatedProduct.stock ?? 0)
        : 0;

      // Calcular progreso de vapers gratis, comisión en € y deuda líquida del trabajador para la notificación ntfy
      let workerPendingFreeVapers = 0;
      let workerProgressText = '';
      let workerEarnedCommissionEuro = 0;
      let workerPendingMoney = null;
      if (warehouse && !warehouse.isMain) {
        const whSales = allSales.filter(s => (s.warehouseId || MAIN_WAREHOUSE_ID) === targetWhId);
        const whPaidUnits = whSales
          .filter(s => s.paymentStatus !== 'pending')
          .reduce((sum, s) => sum + (parseInt(s.quantity, 10) || 0), 0);
        const everyN = Math.max(1, parseInt(warehouse.rewardEveryNUnits, 10) || 5);
        const freeU = Math.max(1, parseInt(warehouse.rewardFreeUnits, 10) || 1);
        const earned = Math.floor(whPaidUnits / everyN) * freeU;
        const delivered = parseInt(warehouse.rewardVapersDelivered, 10) || 0;
        workerPendingFreeVapers = Math.max(0, earned - delivered);
        workerProgressText = `${whPaidUnits % everyN}/${everyN} para próximo regalo`;

        const commRate = Math.max(0, parseFloat(commCfg?.[targetWhId]?.commissionPerUnit) || 0);
        if (commRate > 0) {
          workerEarnedCommissionEuro = parseFloat((whPaidUnits * commRate).toFixed(2));
        }
        const directPaid = whSales
          .filter(s => s.paymentStatus === 'paid')
          .reduce((sum, s) => sum + (parseFloat(s.grossTotal) || 0), 0);
        const custPaid = (allSettlements || [])
          .filter(st => st.type === 'customer_payment' && (st.warehouseId || MAIN_WAREHOUSE_ID) === targetWhId)
          .reduce((sum, st) => sum + (parseFloat(st.amount) || 0), 0);
        const commPaidDirect = (allSettlements || [])
          .filter(st => st.type === 'commission_payout' && st.warehouseId === targetWhId)
          .reduce((sum, st) => sum + (parseFloat(st.amount) || 0), 0);
        const commOffset = Math.max(0, workerEarnedCommissionEuro - commPaidDirect);
        const netOblig = Math.max(0, (directPaid + custPaid) - commOffset);
        workerPendingMoney = Math.max(0, netOblig - (parseFloat(warehouse.cashSettledAmount) || 0));
      }

      const isWorkerSession = this.authAgent.isWorker();

      // Enviar notificación push al iPhone del jefe vía ntfy
      this.notificationsAgent.notifySale({
        sale,
        warehouse,
        remainingStock,
        workerPendingFreeVapers,
        workerProgressText,
        workerEarnedCommissionEuro,
        workerPendingMoney,
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
        const moreDetails = document.getElementById('modalSaleMoreOptions');
        if (moreDetails) moreDetails.open = true;
        this.showToast('Elige una persona del desplegable o escribe su nombre para reservar', '📌');
        const existingSelect = document.getElementById('modalSaleExistingCustomerSelect');
        if (existingSelect && !existingSelect.classList.contains('hidden')) {
          existingSelect.focus();
        } else if (buyerInput) {
          buyerInput.focus();
        }
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
        const isSettled = s.paymentStatus === 'settled';
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
                  ` : isSettled ? `
                    <span class="badge badge-ok-stock">✓ Fiado Saldado</span>
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
                ${s.buyerName ? `<div class="text-[11px] text-indigo-300 font-semibold mt-0.5 cursor-pointer hover:underline" onclick="document.getElementById('salesHistoryModal')?.classList.remove('active'); window.app.openCustomerLedgerModal('${this._escJsAttr(s.buyerName)}')">👤 Cliente: ${this._escapeHtml(s.buyerName)} ${isPending || isSettled ? '›' : ''}</div>` : ''}
                ${s.notes ? `<div class="text-[11px] text-slate-300 mt-0.5">📝 ${this._escapeHtml(s.notes)}</div>` : ''}
              </div>

              <div class="flex flex-col gap-1 items-end flex-shrink-0">
                ${isPending ? `
                  <div class="flex gap-1 mb-1">
                    ${s.buyerName ? `
                      <button 
                        onclick="document.getElementById('salesHistoryModal')?.classList.remove('active'); window.app.openCustomerLedgerModal('${this._escJsAttr(s.buyerName)}')"
                        class="btn-pressable bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 px-2 py-1 rounded-lg text-[10px] font-bold"
                      >💳 Abono</button>
                    ` : ''}
                    <button 
                      onclick="window.app.markPendingSalePaid('${s.id}', 'Efectivo', true)"
                      class="btn-pressable bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 px-2 py-1 rounded-lg text-[10px] font-bold"
                    >💵 Cobrar</button>
                    <button 
                      onclick="window.app.markPendingSalePaid('${s.id}', 'Tarjeta', true)"
                      class="btn-pressable bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 px-2 py-1 rounded-lg text-[10px] font-bold"
                    >💳</button>
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
      const assignedWh = this.authAgent.getAssignedWarehouseId();
      const isWorker = this.authAgent.isWorker();
      const res = await this.salesAgent.markSaleAsPaid(saleId, paymentMethod, {
        warehouseId: isWorker && assignedWh ? assignedWh : null
      });
      if (this.lastCompletedSale && this.lastCompletedSale.id === saleId && res.sale) {
        this.lastCompletedSale = res.sale;
      }
      if (res.settlement && res.summary && res.sale?.buyerName) {
        const wh = await this.inventoryAgent.getWarehouse(res.settlement.warehouseId);
        this.notificationsAgent.notifyCustomerPayment({
          customerName: res.sale.buyerName,
          amount: res.settlement.amount,
          paymentMethod,
          remainingBalance: res.summary.liveBalance,
          warehouse: wh,
          isWorkerSession: isWorker
        }).catch(() => {});
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
      <!-- Sub-navegación de Almacén estilo iOS 27: Stock | Reparto | Reservas | Mensaje -->
      <div class="ios-segmented mb-3.5">
        <button 
          type="button"
          class="segmented-option ${this.inventorySubView === 'stock' ? 'active' : ''}"
          onclick="window.app.switchInventorySubView('stock')"
        >
          <span>${isWorker ? 'Mi Stock' : 'Stock'}</span>
        </button>
        ${isWorker ? '' : `
          <button 
            type="button"
            class="segmented-option ${this.inventorySubView === 'transfer' ? 'active' : ''}"
            onclick="window.app.switchInventorySubView('transfer')"
          >
            <span>Reparto</span>
          </button>
        `}
        <button 
          type="button"
          class="segmented-option ${this.inventorySubView === 'reservations' ? 'active' : ''}"
          onclick="window.app.switchInventorySubView('reservations')"
        >
          <span>Reservas${activeReservations.length > 0 ? ` (${activeReservations.length})` : ''}</span>
        </button>
        <button 
          type="button"
          class="segmented-option ${this.inventorySubView === 'message' ? 'active' : ''}"
          onclick="window.app.switchInventorySubView('message')"
        >
          <span>Mensaje</span>
        </button>
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
      <!-- Tarjeta limpia de Pedido Activo estilo iOS 27 -->
      <div class="ios-glass-card p-4 mb-3.5 flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="text-xs text-slate-400">Pedido activo</div>
          <div class="text-sm font-semibold text-white truncate mt-0.5">
            ${this._escapeHtml(activeOrder ? activeOrder.name : 'Pedido Inicial')}
            ${activeOrder ? `<span class="text-xs font-normal text-slate-400 ml-1">(${activeOrder.totalUnits} uds)</span>` : ''}
          </div>
        </div>
        <button
          type="button"
          onclick="window.app.openNewOrderModal()"
          class="btn-pressable px-3.5 py-2 rounded-full bg-white text-slate-950 text-xs font-semibold whitespace-nowrap flex-shrink-0"
        >Nuevo pedido</button>
      </div>

      <!-- Barra de píldoras de Almacenes -->
      <div class="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5 mb-3">
        <button 
          type="button"
          onclick="window.app.setInventoryWarehouse('all')"
          class="btn-pressable px-3.5 py-1.5 rounded-full text-xs whitespace-nowrap transition ${
            this.selectedInventoryWarehouse === 'all'
              ? 'bg-white text-slate-950 font-semibold'
              : 'bg-white/10 text-slate-300 border border-white/10 font-medium'
          }"
        >Todos (${globalTotalUnits})</button>

        ${(valuation.byWarehouse || []).map(wh => {
          const isSel = this.selectedInventoryWarehouse === wh.warehouseId;
          const shortName = wh.isMain ? 'Principal' : (wh.workerName || wh.name);
          return `
            <button 
              type="button"
              onclick="window.app.setInventoryWarehouse('${wh.warehouseId}')"
              class="btn-pressable px-3.5 py-1.5 rounded-full text-xs whitespace-nowrap transition ${
                isSel
                  ? 'bg-white text-slate-950 font-semibold'
                  : 'bg-white/10 text-slate-300 border border-white/10 font-medium'
              }"
            >${this._escapeHtml(shortName)} (${wh.totalUnits})</button>
          `;
        }).join('')}

        <button 
          type="button"
          onclick="window.app.openWarehouseModal()"
          class="btn-pressable px-3 py-1.5 rounded-full text-xs font-medium bg-white/10 text-emerald-300 border border-white/10 whitespace-nowrap"
        >+ Almacén</button>

        <button 
          type="button"
          onclick="window.app.openProductModal()"
          class="btn-pressable px-3 py-1.5 rounded-full text-xs font-medium bg-white/10 text-indigo-300 border border-white/10 whitespace-nowrap"
        >+ Sabor</button>
      </div>
    `;

    // Desplegable con la Valoración de Inventario y Resumen por Ubicación
    if (this.selectedInventoryWarehouse === 'all') {
      html += `
        <details class="ios-accordion mb-3.5">
          <summary>
            <span>Valoración global (${valuation.totalStockUnits} uds · ${valuation.totalRetailValuation.toFixed(0)} € PVP)</span>
          </summary>
          <div class="ios-accordion-body space-y-3">
            <div class="grid grid-cols-3 gap-2 text-center">
              <div class="bg-white/5 p-2.5 rounded-xl border border-white/10">
                <div class="text-[10px] text-slate-400">Stock Global</div>
                <div class="text-base font-bold text-white tabular-nums">${valuation.totalStockUnits} uds</div>
                <div class="text-[9px] text-slate-400">${valuation.productsWithStock} con stock</div>
              </div>
              <div class="bg-white/5 p-2.5 rounded-xl border border-white/10">
                <div class="text-[10px] text-slate-400">Valor Coste</div>
                <div class="text-base font-bold text-slate-200 tabular-nums">${valuation.totalCostValuation.toFixed(2)}€</div>
                <div class="text-[9px] text-slate-500">Inversión</div>
              </div>
              <div class="bg-emerald-500/10 p-2.5 rounded-xl border border-emerald-400/25">
                <div class="text-[10px] text-emerald-300">Valor PVP</div>
                <div class="text-base font-bold text-emerald-300 tabular-nums">${valuation.totalRetailValuation.toFixed(2)}€</div>
                <div class="text-[9px] text-emerald-400 font-semibold tabular-nums">+${valuation.potentialGrossProfit.toFixed(2)}€ benef.</div>
              </div>
            </div>

            <div class="ios-grouped-list">
              ${(valuation.byWarehouse || []).map(wh => `
                <div 
                  onclick="window.app.setInventoryWarehouse('${wh.warehouseId}')"
                  class="ios-grouped-row px-3.5 py-2.5 flex items-center justify-between cursor-pointer hover:bg-white/5 transition"
                >
                  <div class="min-w-0 pr-2">
                    <div class="text-xs font-semibold text-white truncate">${wh.icon || '🏠'} ${this._escapeHtml(wh.name)}</div>
                    <div class="text-[10px] text-slate-400 truncate">${wh.workerName ? `${this._escapeHtml(wh.workerName)} · ` : ''}${wh.productsWithStock} sabores</div>
                  </div>
                  <div class="text-right flex-shrink-0 tabular-nums">
                    <div class="text-xs font-bold text-white">${wh.totalUnits} uds (${wh.stockSharePercentage}%)</div>
                    <div class="text-[10px] text-emerald-400">PVP ${wh.retailValuation.toFixed(0)} €</div>
                  </div>
                </div>
              `).join('')}
            </div>

            <div class="flex gap-2">
              <button 
                onclick="window.app.openStockMessageForWarehouse('${MAIN_WAREHOUSE_ID}')"
                class="btn-pressable flex-1 bg-white/10 hover:bg-white/15 text-slate-200 py-2 px-3 rounded-xl text-xs font-medium"
              >Copiar mensaje de stock</button>
              <button 
                onclick="window.app.switchInventorySubView('transfer')"
                class="btn-pressable flex-1 bg-white/10 hover:bg-white/15 text-slate-200 py-2 px-3 rounded-xl text-xs font-medium"
              >Repartir stock</button>
            </div>
          </div>
        </details>
      `;
    } else if (activeWhStats) {
      const whRecord = warehouses.find(w => w.id === activeWhStats.warehouseId);
      html += `
        <details class="ios-accordion mb-3.5">
          <summary>
            <span>${this._escapeHtml(activeWhStats.name)} (${activeWhStats.totalUnits} uds · ${activeWhStats.retailValuation.toFixed(0)} € PVP)</span>
          </summary>
          <div class="ios-accordion-body space-y-3">
            <div class="text-xs text-slate-400">
              ${activeWhStats.workerName ? `Encargado: <strong class="text-white">${this._escapeHtml(activeWhStats.workerName)}</strong>` : 'Almacén Principal'}
              ${whRecord?.notes ? ` · ${this._escapeHtml(whRecord.notes)}` : ''}
            </div>

            <div class="grid ${isWorker ? 'grid-cols-2' : 'grid-cols-3'} gap-2 text-center">
              <div class="bg-white/5 p-2.5 rounded-xl border border-white/10">
                <div class="text-[10px] text-slate-400">Unidades</div>
                <div class="text-base font-bold text-white tabular-nums">${activeWhStats.totalUnits} uds</div>
                <div class="text-[9px] text-slate-400">${activeWhStats.productsWithStock} sabores</div>
              </div>
              ${isWorker ? '' : `
                <div class="bg-white/5 p-2.5 rounded-xl border border-white/10">
                  <div class="text-[10px] text-slate-400">Coste</div>
                  <div class="text-base font-bold text-slate-200 tabular-nums">${activeWhStats.costValuation.toFixed(2)}€</div>
                  <div class="text-[9px] text-slate-500">Mercancía</div>
                </div>
              `}
              <div class="bg-emerald-500/10 p-2.5 rounded-xl border border-emerald-400/25">
                <div class="text-[10px] text-emerald-300">Valor PVP</div>
                <div class="text-base font-bold text-emerald-300 tabular-nums">${activeWhStats.retailValuation.toFixed(2)}€</div>
                ${isWorker ? '<div class="text-[9px] text-slate-400">Precio venta</div>' : `<div class="text-[9px] text-emerald-400 font-semibold tabular-nums">+${activeWhStats.potentialProfit.toFixed(2)}€ benef.</div>`}
              </div>
            </div>

            <div class="flex flex-wrap gap-2">
              <button 
                onclick="window.app.openStockMessageForWarehouse('${activeWhStats.warehouseId}')"
                class="btn-pressable flex-1 bg-white/10 hover:bg-white/15 text-slate-200 py-2 px-3 rounded-xl text-xs font-medium"
              >Copiar stock</button>
              ${isWorker ? '' : `
                <button 
                  onclick="window.app.openTransferModal(null, '${activeWhStats.warehouseId}')"
                  class="btn-pressable flex-1 bg-white/10 hover:bg-white/15 text-slate-200 py-2 px-3 rounded-xl text-xs font-medium"
                >Repartir / Mover</button>
                <button 
                  onclick="window.app.openWarehouseModal('${activeWhStats.warehouseId}')"
                  class="btn-pressable bg-white/10 hover:bg-white/15 text-slate-200 py-2 px-3 rounded-xl text-xs font-medium"
                >Editar almacén</button>
              `}
            </div>
          </div>
        </details>
      `;
    }

    // Buscador de catálogo y lista agrupada estilo iOS 27
    html += `
      <div class="relative mb-3">
        <input 
          type="text" 
          id="inventorySearchInput" 
          value="${this._escapeHtml(this.inventorySearchQuery || '')}"
          placeholder="Buscar sabor en almacén" 
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          class="w-full bg-white/10 border border-white/10 rounded-2xl px-4 py-2.5 pr-9 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-white/25"
        />
        <button type="button" id="btnClearInventorySearch" class="${this.inventorySearchQuery ? '' : 'hidden'} absolute right-3.5 top-2.5 text-slate-400 hover:text-white text-sm font-bold">✕</button>
      </div>

      <!-- Lista agrupada de sabores estilo iOS 27 -->
      <div id="inventoryProductGrid" class="ios-grouped-list mb-8">
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

    return products.map((p) => {
      const adjustWhStock = p.stockByWarehouse?.[targetAdjustWh] || 0;
      const reservedCount = isWorker ? (p.warehouseReserved || 0) : (p.totalReserved || 0);
      const theme = this._getFlavorVisualTheme(p.name);

      const whBreakdownSummary = (!isWorker && warehouses.length > 1)
        ? warehouses
            .map(wh => `${wh.isMain ? 'Prin.' : (wh.workerName || wh.name)}: ${p.stockByWarehouse?.[wh.id] || 0}`)
            .join(' · ')
        : '';

      return `
        <div class="ios-grouped-row px-4 py-3 flex items-center justify-between gap-3">
          <div 
            class="flex items-center gap-3 min-w-0 flex-1 ${isWorker ? '' : 'cursor-pointer'}"
            ${isWorker ? '' : `onclick="window.app.openProductModal('${p.id}')"`}
          >
            <span class="text-xl flex-shrink-0">${theme.emoji}</span>
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium text-white truncate">${this._escapeHtml(p.name)}</div>
              <div class="text-xs text-slate-400 truncate tabular-nums">
                ${p.sellPrice.toFixed(2)} € · ${reservedCount > 0 ? `<span class="text-purple-300">${reservedCount} reservadas</span>` : 'Sin reservas'}
                ${whBreakdownSummary ? ` · <span class="text-slate-500">${this._escapeHtml(whBreakdownSummary)}</span>` : ''}
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2 flex-shrink-0">
            ${isWorker ? `
              <span class="text-sm font-semibold text-white w-6 text-center tabular-nums">${adjustWhStock}</span>
              <button 
                type="button"
                onclick="window.app.openReservationModal('${p.id}', '${targetAdjustWh}')"
                class="btn-pressable px-2.5 py-1 rounded-full bg-white/10 text-purple-300 text-xs font-medium"
              >Reservar</button>
            ` : `
              <button 
                type="button"
                onclick="window.app.adjustStockInline('${p.id}', -1, '${targetAdjustWh}')"
                class="btn-pressable w-7 h-7 rounded-full bg-white/10 hover:bg-white/15 text-white text-sm flex items-center justify-center"
                ${adjustWhStock <= 0 ? 'disabled style="opacity:0.3"' : ''}
              >-</button>
              <span class="text-sm font-semibold ${adjustWhStock <= 0 ? 'text-rose-400' : adjustWhStock <= 4 ? 'text-amber-300' : 'text-white'} w-6 text-center tabular-nums">
                ${adjustWhStock}
              </span>
              <button 
                type="button"
                onclick="window.app.adjustStockInline('${p.id}', 1, '${targetAdjustWh}')"
                class="btn-pressable w-7 h-7 rounded-full bg-white/10 hover:bg-white/15 text-white text-sm flex items-center justify-center"
              >+</button>
              <button 
                type="button"
                onclick="window.app.openTransferModal('${p.id}', '${targetAdjustWh}')"
                class="btn-pressable w-7 h-7 rounded-full bg-white/5 hover:bg-white/15 text-slate-300 text-xs flex items-center justify-center"
                title="Repartir este sabor"
              >🚚</button>
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
  _buildGroupedReservationCardHtml(g, { compact = false, refreshModal = false } = {}) {
    const firstItem = g.items[0] || {};
    const custAttr = this._escJsAttr(g.customerName);
    const whAttr = this._escJsAttr(g.primaryWarehouseId || MAIN_WAREHOUSE_ID);

    if (compact) {
      return `
        <div class="bg-slate-900/90 p-2.5 rounded-xl border border-purple-500/30 space-y-2 text-xs">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="font-bold text-purple-300 truncate">👤 ${this._escapeHtml(g.customerName)} · ${g.totalUnits} uds (${g.totalValue.toFixed(2)}€)</div>
            </div>
            <div class="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onclick="window.app.openReservationModal(null, '${whAttr}', '${custAttr}')"
                class="btn-pressable bg-purple-600/25 hover:bg-purple-600/40 text-purple-200 border border-purple-500/40 px-2 py-1 rounded-lg text-[10px] font-bold"
              >+ Añadir</button>
              ${g.items.length > 1 ? `
                <button
                  type="button"
                  onclick="window.app.completeAllCustomerReservations('${custAttr}', 'Efectivo', ${refreshModal ? 'true' : 'false'})"
                  class="btn-pressable bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-1 rounded-lg text-[10px] font-bold"
                >💵 Todo</button>
                <button
                  type="button"
                  onclick="window.app.completeAllCustomerReservations('${custAttr}', 'Tarjeta', ${refreshModal ? 'true' : 'false'})"
                  class="btn-pressable bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-2 py-1 rounded-lg text-[10px] font-bold"
                >💳</button>
              ` : ''}
            </div>
          </div>

          <div class="space-y-1.5">
            ${g.items.map(r => {
              const parsedUnit = parseFloat(r.agreedUnitPrice);
              const unitPrice = Number.isFinite(parsedUnit) ? parsedUnit : 12;
              return `
                <div class="bg-slate-950/70 px-2.5 py-2 rounded-lg border border-white/10 flex items-center justify-between gap-2">
                  <div class="min-w-0 flex-1">
                    <div class="font-semibold text-white truncate">${r.quantity}x ${this._escapeHtml(r.productName)} · ${(r.quantity * unitPrice).toFixed(2)}€</div>
                    <div class="text-[10px] text-slate-400 truncate">${this._escapeHtml(r.warehouseName || 'Principal')}${r.notes ? ` · 📝 ${this._escapeHtml(r.notes)}` : ''}</div>
                  </div>
                  <div class="flex items-center gap-1 flex-shrink-0">
                    <button type="button" onclick="window.app.completeReservationQuick('${this._escJsAttr(r.id)}', 'Efectivo', ${refreshModal ? 'true' : 'false'})" class="btn-pressable bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-1 rounded-lg text-[10px] font-bold">💵 Cobrar</button>
                    <button type="button" onclick="window.app.completeReservationQuick('${this._escJsAttr(r.id)}', 'Tarjeta', ${refreshModal ? 'true' : 'false'})" class="btn-pressable bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-2 py-1 rounded-lg text-[10px] font-bold">💳</button>
                    <button type="button" onclick="window.app.cancelReservationAction('${this._escJsAttr(r.id)}', ${refreshModal ? 'true' : 'false'})" class="btn-pressable text-rose-400 px-1.5 py-1 text-xs font-bold">✕</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    return `
      <div class="bg-slate-900/90 p-3 rounded-2xl border border-purple-500/35 space-y-2.5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="badge badge-reserved text-[10px]">📌 Cliente: ${this._escapeHtml(g.customerName)}</span>
              <span class="text-[11px] font-black text-emerald-300">${g.totalUnits} uds · ${g.totalValue.toFixed(2)}€</span>
              ${g.items.length === 1 && firstItem.warehouseName ? `<span class="badge badge-warehouse text-[10px]">${this._escapeHtml(firstItem.warehouseName)}</span>` : ''}
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 flex-shrink-0">
            <button
              type="button"
              onclick="window.app.openReservationModal(null, '${whAttr}', '${custAttr}')"
              class="btn-pressable bg-purple-600/25 hover:bg-purple-600/45 text-purple-200 border border-purple-500/45 px-2.5 py-1.5 rounded-xl text-[11px] font-bold"
            >+ Añadir</button>
            ${g.items.length > 1 ? `
              <button
                type="button"
                onclick="window.app.completeAllCustomerReservations('${custAttr}', 'Efectivo', false)"
                class="btn-pressable bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-300 border border-emerald-500/40 px-2.5 py-1.5 rounded-xl text-[11px] font-bold"
              >💵 Cobrar Todo (${g.totalValue.toFixed(2)}€)</button>
              <button
                type="button"
                onclick="window.app.completeAllCustomerReservations('${custAttr}', 'Tarjeta', false)"
                class="btn-pressable bg-indigo-500/20 hover:bg-indigo-500/35 text-indigo-300 border border-indigo-500/40 px-2.5 py-1.5 rounded-xl text-[11px] font-bold"
              >💳 Todo</button>
            ` : ''}
          </div>
        </div>

        <div class="space-y-1.5">
          ${g.items.map(r => {
            const dt = new Date(r.createdAt);
            const dateStr = dt.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
            const parsedUnit = parseFloat(r.agreedUnitPrice);
            const unitPrice = Number.isFinite(parsedUnit) ? parsedUnit : 12;
            const totalVal = ((parseInt(r.quantity, 10) || 0) * unitPrice).toFixed(2);
            return `
              <div class="bg-slate-950/75 p-2.5 rounded-xl border border-white/10 flex flex-wrap items-center justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="text-sm font-bold text-white">${this._escapeHtml(r.productName)}</span>
                    <span class="badge badge-warehouse text-[10px]">${this._escapeHtml(r.warehouseName || 'Principal')}</span>
                    <span class="text-[10px] text-slate-400">${dateStr}</span>
                  </div>
                  <div class="text-xs text-slate-300 mt-0.5">
                    <strong>${r.quantity} uds</strong> × ${unitPrice.toFixed(2)}€ = <strong class="text-emerald-400">${totalVal}€</strong>
                  </div>
                  ${r.notes ? `<div class="text-[11px] text-slate-400 mt-0.5">📝 ${this._escapeHtml(r.notes)}</div>` : ''}
                </div>

                <div class="flex flex-col gap-1 items-end">
                  <div class="flex gap-1.5">
                    <button
                      type="button"
                      onclick="window.app.completeReservationQuick('${this._escJsAttr(r.id)}', 'Efectivo')"
                      class="btn-pressable bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-300 border border-emerald-500/40 px-2.5 py-1.5 rounded-xl text-[11px] font-bold"
                    >💵 Cobrar Efec.</button>
                    <button
                      type="button"
                      onclick="window.app.completeReservationQuick('${this._escJsAttr(r.id)}', 'Tarjeta')"
                      class="btn-pressable bg-indigo-500/20 hover:bg-indigo-500/35 text-indigo-300 border border-indigo-500/40 px-2.5 py-1.5 rounded-xl text-[11px] font-bold"
                    >💳 Tarjeta</button>
                  </div>
                  <button
                    type="button"
                    onclick="window.app.cancelReservationAction('${this._escJsAttr(r.id)}')"
                    class="btn-pressable text-[10px] text-rose-400 hover:text-rose-300 underline"
                  >✕ Cancelar y liberar stock</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  async _buildInventoryReservationsSubViewHtml() {
    const isWorker = this.authAgent.isWorker();
    const assignedWh = this.authAgent.getAssignedWarehouseId();

    const [warehouses, products, reservations] = await Promise.all([
      this.inventoryAgent.getWarehouses(),
      this.inventoryAgent.getProducts({ warehouseId: isWorker ? assignedWh : 'all' }),
      this.inventoryAgent.getReservations({ status: 'active', warehouseId: isWorker ? assignedWh : 'all' })
    ]);

    const groups = this._groupReservationsByCustomer(reservations);
    const totalResUnits = reservations.reduce((sum, r) => sum + (parseInt(r.quantity, 10) || 0), 0);
    const totalResValue = reservations.reduce((sum, r) => sum + ((parseInt(r.quantity, 10) || 0) * (parseFloat(r.agreedUnitPrice) || 12)), 0);

    return `
      <div class="ios-card border-purple-500/40 bg-gradient-to-br from-purple-950/35 to-slate-900 mb-4 animate-fade-in">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h3 class="text-base font-black text-white flex items-center gap-1.5">
              <span>📌</span> Reservas Activas de Clientes (${groups.length} personas · ${reservations.length} líneas)
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
            <div class="text-[10px] text-slate-400">Clientes / Líneas</div>
            <div class="text-base font-black text-white">${groups.length} / ${reservations.length}</div>
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

        ${groups.length === 0 ? `
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
            ${groups.map(g => this._buildGroupedReservationCardHtml(g, { compact: false, refreshModal: false })).join('')}
          </div>
        `}
      </div>
    `;
  }

  async openReservationModal(defaultProductId = null, defaultWarehouseId = MAIN_WAREHOUSE_ID, defaultCustomerName = '') {
    const isWorker = this.authAgent.isWorker();
    const assignedWh = this.authAgent.getAssignedWarehouseId();

    const [allWarehouses, products, reservations, allSales, pendingList] = await Promise.all([
      this.inventoryAgent.getWarehouses(),
      this.inventoryAgent.getProducts({ warehouseId: isWorker ? assignedWh : 'all' }),
      this.inventoryAgent.getReservations({ status: 'active', warehouseId: isWorker ? assignedWh : 'all' }),
      this.storageAgent.getAllSales(),
      this._getPendingCustomersDirectory()
    ]);

    const warehouses = isWorker ? allWarehouses.filter(w => w.id === assignedWh) : allWarehouses;

    const modal = document.getElementById('reservationFormModal');
    const existingSelect = document.getElementById('resModalExistingCustomerSelect');
    const custInput = document.getElementById('resModalCustomerName');
    const whSelect = document.getElementById('resModalWarehouseSelect');
    const prodSelect = document.getElementById('resModalProductSelect');
    const qtyInput = document.getElementById('resModalQtyInput');
    const priceInput = document.getElementById('resModalPriceInput');
    const notesInput = document.getElementById('resModalNotesInput');
    const activeListEl = document.getElementById('resModalActiveListContainer');

    if (!modal || !whSelect || !prodSelect) return;

    const datalist = document.getElementById('existingCustomersDatalist');
    if (datalist) {
      const uniqueNames = new Set();
      (allSales || []).forEach(s => { if (s.buyerName && s.buyerName.trim()) uniqueNames.add(s.buyerName.trim()); });
      (reservations || []).forEach(r => { if (r.customerName && r.customerName.trim()) uniqueNames.add(r.customerName.trim()); });
      (pendingList || []).forEach(p => { if (p.name && p.name.trim()) uniqueNames.add(p.name.trim()); });
      datalist.innerHTML = Array.from(uniqueNames)
        .sort((a, b) => a.localeCompare(b))
        .map(n => `<option value="${this._escapeHtml(n)}"></option>`)
        .join('');
    }

    this._populatePendingCustomerSelect(existingSelect, pendingList, 'reservation', defaultCustomerName || '');

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

    if (custInput) custInput.value = defaultCustomerName || '';
    if (qtyInput) qtyInput.value = 1;
    const defaultProd = products.find(p => p.id === targetProd);
    const defaultPrice = (defaultProd && Number.isFinite(parseFloat(defaultProd.sellPrice))) ? parseFloat(defaultProd.sellPrice).toFixed(2) : '12.00';
    if (priceInput) priceInput.value = defaultPrice;
    if (notesInput) notesInput.value = '';

    if (activeListEl) {
      const groups = this._groupReservationsByCustomer(reservations);
      if (groups.length === 0) {
        activeListEl.innerHTML = `<div class="text-xs text-slate-500 text-center py-3">No hay reservas activas.</div>`;
      } else {
        activeListEl.innerHTML = groups.map(g => this._buildGroupedReservationCardHtml(g, { compact: true, refreshModal: true })).join('');
      }
    }

    this._updateResCustomerPendingHint();
    await this.onResModalFieldChange();
    modal.classList.add('active');
    this._playChime('tap');
  }

  onResExistingCustomerSelect(customerName) {
    const custInput = document.getElementById('resModalCustomerName');
    if (custInput) {
      custInput.value = customerName || '';
      if (!customerName) {
        custInput.focus();
      }
    }
    this._playChime('tap');
    this._updateResCustomerPendingHint();
  }

  onResCustomerInputChange() {
    const custInput = document.getElementById('resModalCustomerName');
    const existingSelect = document.getElementById('resModalExistingCustomerSelect');
    const key = this._normalizeCustomerKey(custInput?.value || '');
    const matched = (this._pendingCustomersCache || []).find(i => i.key === key);
    if (existingSelect) {
      existingSelect.value = matched ? matched.name : '';
    }
    this._updateResCustomerPendingHint();
  }

  _updateResCustomerPendingHint() {
    const hintEl = document.getElementById('resModalCustomerPendingHint');
    if (!hintEl) return;
    const rawName = document.getElementById('resModalCustomerName')?.value || '';
    const key = this._normalizeCustomerKey(rawName);
    const m = key ? (this._pendingCustomersCache || []).find(i => i.key === key) : null;

    if (!m) {
      hintEl.classList.add('hidden');
      hintEl.textContent = '';
      return;
    }

    const qty = Math.max(1, parseInt(document.getElementById('resModalQtyInput')?.value, 10) || 1);
    hintEl.classList.remove('hidden');
    hintEl.className = 'text-[10px] text-purple-300 font-semibold mt-1';
    if (m.reservedUnits > 0) {
      hintEl.textContent = `📌 Se añadirá a la lista de ${m.name} (ahora ${m.reservedUnits} uds → ${m.reservedUnits + qty} uds)`;
    } else {
      hintEl.textContent = `📌 Se añadirá a la lista de ${m.name} (tiene fiado de ${m.debtBalance.toFixed(2)}€)`;
    }
  }

  async completeAllCustomerReservations(customerName, paymentMethod = 'Efectivo', refreshModal = false) {
    return this._runLocked(`completeAllRes_${this._normalizeCustomerKey(customerName)}`, async () => {
      const isWorker = this.authAgent.isWorker();
      const assignedWh = this.authAgent.getAssignedWarehouseId();
      const scopeWh = (isWorker && assignedWh) ? assignedWh : 'all';

      const reservations = await this.inventoryAgent.getReservations({ status: 'active', warehouseId: scopeWh });
      const targetKey = this._normalizeCustomerKey(customerName);
      const matching = (reservations || []).filter(r => this._normalizeCustomerKey(r.customerName) === targetKey);
      if (matching.length === 0) {
        this.showToast('No hay reservas activas para ese cliente.', '📌');
        return;
      }

      const totalUnits = matching.reduce((sum, r) => sum + (parseInt(r.quantity, 10) || 0), 0);
      const totalValue = matching.reduce((sum, r) => {
        const p = parseFloat(r.agreedUnitPrice);
        return sum + ((parseInt(r.quantity, 10) || 0) * (Number.isFinite(p) ? p : 12));
      }, 0);

      if (!confirm(`¿Cobrar las ${matching.length} reservas de ${matching[0].customerName} (${totalUnits} uds · ${totalValue.toFixed(2)}€) por ${paymentMethod}?`)) {
        return;
      }

      try {
        let completedCount = 0;
        let lastSale = null;
        for (const r of matching) {
          const res = await this.salesAgent.completeReservationAsSale(r.id, {
            paymentMethod,
            paymentStatus: 'paid'
          });
          if (res.sale) {
            lastSale = res.sale;
            if (!this.supabaseAgent.isConfigured()) {
              this.cloudSyncAgent.publishReservationEvent('complete', { id: r.id }).catch(() => {});
            }
            this._notifyAndSyncSale(res.sale);
          }
          completedCount++;
        }

        if (lastSale) this.lastCompletedSale = lastSale;
        this._playChime('success');
        this.showToast(
          `Cobradas ${completedCount} reservas de ${matching[0].customerName}: +${totalValue.toFixed(2)}€ (${paymentMethod})`,
          '💰'
        );

        if (refreshModal) {
          document.getElementById('reservationFormModal')?.classList.remove('active');
        }
        await this.renderCurrentTab();
        await this.updateHeaderQuickStats();
      } catch (err) {
        alert(`Error completando reservas: ${err.message}`);
      }
    });
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
    this._updateResCustomerPendingHint();
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
    const commissionGroup = document.getElementById('whCommissionPerUnitGroup');
    const commissionInput = document.getElementById('inputWhCommissionPerUnit');
    const pinGroup = document.getElementById('whWorkerPinGroup');
    const pinInput = document.getElementById('inputWhWorkerPin');
    const btnDelete = document.getElementById('btnDeleteWarehouse');
    const commCfg = await this.inventoryAgent.getWorkerCommissionsConfig();

    if (warehouseId) {
      const wh = await this.inventoryAgent.getWarehouse(warehouseId);
      if (!wh) return;
      if (titleEl) titleEl.textContent = wh.isMain ? 'Editar Almacén Principal' : 'Editar Almacén / Trabajador';
      if (nameInput) nameInput.value = wh.name || '';
      if (workerInput) workerInput.value = wh.workerName || '';
      if (notesInput) notesInput.value = wh.notes || '';
      if (rewardEveryInput) rewardEveryInput.value = wh.rewardEveryNUnits || 5;
      if (rewardFreeInput) rewardFreeInput.value = wh.rewardFreeUnits || 1;
      if (commissionGroup) commissionGroup.classList.toggle('hidden', !!wh.isMain);
      if (commissionInput) commissionInput.value = Number(commCfg?.[wh.id]?.commissionPerUnit || 0);
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
      if (commissionGroup) commissionGroup.classList.remove('hidden');
      if (commissionInput) commissionInput.value = '0';
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
    const commVal = Math.max(0, parseFloat(document.getElementById('inputWhCommissionPerUnit')?.value) || 0);
    const commPreviewEl = document.getElementById('whCommissionPreviewText');
    if (commPreviewEl) {
      commPreviewEl.textContent = commVal > 0
        ? `Gana ${commVal.toFixed(2)} € por cada unidad vendida y cobrada (se descuenta al hacer caja).`
        : 'Sin comisión fija en € (0.00 €/ud). Si pones ej. 2.00 €, se restará automáticamente de lo que debe entregar.';
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
    const commissionPerUnit = Math.max(0, parseFloat(document.getElementById('inputWhCommissionPerUnit')?.value) || 0);
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
          rewardFreeUnits,
          commissionPerUnit
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
          rewardFreeUnits,
          commissionPerUnit
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
      <!-- Sub-pestañas estilo iOS 27 (igual que la preview: Resumen | Pedidos | Vendedores | Análisis) -->
      <div class="ios-segmented mb-3.5">
        ${[
          { id: 'resumen', label: 'Resumen' },
          { id: 'pedidos', label: 'Pedidos' },
          { id: 'vendedores', label: 'Vendedores' },
          { id: 'avanzado', label: 'Análisis' }
        ].map(tab => {
          const isSubActive = (this.analyticsSubView || 'resumen') === tab.id;
          return `
            <button
              type="button"
              onclick="window.app.setAnalyticsSubView('${tab.id}')"
              class="segmented-option ${isSubActive ? 'active' : ''}"
            >${tab.label}</button>
          `;
        }).join('')}
      </div>

      <!-- Barra compacta de periodo + desplegable de filtros avanzados -->
      <div class="flex items-center justify-between gap-2 mb-3">
        <div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          ${[
            { id: 'today', label: 'Hoy' },
            { id: 'week', label: '7 días' },
            { id: 'month', label: '30 días' },
            { id: 'all', label: 'Todo' }
          ].map(tf => `
            <button
              type="button"
              onclick="window.app.setTimeframe('${tf.id}')"
              class="btn-pressable px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition ${
                this.analyticsTimeframe === tf.id
                  ? 'bg-white text-slate-950 font-semibold'
                  : 'bg-white/10 text-slate-300 border border-white/10 font-medium'
              }"
            >${tf.label}</button>
          `).join('')}
        </div>
      </div>

      <details class="ios-accordion mb-3.5">
        <summary>
          <span>Filtro: ${activeFilterTitle}</span>
        </summary>
        <div class="ios-accordion-body space-y-2.5">
          <div class="text-[11px] text-slate-400 font-medium">Almacén</div>
          <div class="warehouse-pills-bar no-scrollbar">
            <button 
              type="button"
              onclick="window.app.setAnalyticsWarehouseFilter('all')"
              class="warehouse-pill btn-pressable ${this.analyticsWarehouseFilter === 'all' ? 'active' : ''}"
            >Todos</button>
            ${warehouses.map(wh => `
              <button 
                type="button"
                onclick="window.app.setAnalyticsWarehouseFilter('${wh.id}')"
                class="warehouse-pill btn-pressable ${this.analyticsWarehouseFilter === wh.id ? 'active' : ''}"
              >${this._escapeHtml(wh.isMain ? 'Principal' : (wh.workerName || wh.name))}</button>
            `).join('')}
          </div>

          <div class="text-[11px] text-slate-400 font-medium pt-1">Pedido / Lote</div>
          <div class="warehouse-pills-bar no-scrollbar">
            <button 
              type="button"
              onclick="window.app.setAnalyticsOrderFilter('all')"
              class="warehouse-pill btn-pressable ${this.analyticsOrderFilter === 'all' ? 'active' : ''}"
            >Todos los pedidos</button>
            ${ordersList.map(o => `
              <button 
                type="button"
                onclick="window.app.setAnalyticsOrderFilter('${o.id}')"
                class="warehouse-pill btn-pressable ${this.analyticsOrderFilter === o.id ? 'active' : ''}"
              >${this._escapeHtml(o.name)}</button>
            `).join('')}
            <button
              type="button"
              onclick="window.app.openNewOrderModal()"
              class="warehouse-pill btn-pressable text-emerald-300"
            >+ Nuevo pedido</button>
          </div>
        </div>
      </details>

      <!-- ================================================================= -->
      <!-- SUB-VISTA 1: RESUMEN (Diseño idéntico a la preview + acordeones)  -->
      <!-- ================================================================= -->
      <div class="${(this.analyticsSubView || 'resumen') === 'resumen' ? 'block space-y-3.5' : 'hidden'}">
        <!-- 2 Tarjetas principales estilo iOS 27 Preview -->
        <div class="grid grid-cols-2 gap-3">
          <div class="ios-glass-card p-4">
            <div class="text-xs text-slate-400">Facturación (${timeframeLabels[this.analyticsTimeframe]})</div>
            <div class="text-2xl font-bold text-white mt-1 tabular-nums">${data.totalBilled.toFixed(2)} €</div>
            <div class="text-xs text-emerald-400 mt-1 tabular-nums">+${data.totalProfit.toFixed(2)} € beneficio (${data.overallProfitMargin}%)</div>
          </div>
          <div class="ios-glass-card p-4">
            <div class="text-xs text-slate-400">Unidades</div>
            <div class="text-2xl font-bold text-white mt-1 tabular-nums">${data.totalUnits} uds</div>
            <div class="text-xs text-slate-400 mt-1 tabular-nums">Ticket medio ${data.averageTicket.toFixed(2)} € · ${data.transactionCount} ventas</div>
          </div>
        </div>

        <!-- Gráfica principal de Evolución (€) -->
        ${revenueChartCardHtml}

        <!-- Lista agrupada de desgloses adicionales de Resumen (sin eliminar nada) -->
        <div class="ios-grouped-list">
          <!-- 1. Facturación General Histórica -->
          <details class="ios-grouped-accordion">
            <summary>
              <span class="text-sm text-white font-medium">Facturación general acumulada</span>
              <span class="text-xs text-emerald-400 font-semibold tabular-nums">${allTime.totalBilled.toFixed(2)} € ›</span>
            </summary>
            <div class="ios-grouped-accordion-body">
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div class="bg-white/5 p-3 rounded-xl border border-white/10">
                  <div class="text-[10px] text-slate-400 uppercase font-semibold">Total Facturado</div>
                  <div class="text-lg font-bold text-white mt-0.5 tabular-nums">${allTime.totalBilled.toFixed(2)}€</div>
                  <div class="text-[10px] text-slate-400 mt-0.5">Ticket: ${allTime.averageTicket.toFixed(2)}€ (${allTime.transactionCount} ventas)</div>
                </div>
                <div class="bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/25">
                  <div class="text-[10px] text-emerald-300 uppercase font-semibold">Beneficio Neto</div>
                  <div class="text-lg font-bold text-emerald-400 mt-0.5 tabular-nums">+${allTime.totalProfit.toFixed(2)}€</div>
                  <div class="text-[10px] text-emerald-300/80 mt-0.5">Margen: ${allTime.overallProfitMargin}%</div>
                </div>
                <div class="bg-white/5 p-3 rounded-xl border border-white/10">
                  <div class="text-[10px] text-slate-400 uppercase font-semibold">Unidades</div>
                  <div class="text-lg font-bold text-white mt-0.5 tabular-nums">${allTime.totalUnits} uds</div>
                  <div class="text-[10px] text-slate-400 mt-0.5">Coste: ${allTime.totalCost.toFixed(2)}€</div>
                </div>
                <div class="bg-white/5 p-3 rounded-xl border border-white/10">
                  <div class="text-[10px] text-slate-400 uppercase font-semibold">Efectivo vs Tarjeta</div>
                  <div class="text-xs font-semibold text-emerald-400 mt-1 tabular-nums">💵 ${allTime.cashBilled.toFixed(2)}€ (${allTime.cashPercentage}%)</div>
                  <div class="text-xs font-semibold text-indigo-300 mt-0.5 tabular-nums">💳 ${allTime.cardBilled.toFixed(2)}€ (${allTime.cardPercentage}%)</div>
                </div>
              </div>
            </div>
          </details>

          <!-- 2. Gráfica de Unidades Vendidas -->
          <details class="ios-grouped-accordion">
            <summary>
              <span class="text-sm text-white font-medium">Gráfica de unidades vendidas</span>
              <span class="text-xs text-slate-400 tabular-nums">${data.totalUnits} uds ›</span>
            </summary>
            <div class="ios-grouped-accordion-body">
              ${unitsChartCardHtml}
            </div>
          </details>

          <!-- 3. Fiados pendientes y Reservas activas -->
          <details class="ios-grouped-accordion">
            <summary>
              <span class="text-sm text-white font-medium">Fiados pendientes y reservas</span>
              <span class="text-xs ${data.debtsAndReservations.totalPendingDebtAmount > 0 ? 'text-amber-300 font-semibold' : 'text-slate-400'} tabular-nums">
                ${data.debtsAndReservations.totalPendingDebtAmount.toFixed(0)} € · ${data.debtsAndReservations.activeReservations.length} res. ›
              </span>
            </summary>
            <div class="ios-grouped-accordion-body">
              ${debtsAndReservationsHtml}
            </div>
          </details>
        </div>
      </div>

      <!-- ================================================================= -->
      <!-- SUB-VISTA 2: PEDIDOS Y SALUD FINANCIERA                           -->
      <!-- ================================================================= -->
      <div class="${(this.analyticsSubView || 'resumen') === 'pedidos' ? 'block space-y-3.5' : 'hidden'}">
        ${ordersMetricsHtml}
      </div>

      <!-- ================================================================= -->
      <!-- SUB-VISTA 3: VENDEDORES, ALMACENES Y DESCUENTOS                   -->
      <!-- ================================================================= -->
      <div class="${(this.analyticsSubView || 'resumen') === 'vendedores' ? 'block space-y-3.5' : 'hidden'}">
        ${workerAccountsHtml}

        <div class="ios-grouped-list">
          <details class="ios-grouped-accordion">
            <summary>
              <span class="text-sm text-white font-medium">Control de descuentos por vendedor</span>
              <span class="text-xs text-slate-400 tabular-nums">-${data.discountMetrics.periodTotalDiscount.toFixed(2)} € ›</span>
            </summary>
            <div class="ios-grouped-accordion-body">
              ${discountMetricsHtml}
            </div>
          </details>
        </div>
      </div>

      <!-- ================================================================= -->
      <!-- SUB-VISTA 4: ANÁLISIS AVANZADO                                    -->
      <!-- ================================================================= -->
      <div class="${(this.analyticsSubView || 'resumen') === 'avanzado' ? 'block space-y-3.5' : 'hidden'}">
        <div class="ios-grouped-list">
          <details class="ios-grouped-accordion" open>
            <summary>
              <span class="text-sm text-white font-medium">Inteligencia de sabores y reposición</span>
              <span class="text-xs text-emerald-400">Ver sugerencias ›</span>
            </summary>
            <div class="ios-grouped-accordion-body">
              ${flavorIntelHtml}
            </div>
          </details>

          <details class="ios-grouped-accordion">
            <summary>
              <span class="text-sm text-white font-medium">Mapa de calor (Días × Horas)</span>
              <span class="text-xs text-slate-400">Ver mapa ›</span>
            </summary>
            <div class="ios-grouped-accordion-body">
              ${salesHeatmapHtml}
            </div>
          </details>
        </div>
      </div>

      <!-- 3. DESGLOSE COMPLETO POR ALMACENES Y CASAS DE TRABAJADORES -->
      <div class="${(this.analyticsSubView || 'resumen') === 'vendedores' ? 'block mt-3.5' : 'hidden'}">
      <details class="ios-accordion mb-4">
        <summary>
          <span>Comparativa detallada por almacén (${data.warehouseBreakdown.length})</span>
        </summary>
        <div class="ios-accordion-body">
        <div class="flex justify-end mb-2.5">
          <button 
            onclick="window.app.openWarehouseModal()"
            class="btn-pressable bg-white/10 hover:bg-white/15 text-emerald-300 px-3 py-1 rounded-full text-xs font-medium"
          >+ Añadir almacén</button>
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
      </details>
      </div>

      <!-- 4. SALUD FINANCIERA, RECUPERACIÓN DE INVERSIÓN (BREAK-EVEN), ROI Y PROYECCIÓN TOTAL -->
      <div class="${(this.analyticsSubView || 'resumen') === 'pedidos' ? 'block mt-3.5' : 'hidden'}">
      <details class="ios-accordion mb-4">
        <summary>
          <span>Salud financiera, Break-Even y proyección (ROI ${health.roiPercentage}%)</span>
        </summary>
        <div class="ios-accordion-body">

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
      </details>
      </div>

      <!-- 5. EVOLUCIÓN DE ÚLTIMOS 7 DÍAS Y RITMO DE VENTA (velocityMetrics) -->
      <div class="${(this.analyticsSubView || 'resumen') === 'avanzado' ? 'block mt-3.5' : 'hidden'}">
      <details class="ios-accordion mb-3.5">
        <summary>
          <span>Evolución 7 días y ritmo de venta (${vel.activeDaysCount} días activos)</span>
        </summary>
        <div class="ios-accordion-body">

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
      </details>
      </div>

      <!-- 6. MÉTODOS DE PAGO, TOP SABORES -->
      <div class="${(this.analyticsSubView || 'resumen') === 'resumen' ? 'block mt-3.5' : 'hidden'}">
      <details class="ios-accordion mb-3.5">
        <summary>
          <span>Top sabores y Efectivo vs Tarjeta (${timeframeLabels[this.analyticsTimeframe]})</span>
        </summary>
        <div class="ios-accordion-body">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
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
        </div>
      </details>
      </div>

      <!-- Menor Rotación y Alertas de Reposición -->
      <div class="${(this.analyticsSubView || 'resumen') === 'avanzado' ? 'block' : 'hidden'}">
      <details class="ios-accordion mb-4">
        <summary>
          <span>Menor rotación y alertas de stock (${data.lowStockAlerts.length})</span>
        </summary>
        <div class="ios-accordion-body">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
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
        </div>
      </details>
      </div>

      <!-- Historial de Ventas Recientes del Periodo -->
      <div class="${(this.analyticsSubView || 'resumen') === 'resumen' ? 'block' : 'hidden'}">
      <details class="ios-accordion mb-4">
        <summary>
          <span>Últimas ventas del periodo (${data.recentSales.length})</span>
        </summary>
        <div class="ios-accordion-body">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-2 pb-2">
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
      </details>
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
      <div class="space-y-3">
        <!-- Lista Agrupada de Vendedores (3 Indicadores de Consignación iOS 27) -->
        ${workersList.length === 0 ? `
          <div class="ios-glass-card p-4 text-center text-xs text-slate-400">
            Aún no has creado almacenes de trabajadores.
            <button type="button" onclick="window.app.openWarehouseModal()" class="text-emerald-400 font-semibold ml-1 underline">+ Añadir trabajador</button>
          </div>
        ` : `
          <div class="ios-grouped-list">
            ${workersList.map(w => {
              const historyList = w.workerSettlements || [];
              return `
                <details class="ios-grouped-accordion">
                  <summary>
                    <div>
                      <div class="text-sm font-semibold text-white">${w.icon || '👤'} ${this._escapeHtml(w.workerName || w.name)}</div>
                      <div class="text-xs text-slate-400 mt-0.5 tabular-nums">
                        Stock: <strong class="text-slate-200">${w.currentStockUnits} uds</strong> (${w.stockRetailValuation.toFixed(0)} €)
                        ${w.commissionPerUnit > 0 ? ` · Com.: <span class="text-indigo-300">${w.netCommissionOffset.toFixed(2)} €</span>` : ''}
                        ${w.pendingFreeVapers > 0 ? ` · <span class="text-emerald-300 font-medium">${w.pendingFreeVapers} regalo${w.pendingFreeVapers === 1 ? '' : 's'}</span>` : ''}
                      </div>
                    </div>
                    <div class="text-right">
                      <div class="text-sm font-bold ${w.pendingMoneyToDeliver > 0 ? 'text-amber-300' : 'text-emerald-400'} tabular-nums">
                        ${w.pendingMoneyToDeliver.toFixed(2)} €
                      </div>
                      <div class="text-xs text-slate-400">${w.pendingMoneyToDeliver > 0 ? 'Deuda líquida' : 'Al día'}</div>
                    </div>
                  </summary>
                  <div class="ios-grouped-accordion-body space-y-3">
                    <!-- INDICADOR 1: DEUDA LÍQUIDA (DINERO EN SU MANO) -->
                    <div class="bg-white/5 p-3 rounded-2xl border border-amber-400/20 space-y-2">
                      <div class="flex items-center justify-between">
                        <span class="text-[11px] font-bold uppercase tracking-wider text-amber-300">💶 1. Deuda Líquida (Dinero en su mano)</span>
                        <span class="text-sm font-black ${w.pendingMoneyToDeliver > 0 ? 'text-amber-300' : 'text-emerald-400'} tabular-nums">
                          ${w.pendingMoneyToDeliver.toFixed(2)} €
                        </span>
                      </div>
                      <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-300 tabular-nums">
                        <div class="flex justify-between"><span>Cobrado en ventas:</span><strong class="text-white">${w.totalCollectedPaid.toFixed(2)} €</strong></div>
                        <div class="flex justify-between"><span>💵 ${w.collectedCash.toFixed(0)}€ / 💳 ${w.collectedCard.toFixed(0)}€</span><span class="text-slate-400">${w.globalPaidUnitsSold} uds</span></div>
                        ${w.netCommissionOffset > 0 ? `
                          <div class="flex justify-between text-indigo-300"><span>− Comisiones (${w.commissionPerUnit.toFixed(2)}€/ud):</span><strong>-${w.netCommissionOffset.toFixed(2)} €</strong></div>
                          <div class="flex justify-between"><span>Neto a entregarte:</span><strong class="text-white">${w.netObligationToBoss.toFixed(2)} €</strong></div>
                        ` : ''}
                        <div class="flex justify-between"><span>− Ya entregado:</span><strong class="text-emerald-400">${w.cashSettledAmount.toFixed(2)} €</strong></div>
                        <div class="flex justify-between"><span>= Pendiente hoy:</span><strong class="${w.pendingMoneyToDeliver > 0 ? 'text-amber-300' : 'text-emerald-400'}">${w.pendingMoneyToDeliver.toFixed(2)} €</strong></div>
                      </div>
                      <button 
                        type="button"
                        onclick="window.app.openSettleCashModal('${this._escJsAttr(w.warehouseId)}', ${w.pendingMoneyToDeliver})"
                        class="btn-pressable w-full py-2 px-3 rounded-xl bg-white/15 hover:bg-white/20 text-white text-xs font-semibold"
                      >💶 Registrar entrega / abono parcial</button>
                    </div>

                    <!-- INDICADOR 2: VALOR DEL STOCK EN ALMACÉN (CONSIGNACIÓN) -->
                    <div class="bg-white/5 p-3 rounded-2xl border border-indigo-400/20 space-y-1.5">
                      <div class="flex items-center justify-between">
                        <span class="text-[11px] font-bold uppercase tracking-wider text-indigo-300">📦 2. Stock en su Almacén (Consignación)</span>
                        <span class="text-xs font-bold text-white tabular-nums">${w.currentStockUnits} uds = ${w.stockRetailValuation.toFixed(2)} €</span>
                      </div>
                      <div class="flex flex-wrap items-center justify-between text-[11px] text-slate-400 gap-2 tabular-nums">
                        <span>Al venderlo todo (PVP): <strong class="text-white">${w.stockRetailValuation.toFixed(2)} €</strong></span>
                        ${w.commissionPerUnit > 0 ? `
                          <span>Neto para ti tras comisión: <strong class="text-emerald-300">${w.stockNetPotentialToBoss.toFixed(2)} €</strong></span>
                        ` : `
                          <span>Sabores disponibles: <strong class="text-slate-200">${w.productsWithStock}</strong></span>
                        `}
                      </div>
                      ${w.totalPendingFiados > 0 ? `
                        <div class="text-[11px] text-amber-300/90 tabular-nums">
                          ⏳ Fiados sin cobrar en esta zona: <strong>${w.totalPendingFiados.toFixed(2)} €</strong> (se sumarán al cobrarlos)
                        </div>
                      ` : ''}
                    </div>

                    <!-- INDICADOR 3: BALANCE DE COMISIONES (LO QUE TÚ LE DEBES) -->
                    <div class="bg-emerald-500/10 p-3 rounded-2xl border border-emerald-400/25 space-y-2">
                      <div class="flex items-center justify-between">
                        <span class="text-[11px] font-bold uppercase tracking-wider text-emerald-300">🏆 3. Balance de Comisiones (A su favor)</span>
                        <span class="text-xs font-bold text-emerald-300 tabular-nums">
                          ${w.commissionPerUnit > 0 ? `${w.earnedCommissionEuro.toFixed(2)} €` : `${w.pendingFreeVapers} regalo(s)`}
                        </span>
                      </div>

                      ${w.commissionPerUnit > 0 ? `
                        <div class="text-[11px] text-slate-200 space-y-0.5 tabular-nums">
                          <div class="flex justify-between">
                            <span>Comisión acumulada (${w.globalPaidUnitsSold} uds × ${w.commissionPerUnit.toFixed(2)}€):</span>
                            <strong class="text-emerald-300">${w.earnedCommissionEuro.toFixed(2)} €</strong>
                          </div>
                          ${w.commissionPaidDirectly > 0 ? `
                            <div class="flex justify-between text-slate-400">
                              <span>− Pagado directamente aparte:</span>
                              <strong>-${w.commissionPaidDirectly.toFixed(2)} €</strong>
                            </div>
                          ` : ''}
                          <div class="text-[10px] text-emerald-200/90 pt-0.5">
                            Cruce caja: ${w.totalCollectedPaid.toFixed(0)}€ ventas − ${w.netCommissionOffset.toFixed(0)}€ comisiones = <strong>${w.netObligationToBoss.toFixed(2)}€ netos</strong>
                          </div>
                        </div>
                      ` : ''}

                      <div class="flex items-center justify-between text-[11px] text-slate-300 tabular-nums">
                        <span>Vapers regalo (${w.unitsTowardNextFreeVaper}/${w.rewardEveryNUnits} · ${w.rewardFreeUnits} gratis/${w.rewardEveryNUnits} uds):</span>
                        <strong class="text-emerald-300">${w.pendingFreeVapers} pend. (${w.deliveredFreeVapers} entr.)</strong>
                      </div>
                      <div class="h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div class="h-full bg-emerald-400 rounded-full" style="width: ${Math.min(100, w.nextFreeVaperProgressPct)}%"></div>
                      </div>

                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
                        <button 
                          type="button"
                          onclick="window.app.openDeliverRewardModal('${this._escJsAttr(w.warehouseId)}', ${Math.max(1, w.pendingFreeVapers)})"
                          class="btn-pressable py-2 px-3 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/35 text-emerald-200 text-xs font-semibold"
                        >🎁 Entregar regalo (${w.pendingFreeVapers})</button>
                        <button 
                          type="button"
                          onclick="window.app.openWarehouseModal('${this._escJsAttr(w.warehouseId)}')"
                          class="btn-pressable py-2 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-slate-200 text-xs font-medium"
                        >⚙️ Comisiones (${w.commissionPerUnit.toFixed(2)}€/ud · ${w.rewardFreeUnits}/${w.rewardEveryNUnits})</button>
                      </div>
                    </div>

                    ${historyList.length > 0 ? `
                      <details class="ios-accordion mb-0">
                        <summary>
                          <span>Historial de entregas y comisiones (${historyList.length})</span>
                        </summary>
                        <div class="ios-accordion-body space-y-1.5 max-h-48 overflow-y-auto">
                          ${historyList.map(st => {
                            const dt = new Date(st.timestamp);
                            const dateTxt = `${dt.toLocaleDateString([], { day: '2-digit', month: '2-digit' })} ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                            const isReward = st.type === 'reward_vaper';
                            const isCommPayout = st.type === 'commission_payout';
                            const label = isReward
                              ? `🎁 ${st.count} regalo${st.count === 1 ? '' : 's'}${st.productName ? ` (${this._escapeHtml(st.productName)})` : ''}`
                              : isCommPayout
                                ? `🏆 Comisión pagada: ${Number(st.amount || 0).toFixed(2)}€ (${this._escapeHtml(st.productName || 'Efectivo')})`
                                : `💶 Entrega: ${Number(st.amount || 0).toFixed(2)}€ (${this._escapeHtml(st.productName || 'Efectivo')})`;
                            return `
                              <div class="flex items-center justify-between gap-2 bg-white/5 px-2.5 py-2 rounded-xl border border-white/10 text-[11px]">
                                <div class="min-w-0">
                                  <div class="font-semibold text-white truncate">${label}</div>
                                  <div class="text-[10px] text-slate-400">${dateTxt}${st.notes ? ` · ${this._escapeHtml(st.notes)}` : ''}</div>
                                </div>
                                <button
                                  type="button"
                                  onclick="window.app.revertWorkerSettlementAction('${this._escJsAttr(st.id)}')"
                                  class="btn-pressable text-[10px] text-rose-400 hover:text-rose-300 underline flex-shrink-0"
                                >Anular</button>
                              </div>
                            `;
                          }).join('')}
                        </div>
                      </details>
                    ` : ''}
                  </div>
                </details>
              `;
            }).join('')}
          </div>
        `}

        <!-- Resumen global de trabajadores y botón + Nuevo trabajador -->
        <div class="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-400 tabular-nums">
          <span>
            Deuda líquida total: <strong class="text-white">${workerAccounts.totalPendingMoneyFromWorkers.toFixed(2)} €</strong>
            · Stock en equipo: <strong class="text-indigo-300">${workerAccounts.totalStockUnitsWorkers} uds (${workerAccounts.totalStockRetailWorkers.toFixed(0)} €)</strong>
          </span>
          <button 
            type="button"
            onclick="window.app.openWarehouseModal()"
            class="text-emerald-400 hover:text-emerald-300 font-semibold"
          >+ Nuevo trabajador</button>
        </div>
      </div>
    `;
  }

  _buildDebtsAndReservationsSectionHtml(dr) {
    if (!dr) return '';
    const debtors = dr.debtorsByCustomer || [];
    const settled = dr.settledCustomers || [];
    const reservations = dr.activeReservations || [];

    return `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <!-- Control de Fiados / Cuenta Corriente de Clientes -->
        <div class="ios-card ios-card-glow-amber mb-0">
          <div class="flex items-center justify-between mb-2">
            <div>
              <h3 class="text-xs font-black uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                <span>⏳</span> Cuentas de Clientes ("Fiados")
              </h3>
              <span class="text-[10px] text-slate-300">Saldo vivo con abonos parciales · toca un cliente para ver su historial</span>
            </div>
            <span class="badge badge-fiado text-xs font-black tabular-nums">${dr.totalPendingDebtAmount.toFixed(2)}€</span>
          </div>

          ${debtors.length === 0 ? `
            <div class="text-xs text-emerald-400 py-5 text-center font-semibold bg-slate-950/40 rounded-xl border border-slate-800/80">
              ✅ No hay ninguna deuda ni cuenta fiada pendiente de cobro
            </div>
          ` : `
            <div class="space-y-2 max-h-72 overflow-y-auto pr-1">
              ${debtors.map(d => `
                <div
                  onclick="window.app.openCustomerLedgerModal('${this._escJsAttr(d.customerName)}')"
                  class="bg-slate-950/70 hover:bg-slate-900/90 p-3 rounded-xl border border-amber-500/35 cursor-pointer transition flex items-center justify-between gap-2"
                >
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                      <span class="text-xs font-black text-white truncate">👤 ${this._escapeHtml(d.customerName)}</span>
                      <span class="text-[10px] text-slate-400">(${d.openSalesCount} ${d.openSalesCount === 1 ? 'cargo' : 'cargos'})</span>
                    </div>
                    <div class="text-[10px] text-slate-400 mt-0.5 tabular-nums">
                      Fiado: <strong class="text-slate-200">${d.totalCharged.toFixed(2)}€</strong>
                      ${d.totalPaid > 0 ? ` · Abonado: <strong class="text-emerald-400">-${d.totalPaid.toFixed(2)}€</strong>` : ''}
                    </div>
                  </div>
                  <div class="flex items-center gap-2 flex-shrink-0">
                    <div class="text-right tabular-nums">
                      <div class="text-sm font-black text-amber-300">${d.liveBalance.toFixed(2)}€</div>
                      <div class="text-[9.5px] text-slate-400">Pendiente</div>
                    </div>
                    <button
                      type="button"
                      onclick="event.stopPropagation(); window.app.openCustomerLedgerModal('${this._escJsAttr(d.customerName)}')"
                      class="btn-pressable bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 px-2.5 py-1.5 rounded-lg text-[10px] font-bold"
                    >+ Abono</button>
                  </div>
                </div>
              `).join('')}
            </div>
          `}

          ${settled.length > 0 ? `
            <details class="ios-accordion mt-2.5 mb-0">
              <summary>
                <span>Clientes al día con historial (${settled.length})</span>
              </summary>
              <div class="ios-accordion-body space-y-1.5 max-h-40 overflow-y-auto">
                ${settled.map(c => `
                  <div
                    onclick="window.app.openCustomerLedgerModal('${this._escJsAttr(c.customerName)}')"
                    class="flex items-center justify-between text-[11px] bg-white/5 hover:bg-white/10 px-2.5 py-2 rounded-xl cursor-pointer transition"
                  >
                    <span class="font-semibold text-white truncate">👤 ${this._escapeHtml(c.customerName)}</span>
                    <span class="text-emerald-400 font-semibold tabular-nums">0.00€ (${c.totalPaid.toFixed(0)}€ pagados) ›</span>
                  </div>
                `).join('')}
              </div>
            </details>
          ` : ''}
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
            <div class="space-y-2 max-h-72 overflow-y-auto pr-1">
              ${this._groupReservationsByCustomer(reservations).map(g => this._buildGroupedReservationCardHtml(g, { compact: true, refreshModal: false })).join('')}
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
    const [warehouse, metrics] = await Promise.all([
      this.inventoryAgent.getWarehouse(workerWarehouseId),
      this.analyticsAgent.getDashboardMetrics('all', 'all', 'all')
    ]);
    if (!warehouse) return;

    const modal = document.getElementById('workerActionModal');
    const body = document.getElementById('workerActionModalBody');
    if (!modal || !body) return;

    const acct = (metrics.workerAccounts?.warehouses || []).find(w => w.warehouseId === workerWarehouseId);
    const livePending = acct ? acct.pendingMoneyToDeliver : pendingAmount;
    const defaultVal = livePending > 0 ? livePending.toFixed(2) : '';

    body.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <div>
          <h3 class="text-base font-bold text-white">💶 Recibir / Liquidar Dinero</h3>
          <span class="text-xs text-slate-400">${this._escapeHtml(warehouse.name)} (${this._escapeHtml(warehouse.workerName || 'Trabajador')})</span>
        </div>
        <button onclick="document.getElementById('workerActionModal').classList.remove('active')" class="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center font-bold">✕</button>
      </div>

      ${acct ? `
        <div class="bg-slate-900/90 p-3 rounded-2xl border border-white/10 text-xs space-y-1.5 mb-3 tabular-nums">
          <div class="text-[10px] uppercase tracking-wider font-bold text-slate-400">Cruce de Caja (Consignación)</div>
          <div class="flex justify-between">
            <span class="text-slate-300">Ventas cobradas por ${this._escapeHtml(warehouse.workerName || warehouse.name)}:</span>
            <strong class="text-white">${acct.totalCollectedPaid.toFixed(2)} €</strong>
          </div>
          ${acct.netCommissionOffset > 0 ? `
            <div class="flex justify-between text-indigo-300">
              <span>− Comisiones (${acct.globalPaidUnitsSold} uds × ${acct.commissionPerUnit.toFixed(2)}€):</span>
              <strong>-${acct.netCommissionOffset.toFixed(2)} €</strong>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-300">= Neto que te corresponde:</span>
              <strong class="text-white">${acct.netObligationToBoss.toFixed(2)} €</strong>
            </div>
          ` : ''}
          <div class="flex justify-between">
            <span class="text-slate-300">− Entregas anteriores ya recibidas:</span>
            <strong class="text-emerald-400">-${acct.cashSettledAmount.toFixed(2)} €</strong>
          </div>
          <div class="flex justify-between pt-1.5 border-t border-white/10 text-sm">
            <span class="font-bold text-white">Te debe hoy:</span>
            <strong class="${livePending > 0 ? 'text-amber-300' : 'text-emerald-400'}">${livePending.toFixed(2)} €</strong>
          </div>
        </div>
      ` : `
        <div class="bg-slate-900/90 p-3 rounded-xl border border-slate-800 text-xs flex justify-between mb-3">
          <span class="text-slate-400">Pendiente actual de entregarte:</span>
          <strong class="text-amber-400">${livePending.toFixed(2)}€</strong>
        </div>
      `}

      <form onsubmit="event.preventDefault(); window.app.confirmSettleWorkerCash('${this._escJsAttr(warehouse.id)}');" class="space-y-3">
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
          ${livePending > 0 ? `
            <div class="flex gap-2 mt-1.5">
              <button type="button" onclick="document.getElementById('settleModalAmount').value='${livePending.toFixed(2)}'" class="flex-1 py-1 rounded-lg bg-white/10 text-xs text-slate-200 font-semibold">Liquidar todo (${livePending.toFixed(2)}€)</button>
              <button type="button" onclick="document.getElementById('settleModalAmount').value='${(livePending / 2).toFixed(2)}'" class="flex-1 py-1 rounded-lg bg-white/10 text-xs text-slate-200 font-semibold">Mitad (${(livePending / 2).toFixed(2)}€)</button>
            </div>
          ` : ''}
        </div>

        <div>
          <label class="text-xs text-slate-300 font-bold block mb-1">Método de entrega</label>
          <select id="settleModalMethod" class="w-full bg-slate-800 text-white px-3 py-2.5 rounded-xl border border-slate-700 text-xs font-semibold">
            <option value="Efectivo">💵 Efectivo en mano</option>
            <option value="Tarjeta">💳 Bizum / Transferencia / Tarjeta</option>
          </select>
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
    const paymentMethod = document.getElementById('settleModalMethod')?.value || 'Efectivo';
    const notes = document.getElementById('settleModalNotes')?.value || '';

    try {
      const res = await this.inventoryAgent.settleWorkerCash({
        workerWarehouseId,
        amount,
        paymentMethod,
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

  async revertWorkerSettlementAction(settlementId) {
    if (!confirm('¿Anular este movimiento de liquidación/entrega del trabajador? Se recalculará automáticamente su saldo.')) {
      return;
    }
    try {
      const res = await this.inventoryAgent.revertWorkerSettlement(settlementId);
      this._playChime('revert');
      this.showToast(res.message, '↩️');
      this.scheduleCloudSnapshotPublish();
      await this.renderCurrentTab();
    } catch (err) {
      alert(`Error anulando movimiento: ${err.message}`);
    }
  }

  // =========================================================================
  // CUENTA CORRIENTE DE CLIENTES (FIADOS CON ABONOS PARCIALES E HISTORIAL)
  // =========================================================================
  async openCustomerDebtorsModal() {
    const modal = document.getElementById('customerLedgerModal');
    const body = document.getElementById('customerLedgerModalBody');
    if (!modal || !body) return;

    const isWorker = this.authAgent.isWorker();
    const assignedWh = this.authAgent.getAssignedWarehouseId();
    const [allSales, allSettlements] = await Promise.all([
      this.storageAgent.getAllSales(),
      this.storageAgent.getAllSettlements()
    ]);

    const summary = this.analyticsAgent.computeCustomerAccounts(
      allSales,
      allSettlements,
      isWorker ? assignedWh : 'all'
    );
    const debtors = summary.debtorsByCustomer || [];
    const settled = summary.settledCustomers || [];

    body.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <div>
          <h3 class="text-lg font-bold text-white">⏳ Cuentas de Fiados</h3>
          <span class="text-xs text-slate-400">Saldo total pendiente: <strong class="text-amber-300 tabular-nums">${summary.totalPendingDebtAmount.toFixed(2)} €</strong></span>
        </div>
        <button onclick="document.getElementById('customerLedgerModal').classList.remove('active')" class="w-8 h-8 rounded-full bg-white/10 text-slate-300 hover:text-white flex items-center justify-center font-semibold">✕</button>
      </div>

      ${debtors.length === 0 ? `
        <div class="ios-glass-card p-6 text-center text-xs text-emerald-400 font-semibold mb-3">
          ✅ No hay ninguna deuda fiada pendiente de cobro.
        </div>
      ` : `
        <div class="ios-grouped-list mb-3">
          ${debtors.map(c => `
            <div
              onclick="window.app.openCustomerLedgerModal('${this._escJsAttr(c.customerName)}')"
              class="ios-grouped-row px-4 py-3 flex items-center justify-between gap-2 cursor-pointer hover:bg-white/5 transition"
            >
              <div class="min-w-0">
                <div class="text-sm font-semibold text-white truncate">👤 ${this._escapeHtml(c.customerName)}</div>
                <div class="text-xs text-slate-400 tabular-nums">
                  Fiado: ${c.totalCharged.toFixed(2)}€${c.totalPaid > 0 ? ` · Abonado: -${c.totalPaid.toFixed(2)}€` : ''}
                </div>
              </div>
              <div class="text-right flex-shrink-0 tabular-nums">
                <div class="text-sm font-bold text-amber-300">${c.liveBalance.toFixed(2)} €</div>
                <div class="text-[11px] text-emerald-400 font-medium">+ Abonar ›</div>
              </div>
            </div>
          `).join('')}
        </div>
      `}

      ${settled.length > 0 ? `
        <details class="ios-accordion mb-0">
          <summary>
            <span>Clientes al día con historial (${settled.length})</span>
          </summary>
          <div class="ios-accordion-body space-y-1.5 max-h-48 overflow-y-auto">
            ${settled.map(c => `
              <div
                onclick="window.app.openCustomerLedgerModal('${this._escJsAttr(c.customerName)}')"
                class="flex items-center justify-between text-xs bg-white/5 hover:bg-white/10 px-3 py-2 rounded-xl cursor-pointer transition"
              >
                <span class="font-medium text-white truncate">👤 ${this._escapeHtml(c.customerName)}</span>
                <span class="text-emerald-400 font-semibold tabular-nums">0.00€ (${c.totalPaid.toFixed(0)}€ pagados) ›</span>
              </div>
            `).join('')}
          </div>
        </details>
      ` : ''}
    `;

    modal.classList.add('active');
    this._playChime('tap');
  }

  async openCustomerLedgerModal(customerName) {
    const cleanName = String(customerName || '').trim();
    if (!cleanName) return;

    const modal = document.getElementById('customerLedgerModal');
    const body = document.getElementById('customerLedgerModalBody');
    if (!modal || !body) return;

    const isWorker = this.authAgent.isWorker();
    const assignedWh = this.authAgent.getAssignedWarehouseId();
    const [allSales, allSettlements, warehouses] = await Promise.all([
      this.storageAgent.getAllSales(),
      this.storageAgent.getAllSettlements(),
      this.inventoryAgent.getWarehouses()
    ]);

    const summary = this.analyticsAgent.computeCustomerAccounts(
      allSales,
      allSettlements,
      isWorker ? assignedWh : 'all'
    );
    const key = this.salesAgent._normalizeCustomerKey(cleanName);
    const account = (summary.allCustomerAccounts || []).find(c => c.customerKey === key) || {
      customerName: cleanName,
      totalCharged: 0,
      totalPaid: 0,
      liveBalance: 0,
      primaryWarehouseId: isWorker && assignedWh ? assignedWh : MAIN_WAREHOUSE_ID,
      movementsDesc: []
    };

    const defaultReceiveWh = isWorker && assignedWh
      ? assignedWh
      : (account.primaryWarehouseId || MAIN_WAREHOUSE_ID);

    body.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onclick="window.app.openCustomerDebtorsModal()"
            class="w-8 h-8 rounded-full bg-white/10 text-slate-300 hover:text-white flex items-center justify-center text-sm font-bold flex-shrink-0"
            title="Volver a lista de clientes"
          >‹</button>
          <div class="min-w-0">
            <h3 class="text-lg font-bold text-white truncate">👤 ${this._escapeHtml(account.customerName)}</h3>
            <span class="text-xs text-slate-400">Cuenta corriente de fiados y abonos</span>
          </div>
        </div>
        <button onclick="document.getElementById('customerLedgerModal').classList.remove('active')" class="w-8 h-8 rounded-full bg-white/10 text-slate-300 hover:text-white flex items-center justify-center font-semibold flex-shrink-0">✕</button>
      </div>

      <!-- Saldo Vivo + Resumen -->
      <div class="grid grid-cols-3 gap-2 text-center mb-3 tabular-nums">
        <div class="bg-white/5 p-2.5 rounded-2xl border border-white/10">
          <div class="text-[10px] text-slate-400 uppercase">Total Fiado</div>
          <div class="text-sm font-bold text-white mt-0.5">+${account.totalCharged.toFixed(2)} €</div>
        </div>
        <div class="bg-white/5 p-2.5 rounded-2xl border border-white/10">
          <div class="text-[10px] text-emerald-300 uppercase">Abonado</div>
          <div class="text-sm font-bold text-emerald-400 mt-0.5">-${account.totalPaid.toFixed(2)} €</div>
        </div>
        <div class="${account.liveBalance > 0 ? 'bg-amber-500/15 border-amber-400/35' : 'bg-emerald-500/15 border-emerald-400/35'} p-2.5 rounded-2xl border">
          <div class="text-[10px] ${account.liveBalance > 0 ? 'text-amber-300' : 'text-emerald-300'} uppercase font-bold">Saldo Vivo</div>
          <div class="text-base font-black ${account.liveBalance > 0 ? 'text-amber-300' : 'text-emerald-400'} mt-0.5">${account.liveBalance.toFixed(2)} €</div>
        </div>
      </div>

      <!-- Formulario de Abono Parcial o Total -->
      <form onsubmit="event.preventDefault(); window.app.confirmCustomerPayment('${this._escJsAttr(account.customerName)}');" class="ios-glass-card p-3.5 space-y-2.5 mb-3">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-white">💶 Registrar Abono / Pago</span>
          ${account.liveBalance > 0 ? `
            <div class="flex gap-1.5">
              <button type="button" onclick="document.getElementById('custPayAmountInput').value='${account.liveBalance.toFixed(2)}'" class="px-2 py-0.5 rounded-full bg-white/10 text-[10px] text-slate-200 font-semibold">Liquidar (${account.liveBalance.toFixed(2)}€)</button>
              <button type="button" onclick="document.getElementById('custPayAmountInput').value='${(account.liveBalance / 2).toFixed(2)}'" class="px-2 py-0.5 rounded-full bg-white/10 text-[10px] text-slate-200 font-semibold">Mitad</button>
            </div>
          ` : ''}
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="text-[10px] text-slate-400 block mb-1">Importe entregado (€) *</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              id="custPayAmountInput"
              value="${account.liveBalance > 0 ? account.liveBalance.toFixed(2) : ''}"
              placeholder="Ej: 30.00"
              class="w-full bg-slate-900 text-white font-black text-center py-2 rounded-xl border border-white/15 text-base focus:outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label class="text-[10px] text-slate-400 block mb-1">Método de pago</label>
            <select id="custPayMethodSelect" class="w-full bg-slate-900 text-white px-2.5 py-2.5 rounded-xl border border-white/15 text-xs font-semibold">
              <option value="Efectivo">💵 Efectivo</option>
              <option value="Tarjeta">💳 Tarjeta / Bizum</option>
            </select>
          </div>
        </div>

        ${isWorker ? `
          <input type="hidden" id="custPayWarehouseSelect" value="${this._escapeHtml(defaultReceiveWh)}" />
        ` : `
          <div>
            <label class="text-[10px] text-slate-400 block mb-1">Almacén / Caja que recibe el cobro</label>
            <select id="custPayWarehouseSelect" class="w-full bg-slate-900 text-white px-2.5 py-2 rounded-xl border border-white/15 text-xs font-semibold">
              ${warehouses.map(wh => `
                <option value="${this._escapeHtml(wh.id)}" ${wh.id === defaultReceiveWh ? 'selected' : ''}>
                  ${wh.icon || '🏠'} ${this._escapeHtml(wh.name)}
                </option>
              `).join('')}
            </select>
          </div>
        `}

        <div class="flex gap-2">
          <input
            type="text"
            id="custPayNotesInput"
            placeholder="📝 Nota opcional (ej. Abono parcial)..."
            class="flex-1 bg-slate-900 text-white px-3 py-2 rounded-xl border border-white/15 text-xs focus:outline-none focus:border-white/30"
          />
          <button type="submit" class="btn-pressable px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs whitespace-nowrap">
            Registrar Abono
          </button>
        </div>
      </form>

      <!-- Historial Cronológico de Movimientos -->
      <div>
        <div class="text-xs font-bold uppercase tracking-wider text-slate-300 mb-2 px-1">
          📜 Historial de Movimientos (${(account.movementsDesc || []).length})
        </div>
        ${(account.movementsDesc || []).length === 0 ? `
          <div class="ios-glass-card p-4 text-center text-xs text-slate-400">
            No hay movimientos registrados para este cliente.
          </div>
        ` : `
          <div class="ios-grouped-list max-h-64 overflow-y-auto">
            ${(account.movementsDesc || []).map(m => {
              const dt = new Date(m.timestamp);
              const dateTxt = `${dt.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' })} · ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
              const isPayment = m.kind === 'payment';
              return `
                <div class="ios-grouped-row px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                      <span class="font-semibold text-white truncate">
                        ${isPayment
                          ? `💳 Abono (${this._escapeHtml(m.paymentMethod)})`
                          : `📦 ${m.quantity}x ${this._escapeHtml(m.productName)}`
                        }
                      </span>
                    </div>
                    <div class="text-[10px] text-slate-400 mt-0.5">
                      ${dateTxt} · ${this._escapeHtml(m.warehouseName)}
                      ${m.notes ? ` · ${this._escapeHtml(m.notes)}` : ''}
                    </div>
                  </div>

                  <div class="text-right flex-shrink-0 tabular-nums">
                    <div class="font-bold ${isPayment ? 'text-emerald-400' : 'text-amber-300'}">
                      ${isPayment ? `-${m.amount.toFixed(2)} €` : `+${m.amount.toFixed(2)} €`}
                    </div>
                    <div class="text-[10px] text-slate-400 flex items-center justify-end gap-2">
                      <span>Saldo: ${Math.max(0, m.runningBalance).toFixed(2)}€</span>
                      ${isPayment ? `
                        <button
                          type="button"
                          onclick="window.app.revertCustomerPaymentAction('${this._escJsAttr(m.id)}', '${this._escJsAttr(account.customerName)}')"
                          class="text-rose-400 hover:text-rose-300 underline"
                        >Anular</button>
                      ` : ''}
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    `;

    modal.classList.add('active');
    this._playChime('tap');
  }

  async confirmCustomerPayment(customerName) {
    return this._runLocked(`custPay_${customerName}`, async () => {
      const amount = parseFloat(document.getElementById('custPayAmountInput')?.value);
      const paymentMethod = document.getElementById('custPayMethodSelect')?.value || 'Efectivo';
      const isWorker = this.authAgent.isWorker();
      const assignedWh = this.authAgent.getAssignedWarehouseId();
      const warehouseId = isWorker && assignedWh
        ? assignedWh
        : (document.getElementById('custPayWarehouseSelect')?.value || MAIN_WAREHOUSE_ID);
      const notes = document.getElementById('custPayNotesInput')?.value || '';

      try {
        const res = await this.salesAgent.recordCustomerPayment({
          customerName,
          amount,
          paymentMethod,
          warehouseId,
          notes
        });
        this._playChime('success');
        this.showToast(res.message, '💶');
        const wh = await this.inventoryAgent.getWarehouse(warehouseId);
        this.notificationsAgent.notifyCustomerPayment({
          customerName,
          amount: res.settlement.amount,
          paymentMethod,
          remainingBalance: res.summary.liveBalance,
          warehouse: wh,
          isWorkerSession: isWorker
        }).catch(() => {});
        this.scheduleCloudSnapshotPublish();
        await this.openCustomerLedgerModal(customerName);
        await this.renderCurrentTab();
        await this.updateHeaderQuickStats();
      } catch (err) {
        alert(`No se pudo registrar el abono: ${err.message}`);
      }
    });
  }

  async revertCustomerPaymentAction(settlementId, customerName) {
    if (!confirm('¿Anular este abono? El saldo pendiente del cliente volverá a recalcularse.')) {
      return;
    }
    try {
      const res = await this.salesAgent.deleteCustomerPayment(settlementId);
      this._playChime('revert');
      this.showToast(res.message, '↩️');
      this.scheduleCloudSnapshotPublish();
      await this.openCustomerLedgerModal(customerName || res.summary?.customerName);
      await this.renderCurrentTab();
      await this.updateHeaderQuickStats();
    } catch (err) {
      alert(`Error anulando abono: ${err.message}`);
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
      <!-- GRÁFICA 1: FACTURACIÓN EN FUNCIÓN DEL TIEMPO (€) ESTILO iOS 27 PREVIEW -->
      <div class="ios-glass-card p-4">
        <div class="flex items-center justify-between mb-3">
          <span class="text-sm font-semibold text-white">Evolución (${scaleLabels[scale]})</span>
          <span class="text-xs ${trendPositive ? 'text-emerald-400' : 'text-rose-400'} font-medium tabular-nums">
            ${trendPositive ? '+' : ''}${trendVal} %
          </span>
        </div>

        <!-- Lienzo SVG Interactivo -->
        <div class="ts-chart-wrapper mb-2.5">
          <svg viewBox="0 0 ${svgW} ${svgH}" class="ts-svg-canvas">
            <defs>
              <linearGradient id="revAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#34d399" stop-opacity="0.38"/>
                <stop offset="100%" stop-color="#34d399" stop-opacity="0.0"/>
              </linearGradient>
              <linearGradient id="revBarGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#34d399" stop-opacity="0.25"/>
                <stop offset="100%" stop-color="#10b981" stop-opacity="0.05"/>
              </linearGradient>
            </defs>

            <!-- Líneas guía horizontales y etiquetas del Eje Y (€) -->
            <line x1="${padLeft}" y1="${padTop}" x2="${svgW - padRight}" y2="${padTop}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3,3"/>
            <text x="${padLeft - 6}" y="${padTop + 4}" text-anchor="end" fill="#94a3b8" font-size="9.5" font-weight="600">${Math.round(maxY)}€</text>

            <line x1="${padLeft}" y1="${(padTop + plotH / 2).toFixed(1)}" x2="${svgW - padRight}" y2="${(padTop + plotH / 2).toFixed(1)}" stroke="rgba(255,255,255,0.05)" stroke-dasharray="3,3"/>
            <text x="${padLeft - 6}" y="${(padTop + plotH / 2 + 3).toFixed(1)}" text-anchor="end" fill="#64748b" font-size="9.5">${Math.round(maxY / 2)}€</text>

            <line x1="${padLeft}" y1="${baseLineY}" x2="${svgW - padRight}" y2="${baseLineY}" stroke="rgba(255,255,255,0.12)"/>
            <text x="${padLeft - 6}" y="${baseLineY + 3}" text-anchor="end" fill="#64748b" font-size="9.5">0€</text>

            ${mode === 'interval' && meta.avgBilledPerPoint > 0 ? `
              <line x1="${padLeft}" y1="${avgY.toFixed(1)}" x2="${svgW - padRight}" y2="${avgY.toFixed(1)}" stroke="#fbbf24" stroke-width="1.2" stroke-dasharray="4,4" opacity="0.65"/>
            ` : ''}

            ${mode === 'interval' ? coordsBilled.map((c) => {
              if (c.val <= 0) return '';
              const bw = Math.max(4, Math.min(20, colW * 0.55));
              const bh = Math.max(2, baseLineY - c.y);
              return `<rect x="${(c.x - bw / 2).toFixed(1)}" y="${c.y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="url(#revBarGrad)" />`;
            }).join('') : ''}

            ${areaPathBilled ? `<path d="${areaPathBilled}" fill="url(#revAreaGrad)" />` : ''}
            ${linePathProfit ? `<path d="${linePathProfit}" fill="none" stroke="#818cf8" stroke-width="1.8" stroke-dasharray="3,2" opacity="0.8" />` : ''}
            ${linePathBilled ? `<path d="${linePathBilled}" fill="none" stroke="#34d399" stroke-width="2.6" stroke-linecap="round" />` : ''}

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
        </div>

        <!-- Panel Inspector Táctil del Punto Seleccionado -->
        <div id="revenueChartInspector" class="ts-inspector-bar mb-2">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span>
            <span class="text-xs font-semibold text-white">${this._escapeHtml(inspectedPt.label)}</span>
            <span class="text-[10px] text-slate-400">(${inspectedPt.transactions} ${inspectedPt.transactions === 1 ? 'venta' : 'ventas'})</span>
          </div>
          <div class="flex flex-wrap items-center gap-3 text-xs tabular-nums">
            <span>Tramo: <strong class="text-white">${inspectedPt.billed.toFixed(2)}€</strong></span>
            <span>Beneficio: <strong class="text-emerald-400">+${inspectedPt.profit.toFixed(2)}€</strong></span>
            <span>Acum.: <strong class="text-indigo-300">${inspectedPt.cumulativeBilled.toFixed(2)}€</strong></span>
          </div>
        </div>

        <!-- Desplegable con controles de escala (24h, 7d, 30d, 12m), modo y picos -->
        <details class="ios-accordion mb-0">
          <summary>
            <span>Escala y detalles de gráfica (${scaleLabels[scale]})</span>
          </summary>
          <div class="ios-accordion-body space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
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
                >Por tramo</button>
                <button 
                  type="button"
                  onclick="window.app.setTimeSeriesMode('revenue', 'cumulative')"
                  class="ts-mini-pill btn-pressable ${mode === 'cumulative' ? 'active-emerald' : ''}"
                >Acumulada</button>
              </div>
            </div>

            <div class="grid grid-cols-3 gap-2 text-center tabular-nums">
              <div class="bg-white/5 p-2 rounded-xl border border-white/10">
                <div class="text-[9px] text-slate-400 uppercase">Total serie</div>
                <div class="text-xs font-bold text-white">${meta.totalBilled.toFixed(2)}€</div>
                <div class="text-[10px] text-emerald-400">+${meta.totalProfit.toFixed(2)}€</div>
              </div>
              <div class="bg-white/5 p-2 rounded-xl border border-white/10">
                <div class="text-[9px] text-slate-400 uppercase">Pico máximo</div>
                <div class="text-xs font-bold text-emerald-300">${meta.maxBilled.toFixed(2)}€</div>
                <div class="text-[10px] text-slate-400 truncate">${this._escapeHtml(meta.maxBilledLabel)}</div>
              </div>
              <div class="bg-white/5 p-2 rounded-xl border border-white/10">
                <div class="text-[9px] text-slate-400 uppercase">Media</div>
                <div class="text-xs font-bold text-indigo-300">${meta.avgBilledPerPoint.toFixed(2)}€</div>
                <div class="text-[10px] text-slate-400">Por tramo</div>
              </div>
            </div>
          </div>
        </details>
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

  setAnalyticsSubView(subView) {
    this.analyticsSubView = subView || 'resumen';
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
    const pendingDebtors = data.debtsAndReservations?.debtorsByCustomer || [];
    const totalPendingDebt = data.debtsAndReservations?.totalPendingDebtAmount || 0;

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
          <div class="text-[11px] text-indigo-300 font-bold mb-1">📦 Tu Stock (Consignación)</div>
          <div class="text-2xl font-black text-white tabular-nums">${myWarehouse ? myWarehouse.currentStockUnits : 0} uds</div>
          <div class="text-[10px] text-slate-400 mt-1">Valor PVP: ${(myWarehouse ? myWarehouse.stockRetailValuation : 0).toFixed(2)}€</div>
        </div>
      </div>

      ${workerAcct ? `
        <!-- 3 Indicadores de Consignación para el Trabajador -->
        <div class="ios-card ios-card-glow-emerald mb-4 space-y-2.5">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-black text-white flex items-center gap-1.5">
              <span>💼</span> Tu Cuenta y Comisiones
            </h3>
            <span class="badge badge-ok-stock text-[10px]">
              ${workerAcct.commissionPerUnit > 0 ? `${workerAcct.commissionPerUnit.toFixed(2)}€/ud · ` : ''}${workerAcct.rewardFreeUnits} regalo/${workerAcct.rewardEveryNUnits} uds
            </span>
          </div>

          <div class="bg-slate-900/80 p-3 rounded-xl border border-slate-700/60 tabular-nums space-y-1">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-slate-300">💶 1. Dinero por entregar al Jefe:</span>
              <span class="text-lg font-black ${workerAcct.pendingMoneyToDeliver > 0 ? 'text-amber-400' : 'text-emerald-400'}">
                ${workerAcct.pendingMoneyToDeliver.toFixed(2)}€
              </span>
            </div>
            <div class="text-[10px] text-slate-400 flex flex-wrap justify-between gap-2">
              <span>Cobrado: <strong class="text-white">${workerAcct.totalCollectedPaid.toFixed(2)}€</strong> (💵 ${workerAcct.collectedCash.toFixed(0)}€ / 💳 ${workerAcct.collectedCard.toFixed(0)}€)</span>
              <span>Entregado ya: <strong class="text-emerald-400">${workerAcct.cashSettledAmount.toFixed(2)}€</strong></span>
            </div>
            ${workerAcct.netCommissionOffset > 0 ? `
              <div class="text-[10px] text-indigo-300">
                − Tus comisiones descontadas: <strong>-${workerAcct.netCommissionOffset.toFixed(2)}€</strong> · Neto a entregar: <strong>${workerAcct.netObligationToBoss.toFixed(2)}€</strong>
              </div>
            ` : ''}
          </div>

          <div class="bg-emerald-950/35 p-3 rounded-xl border border-emerald-500/30">
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs font-bold text-emerald-200">🎁 Tus comisiones y regalos:</span>
              <span class="text-sm font-black text-emerald-400 tabular-nums">
                ${workerAcct.commissionPerUnit > 0 ? `${workerAcct.earnedCommissionEuro.toFixed(2)}€ · ` : ''}${workerAcct.pendingFreeVapers} ${workerAcct.pendingFreeVapers === 1 ? 'vaper' : 'vapers'}
              </span>
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
              <span>Regalos recibidos: <strong class="text-emerald-300">${workerAcct.deliveredFreeVapers}</strong></span>
            </div>
          </div>
        </div>
      ` : ''}

      ${pendingDebtors.length > 0 ? `
        <div class="ios-card ios-card-glow-amber mb-4">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-xs font-black uppercase tracking-wider text-amber-300">⏳ Tus Fiados Pendientes (${totalPendingDebt.toFixed(2)}€)</h3>
            <button onclick="window.app.openCustomerDebtorsModal()" class="text-[11px] text-emerald-300 font-semibold underline">Ver todos ›</button>
          </div>
          <div class="space-y-2">
            ${pendingDebtors.map(c => `
              <div
                onclick="window.app.openCustomerLedgerModal('${this._escJsAttr(c.customerName)}')"
                class="bg-slate-900/85 p-2.5 rounded-xl border border-amber-500/35 flex items-center justify-between gap-2 text-xs cursor-pointer"
              >
                <div class="min-w-0">
                  <div class="font-bold text-white truncate">👤 ${this._escapeHtml(c.customerName)}</div>
                  <div class="text-[10px] text-amber-300 font-bold tabular-nums">
                    Debe: ${c.liveBalance.toFixed(2)}€ ${c.totalPaid > 0 ? `(Abonado -${c.totalPaid.toFixed(2)}€)` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onclick="event.stopPropagation(); window.app.openCustomerLedgerModal('${this._escJsAttr(c.customerName)}')"
                  class="btn-pressable bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2.5 py-1 rounded-lg text-[10px] font-bold"
                >+ Abono</button>
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
      <!-- Grupo 1 iOS 27 Settings: Nube, Avisos y Trabajadores (Desplegables al tocar) -->
      <div class="ios-grouped-list mb-4">
        <!-- Fila 1: Base de datos Supabase -->
        <details class="ios-grouped-accordion">
          <summary>
            <span class="text-sm text-white font-medium">Base de datos Supabase</span>
            <span class="text-xs ${sbConnected ? 'text-emerald-400' : sbConfigured ? 'text-amber-300' : 'text-slate-400'} font-medium">
              ${sbConnected ? 'Conectado' : sbConfigured ? 'Configurado' : 'Local'} ›
            </span>
          </summary>
          <div class="ios-grouped-accordion-body space-y-3">
            <p class="text-xs text-slate-400">
              Sincronización en tiempo real en la nube para catálogo, almacenes, ventas, reservas y liquidaciones.
            </p>
            <div>
              <label class="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mb-1">Supabase Project URL</label>
              <input
                type="url"
                id="inputSupabaseUrl"
                value="${this._escapeHtml(sbCfg.url || '')}"
                placeholder="https://xxxxxxxxxxxx.supabase.co"
                class="w-full bg-white/10 text-white font-mono text-xs px-3 py-2 rounded-xl border border-white/10 focus:outline-none focus:border-white/30"
              />
            </div>
            <div>
              <label class="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mb-1">Supabase Anon Public Key</label>
              <input
                type="text"
                id="inputSupabaseAnonKey"
                value="${this._escapeHtml(sbCfg.anonKey || '')}"
                placeholder="sb_publishable_... o eyJ..."
                class="w-full bg-white/10 text-white font-mono text-xs px-3 py-2 rounded-xl border border-white/10 focus:outline-none focus:border-white/30"
              />
            </div>
            ${this.supabaseAgent.lastError ? `
              <div class="text-[11px] text-rose-400 font-semibold">⚠️ Error: ${this._escapeHtml(this.supabaseAgent.lastError)}</div>
            ` : ''}
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
              <button
                type="button"
                onclick="window.app.saveSupabaseConfigFromView()"
                class="btn-pressable bg-emerald-500 text-slate-950 text-xs font-semibold py-2.5 px-3 rounded-xl"
              >Conectar Supabase</button>
              <button
                type="button"
                onclick="window.app.pushLocalToSupabaseNow()"
                class="btn-pressable bg-white/10 hover:bg-white/15 text-white text-xs font-medium py-2.5 px-3 rounded-xl"
                ${!sbConfigured ? 'disabled style="opacity:0.45"' : ''}
              >Subir datos locales</button>
              <button
                type="button"
                onclick="window.app.pullFromSupabaseNow()"
                class="btn-pressable bg-white/10 hover:bg-white/15 text-white text-xs font-medium py-2.5 px-3 rounded-xl"
                ${!sbConfigured ? 'disabled style="opacity:0.45"' : ''}
              >Descargar nube</button>
            </div>
          </div>
        </details>

        <!-- Fila 2: Avisos iPhone (ntfy) -->
        <details class="ios-grouped-accordion">
          <summary>
            <span class="text-sm text-white font-medium">Avisos iPhone (ntfy)</span>
            <span id="ntfyStatusBadge" class="text-xs ${ntfy.enabled ? 'text-emerald-400' : 'text-slate-400'} font-medium">
              ${ntfy.enabled ? 'Activo' : 'Pausado'} ›
            </span>
          </summary>
          <div class="ios-grouped-accordion-body space-y-3">
            <div>
              <label class="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mb-1">Canal privado de ntfy (Topic)</label>
              <div class="flex gap-1.5">
                <input
                  type="text"
                  id="inputNtfyTopic"
                  value="${this._escapeHtml(ntfy.topic)}"
                  class="flex-1 bg-white/10 text-white font-mono text-xs px-3 py-2 rounded-xl border border-white/10 focus:outline-none focus:border-white/30"
                />
                <button
                  type="button"
                  onclick="window.app.copyNtfyTopic()"
                  class="btn-pressable bg-white/10 hover:bg-white/15 text-white text-xs font-medium px-3 py-2 rounded-xl"
                >Copiar</button>
              </div>
            </div>

            <div class="flex flex-wrap gap-2 text-xs">
              <label class="flex items-center gap-1.5 bg-white/5 px-2.5 py-1.5 rounded-xl border border-white/10 cursor-pointer">
                <input type="checkbox" id="chkNtfyEnabled" ${ntfy.enabled ? 'checked' : ''} onchange="window.app.saveNtfySettingsFromView()" class="accent-emerald-500" />
                <span class="text-slate-200 font-medium">Activar avisos</span>
              </label>
              <label class="flex items-center gap-1.5 bg-white/5 px-2.5 py-1.5 rounded-xl border border-white/10 cursor-pointer">
                <input type="checkbox" id="chkNtfyWorkers" ${ntfy.notifyWorkerSales ? 'checked' : ''} onchange="window.app.saveNtfySettingsFromView()" class="accent-emerald-500" />
                <span class="text-slate-200">Ventas trabajadores</span>
              </label>
              <label class="flex items-center gap-1.5 bg-white/5 px-2.5 py-1.5 rounded-xl border border-white/10 cursor-pointer">
                <input type="checkbox" id="chkNtfyRes" ${ntfy.notifyReservations ? 'checked' : ''} onchange="window.app.saveNtfySettingsFromView()" class="accent-emerald-500" />
                <span class="text-slate-200">Reservas</span>
              </label>
              <label class="flex items-center gap-1.5 bg-white/5 px-2.5 py-1.5 rounded-xl border border-white/10 cursor-pointer">
                <input type="checkbox" id="chkNtfyBoss" ${ntfy.notifyBossSales ? 'checked' : ''} onchange="window.app.saveNtfySettingsFromView()" class="accent-emerald-500" />
                <span class="text-slate-200">Mis propias ventas</span>
              </label>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onclick="window.app.saveNtfySettingsFromView(true)"
                class="btn-pressable bg-white/10 hover:bg-white/15 text-white text-xs font-medium py-2.5 px-3 rounded-xl"
              >Guardar canal</button>
              <button
                type="button"
                onclick="window.app.testNtfyNotification()"
                class="btn-pressable bg-emerald-500 text-slate-950 text-xs font-semibold py-2.5 px-3 rounded-xl"
              >Probar notificación</button>
              <button
                type="button"
                onclick="window.app.syncFullStateToCloud()"
                class="btn-pressable bg-white/10 hover:bg-white/15 text-white text-xs font-medium py-2.5 px-3 rounded-xl"
              >Sincronizar trabajadores</button>
            </div>

            <div class="text-[11px] text-slate-400 pt-1">
              En la app <strong>ntfy</strong> de tu iPhone, suscríbete al canal <code id="ntfyGuideTopicCode" class="px-1.5 py-0.5 rounded bg-white/10 text-emerald-300 font-semibold">${this._escapeHtml(ntfy.topic)}</code>.
            </div>
          </div>
        </details>

        <!-- Fila 3: Trabajadores, Almacenes y PINs -->
        <details class="ios-grouped-accordion">
          <summary>
            <span class="text-sm text-white font-medium">Trabajadores y almacenes</span>
            <span class="text-xs text-slate-400">${warehouses.length} almacenes ›</span>
          </summary>
          <div class="ios-grouped-accordion-body space-y-3">
            <!-- PIN de Jefe y Cambiar Perfil -->
            <div class="bg-white/5 p-3 rounded-xl border border-white/10 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div class="text-xs font-semibold text-white">PIN de Jefe</div>
                <div class="text-[10px] text-slate-400">Para volver al modo Jefe desde otro móvil</div>
              </div>
              <div class="flex items-center gap-1.5">
                <input
                  type="text"
                  inputmode="numeric"
                  id="inputSettingsBossPin"
                  value="${this._escapeHtml(bossPin)}"
                  class="w-20 text-center bg-white/10 text-white font-bold tracking-widest text-xs py-1.5 rounded-lg border border-white/10"
                />
                <button
                  type="button"
                  onclick="window.app.saveBossPinFromSettings()"
                  class="btn-pressable bg-white text-slate-950 text-xs font-semibold px-3 py-1.5 rounded-lg"
                >Guardar</button>
                <button
                  type="button"
                  onclick="window.app.openPinAuthModal()"
                  class="btn-pressable bg-white/10 text-slate-200 text-xs font-medium px-2.5 py-1.5 rounded-lg"
                >Perfil</button>
              </div>
            </div>

            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-slate-300">Almacenes y enlaces de trabajadores</span>
              <button
                type="button"
                onclick="window.app.openWarehouseModal()"
                class="text-emerald-400 hover:text-emerald-300 text-xs font-semibold"
              >+ Añadir almacén</button>
            </div>

            <div class="space-y-2">
              ${warehouses.map(wh => `
                <div class="bg-white/5 p-3 rounded-xl border border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <div class="font-semibold text-white">${wh.icon || '🏠'} ${this._escapeHtml(wh.name)}</div>
                    <div class="text-[10px] text-slate-400">
                      ${wh.isMain ? 'Almacén Principal' : `${wh.workerName ? `${this._escapeHtml(wh.workerName)} · ` : ''}PIN: <strong class="text-indigo-300 font-mono">${this._escapeHtml(wh.workerPin || '----')}</strong>`}
                    </div>
                  </div>
                  <div class="flex items-center gap-1.5">
                    ${wh.isMain ? '' : `
                      <button
                        type="button"
                        onclick="window.app.openWorkerInviteModal('${wh.id}')"
                        class="btn-pressable bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2.5 py-1 rounded-lg text-[11px] font-medium"
                      >Enlace</button>
                      <button
                        type="button"
                        onclick="window.app.enterWorkerView('${wh.id}')"
                        class="btn-pressable bg-white/10 text-slate-200 px-2.5 py-1 rounded-lg text-[11px] font-medium"
                      >Probar</button>
                    `}
                    <button
                      type="button"
                      onclick="window.app.openWarehouseModal('${wh.id}')"
                      class="btn-pressable bg-white/10 text-slate-200 px-2.5 py-1 rounded-lg text-[11px] font-medium"
                    >Editar</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </details>
      </div>

      <!-- Grupo 2 iOS 27 Settings: Copias de Seguridad, Almacenamiento y Reinicio -->
      <div class="ios-grouped-list mb-6">
        <button
          type="button"
          onclick="window.app.exportDataBackup()"
          class="ios-grouped-row w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-white/5 transition"
        >
          <span class="text-sm text-white font-medium">Exportar copia JSON</span>
          <span class="text-xs text-slate-400">›</span>
        </button>

        <label class="ios-grouped-row w-full px-4 py-3.5 flex items-center justify-between cursor-pointer hover:bg-white/5 transition">
          <span class="text-sm text-white font-medium">Restaurar copia</span>
          <span class="text-xs text-slate-400">›</span>
          <input type="file" id="importBackupInput" accept=".json" class="hidden" onchange="window.app.importDataBackup(event)"/>
        </label>

        <details class="ios-grouped-accordion">
          <summary>
            <span class="text-sm text-white font-medium">Estado del almacenamiento</span>
            <span class="text-xs text-slate-400">${products.length} sabores · ${sales.length} ventas ›</span>
          </summary>
          <div class="ios-grouped-accordion-body text-xs text-slate-400 space-y-1.5">
            <div class="flex justify-between">
              <span>Sabores registrados:</span>
              <span class="font-semibold text-white">${products.length}</span>
            </div>
            <div class="flex justify-between">
              <span>Almacenes activos:</span>
              <span class="font-semibold text-white">${warehouses.length}</span>
            </div>
            <div class="flex justify-between">
              <span>Ventas históricas:</span>
              <span class="font-semibold text-white">${sales.length}</span>
            </div>
            <div class="flex justify-between">
              <span>Repartos de stock:</span>
              <span class="font-semibold text-white">${transfers.length}</span>
            </div>
            <div class="flex justify-between">
              <span>Modo Offline PWA:</span>
              <span class="font-semibold text-emerald-400">Activo (${APP_VERSION})</span>
            </div>
          </div>
        </details>

        <button
          type="button"
          onclick="window.app.resetDemoData()"
          class="ios-grouped-row w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-white/5 transition"
        >
          <span class="text-sm text-rose-400 font-medium">Reiniciar catálogo</span>
          <span class="text-xs text-rose-400">›</span>
        </button>
      </div>

      <div class="text-center text-[11px] text-slate-500 pb-12">
        VapeOS ${APP_VERSION} · Diseño iOS 27 Liquid Glass
      </div>
    `;

    container.innerHTML = html;
  }

  // =========================================================================
  // CONTROLADORES DE ROLES / PIN, INVITACIONES DE TRABAJADOR, NTFY Y CLOUD SYNC
  // =========================================================================
  async openPinAuthModal(forceLocked = false) {
    const modal = document.getElementById('pinAuthModal');
    const body = document.getElementById('pinAuthModalBody');
    if (!modal || !body) return;

    const isLocked = forceLocked || this.authAgent.isLocked();
    const session = this.authAgent.getSession();
    const isBoss = this.authAgent.isBoss();
    const isWorker = !isBoss;
    const warehouses = isBoss ? await this.inventoryAgent.getWarehouses() : [];
    const workerWhs = warehouses.filter(w => !w.isMain);

    body.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <div>
          <h3 class="text-lg font-black text-white">${isLocked ? '🔐 Acceso Protegido con PIN' : '🔐 Acceso y Cambio de Perfil'}</h3>
          <span class="text-xs text-slate-400">
            ${isLocked
              ? 'Introduce tu PIN personal para acceder a tu perfil'
              : `Sesión actual: ${isWorker ? `👤 ${this._escapeHtml(session.workerName)} (${this._escapeHtml(session.warehouseName)})` : '👑 Jefe (Acceso Total)'}`
            }
          </span>
        </div>
        ${isLocked ? '' : `<button onclick="document.getElementById('pinAuthModal').classList.remove('active')" class="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center font-bold">✕</button>`}
      </div>

      <form onsubmit="event.preventDefault(); window.app.submitPinAuthModal();" class="space-y-3 mb-4">
        <div class="bg-slate-900/80 p-3.5 rounded-2xl border border-white/10">
          <label class="text-xs text-slate-300 font-bold block mb-2 text-center">
            ${isLocked
              ? 'Introduce tu PIN de Trabajador o PIN de Jefe'
              : isWorker
                ? 'Introduce el PIN del Jefe (o el PIN de otro perfil) para cambiar'
                : 'Introduce un PIN de Trabajador o PIN de Jefe'
            }
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

      ${isBoss ? `
        <div class="pt-3 border-t border-slate-800 space-y-2.5">
          ${workerWhs.length > 0 ? `
            <div>
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
          <button
            type="button"
            onclick="window.app.lockToPinScreen()"
            class="btn-pressable w-full py-2.5 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-slate-200 text-xs font-semibold"
          >🔒 Bloquear pantalla (pedir PIN al abrir)</button>
        </div>
      ` : ''}
    `;

    modal.classList.add('active');
    if (!isLocked) this._playChime('tap');
  }

  lockToPinScreen() {
    const res = this.authAgent.logoutToPinLock();
    this.applyRoleUI();
    this.renderCurrentTab();
    this.updateHeaderQuickStats();
    this.openPinAuthModal(true);
    return res;
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

    await this.notificationsAgent.syncWithCloudConfig({ isBoss: this.authAgent.isBoss() }).catch(() => {});
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
    }, { syncToCloud: this.authAgent.isBoss() });

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
    if (!confirm('¿Reiniciar el catálogo a los 14 sabores del Pedido #1 (200 uds) en el Almacén Principal? (Se borrarán las ventas, pedidos, trabajadores y reservas actuales tanto en local como en Supabase)')) {
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
      this.showToast('¡14 Sabores (200 uds) cargados en local y nube!', '✓');
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
      <div class="space-y-3">
        ${orders.map(ord => {
          const isSelected = this.analyticsOrderFilter === ord.id;
          const isActive = ord.status === 'active';
          const dateStr = ord.createdAt
            ? new Date(ord.createdAt).toLocaleDateString([], { day: '2-digit', month: 'short' })
            : '';

          return `
            <div class="ios-glass-card p-4 space-y-3 ${isSelected ? 'border-emerald-400/50' : ''}">
              <div class="flex items-center justify-between">
                <div>
                  <div class="text-sm font-semibold text-white">${this._escapeHtml(ord.name)}</div>
                  <div class="text-xs text-slate-400">${ord.initialUnits} uds · ${isActive ? 'En curso' : 'Terminado'}${dateStr ? ` · ${dateStr}` : ''}</div>
                </div>
                <span class="text-xs font-semibold ${ord.roiPct >= 0 ? 'text-emerald-400' : 'text-rose-400'} tabular-nums">ROI ${ord.roiPct} %</span>
              </div>

              <div class="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div class="h-full bg-emerald-400 rounded-full" style="width: ${Math.min(100, ord.sellThroughPct)}%"></div>
              </div>

              <div class="flex justify-between text-xs text-slate-300 tabular-nums">
                <span>Facturado: ${ord.billed.toFixed(0)} €</span>
                <span class="text-emerald-400 font-medium">Beneficio: +${ord.profit.toFixed(0)} €</span>
              </div>

              <details class="ios-accordion mb-0">
                <summary>
                  <span>Desglose y acciones (${ord.unitsSold}/${ord.initialUnits} vendidas · ${ord.sellThroughPct}%)</span>
                </summary>
                <div class="ios-accordion-body space-y-2.5">
                  <div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-center tabular-nums">
                    <div class="bg-white/5 p-2 rounded-xl border border-white/10">
                      <div class="text-[9.5px] text-slate-400 uppercase">Inversión</div>
                      <div class="text-xs font-bold text-slate-200 mt-0.5">${ord.initialCost.toFixed(2)}€</div>
                    </div>
                    <div class="bg-white/5 p-2 rounded-xl border border-white/10">
                      <div class="text-[9.5px] text-slate-400 uppercase">Facturado</div>
                      <div class="text-xs font-bold text-white mt-0.5">${ord.billed.toFixed(2)}€</div>
                    </div>
                    <div class="bg-emerald-500/10 p-2 rounded-xl border border-emerald-500/25">
                      <div class="text-[9.5px] text-emerald-300 uppercase">Beneficio</div>
                      <div class="text-xs font-bold text-emerald-400 mt-0.5">+${ord.profit.toFixed(2)}€</div>
                    </div>
                    <div class="bg-white/5 p-2 rounded-xl border border-white/10">
                      <div class="text-[9.5px] text-slate-400 uppercase">Margen</div>
                      <div class="text-xs font-bold text-white mt-0.5">${ord.profitMargin}%</div>
                    </div>
                  </div>

                  <div class="flex flex-wrap items-center justify-between text-[11px] text-slate-400 gap-1 tabular-nums">
                    <span>💵 ${ord.cashBilled.toFixed(0)}€ · 💳 ${ord.cardBilled.toFixed(0)}€${ord.pendingDebtBilled > 0 ? ` · ⏳ ${ord.pendingDebtBilled.toFixed(0)}€` : ''}</span>
                    <span>${ord.transactionCount} ventas (ticket ${ord.avgTicket.toFixed(2)}€)</span>
                  </div>

                  ${ord.topFlavors && ord.topFlavors.length > 0 ? `
                    <div class="text-[11px] text-slate-300 bg-white/5 px-2.5 py-1.5 rounded-xl border border-white/10 truncate">
                      ⭐ Top: ${ord.topFlavors.map(f => `${this._escapeHtml(f.name)} (${f.unitsSold})`).join(' · ')}
                    </div>
                  ` : ''}

                  <div class="flex items-center gap-1.5 pt-1">
                    <button
                      type="button"
                      onclick="window.app.setAnalyticsOrderFilter('${this._escJsAttr(isSelected ? 'all' : ord.id)}')"
                      class="btn-pressable flex-1 py-2 px-2.5 rounded-xl text-xs font-semibold ${
                        isSelected
                          ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-500/40'
                          : 'bg-white/10 hover:bg-white/15 text-slate-200'
                      }"
                    >
                      ${isSelected ? '✓ Viendo este pedido (Ver todos)' : 'Filtrar métricas por este pedido'}
                    </button>
                    ${isActive ? `
                      <button
                        type="button"
                        onclick="window.app.closeOrderAction('${this._escJsAttr(ord.id)}')"
                        class="btn-pressable py-2 px-3 rounded-xl text-xs font-semibold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/35"
                      >Terminar</button>
                    ` : ''}
                  </div>
                </div>
              </details>
            </div>
          `;
        }).join('')}

        <div class="flex justify-end px-1">
          <button
            type="button"
            onclick="window.app.openNewOrderModal()"
            class="btn-pressable px-3.5 py-2 rounded-full bg-white text-slate-950 text-xs font-semibold"
          >+ Nuevo pedido / recuento</button>
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
