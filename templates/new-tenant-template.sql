-- ============================================================
-- TEMPLATE NUOVO TENANT/CLIENTE
-- ============================================================
-- Copia e personalizza questo template per ogni nuovo cliente
-- ============================================================

-- ⚠️ PRIMA DI INIZIARE:
-- 1. Genera una API Key sicura:
--    node -e "console.log('sk_live_[nome]_' + require('crypto').randomBytes(32).toString('hex'))"
--
-- 2. Sostituisci i seguenti placeholder:
--    - [TENANT_ID]: es. "cliente_xyz", "progetto_abc"
--    - [TENANT_NAME]: es. "Cliente XYZ S.r.l.", "Progetto ABC"
--    - [API_KEY]: la chiave generata al punto 1
--    - [WEBHOOK_URL]: es. "https://cliente-xyz.com/api/webhooks/whatsapp"
--    - [DOMAINS]: domini permessi per CORS

-- ============================================================
-- 1. CREA TENANT
-- ============================================================
INSERT INTO tenants (
  tenant_id,
  name,
  api_key,
  webhook_url,
  allowed_origins,
  rate_limit_per_minute,
  is_active,
  metadata
) VALUES (
  '[TENANT_ID]',                    -- ⚠️ SOSTITUISCI: es. 'cliente_xyz'
  '[TENANT_NAME]',                  -- ⚠️ SOSTITUISCI: es. 'Cliente XYZ'
  '[API_KEY]',                      -- ⚠️ SOSTITUISCI: es. 'sk_live_xyz_abc123...'
  '[WEBHOOK_URL]',                  -- ⚠️ SOSTITUISCI: es. 'https://cliente-xyz.com/api/webhooks/whatsapp'
  ARRAY[
    '[DOMAIN_1]',                   -- ⚠️ SOSTITUISCI: es. 'https://cliente-xyz.com'
    '[DOMAIN_2]',                   -- ⚠️ SOSTITUISCI: es. 'https://app.cliente-xyz.com'
    'http://localhost:3000'         -- Per sviluppo locale (opzionale)
  ],
  30,                               -- Rate limit: 30 richieste/minuto (personalizzabile)
  true,                             -- Tenant attivo
  '{
    "company": "[TENANT_NAME]",
    "website": "[WEBSITE]",
    "contact_email": "[EMAIL]"
  }'::jsonb
) ON CONFLICT (tenant_id) DO UPDATE SET
  name = EXCLUDED.name,
  api_key = EXCLUDED.api_key,
  webhook_url = EXCLUDED.webhook_url,
  allowed_origins = EXCLUDED.allowed_origins,
  rate_limit_per_minute = EXCLUDED.rate_limit_per_minute,
  metadata = EXCLUDED.metadata,
  updated_at = NOW();

-- ============================================================
-- 2. CREA SESSIONI WHATSAPP
-- ============================================================

-- SCENARIO A: Un solo numero WhatsApp
-- Usa questo se il cliente ha bisogno di un solo numero

