-- ============================================================================
-- ESQUEMA DE BASE DE DATOS EN SUPABASE (PostgreSQL + Realtime)
-- Proyecto: VapeOS Pro - Gestor de Ventas e Inventario Multi-Almacén
-- Instrucciones: Copia todo este archivo y pégalo en Supabase -> SQL Editor -> Run
-- ============================================================================

-- 1. Almacenes (Almacén Principal + Casas de Trabajadores)
CREATE TABLE IF NOT EXISTS public.warehouses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  worker_name TEXT DEFAULT '',
  icon TEXT DEFAULT '🏠',
  color TEXT DEFAULT 'indigo',
  is_main BOOLEAN DEFAULT FALSE,
  worker_pin TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  reward_every_n_units INTEGER DEFAULT 5,
  reward_free_units INTEGER DEFAULT 1,
  reward_vapers_delivered INTEGER DEFAULT 0,
  cash_settled_amount NUMERIC(10, 2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Productos / Sabores y Stock por Almacén
CREATE TABLE IF NOT EXISTS public.products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'Sabores',
  cost_price NUMERIC(10, 2) DEFAULT 0,
  sell_price NUMERIC(10, 2) DEFAULT 0,
  stock INTEGER DEFAULT 0,
  stock_by_warehouse JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Ventas y Transacciones (Cobradas y Fiadas)
CREATE TABLE IF NOT EXISTS public.sales (
  id TEXT PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  product_id TEXT,
  product_name TEXT NOT NULL,
  product_category TEXT DEFAULT 'Sabores',
  warehouse_id TEXT DEFAULT 'wh_main',
  warehouse_name TEXT DEFAULT 'Mi Almacén (Principal)',
  worker_name TEXT DEFAULT '',
  cost_price NUMERIC(10, 2) DEFAULT 0,
  catalog_unit_price NUMERIC(10, 2) DEFAULT 12.00,
  unit_price NUMERIC(10, 2) DEFAULT 0,
  quantity INTEGER DEFAULT 1,
  gross_total NUMERIC(10, 2) DEFAULT 0,
  total_cost NUMERIC(10, 2) DEFAULT 0,
  net_profit NUMERIC(10, 2) DEFAULT 0,
  profit_margin NUMERIC(12, 2) DEFAULT 0,
  discount_per_unit NUMERIC(10, 2) DEFAULT 0,
  total_discount NUMERIC(10, 2) DEFAULT 0,
  payment_method TEXT DEFAULT 'Efectivo',
  payment_status TEXT DEFAULT 'paid',
  paid_at TIMESTAMPTZ,
  buyer_name TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  reservation_id TEXT,
  order_id TEXT,
  order_name TEXT,
  status TEXT DEFAULT 'completed'
);

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS order_id TEXT;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS order_name TEXT;

-- 4. Reservas de Clientes
CREATE TABLE IF NOT EXISTS public.reservations (
  id TEXT PRIMARY KEY,
  product_id TEXT,
  product_name TEXT NOT NULL,
  warehouse_id TEXT DEFAULT 'wh_main',
  warehouse_name TEXT DEFAULT 'Mi Almacén (Principal)',
  quantity INTEGER DEFAULT 1,
  customer_name TEXT NOT NULL,
  agreed_unit_price NUMERIC(10, 2) DEFAULT 12.00,
  notes TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Repartos / Transferencias de Stock entre Almacenes
CREATE TABLE IF NOT EXISTS public.transfers (
  id TEXT PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  product_id TEXT,
  product_name TEXT NOT NULL,
  from_warehouse_id TEXT,
  from_warehouse_name TEXT,
  to_warehouse_id TEXT,
  to_warehouse_name TEXT,
  quantity INTEGER DEFAULT 1,
  notes TEXT DEFAULT ''
);

-- 6. Liquidaciones de Efectivo y Entregas de Vapers de Regalo
CREATE TABLE IF NOT EXISTS public.settlements (
  id TEXT PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  type TEXT NOT NULL,
  warehouse_id TEXT,
  warehouse_name TEXT,
  worker_name TEXT DEFAULT '',
  count INTEGER DEFAULT 0,
  amount NUMERIC(10, 2) DEFAULT 0,
  product_id TEXT,
  product_name TEXT,
  from_warehouse_id TEXT,
  notes TEXT DEFAULT ''
);

-- 7. Configuración Global (PIN Jefe, canal ntfy, etc.)
CREATE TABLE IF NOT EXISTS public.app_config (
  key TEXT PRIMARY KEY,
  value JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Pedidos / Lotes de Mercancía (Recuentos de llegada al proveedor)
CREATE TABLE IF NOT EXISTS public.orders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  supplier TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  items JSONB DEFAULT '[]'::jsonb,
  total_units INTEGER DEFAULT 0,
  total_cost NUMERIC(10, 2) DEFAULT 0,
  expected_revenue NUMERIC(10, 2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar Row Level Security (RLS) con acceso para la app
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_warehouses" ON public.warehouses;
CREATE POLICY "allow_all_warehouses" ON public.warehouses FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_products" ON public.products;
CREATE POLICY "allow_all_products" ON public.products FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_sales" ON public.sales;
CREATE POLICY "allow_all_sales" ON public.sales FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_reservations" ON public.reservations;
CREATE POLICY "allow_all_reservations" ON public.reservations FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_transfers" ON public.transfers;
CREATE POLICY "allow_all_transfers" ON public.transfers FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_settlements" ON public.settlements;
CREATE POLICY "allow_all_settlements" ON public.settlements FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_app_config" ON public.app_config;
CREATE POLICY "allow_all_app_config" ON public.app_config FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_orders" ON public.orders;
CREATE POLICY "allow_all_orders" ON public.orders FOR ALL USING (true) WITH CHECK (true);

-- Activar Supabase Realtime en todas las tablas para sincronización en vivo
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.warehouses;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.sales;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.reservations;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.transfers;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.settlements;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.app_config;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
