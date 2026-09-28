# Gestor Privado de Inventario y Ventas (iOS & Mobile PWA)

Una aplicación móvil moderna, privada y local diseñada con estética **Apple iOS (Mobile-First y 100% Responsive)** para gestionar el inventario de productos y registrar transacciones de venta diarias de forma ultrarrápida.

Ejecutable en tu **iPhone 17** (y cualquier dispositivo móvil u ordenador) de forma **gratuita, local y sin necesidad de tener el ordenador encendido ni depender de la misma red Wi-Fi**.

---

## 🌐 Enlace Oficial de la Aplicación

👉 **[https://wolkyyy7.github.io/gestor-ventas-ios/](https://wolkyyy7.github.io/gestor-ventas-ios/)**

---

## 📱 Cómo Instalar en tu iPhone 17 (30 segundos)

1. Abre el enlace en **Safari** en tu iPhone:  
   `https://wolkyyy7.github.io/gestor-ventas-ios/`
2. Pulsa el botón **Compartir** *(icono central del cuadrado con flecha hacia arriba ⬆)*.
3. Desliza hacia abajo y pulsa **"Añadir a la pantalla de inicio"** *(Add to Home Screen)*.
4. Pulsa **Añadir**.

> **¡Listo!** La app se abrirá a pantalla completa (sin barras de Safari), con feedback táctil y acústico. Todos tus datos se almacenan de forma segura y permanente en la memoria de tu iPhone mediante **IndexedDB**, funcionando incluso sin conexión a internet o en modo avión.

---

## 🏛️ Estructura del Proyecto

```
gestor-ventas-ios/
│
├── .github/
│   └── workflows/
│       └── deploy.yml          # Despliegue automático a GitHub Pages
│
├── css/
│   └── app.css                 # Diseño iOS Human Interface, Cupertino y Safe Areas
│
├── icons/                      # Iconos oficiales PWA de alta resolución
│   ├── icon-192.png
│   └── icon-512.png
│
├── js/
│   ├── agents/
│   │   ├── AgentInventory.js   # Agente 1: Catálogo, Stock & Valoración
│   │   ├── AgentSales.js       # Agente 2: Transacciones Atómicas & Beneficio
│   │   ├── AgentAnalytics.js   # Agente 3: Métricas Dashboard & Desglose
│   │   └── AgentStorage.js     # Agente 4: Persistencia & IndexedDB
│   └── app.js                  # Orquestador UI & Feedback Háptico/Auditivo
│
├── .gitignore                  # Filtro de archivos Git
├── index.html                  # Shell interactivo Mobile-First y Responsive
├── manifest.json                # Manifiesto PWA para iOS Standalone
├── PUBLICAR_EN_GITHUB.bat      # Sincronización de cambios con GitHub en 1 clic
├── README.md                   # Documentación del proyecto
└── sw.js                       # Service Worker para funcionamiento 100% Offline
```

---

## 🔄 Cómo Actualizar la App en el Futuro

Si en el futuro modificas algún archivo o añades nuevas funcionalidades:
1. Haz doble clic en **`PUBLICAR_EN_GITHUB.bat`**.
2. Los cambios se subirán a tu repositorio y **GitHub actualizará la web automáticamente**.
3. Al abrir la app en tu iPhone 17, el *Service Worker* detectará los cambios y se actualizará sola, manteniendo todos tus datos de inventario y ventas intactos.
