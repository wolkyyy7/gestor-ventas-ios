/**
 * Aplicación Principal - Orquestador UI Mobile-First
 * 
 * Conecta los agentes autónomos de Inventario, Ventas, Analítica y Almacenamiento
 * con una interfaz táctil ultra-rápida pensada para iPhone.
 */

import { AgentStorage } from './agents/AgentStorage.js?v=2.2';
import { AgentInventory } from './agents/AgentInventory.js?v=2.2';
import { AgentSales } from './agents/AgentSales.js?v=2.2';
import { AgentAnalytics } from './agents/AgentAnalytics.js?v=2.2';

class AppController {
  constructor() {
    this.storageAgent = new AgentStorage();
    this.inventoryAgent = new AgentInventory(this.storageAgent);
    this.salesAgent = new AgentSales(this.storageAgent, this.inventoryAgent);
    this.analyticsAgent = new AgentAnalytics(this.storageAgent);

    // Estado reactivo local de la interfaz
    this.activeTab = 'sales'; // 'sales' | 'inventory' | 'analytics' | 'settings'
    this.analyticsTimeframe = 'today';
    this.selectedProductForSale = null;
    this.saleQuantity = 1;
    this.saleUnitPrice = 0;
    this.salePaymentMethod = 'Efectivo'; // Efectivo como principal por defecto
    this.lastCompletedSale = null; // Para deshacer y repetir rápido
    this.editingProductId = null;
    this.inventorySearchQuery = '';
    this.salesSearchQuery = '';
    this.selectedCategoryFilter = 'all';

    // Sintetizador de audio web para feedback háptico/acústico
    this.audioCtx = null;
  }

  async init() {
    console.log('Iniciando Gestor de Ventas e Inventario...');
    await this.storageAgent.init();

    // Suscribirse a cambios en los datos para reactividad automática
    this.storageAgent.subscribe('products:changed', () => {
      this.renderCurrentTab();
      this.updateHeaderQuickStats();
    });

    this.storageAgent.subscribe('sales:changed', () => {
      this.renderCurrentTab();
      this.updateHeaderQuickStats();
    });

    this.setupEventListeners();
    this.setupServiceWorker();
    this.renderCurrentTab();
    this.updateHeaderQuickStats();
  }

