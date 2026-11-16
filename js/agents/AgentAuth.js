/**
 * Agente de Control de Acceso y Roles (Modo Jefe vs. Modo Trabajador)
 *
 * Responsable de:
 * - Gestionar el PIN del Jefe (por defecto '1234', modificable en Ajustes)
 * - Autenticar trabajadores mediante su PIN único o enlace de invitación (`?sync=...&wh=...&pin=...`)
 * - Aislar la sesión del trabajador a su almacén asignado (ocultando costes, márgenes y otros almacenes)
 * - Generar enlaces directos y mensajes de invitación para cada trabajador
 */

const ACTIVE_SESSION_STORAGE_KEY = 'gv_active_session';
const AUTH_CONFIG_KEY = 'auth_config';
const DEFAULT_BOSS_PIN = '1234';

export class AgentAuth {
  /**
   * @param {import('./AgentStorage.js').AgentStorage} storageAgent
   * @param {import('./AgentInventory.js').AgentInventory} inventoryAgent
   */
  constructor(storageAgent, inventoryAgent) {
    this.storage = storageAgent;
    this.inventory = inventoryAgent;
    this.bossPin = DEFAULT_BOSS_PIN;
    this.session = this._getDefaultBossSession();
  }

  _getDefaultBossSession() {
    return {
      role: 'boss',
      warehouseId: 'all',
      warehouseName: 'Todos los Almacenes',
      workerName: 'Jefe',
      isWorkerMode: false
    };
  }

  _buildWorkerSession(warehouse) {
    return {
      role: 'worker',
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      workerName: warehouse.workerName || warehouse.name,
      isWorkerMode: true
    };
  }

  _saveSession(session) {
    this.session = session;
    try {
      localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch (err) {
      console.warn('AgentAuth: No se pudo persistir la sesión:', err);
    }
    return this.session;
  }

  /**
   * Inicializa la configuración de PIN y la sesión activa (incluyendo auto-login desde enlace de trabajador).
   */
  async init() {
    try {
      const cfg = await this.storage.getConfig(AUTH_CONFIG_KEY, null);
      if (cfg && cfg.bossPin && String(cfg.bossPin).trim().length >= 4) {
        this.bossPin = String(cfg.bossPin).trim();
      } else {
        this.bossPin = DEFAULT_BOSS_PIN;
        await this.storage.setConfig(AUTH_CONFIG_KEY, { bossPin: this.bossPin });
      }
    } catch (err) {
      console.warn('AgentAuth: Error cargando auth_config:', err);
      this.bossPin = DEFAULT_BOSS_PIN;
    }

    // 1. Comprobar si viene invitación de trabajador por parámetros URL (?wh=...&pin=... o ?pin=...)
    try {
      if (typeof window !== 'undefined' && window.location && window.location.search) {
        const params = new URLSearchParams(window.location.search);
        const urlPin = params.get('pin');
        const urlWh = params.get('wh');

        if (urlPin && urlPin.trim()) {
          const warehouses = await this.inventory.getWarehouses();
          let matchedWh = null;

          if (urlWh) {
            matchedWh = warehouses.find(
              w => !w.isMain && w.id === urlWh && String(w.workerPin || '').trim() === urlPin.trim()
            );
          }
          if (!matchedWh) {
            matchedWh = warehouses.find(
              w => !w.isMain && String(w.workerPin || '').trim() === urlPin.trim()
            );
          }

          if (matchedWh) {
            this._saveSession(this._buildWorkerSession(matchedWh));
            return this.session;
          }

          // Fallback si el enlace traía el wh y aún no había llegado el snapshot remoto completo
          if (urlWh) {
            const urlWhName = params.get('name') || 'Mi Almacén';
            this._saveSession({
              role: 'worker',
              warehouseId: urlWh,
              warehouseName: urlWhName,
              workerName: urlWhName,
              isWorkerMode: true
            });
            return this.session;
          }
        }
      }
    } catch (err) {
      console.warn('AgentAuth: Error leyendo parámetros URL:', err);
    }

    // 2. Recuperar sesión previa guardada en localStorage
    try {
      const raw = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.role === 'worker' && parsed.warehouseId) {
          const warehouses = await this.inventory.getWarehouses();
          const wh = warehouses.find(w => w.id === parsed.warehouseId);
          if (wh && !wh.isMain) {
            this._saveSession(this._buildWorkerSession(wh));
            return this.session;
          }
          // Si ya no existe el almacén, mantener la sesión o volver a boss si fue eliminado
          this._saveSession(parsed);
          return this.session;
        }
      }
    } catch (err) {
      console.warn('AgentAuth: Error restaurando sesión:', err);
    }

