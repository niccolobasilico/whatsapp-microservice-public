-- ============================================================
-- MIGRAZIONE SICURA MULTI-TENANT - WhatsApp Microservice
-- ============================================================
-- Questo script aggiorna la struttura esistente in modo sicuro
-- Esegui questo script nel SQL Editor di Supabase
-- ============================================================

-- ============================================================
-- 1. AGGIORNA TABELLA MESSAGES (aggiungi colonne mancanti)
-- ============================================================

-- Crea la tabella se non esiste (caso nuovo setup)
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'SENT', 'FAILED', 'RECEIVED')),
  platform TEXT NOT NULL CHECK (platform IN ('WHATSAPP', 'SMS')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Aggiungi colonne mancanti una per una (se non esistono)
DO $$
BEGIN
  -- jid
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='jid') THEN
    ALTER TABLE messages ADD COLUMN jid TEXT;
    RAISE NOTICE 'Colonna jid aggiunta';
  END IF;

  -- phone_number
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='phone_number') THEN
    ALTER TABLE messages ADD COLUMN phone_number TEXT;
    RAISE NOTICE 'Colonna phone_number aggiunta';
  END IF;

  -- session_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='session_id') THEN
    ALTER TABLE messages ADD COLUMN session_id TEXT DEFAULT 'default';
    RAISE NOTICE 'Colonna session_id aggiunta';
  END IF;

  -- tenant_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='tenant_id') THEN
    ALTER TABLE messages ADD COLUMN tenant_id TEXT;
    RAISE NOTICE 'Colonna tenant_id aggiunta';
  END IF;

  -- error_message
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='error_message') THEN
    ALTER TABLE messages ADD COLUMN error_message TEXT;
    RAISE NOTICE 'Colonna error_message aggiunta';
  END IF;

  -- metadata
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='metadata') THEN
    ALTER TABLE messages ADD COLUMN metadata JSONB;
    RAISE NOTICE 'Colonna metadata aggiunta';
  END IF;
END $$;

-- Rimuovi vecchio constraint se esiste e aggiungilo di nuovo
DO $$
BEGIN
  ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_check;
  ALTER TABLE messages ADD CONSTRAINT messages_check CHECK (jid IS NOT NULL OR phone_number IS NOT NULL);
  RAISE NOTICE 'Constraint check aggiunto/aggiornato';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Constraint già presente o errore: %', SQLERRM;
END $$;

-- ============================================================
-- 2. CREA TABELLA TENANTS
-- ============================================================
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  api_key TEXT UNIQUE NOT NULL,
  webhook_url TEXT,
  allowed_origins TEXT[],
  rate_limit_per_minute INTEGER DEFAULT 10,
  is_active BOOLEAN DEFAULT true,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- 3. CREA TABELLA WHATSAPP_SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id TEXT NOT NULL,
  session_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  whatsapp_number TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disconnected', 'error')),
  auth_path TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  metadata JSONB,
  connected_at TIMESTAMP WITH TIME ZONE,
  last_seen_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Aggiungi foreign key in modo sicuro
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'whatsapp_sessions_tenant_id_fkey'
  ) THEN
    ALTER TABLE whatsapp_sessions
    ADD CONSTRAINT whatsapp_sessions_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE;
    RAISE NOTICE 'Foreign key aggiunta a whatsapp_sessions';
  END IF;
END $$;

-- ============================================================
-- 4. CREA TABELLA API_CALLS
-- ============================================================
CREATE TABLE IF NOT EXISTS api_calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  session_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- 5. CREA INDICI (solo dopo che le colonne esistono)
-- ============================================================