  // ==========================================
  // FEEDBACK AUDITIVO Y HÁPTICO
  // ==========================================
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
        // Sonido suave de caja registradora / éxito (arpegio rápido)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.1); // A5
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
      } else if (type === 'tap') {
        // Clic sutil táctil
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(400, now);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
      } else if (type === 'revert') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(330, now + 0.2);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      }
    } catch (e) {
      // Ignorar si el navegador bloquea audio sin interacción
    }

    // Vibración en dispositivos que lo soporten
    if (navigator.vibrate) {
      if (type === 'success') navigator.vibrate([30, 40, 60]);
      else if (type === 'tap') navigator.vibrate(15);
    }
  }

  showToast(message, icon = '✓') {
    const toast = document.getElementById('toastNotice');
    if (!toast) return;
    toast.innerHTML = `<span style="font-size:16px;">${icon}</span> <span>${message}</span>`;
    toast.classList.add('show');
    clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 2800);
  }

  // ==========================================
  // CONFIGURACIÓN DE EVENT LISTENERS
  // ==========================================
  setupEventListeners() {
    // Pestañas de navegación
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = btn.dataset.tab;
        this.switchTab(tab);
        this._playChime('tap');
      });
    });

    // Cerrar modales con toque en el overlay o botón cerrar
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.remove('active');
        }
      });
    });

    // Delegación para cerrar botones de modal
    document.querySelectorAll('.btn-close-modal').forEach(btn => {
      btn.addEventListener('click', () => {
        const modal = btn.closest('.modal-overlay');
        if (modal) modal.classList.remove('active');
      });
    });
  }

  switchTab(tabName) {
    this.activeTab = tabName;
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Ocultar todas las vistas
    document.querySelectorAll('.tab-view').forEach(view => {
      view.classList.add('hidden');
    });

    // Mostrar vista activa
    const target = document.getElementById(`view-${tabName}`);
    if (target) target.classList.remove('hidden');

    this.renderCurrentTab();
  }

  renderCurrentTab() {
    switch (this.activeTab) {
      case 'sales':
        this.renderSalesView();
        break;
      case 'inventory':
        this.renderInventoryView();
        break;
      case 'analytics':
        this.renderAnalyticsView();
        break;
      case 'settings':
        this.renderSettingsView();
        break;
    }
  }

  async updateHeaderQuickStats() {
    const stats = await this.analyticsAgent.getQuickHeaderStats();
    const el = document.getElementById('headerTodayRevenue');
    if (el) {
      el.textContent = `${stats.todayBilled.toFixed(2)}€`;
    }
    const profitEl = document.getElementById('headerTodayProfit');
    if (profitEl) {
      profitEl.textContent = `+${stats.todayProfit.toFixed(2)}€ benef.`;
    }
  }

  // =========================================================================
  // VISTA 1: PANEL RÁPIDO DE VENTA (Agente de Ventas y Transacciones)
  // =========================================================================
  async renderSalesView() {
    const container = document.getElementById('view-sales');
    if (!container) return;

    const products = await this.inventoryAgent.getProducts({
      query: this.salesSearchQuery
    });

    const categories = await this.inventoryAgent.getCategories();

    let html = `
      <div class="mb-4">
        <!-- Banner de Deshacer / Repetir Última Venta -->
        ${this.lastCompletedSale ? `
          <div class="ios-card bg-emerald-950/40 border border-emerald-500/50 p-3 mb-3 flex items-center justify-between animate-fade-in shadow-lg">
            <div class="pr-2">
              <div class="flex items-center gap-1.5 mb-0.5">
                <span class="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse"></span>
                <span class="text-[10px] text-emerald-300 font-bold uppercase tracking-wider">Última Venta: ${this.lastCompletedSale.paymentMethod}</span>
              </div>
              <div class="text-xs font-bold text-white leading-tight">
                ${this.lastCompletedSale.quantity}x ${this.lastCompletedSale.productName} • ${this.lastCompletedSale.grossTotal.toFixed(2)}€
              </div>
              <div class="text-[10px] text-emerald-400 font-medium">Beneficio: +${this.lastCompletedSale.netProfit.toFixed(2)}€</div>
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
        <div class="flex items-center gap-2 mb-3">
          <div class="relative flex-1">
            <input 
              type="text" 
              id="salesSearchInput" 
              value="${this.salesSearchQuery || ''}"
              placeholder="🔍 Buscar sabor para cobrar..." 
              class="w-full bg-slate-800/90 text-white placeholder-slate-400 px-4 py-2.5 rounded-xl border border-slate-700/60 focus:outline-none focus:border-emerald-500 text-sm"
            />
            ${this.salesSearchQuery ? `
              <button id="btnClearSalesSearch" class="absolute right-3 top-2 text-slate-400 hover:text-white text-base">✕</button>
            ` : ''}
          </div>
          <button 
            onclick="window.app.openSalesHistoryModal()"
            class="btn-pressable bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shadow-sm"
            title="Ver y cancelar ventas anteriores"
          >
            <span>↩</span> Historial
          </button>
        </div>

        <div class="flex items-center justify-between text-xs text-slate-400 px-1 mb-2">
          <span>Toca un sabor para cobrar</span>
          <span class="font-medium text-emerald-400">${products.length} disponibles</span>
        </div>
      </div>

      <!-- Cuadrícula de productos listos para venta rápida (Responsive) -->
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 pb-8">
    `;

    if (products.length === 0) {
      html += `
        <div class="col-span-2 text-center py-12 px-4">
          <div class="text-4xl mb-2">📦</div>
          <p class="text-slate-300 font-medium">No se encontraron productos</p>
          <p class="text-xs text-slate-500 mt-1">Añade productos en la pestaña de Inventario o cambia el filtro de búsqueda.</p>
        </div>
      `;
    } else {
      products.forEach(p => {
        const isOutOfStock = p.stock <= 0;
        const isLowStock = p.stock > 0 && p.stock <= 4;
        const margin = p.sellPrice > 0 ? (((p.sellPrice - p.costPrice) / p.sellPrice) * 100).toFixed(0) : 0;
        const profit = (p.sellPrice - p.costPrice).toFixed(2);

        html += `
          <div 
            class="ios-card btn-pressable flex flex-col justify-between cursor-pointer transition-all border ${
              isOutOfStock 
                ? 'opacity-50 border-rose-900/40 bg-slate-900/60 pointer-events-none' 
                : 'hover:border-emerald-500/50'
            }"
            onclick="window.app.openQuickSaleSheet('${p.id}')"
          >
            <div>
              <div class="flex items-start justify-between gap-1 mb-1.5">
                <span class="text-xs font-semibold px-2 py-0.5 rounded-full ${
                  isOutOfStock 
                    ? 'badge-low-stock' 
                    : isLowStock ? 'badge-low-stock' : 'badge-ok-stock'
                }">
                  ${isOutOfStock ? 'Agotado' : `${p.stock} unid.`}
                </span>
                <span class="text-[10px] text-slate-400 uppercase tracking-wider">${p.category || 'General'}</span>
              </div>
              <h4 class="font-semibold text-white text-sm line-clamp-2 leading-tight">${p.name}</h4>
            </div>

            <div class="mt-3 pt-2 border-t border-slate-700/50 flex items-baseline justify-between">
              <div>
                <div class="text-xs text-slate-400">PVP</div>
                <div class="text-lg font-bold text-white">${p.sellPrice.toFixed(2)}€</div>
              </div>
              <div class="text-right">
                <div class="text-[10px] text-emerald-400 font-medium">+${profit}€</div>
                <div class="text-[9px] text-slate-500">margen ${margin}%</div>
              </div>
            </div>
          </div>
        `;
      });
    }

    html += `</div>`;
    container.innerHTML = html;

    // Vincular búsqueda
    const searchInput = document.getElementById('salesSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.salesSearchQuery = e.target.value;
        this.renderSalesView();
      });
    }
    const btnClear = document.getElementById('btnClearSalesSearch');
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        this.salesSearchQuery = '';
        this.renderSalesView();
      });
    }
  }

  // Bottom Sheet Modal: Preparar y Confirmar Venta
  async openQuickSaleSheet(productId, prefill = null) {
    const product = await this.inventoryAgent.getProduct(productId);
    if (!product) return;

    this.selectedProductForSale = product;
    if (prefill) {
      this.saleQuantity = prefill.quantity || 1;
      this.saleUnitPrice = prefill.finalUnitPrice !== undefined ? prefill.finalUnitPrice : product.sellPrice;
      this.salePaymentMethod = prefill.paymentMethod || 'Efectivo';
    } else {
      this.saleQuantity = 1;
      this.saleUnitPrice = product.sellPrice;
      this.salePaymentMethod = 'Efectivo'; // Efectivo como principal por defecto
    }

    const modal = document.getElementById('saleCheckoutModal');
    if (!modal) return;

    const inputPrice = document.getElementById('modalSalePriceInput');
    if (inputPrice) {
      inputPrice.value = this.saleUnitPrice;
    }

    this._updateSaleModalPreview(false);
    modal.classList.add('active');
    this._playChime('tap');
  }

  _updateSaleModalPreview(updatePriceInput = false) {
    const p = this.selectedProductForSale;
    if (!p) return;

    const qty = parseInt(this.saleQuantity, 10) || 1;
    const unitPrice = parseFloat(this.saleUnitPrice) || 0;
    const totalGross = parseFloat((unitPrice * qty).toFixed(2));
    const totalCost = parseFloat(((p.costPrice || 0) * qty).toFixed(2));
    const netProfit = parseFloat((totalGross - totalCost).toFixed(2));
    const remainingStock = p.stock - qty;

    const modalTitle = document.getElementById('modalSaleProductName');
    const modalStock = document.getElementById('modalSaleStockBadge');
    const inputQty = document.getElementById('modalSaleQtyInput');
    const inputPrice = document.getElementById('modalSalePriceInput');
    const displayTotal = document.getElementById('modalSaleTotalGross');
    const displayProfit = document.getElementById('modalSaleNetProfit');
    const displayRemaining = document.getElementById('modalSaleRemainingStock');
    const btnConfirm = document.getElementById('btnConfirmExecuteSale');

    if (modalTitle) modalTitle.textContent = p.name;
    if (modalStock) {
      modalStock.textContent = `${p.stock} disponibles en stock`;
      modalStock.className = `text-xs ${p.stock <= 3 ? 'text-rose-400 font-semibold' : 'text-slate-400'}`;
    }
    if (inputQty) inputQty.value = qty;
    
    // Solo modificar el campo de texto de precio si se pide expresamente (evita bugs al teclear)
    if (inputPrice && updatePriceInput) {
      inputPrice.value = unitPrice;
    }

    if (displayTotal) displayTotal.textContent = `${totalGross.toFixed(2)}€`;
    if (displayProfit) {
      displayProfit.textContent = `${netProfit >= 0 ? '+' : ''}${netProfit.toFixed(2)}€`;
      displayProfit.className = netProfit >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold';
    }
    if (displayRemaining) {
      displayRemaining.textContent = remainingStock < 0 ? '¡Stock insuficiente!' : `${remainingStock} unid.`;
      displayRemaining.className = remainingStock < 0 ? 'text-xs text-rose-400 font-bold' : 'text-xs text-slate-400';
    }

    if (btnConfirm) {
      btnConfirm.disabled = remainingStock < 0 || qty <= 0;
      btnConfirm.innerHTML = `
        <span>Cobrar ${totalGross.toFixed(2)}€ con ${this.salePaymentMethod}</span>
        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/>
        </svg>
      `;
    }

    // Actualizar botones de método de pago (Efectivo como principal)
    const btnCard = document.getElementById('btnPayCard');
    const btnCash = document.getElementById('btnPayCash');
    if (btnCard && btnCash) {
      if (this.salePaymentMethod === 'Efectivo') {
        btnCash.className = 'flex-1 py-3 px-4 rounded-xl border-2 border-emerald-500 bg-emerald-500/20 text-white font-semibold flex items-center justify-center gap-2 transition-all';
        btnCard.className = 'flex-1 py-3 px-4 rounded-xl border border-slate-700 bg-slate-800/80 text-slate-400 font-medium flex items-center justify-center gap-2 transition-all';
      } else {
        btnCard.className = 'flex-1 py-3 px-4 rounded-xl border-2 border-indigo-500 bg-indigo-500/20 text-white font-semibold flex items-center justify-center gap-2 transition-all';
        btnCash.className = 'flex-1 py-3 px-4 rounded-xl border border-slate-700 bg-slate-800/80 text-slate-400 font-medium flex items-center justify-center gap-2 transition-all';
      }
    }
  }

  setSalePaymentMethod(method) {
    this.salePaymentMethod = method;
    this._playChime('tap');
    this._updateSaleModalPreview(false);
  }

  changeSaleQuantity(delta) {
    const current = parseInt(this.saleQuantity, 10) || 1;
    const next = Math.max(1, current + delta);
    this.saleQuantity = next;
    this._playChime('tap');
    this._updateSaleModalPreview(false);
  }

  setSaleUnitPrice(value) {
    const val = parseFloat(value);
    if (!isNaN(val) && val >= 0) {
      this.saleUnitPrice = val;
    } else if (value === '' || value === '0') {
      this.saleUnitPrice = 0;
    }
    // No alterar inputPrice mientras el usuario teclea
    this._updateSaleModalPreview(false);
  }

  quickAdjustPrice(delta) {
    const current = parseFloat(this.saleUnitPrice) || 0;
    const next = Math.max(0, current + delta);
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

  async confirmExecuteSale() {
    if (!this.selectedProductForSale) return;

    try {
      const result = await this.salesAgent.executeSale({
        productId: this.selectedProductForSale.id,
        quantity: this.saleQuantity,
        finalUnitPrice: this.saleUnitPrice,
        paymentMethod: this.salePaymentMethod,
        notes: ''
      });

      // Guardar última venta para poder deshacerla con 1 toque
      this.lastCompletedSale = result.sale;

      // Cerrar modal
      const modal = document.getElementById('saleCheckoutModal');
      if (modal) modal.classList.remove('active');

      // Reproducir sonido de caja y feedback
      this._playChime('success');
      this.showToast(result.message, '💰');
      this.renderSalesView();
      this.updateHeaderQuickStats();
    } catch (err) {
      alert(`Error en la venta: ${err.message}`);
    }
  }

  // Cancelar y Deshacer Venta Restaurando Stock y Beneficio
  async undoAndRepeatSale(saleId) {
    try {
      const res = await this.salesAgent.revertSale(saleId);
      this._playChime('revert');
      this.showToast('Venta anulada. Stock y beneficio restaurados', '↩️');

      const reverted = res.revertedSale;
      this.lastCompletedSale = null;
      this.renderSalesView();
      this.updateHeaderQuickStats();

      // Volver a abrir el modal de venta para corregir y repetir
      if (reverted) {
        await this.openQuickSaleSheet(reverted.productId, {
          quantity: reverted.quantity,
          finalUnitPrice: reverted.unitPrice,
          paymentMethod: reverted.paymentMethod
        });
      }
    } catch (err) {
      alert(`Error al cancelar la venta: ${err.message}`);
    }
  }

  // Modal para ver y cancelar ventas anteriores
  async openSalesHistoryModal() {
    const modal = document.getElementById('salesHistoryModal');
    const content = document.getElementById('salesHistoryModalContent');
    if (!modal || !content) return;

    const sales = await this.salesAgent.getRecentSales(30);

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

        return `
          <div class="ios-card bg-slate-900/90 border border-slate-700/60 p-3 mb-2 flex items-center justify-between">
            <div class="flex-1 pr-2">
              <div class="flex items-center gap-1.5 mb-1">
                <span class="badge ${isCash ? 'badge-payment-cash' : 'badge-payment-card'}">
                  ${isCash ? '💵 Efectivo' : '💳 Tarjeta'}
                </span>
                <span class="text-[10px] text-slate-400">${dateFormatted} • ${timeFormatted}</span>
              </div>
              <h5 class="text-sm font-bold text-white">${s.productName}</h5>
              <div class="text-xs text-slate-400">
                ${s.quantity} x ${s.unitPrice.toFixed(2)}€ = <strong class="text-white">${s.grossTotal.toFixed(2)}€</strong>
                <span class="text-emerald-400 ml-1.5">(+${s.netProfit.toFixed(2)}€)</span>
              </div>
            </div>

            <div class="flex flex-col gap-1 items-end">
              <button 
                onclick="window.app.revertSaleFromModal('${s.id}', true)"
                class="btn-pressable bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap"
              >
                ↩ Anular y Repetir
              </button>
              <button 
                onclick="window.app.revertSaleFromModal('${s.id}', false)"
                class="btn-pressable text-[10px] text-rose-400 hover:text-rose-300 underline"
              >
                Solo Anular
              </button>
            </div>
          </div>
        `;
      }).join('');
    }

    modal.classList.add('active');
    this._playChime('tap');
  }

  async revertSaleFromModal(saleId, repeat = false) {
    if (!confirm('¿Deseas cancelar esta venta? Se devolverá el stock al inventario y se recalculará el beneficio.')) {
      return;
    }

    try {
      const res = await this.salesAgent.revertSale(saleId);
      this._playChime('revert');
      this.showToast('Venta cancelada y stock restaurado', '↩️');

      const modal = document.getElementById('salesHistoryModal');
      if (modal) modal.classList.remove('active');

      this.lastCompletedSale = null;
      this.renderSalesView();
      this.updateHeaderQuickStats();

      if (repeat && res.revertedSale) {
        await this.openQuickSaleSheet(res.revertedSale.productId, {
          quantity: res.revertedSale.quantity,
          finalUnitPrice: res.revertedSale.unitPrice,
          paymentMethod: res.revertedSale.paymentMethod
        });
      }
    } catch (err) {
      alert(`Error al anular la venta: ${err.message}`);
    }
  }

  // =========================================================================
  // VISTA 2: CATÁLOGO DE INVENTARIO (Agente de Gestión de Inventario)
  // =========================================================================
  async renderInventoryView() {
    const container = document.getElementById('view-inventory');
    if (!container) return;

    const products = await this.inventoryAgent.getProducts({
      query: this.inventorySearchQuery,
      category: this.selectedCategoryFilter
    });

    const valuation = await this.inventoryAgent.getInventoryValuation();
    const categories = await this.inventoryAgent.getCategories();

    let html = `
      <!-- Resumen rápido de valoración de inventario -->
      <div class="ios-card bg-gradient-to-br from-slate-800/90 to-slate-900/90 border border-slate-700/60 mb-4">
        <div class="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2">Valoración Global de Almacén</div>
        <div class="grid grid-cols-3 gap-2 text-center">
          <div class="bg-slate-800/50 p-2.5 rounded-xl border border-slate-700/40">
            <div class="text-[10px] text-slate-400">Total Unidades</div>
            <div class="text-base font-bold text-white">${valuation.totalStockUnits}</div>
            <div class="text-[9px] text-slate-400">${valuation.totalProducts} refs</div>
          </div>
          <div class="bg-slate-800/50 p-2.5 rounded-xl border border-slate-700/40">
            <div class="text-[10px] text-slate-400">Coste Stock</div>
            <div class="text-base font-bold text-slate-300">${valuation.totalCostValuation.toFixed(2)}€</div>
            <div class="text-[9px] text-slate-500">Inversión</div>
          </div>
          <div class="bg-emerald-950/30 p-2.5 rounded-xl border border-emerald-500/20">
            <div class="text-[10px] text-emerald-400">PVP Potencial</div>
            <div class="text-base font-bold text-emerald-300">${valuation.totalRetailValuation.toFixed(2)}€</div>
            <div class="text-[9px] text-emerald-400 font-medium">+${valuation.potentialGrossProfit.toFixed(2)}€</div>
          </div>
        </div>
      </div>

      <!-- Barra de acciones: Búsqueda y Botón Añadir -->
      <div class="flex items-center gap-2 mb-3">
        <div class="relative flex-1">
          <input 
            type="text" 
            id="inventorySearchInput" 
            value="${this.inventorySearchQuery || ''}"
            placeholder="🔍 Filtrar inventario..." 
            class="w-full bg-slate-800/90 text-white placeholder-slate-400 px-3.5 py-2.5 rounded-xl border border-slate-700/60 focus:outline-none focus:border-emerald-500 text-sm"
          />
        </div>
        <button 
          onclick="window.app.openProductModal()"
          class="btn-pressable bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm px-4 py-2.5 rounded-xl flex items-center gap-1.5 shadow-lg shadow-emerald-900/40 whitespace-nowrap"
        >
          <span class="text-lg leading-none">+</span> Añadir
        </button>
      </div>

      <!-- Lista de productos (Responsive: 1 col en móvil, 2 cols en tablet/PC) -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-2 pb-8">
    `;

    if (products.length === 0) {
      html += `
        <div class="text-center py-12 px-4">
          <div class="text-4xl mb-2">🏷️</div>
          <p class="text-slate-300 font-medium">No hay productos en esta selección</p>
          <button onclick="window.app.openProductModal()" class="mt-3 text-sm text-emerald-400 font-semibold underline">
            Crear el primer producto
          </button>
        </div>
      `;
    } else {
      products.forEach(p => {
        const isLow = p.stock <= 4;
        const profitMargin = p.sellPrice > 0 ? (((p.sellPrice - p.costPrice) / p.sellPrice) * 100).toFixed(0) : 0;

        html += `
          <div class="ios-card flex items-center justify-between gap-3 p-3.5">
            <!-- Info básica y tap para editar -->
            <div class="flex-1 cursor-pointer" onclick="window.app.openProductModal('${p.id}')">
              <div class="flex items-center gap-2 mb-1">
                <span class="text-[10px] uppercase font-bold tracking-wider text-slate-400 px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700/50">
                  ${p.category || 'General'}
                </span>
                ${isLow ? '<span class="text-[10px] text-rose-400 font-semibold">⚠️ Stock bajo</span>' : ''}
              </div>
              <h4 class="font-semibold text-white text-sm line-clamp-1">${p.name}</h4>
              <div class="flex items-center gap-3 text-xs mt-1 text-slate-400">
                <span>Coste: <strong class="text-slate-300">${p.costPrice.toFixed(2)}€</strong></span>
                <span>PVP: <strong class="text-white">${p.sellPrice.toFixed(2)}€</strong></span>
                <span class="text-emerald-400 text-[11px] font-medium">${profitMargin}% marg.</span>
              </div>
            </div>

            <!-- Controles rápidos de Stock +/- directo en la lista -->
            <div class="flex flex-col items-center justify-center bg-slate-900/70 p-1.5 rounded-xl border border-slate-700/60 min-w-[90px]">
              <div class="text-[10px] text-slate-400 uppercase font-medium">Stock</div>
              <div class="flex items-center gap-2 my-0.5">
                <button 
                  onclick="window.app.adjustStockInline('${p.id}', -1)"
                  class="btn-pressable w-6 h-6 rounded-lg bg-slate-800 text-slate-300 font-bold flex items-center justify-center hover:bg-slate-700 border border-slate-600/40 text-sm"
                  ${p.stock <= 0 ? 'disabled style="opacity:0.3"' : ''}
                >-</button>
                <span class="text-sm font-bold ${p.stock <= 0 ? 'text-rose-400' : p.stock <= 4 ? 'text-amber-400' : 'text-white'} min-w-[20px] text-center">
                  ${p.stock}
                </span>
                <button 
                  onclick="window.app.adjustStockInline('${p.id}', 1)"
                  class="btn-pressable w-6 h-6 rounded-lg bg-slate-800 text-slate-300 font-bold flex items-center justify-center hover:bg-slate-700 border border-slate-600/40 text-sm"
                >+</button>
              </div>
              <span class="text-[9px] text-slate-500">toca para editar</span>
            </div>
          </div>
        `;
      });
    }

    html += `</div>`;
    container.innerHTML = html;

    const inputSearch = document.getElementById('inventorySearchInput');
    if (inputSearch) {
      inputSearch.addEventListener('input', (e) => {
        this.inventorySearchQuery = e.target.value;
        this.renderInventoryView();
      });
    }
  }

  async adjustStockInline(id, delta) {
    try {
      await this.inventoryAgent.adjustStock(id, delta);
      this._playChime('tap');
      this.renderInventoryView();
      this.updateHeaderQuickStats();
    } catch (err) {
      this.showToast(err.message, '⚠️');
    }
  }

  // Modal para Añadir / Editar Producto
  async openProductModal(productId = null) {
    this.editingProductId = productId;
    const modal = document.getElementById('productFormModal');
    if (!modal) return;

    const titleEl = document.getElementById('productModalTitle');
    const nameInput = document.getElementById('inputProdName');
    const catInput = document.getElementById('inputProdCategory');
    const costInput = document.getElementById('inputProdCost');
    const sellInput = document.getElementById('inputProdSell');
    const stockInput = document.getElementById('inputProdStock');
    const btnDelete = document.getElementById('btnDeleteProduct');

    if (productId) {
      const p = await this.inventoryAgent.getProduct(productId);
      if (!p) return;
      if (titleEl) titleEl.textContent = 'Editar Producto';
      if (nameInput) nameInput.value = p.name;
      if (catInput) catInput.value = p.category || '';
      if (costInput) costInput.value = p.costPrice;
      if (sellInput) sellInput.value = p.sellPrice;
      if (stockInput) stockInput.value = p.stock;
      if (btnDelete) btnDelete.classList.remove('hidden');
    } else {
      if (titleEl) titleEl.textContent = 'Nuevo Producto';
      if (nameInput) nameInput.value = '';
      if (catInput) catInput.value = '';
      if (costInput) costInput.value = '';
      if (sellInput) sellInput.value = '';
      if (stockInput) stockInput.value = '10';
      if (btnDelete) btnDelete.classList.add('hidden');
    }

    modal.classList.add('active');
    this._playChime('tap');
  }

  async saveProductFromModal() {
    const name = document.getElementById('inputProdName')?.value;
    const category = document.getElementById('inputProdCategory')?.value || 'General';
    const costPrice = parseFloat(document.getElementById('inputProdCost')?.value) || 0;
    const sellPrice = parseFloat(document.getElementById('inputProdSell')?.value) || 0;
    const stock = parseInt(document.getElementById('inputProdStock')?.value, 10) || 0;

    try {
      if (this.editingProductId) {
        await this.inventoryAgent.updateProduct(this.editingProductId, {
          name, category, costPrice, sellPrice, stock
        });
        this.showToast('Producto actualizado con éxito', '✓');
      } else {
        await this.inventoryAgent.addProduct({
          name, category, costPrice, sellPrice, stock
        });
        this.showToast('Producto añadido al inventario', '✓');
      }

      document.getElementById('productFormModal')?.classList.remove('active');
      this._playChime('success');
      this.renderInventoryView();
    } catch (err) {
      alert(`Error al guardar: ${err.message}`);
    }
  }

  async deleteCurrentProduct() {
    if (!this.editingProductId) return;
    if (!confirm('¿Estás seguro de que quieres eliminar este producto del catálogo?')) return;

    try {
      await this.inventoryAgent.deleteProduct(this.editingProductId);
      document.getElementById('productFormModal')?.classList.remove('active');
      this.showToast('Producto eliminado', '🗑️');
      this.renderInventoryView();
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  }

  // =========================================================================
  // VISTA 3: ANALÍTICA Y MÉTRICAS (Agente de Analítica / Dashboard)
  // =========================================================================
  async renderAnalyticsView() {
    const container = document.getElementById('view-analytics');
    if (!container) return;

    const data = await this.analyticsAgent.getDashboardMetrics(this.analyticsTimeframe);

    const timeframeLabels = {
      today: 'Hoy',
      week: '7 Días',
      month: 'Este Mes',
      all: 'Histórico'
    };

    let html = `
      <!-- Segmented Control de periodo -->
      <div class="ios-segmented">
        <button class="segmented-option ${this.analyticsTimeframe === 'today' ? 'active' : ''}" onclick="window.app.setTimeframe('today')">Hoy</button>
        <button class="segmented-option ${this.analyticsTimeframe === 'week' ? 'active' : ''}" onclick="window.app.setTimeframe('week')">7 Días</button>
        <button class="segmented-option ${this.analyticsTimeframe === 'month' ? 'active' : ''}" onclick="window.app.setTimeframe('month')">Este Mes</button>
        <button class="segmented-option ${this.analyticsTimeframe === 'all' ? 'active' : ''}" onclick="window.app.setTimeframe('all')">Todo</button>
      </div>

      <!-- Tarjetas KPI Principales: Facturado y Beneficio -->
      <div class="grid grid-cols-2 gap-3 mb-4">
        <!-- Dinero Facturado -->
        <div class="ios-card bg-gradient-to-br from-slate-800 to-slate-900 border-indigo-500/20">
          <div class="flex items-center gap-1.5 text-xs text-indigo-300 font-semibold mb-1">
            <span>💳</span> Facturado
          </div>
          <div class="text-2xl font-black text-white tracking-tight">${data.totalBilled.toFixed(2)}€</div>
          <div class="text-[11px] text-slate-400 mt-1 flex justify-between">
            <span>${data.transactionCount} ventas</span>
            <span>${data.totalUnits} unid.</span>
          </div>
        </div>

        <!-- Dinero de Beneficio -->
        <div class="ios-card bg-gradient-to-br from-emerald-950/60 to-slate-900 border-emerald-500/30">
          <div class="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold mb-1">
            <span>📈</span> Beneficio Neto
          </div>
          <div class="text-2xl font-black text-emerald-400 tracking-tight">+${data.totalProfit.toFixed(2)}€</div>
          <div class="text-[11px] text-emerald-300/80 mt-1 flex justify-between">
            <span>Margen: ${data.overallProfitMargin}%</span>
            <span>Ticket: ${data.averageTicket.toFixed(2)}€</span>
          </div>
        </div>
      </div>

      <!-- Sección responsive: Desglose de Pago y Top Productos en paralelo en tablets/PC -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <!-- Desglose de Métodos de Pago: Tarjeta vs Efectivo -->
        <div class="ios-card mb-0">
          <div class="flex justify-between items-center mb-2">
            <span class="text-xs font-semibold uppercase tracking-wider text-slate-400">Métodos de Pago</span>
            <span class="text-xs text-slate-400">Total: ${data.totalBilled.toFixed(2)}€</span>
          </div>

          <!-- Barra comparativa visual -->
          <div class="ratio-bar">
            <div class="ratio-segment-card" style="width: ${data.paymentMethods.Tarjeta.percentage}%"></div>
            <div class="ratio-segment-cash" style="width: ${data.paymentMethods.Efectivo.percentage}%"></div>
          </div>

          <div class="grid grid-cols-2 gap-3 mt-3 pt-2 border-t border-slate-700/50">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="w-3 h-3 rounded-full bg-indigo-500 inline-block"></span>
                <span class="text-xs font-medium text-slate-300">Tarjeta</span>
              </div>
              <div class="text-right">
                <div class="text-xs font-bold text-white">${data.paymentMethods.Tarjeta.billed.toFixed(2)}€</div>
                <div class="text-[10px] text-indigo-400 font-medium">${data.paymentMethods.Tarjeta.percentage}% (${data.paymentMethods.Tarjeta.count})</div>
              </div>
            </div>

            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="w-3 h-3 rounded-full bg-emerald-500 inline-block"></span>
                <span class="text-xs font-medium text-slate-300">Efectivo</span>
              </div>
              <div class="text-right">
                <div class="text-xs font-bold text-white">${data.paymentMethods.Efectivo.billed.toFixed(2)}€</div>
                <div class="text-[10px] text-emerald-400 font-medium">${data.paymentMethods.Efectivo.percentage}% (${data.paymentMethods.Efectivo.count})</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Top Productos Más Vendidos -->
        <div class="ios-card mb-0">
          <div class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Top Ventas (${timeframeLabels[this.analyticsTimeframe]})</div>
          ${data.topProducts.length > 0 ? `
            <div class="space-y-2">
              ${data.topProducts.map((tp, idx) => `
                <div class="flex items-center justify-between text-xs py-1 border-b border-slate-800/80 last:border-0">
                  <div class="flex items-center gap-2">
                    <span class="w-5 h-5 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center font-bold text-[10px]">#${idx + 1}</span>
                    <span class="font-medium text-white truncate max-w-[150px]">${tp.name}</span>
                  </div>
                  <div class="text-right">
                    <span class="font-bold text-white">${tp.unitsSold} unid.</span>
                    <span class="text-emerald-400 font-medium ml-2">+${tp.profit.toFixed(2)}€</span>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : `
            <div class="text-xs text-slate-500 py-4 text-center">Sin ventas en este periodo</div>
          `}
        </div>
      </div>

      <!-- Historial de Ventas Recientes -->
      <div class="mb-4">
        <div class="flex items-center justify-between mb-2 px-1">
          <span class="text-xs font-semibold uppercase tracking-wider text-slate-400">Historial Reciente</span>
          <span class="text-xs text-slate-500">${data.recentSales.length} transacciones</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-2 pb-10">
    `;

    if (data.recentSales.length === 0) {
      html += `
        <div class="ios-card text-center py-8 text-slate-400 text-sm">
          No hay transacciones registradas en este periodo.
        </div>
      `;
    } else {
      data.recentSales.forEach(s => {
        const timeFormatted = new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateFormatted = new Date(s.timestamp).toLocaleDateString([], { day: '2-digit', month: '2-digit' });
        const isCard = s.paymentMethod === 'Tarjeta';

        html += `
          <div class="ios-card flex items-center justify-between p-3.5">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-1">
                <span class="badge ${isCard ? 'badge-payment-card' : 'badge-payment-cash'}">
                  ${isCard ? '💳 Tarjeta' : '💵 Efectivo'}
                </span>
                <span class="text-[10px] text-slate-400">${dateFormatted} • ${timeFormatted}</span>
              </div>
              <h5 class="text-sm font-semibold text-white">${s.productName}</h5>
              <div class="text-xs text-slate-400">
                ${s.quantity} x ${s.unitPrice.toFixed(2)}€
              </div>
            </div>

            <div class="text-right flex flex-col items-end">
              <div class="text-base font-bold text-white">${s.grossTotal.toFixed(2)}€</div>
              <div class="text-xs text-emerald-400 font-medium">+${s.netProfit.toFixed(2)}€</div>
              <button 
                onclick="window.app.revertSaleAction('${s.id}')"
                class="btn-pressable text-[10px] text-rose-400 hover:text-rose-300 mt-1 underline"
              >
                Anular
              </button>
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

  setTimeframe(tf) {
    this.analyticsTimeframe = tf;
    this._playChime('tap');
    this.renderAnalyticsView();
  }

  async revertSaleAction(saleId) {
    if (!confirm('¿Deseas anular esta venta? Se devolverá automáticamente el stock al inventario.')) {
      return;
    }

    try {
      const res = await this.salesAgent.revertSale(saleId);
      this._playChime('revert');
      this.showToast(res.message, '↩️');
      this.renderAnalyticsView();
      this.updateHeaderQuickStats();
    } catch (err) {
      alert(`Error anulando la venta: ${err.message}`);
    }
  }

  // =========================================================================
  // VISTA 4: AJUSTES Y PERSISTENCIA (Agente de Persistencia / Backup)
  // =========================================================================
  async renderSettingsView() {
    const container = document.getElementById('view-settings');
    if (!container) return;

    const products = await this.storageAgent.getAllProducts();
    const sales = await this.storageAgent.getAllSales();

    let html = `
      <!-- Copias de Seguridad -->
      <div class="ios-card mb-4">
        <h3 class="text-sm font-bold text-white mb-2 flex items-center gap-2">
          <span>💾</span> Copias de Seguridad Locales
        </h3>
        <p class="text-xs text-slate-400 mb-3 leading-relaxed">
          Tus datos se guardan directamente en este dispositivo (${this.storageAgent.isIndexedDBSupported ? 'IndexedDB' : 'LocalStorage'}). Puedes descargar una copia de seguridad o restaurarla en cualquier momento.
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

      <!-- Guía para iPhone / Pantalla de Inicio -->
      <div class="ios-card mb-4 border-indigo-500/30 bg-indigo-950/20">
        <h3 class="text-sm font-bold text-indigo-300 mb-2 flex items-center gap-2">
          <span>📱</span> Cómo usarla como App Nativa en iPhone
        </h3>
        <ol class="text-xs text-slate-300 space-y-2 list-decimal list-inside leading-relaxed">
          <li>Abre esta web en <strong>Safari</strong> en tu iPhone.</li>
          <li>Toca el botón <strong>Compartir</strong> (el icono del cuadrado con una flecha hacia arriba en la barra inferior de Safari).</li>
          <li>Desliza hacia abajo y selecciona <strong>"Añadir a la pantalla de inicio"</strong>.</li>
          <li>¡Listo! Se abrirá a pantalla completa sin barra de navegación, como una app nativa de la App Store.</li>
        </ol>
      </div>

      <!-- Estado y Gestión de Datos -->
      <div class="ios-card mb-4">
        <h3 class="text-sm font-bold text-white mb-2">Estado del Almacenamiento</h3>
        <div class="text-xs text-slate-400 space-y-1 mb-4">
          <div class="flex justify-between">
            <span>Productos registrados:</span>
            <span class="font-bold text-white">${products.length}</span>
          </div>
          <div class="flex justify-between">
            <span>Ventas registradas:</span>
            <span class="font-bold text-white">${sales.length}</span>
          </div>
          <div class="flex justify-between">
            <span>Modo Offline:</span>
            <span class="font-bold text-emerald-400">Activo (Cache PWA)</span>
          </div>
        </div>

        <div class="space-y-2 pt-2 border-t border-slate-700/60">
          <button 
            onclick="window.app.resetDemoData()"
            class="w-full text-xs font-semibold text-emerald-400 hover:text-emerald-300 py-3 px-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-center flex items-center justify-center gap-1.5"
          >
            <span>🔄</span> Cargar Catálogo Oficial (10 Sabores • 6,70€ / 13€)
          </button>
        </div>
      </div>

      <div class="text-center text-[11px] text-slate-500 pb-12">
        Gestor Privado de Inventario y Ventas v2.0<br/>
        Arquitectura Modular por Agentes • Diseñado para iOS
      </div>
    `;

    container.innerHTML = html;
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
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const json = JSON.parse(e.target.result);
        if (confirm('¿Restaurar esta copia de seguridad? Se reemplazarán los datos actuales.')) {
          await this.storageAgent.importBackup(json);
          this._playChime('success');
          this.showToast('Copia restaurada con éxito', '✓');
          this.renderSettingsView();
        }
      } catch (err) {
        alert('Archivo de copia no válido: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  async resetDemoData() {
    await this.storageAgent.setNewProductCatalog();
    this._playChime('success');
    this.showToast('¡10 Sabores cargados correctamente!', '✓');
    this.switchTab('sales');
  }

  // ==========================================
  // SERVICE WORKER PARA OFFLINE
  // ==========================================
  setupServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js?v=2.2')
          .then(reg => {
            console.log('Service Worker registrado correctamente');
            reg.update();
          })
          .catch(err => console.log('Registro SW opcional omitido:', err));

        navigator.serviceWorker.addEventListener('controllerchange', () => {
          console.log('Nuevo Service Worker activado. Recargando interfaz...');
          window.location.reload();
        });
      });
    }
  }
}

// Inicializar y exponer al ámbito global
window.app = new AppController();
document.addEventListener('DOMContentLoaded', () => {
  window.app.init();
});