    this._saveSession(this._getDefaultBossSession());
    return this.session;
  }

  getSession() {
    return this.session || this._getDefaultBossSession();
  }

  isBoss() {
    return this.getSession().role === 'boss';
  }

  isWorker() {
    return this.getSession().role === 'worker';
  }

  getAssignedWarehouseId() {
    const s = this.getSession();
    return s.role === 'worker' ? s.warehouseId : null;
  }

  async getBossPin() {
    const cfg = await this.storage.getConfig(AUTH_CONFIG_KEY, null);
    if (cfg && cfg.bossPin) {
      this.bossPin = String(cfg.bossPin).trim();
    }
    return this.bossPin;
  }

  async setBossPin(newPin) {
    const clean = String(newPin || '').trim();
    if (clean.length < 4) {
      throw new Error('El PIN de Jefe debe tener al menos 4 dígitos o caracteres.');
    }
    this.bossPin = clean;
    await this.storage.setConfig(AUTH_CONFIG_KEY, { bossPin: clean });
    return clean;
  }

  /**
   * Inicia sesión comparando el PIN contra el del Jefe o contra el PIN de cualquier trabajador.
   */
  async loginWithPin(pin) {
    const cleanPin = String(pin || '').trim();
    if (!cleanPin) {
      return { success: false, error: 'Introduce un código PIN.' };
    }

    const currentBossPin = await this.getBossPin();
    if (cleanPin === currentBossPin) {
      const session = this._saveSession(this._getDefaultBossSession());
      return { success: true, session };
    }

    const warehouses = await this.inventory.getWarehouses();
    const matchedWh = warehouses.find(
      w => !w.isMain && String(w.workerPin || '').trim() === cleanPin
    );

    if (matchedWh) {
      const session = this._saveSession(this._buildWorkerSession(matchedWh));
      return { success: true, session };
    }

    return { success: false, error: 'PIN incorrecto. Verifica el código con el jefe.' };
  }

  /**
   * Permite al jefe entrar directamente en el Modo Trabajador de un almacén concreto
   * (para probar la vista o entregar el dispositivo bloqueado).
   */
  async enterWorkerMode(warehouseId) {
    const wh = await this.inventory.getWarehouse(warehouseId);
    if (!wh || wh.isMain) {
      throw new Error('Solo se puede activar el Modo Trabajador en un almacén secundario.');
    }
    const session = this._saveSession(this._buildWorkerSession(wh));
    return { success: true, session };
  }

  /**
   * Sale del Modo Trabajador validando el PIN del Jefe.
   */
  async exitWorkerModeWithPin(pin) {
    const cleanPin = String(pin || '').trim();
    const currentBossPin = await this.getBossPin();
    if (cleanPin !== currentBossPin) {
      return { success: false, error: 'PIN de Jefe incorrecto.' };
    }
    const session = this._saveSession(this._getDefaultBossSession());
    return { success: true, session };
  }

  /**
   * Genera la URL directa y el mensaje de invitación para WhatsApp de un trabajador.
   */
  buildWorkerInviteData(warehouse, syncTopic = '', supabaseCfg = null) {
    if (!warehouse || warehouse.isMain) {
      throw new Error('Selecciona un almacén de trabajador válido.');
    }

    let baseUrl = 'https://wolkyyy7.github.io/gestor-ventas-ios/';
    if (typeof window !== 'undefined' && window.location) {
      baseUrl = `${window.location.origin}${window.location.pathname}`;
    }

    const params = new URLSearchParams();
    if (syncTopic && syncTopic.trim()) {
      params.set('sync', syncTopic.trim());
    }
    params.set('wh', warehouse.id);
    params.set('pin', warehouse.workerPin || '');
    params.set('name', warehouse.workerName || warehouse.name);
    if (supabaseCfg && supabaseCfg.url && supabaseCfg.anonKey) {
      params.set('sbUrl', supabaseCfg.url);
      params.set('sbKey', supabaseCfg.anonKey);
    }

    const inviteUrl = `${baseUrl}?${params.toString()}`;
    const workerLabel = warehouse.workerName || warehouse.name;

    const whatsappText = [
      `👋 Hola *${workerLabel}*, aquí tienes tu acceso personal a la app de ventas de *${warehouse.name}*:`,
      ``,
      `🔗 *Tu enlace directo:*`,
      inviteUrl,
      ``,
      `🔐 *Tu código PIN personal:* \`${warehouse.workerPin}\``,
      ``,
      `📱 *Cómo instalarla en tu móvil:*`,
      `1. Abre el enlace en Safari (iPhone) o Chrome (Android).`,
      `2. Pulsa *Compartir -> Añadir a pantalla de inicio*.`,
      `3. Cada venta que registres se descontará de tu stock y me avisará al instante.`
    ].join('\n');

    return {
      inviteUrl,
      pin: warehouse.workerPin,
      workerName: workerLabel,
      warehouseName: warehouse.name,
      whatsappText
    };
  }
}
