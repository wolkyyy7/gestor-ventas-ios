# Gestor Privado de Inventario y Ventas (iOS & Mobile PWA)

Una aplicación móvil moderna, privada y local diseñada con estética **Apple iOS (Mobile-First)** para gestionar el inventario de productos y registrar transacciones de venta diarias de forma ultrarrápida.

Ejecutable en cualquier **iPhone** (y otros dispositivos móviles u ordenadores) de forma **100% gratuita, local y sin pasar por la App Store**, utilizando tecnología **Progressive Web App (PWA)** instalable con soporte offline y persistencia en **IndexedDB**.

---

## 🏛️ Arquitectura Modular por Agentes

El sistema está estructurado en 4 módulos / agentes especializados y autónomos:

```
gestor-ventas-ios/
│
├── js/
│   ├── agents/
│   │   ├── AgentStorage.js      # Agente 4: Persistencia & IndexedDB
│   │   ├── AgentInventory.js    # Agente 1: Catálogo, Stock & Valoración
│   │   ├── AgentSales.js        # Agente 2: Transacciones Atómicas & Beneficio
│   │   └── AgentAnalytics.js    # Agente 3: Métricas Dashboard & Desglose
│   └── app.js                   # Orquestador UI & Feedback Háptico/Auditivo
│
├── css/
│   └── app.css                  # Diseño iOS Human Interface & Safe Areas
│
├── icons/                       # Iconos de alta resolución PWA
│   ├── icon-192.png
│   └── icon-512.png
│
├── index.html                   # Shell interactivo Mobile-First
├── manifest.json                # Manifiesto PWA para iOS Standalone
├── sw.js                        # Service Worker para funcionamiento Offline
├── server.py                    # Servidor local LAN con QR automático
└── INICIAR_APP.bat              # Lanzador en 1 clic para Windows
```

### 1. Agente de Gestión de Inventario (`AgentInventory.js`)
- Gestiona el catálogo de productos: nombre, categoría, precio de coste, precio de venta recomendado (PVP) y stock disponible.
- Búsquedas instantáneas y filtrado dinámico.
- Ajuste rápido de stock con botones táctiles `+` y `-` directamente en la lista.
- Valoración económica del almacén en tiempo real: Unidades totales, Capital inmovilizado (Coste) y Valor potencial de venta.

### 2. Agente de Registro de Ventas y Transacciones (`AgentSales.js`)
- Panel de venta ultrarrápido con selector táctil de productos y teclado de unidades.
- Permite cambiar el precio final sobre la marcha para aplicar descuentos o sobreprecios.
- Selección de método de pago: **Tarjeta** 💳 o **Efectivo** 💵.
- **Ejecución Atómica**:
  1. Verifica que haya stock disponible en almacén.
  2. Descuenta la cantidad vendida de forma atómica.
  3. Calcula el beneficio neto instantáneo: `(Precio Final - Precio Coste) × Cantidad`.
  4. Registra la transacción con timestamp exacto.
- Permite **anular/revertir transacciones**, restaurando el stock al instante.

### 3. Agente de Analítica y Métricas - Dashboard (`AgentAnalytics.js`)
- Métricas financieras en tiempo real con selector de periodo (**Hoy**, **7 Días**, **Este Mes**, **Histórico completo**):
  - **Dinero Facturado** (Ingresos brutos).
  - **Dinero de Beneficio** (Ganancia neta).
  - **Margen de Rentabilidad medio (%)** y **Ticket Medio**.
  - **Desglose de métodos de pago**: Tarjeta (€ y %) vs Efectivo (€ y %) con barra visual interactiva.
  - **Ranking Top Ventas** de los productos más vendidos.
  - **Historial detallado** de las ventas recientes.

### 4. Agente de Persistencia y Almacenamiento Local (`AgentStorage.js`)
- Motor de almacenamiento persistente en el dispositivo del usuario utilizando **IndexedDB** (con fallback transparente a **LocalStorage**).
- Exportación e importación de copias de seguridad en formato `.json` con un solo toque (compatible con archivos de iPhone / iCloud).
- Inicialización automática con catálogo de demostración si la base de datos está vacía.

---

## 🚀 Cómo probarlo en el ordenador y en tu iPhone

### Paso 1: Iniciar el servidor local en tu PC
Tienes dos opciones muy sencillas:
- **Opción A (Recomendada):** Haz doble clic en el archivo `INICIAR_APP.bat` (o en `INICIAR_GESTOR_VENTAS.bat`).
- **Opción B:** Abre una terminal en la carpeta del proyecto y ejecuta:
  ```bash
  python server.py
  ```

El script:
1. Detectará automáticamente tu dirección IP local en tu red Wi-Fi (ejemplo: `http://192.168.1.38:8000`).
2. Abrirá automáticamente la aplicación en el navegador de tu ordenador (`http://localhost:8000`).
3. **Dibujará un código QR directamente en la consola** de comandos.

---

### Paso 2: Abrirlo en tu iPhone como App Nativa (Gratis)
1. **Conexión Wi-Fi:** Asegúrate de que tu iPhone esté conectado a la **misma red Wi-Fi** que tu ordenador.
2. **Escanear el código:** Abre la aplicación **Cámara** en tu iPhone y apunta a la pantalla del ordenador donde aparece el código QR. Toca el enlace amarillo de Safari que aparece.
   *(O escribe directamente en Safari de tu iPhone la dirección que te indique la consola, por ejemplo `http://192.168.1.38:8000`)*.
3. **Instalar como App:**
   - En Safari, toca el botón **Compartir** (el icono de un recuadro con una flecha hacia arriba en la barra inferior de navegación).
   - Desplázate hacia abajo en el menú y pulsa **"Añadir a la pantalla de inicio"** (Add to Home Screen).
   - Confirma el nombre (ej. *"Ventas POS"*) y pulsa **Añadir**.
4. **¡Listo!** Ahora tendrás el icono de la app en la pantalla de inicio de tu iPhone. Al abrirla:
   - Se ejecutará a pantalla completa (sin la barra de Safari ni botones del navegador).
   - Respetará la Dynamic Island y notch del iPhone.
   - Tendrá efectos sonoros y hápticos de caja registradora al registrar ventas.
   - Funcionará de forma local y offline mediante el Service Worker y el almacenamiento local.