-- Indici messages
CREATE INDEX IF NOT EXISTS idx_messages_status_platform ON messages(status, platform);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone_number) WHERE phone_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_jid ON messages(jid) WHERE jid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_tenant ON messages(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_tenant_session ON messages(tenant_id, session_id) WHERE tenant_id IS NOT NULL;

-- Indici sessions
CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON whatsapp_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON whatsapp_sessions(status);

-- Indici api_calls
CREATE INDEX IF NOT EXISTS idx_api_calls_tenant_time ON api_calls(tenant_id, created_at DESC);

-- ============================================================
-- 6. FUNZIONE E TRIGGER per updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger messages
DROP TRIGGER IF EXISTS update_messages_updated_at ON messages;
CREATE TRIGGER update_messages_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger tenants
DROP TRIGGER IF EXISTS update_tenants_updated_at ON tenants;
CREATE TRIGGER update_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger sessions
DROP TRIGGER IF EXISTS update_sessions_updated_at ON whatsapp_sessions;
CREATE TRIGGER update_sessions_updated_at
  BEFORE UPDATE ON whatsapp_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 7. DATI DI ESEMPIO
-- ============================================================

-- Esempio 1: SaaS CRM con 3 numeri WhatsApp
INSERT INTO tenants (tenant_id, name, api_key, webhook_url, allowed_origins, rate_limit_per_minute)
VALUES (
  'saas_crm',
  'CRM Application',
  'sk_live_crm_abc123xyz789',
  'https://my-crm.com/api/webhooks/whatsapp',
  ARRAY['https://my-crm.com', 'https://app.my-crm.com', 'http://localhost:3000'],
  30
)
ON CONFLICT (tenant_id) DO UPDATE SET
  name = EXCLUDED.name,
  webhook_url = EXCLUDED.webhook_url,
  allowed_origins = EXCLUDED.allowed_origins,
  rate_limit_per_minute = EXCLUDED.rate_limit_per_minute;

INSERT INTO whatsapp_sessions (tenant_id, session_id, name, description, auth_path)
VALUES
  ('saas_crm', 'crm_vendite', 'Vendite', 'Numero dedicato al team vendite', 'auth_info_crm_vendite'),
  ('saas_crm', 'crm_supporto', 'Supporto Clienti', 'Numero per assistenza clienti', 'auth_info_crm_supporto'),
  ('saas_crm', 'crm_marketing', 'Marketing', 'Numero per campagne marketing', 'auth_info_crm_marketing')
ON CONFLICT (session_id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;

-- Esempio 2: SaaS Ecommerce con 2 numeri WhatsApp
INSERT INTO tenants (tenant_id, name, api_key, webhook_url, allowed_origins, rate_limit_per_minute)
VALUES (
  'saas_ecommerce',
  'E-commerce Platform',
  'sk_live_ecom_def456uvw012',
  'https://my-shop.com/api/webhooks/whatsapp',
  ARRAY['https://my-shop.com', 'https://admin.my-shop.com', 'http://localhost:3000'],
  50
)
ON CONFLICT (tenant_id) DO UPDATE SET
  name = EXCLUDED.name,
  webhook_url = EXCLUDED.webhook_url,
  allowed_origins = EXCLUDED.allowed_origins,
  rate_limit_per_minute = EXCLUDED.rate_limit_per_minute;

INSERT INTO whatsapp_sessions (tenant_id, session_id, name, description, auth_path)
VALUES
  ('saas_ecommerce', 'ecom_ordini', 'Gestione Ordini', 'Conferme ordini e tracking', 'auth_info_ecom_ordini'),
  ('saas_ecommerce', 'ecom_spedizioni', 'Spedizioni', 'Notifiche spedizioni e consegne', 'auth_info_ecom_spedizioni')
ON CONFLICT (session_id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;

-- ============================================================
-- 8. VERIFICA SETUP FINALE
-- ============================================================
DO $$
DECLARE
  tenant_count INTEGER;
  session_count INTEGER;
  message_columns TEXT;
BEGIN
  SELECT COUNT(*) INTO tenant_count FROM tenants;
  SELECT COUNT(*) INTO session_count FROM whatsapp_sessions;

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'SETUP COMPLETATO CON SUCCESSO!';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Tenants creati: %', tenant_count;
  RAISE NOTICE 'Sessioni create: %', session_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Colonne tabella messages:';

  FOR message_columns IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'messages'
    ORDER BY ordinal_position
  LOOP
    RAISE NOTICE '  - %', message_columns;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE 'Prossimi passi:';
  RAISE NOTICE '1. Verifica i tenant creati: SELECT * FROM tenants;';
  RAISE NOTICE '2. Verifica le sessioni: SELECT * FROM whatsapp_sessions;';
  RAISE NOTICE '3. Testa una API key: SELECT * FROM tenants WHERE api_key = ''sk_live_crm_abc123xyz789'';';
  RAISE NOTICE '========================================';
END $$;