INSERT INTO whatsapp_sessions (
  tenant_id,
  session_id,
  name,
  description,
  auth_path,
  is_active
) VALUES (
  '[TENANT_ID]',                          -- ⚠️ Stesso tenant_id di sopra
  '[TENANT_ID]_main',                     -- ⚠️ es. 'cliente_xyz_main'
  '[TENANT_NAME] - Principale',
  'Numero WhatsApp principale',
  'auth_info_[TENANT_ID]_main',           -- ⚠️ es. 'auth_info_cliente_xyz_main'
  true
) ON CONFLICT (session_id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at = NOW();

-- SCENARIO B: Più numeri WhatsApp (decommentare se necessario)
-- Supporto, Vendite, Marketing, etc.

/*
-- Sessione: Supporto Clienti
INSERT INTO whatsapp_sessions (
  tenant_id,
  session_id,
  name,
  description,
  auth_path,
  is_active
) VALUES (
  '[TENANT_ID]',
  '[TENANT_ID]_supporto',
  'Supporto Clienti',
  'Assistenza e supporto clienti',
  'auth_info_[TENANT_ID]_supporto',
  true
) ON CONFLICT (session_id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at = NOW();

-- Sessione: Vendite
INSERT INTO whatsapp_sessions (
  tenant_id,
  session_id,
  name,
  description,
  auth_path,
  is_active
) VALUES (
  '[TENANT_ID]',
  '[TENANT_ID]_vendite',
  'Team Vendite',
  'Numero dedicato alle vendite',
  'auth_info_[TENANT_ID]_vendite',
  true
) ON CONFLICT (session_id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at = NOW();

-- Sessione: Marketing
INSERT INTO whatsapp_sessions (
  tenant_id,
  session_id,
  name,
  description,
  auth_path,
  is_active
) VALUES (
  '[TENANT_ID]',
  '[TENANT_ID]_marketing',
  'Marketing & Notifiche',
  'Campagne marketing e notifiche automatiche',
  'auth_info_[TENANT_ID]_marketing',
  true
) ON CONFLICT (session_id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at = NOW();

-- Sessione: Amministrazione
INSERT INTO whatsapp_sessions (
  tenant_id,
  session_id,
  name,
  description,
  auth_path,
  is_active
) VALUES (
  '[TENANT_ID]',
  '[TENANT_ID]_admin',
  'Amministrazione',
  'Comunicazioni amministrative',
  'auth_info_[TENANT_ID]_admin',
  true
) ON CONFLICT (session_id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at = NOW();
*/

-- ============================================================
-- 3. VERIFICA SETUP
-- ============================================================

-- Visualizza il tenant creato
SELECT
  tenant_id,
  name,
  api_key,
  webhook_url,
  allowed_origins,
  rate_limit_per_minute,
  is_active,
  created_at
FROM tenants
WHERE tenant_id = '[TENANT_ID]';  -- ⚠️ SOSTITUISCI

-- Visualizza le sessioni create
SELECT
  session_id,
  name,
  description,
  status,
  whatsapp_number,
  is_active,
  created_at
FROM whatsapp_sessions
WHERE tenant_id = '[TENANT_ID]'   -- ⚠️ SOSTITUISCI
ORDER BY created_at;

-- ============================================================
-- CHECKLIST POST-SETUP ✅
-- ============================================================
/*
□ 1. Sostituiti tutti i placeholder [TENANT_ID], [API_KEY], etc.
□ 2. Eseguito questo script nel SQL Editor di Supabase
□ 3. Verificato che tenant e sessioni siano stati creati
□ 4. Salvata la API Key in modo sicuro (.env del cliente)
□ 5. Riavviato il microservizio (npm run dev)
□ 6. Scansionati i QR codes per connettere i numeri WhatsApp
□ 7. Configurato webhook endpoint nel progetto del cliente
□ 8. Testato invio messaggi via API
□ 9. Testato ricezione messaggi via webhook
□ 10. Documentazione condivisa con il cliente
*/

-- ============================================================
-- COMANDI UTILI
-- ============================================================

-- Aggiorna webhook URL
/*
UPDATE tenants
SET webhook_url = 'https://new-url.com/webhooks/whatsapp',
    updated_at = NOW()
WHERE tenant_id = '[TENANT_ID]';
*/

-- Aggiorna rate limit
/*
UPDATE tenants
SET rate_limit_per_minute = 60,
    updated_at = NOW()
WHERE tenant_id = '[TENANT_ID]';
*/

-- Disabilita temporaneamente un tenant
/*
UPDATE tenants
SET is_active = false,
    updated_at = NOW()
WHERE tenant_id = '[TENANT_ID]';
*/

-- Rigenera API key (dopo aver generato una nuova)
/*
UPDATE tenants
SET api_key = 'sk_live_[nome]_NUOVA_CHIAVE',
    updated_at = NOW()
WHERE tenant_id = '[TENANT_ID]';
*/

-- Disabilita una sessione
/*
UPDATE whatsapp_sessions
SET is_active = false,
    updated_at = NOW()
WHERE session_id = '[TENANT_ID]_main';
*/

-- Elimina completamente un tenant (⚠️ ATTENZIONE!)
/*
DELETE FROM whatsapp_sessions WHERE tenant_id = '[TENANT_ID]';
DELETE FROM messages WHERE tenant_id = '[TENANT_ID]';
DELETE FROM api_calls WHERE tenant_id = '[TENANT_ID]';
DELETE FROM tenants WHERE tenant_id = '[TENANT_ID]';
*/
