# Quick Start - WhatsApp Multi-Tenant Microservice

Setup rapido per iniziare a usare il microservizio in 5 minuti.

## 🚀 Setup Iniziale

### 1. Database Setup (5 min)

```bash
# 1. Vai su Supabase Dashboard
https://app.supabase.com

# 2. Apri SQL Editor
# 3. Esegui lo script
supabase-safe-migration.sql

# Fatto! ✅
```

### 2. Configurazione Locale

```bash
# Clona (se non l'hai già fatto)
git clone https://github.com/niccolobasilico/whatsapp-microservice.git
cd whatsapp-microservice

# Installa dipendenze
npm install

# Copia .env di esempio
cp .env.example .env

# Modifica .env con le tue credenziali Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=your_service_role_key
PORT=3000
STORAGE_MODE=local
```

### 3. Avvia il Servizio

```bash
# Sviluppo (watch mode)
npm run dev

# Attendi il QR code nel terminale
# Scansionalo con WhatsApp
```

## ✅ Il Tuo Primo Messaggio

### Via Database

```sql
-- Inserisci un messaggio QUEUED
INSERT INTO messages (phone_number, message, status, platform, session_id)
VALUES ('3331234567', 'Ciao da WhatsApp!', 'QUEUED', 'WHATSAPP', 'crm_vendite');

-- Il servizio lo invierà automaticamente!
```

### Via API (con autenticazione)

```bash
# Ottieni la tua API key dal database
SELECT api_key FROM tenants WHERE tenant_id = 'saas_crm';
# Copia: sk_live_crm_abc123xyz789

# Invia messaggio
curl -X POST http://localhost:3000/session/crm_vendite/send \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: sk_live_crm_abc123xyz789" \
  -d '{
    "to": "3331234567",
    "message": "Hello from API!"
  }'
```

## 📊 Verifica che Funzioni

### Health Check

```bash
curl http://localhost:3000/health
```

**Output atteso:**
```json
{
  "status": "ok",
  "sessions": [
    {
      "sessionId": "crm_vendite",
      "connected": true
    }
  ],
  "queue": {...},
  "timestamp": "2025-01-22T..."
}
```

### Ottieni QR Code (via API)

```bash
curl http://localhost:3000/session/crm_vendite/qr \
  -H "X-Api-Key: sk_live_crm_abc123xyz789"
```

### Check Status Sessione

```bash
curl http://localhost:3000/session/crm_vendite/status \
  -H "X-Api-Key: sk_live_crm_abc123xyz789"
```

## 🎯 Personalizza per la Tua SaaS

### 1. Genera API Key Sicura

```javascript
// generate-api-key.js
const crypto = require('crypto');
const apiKey = `sk_live_${crypto.randomBytes(32).toString('hex')}`;
console.log(apiKey);
```

```bash
node generate-api-key.js
```

### 2. Crea il Tuo Tenant

```sql
-- Sostituisci con i tuoi dati
INSERT INTO tenants (tenant_id, name, api_key, webhook_url, allowed_origins, rate_limit_per_minute)
VALUES (
  'my_saas',                                    -- ID univoco
  'La Mia SaaS',                                -- Nome
  'sk_live_xxxxxxxxxxxxx',                      -- API Key generata sopra
  'https://my-saas.com/api/webhooks/whatsapp',  -- URL webhook
  ARRAY['https://my-saas.com', 'http://localhost:3000'],
  30                                             -- Rate limit
);
```

### 3. Crea le Tue Sessioni

```sql
-- Esempio: 2 numeri WhatsApp per la tua SaaS
INSERT INTO whatsapp_sessions (tenant_id, session_id, name, description, auth_path)
VALUES
  ('my_saas', 'my_sales', 'Vendite', 'Numero vendite', 'auth_info_my_sales'),
  ('my_saas', 'my_support', 'Supporto', 'Numero support', 'auth_info_my_support');
```

### 4. Riavvia il Servizio

```bash
# Ferma (Ctrl+C) e riavvia
npm run dev

# Ora vedrai 2 QR code da scansionare!
```

## 🔗 Integra nella Tua SaaS

### Setup Client SDK

```typescript
// lib/whatsapp/client.ts (nella tua SaaS)
import { WhatsAppClient } from './whatsapp-client'; // Copia da sdk/

export const whatsapp = new WhatsAppClient({
  apiUrl: process.env.WHATSAPP_API_URL!, // http://localhost:3000
  apiKey: process.env.WHATSAPP_API_KEY!, // sk_live_xxxxx
});
```

### API Route Next.js

```typescript
// app/api/whatsapp/send/route.ts
import { whatsapp } from '@/lib/whatsapp/client';

export async function POST(req: Request) {
  const { sessionId, to, message } = await req.json();

  const result = await whatsapp.sendMessage(sessionId, to, message);

  return Response.json(result);
}
```

### Componente React

```tsx
// components/SendWhatsApp.tsx
'use client';

export function SendWhatsApp() {
  const send = async () => {
    await fetch('/api/whatsapp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'my_sales',
        to: '3331234567',
        message: 'Ciao!',
      }),
    });
  };

  return <button onClick={send}>Invia WhatsApp</button>;
}
```

## 📡 Setup Webhook (Ricevi Messaggi)

### 1. Crea Endpoint nella Tua SaaS

```typescript
// app/api/webhooks/whatsapp/route.ts
export async function POST(req: Request) {
  const event = await req.json();

  switch (event.type) {
    case 'message.received':
      // Salva messaggio nel tuo DB
      await db.messages.create({
        from: event.data.phone_number,
        message: event.data.message,
      });
      break;

    case 'session.disconnected':
      // Notifica admin
      await sendAlert('WhatsApp disconnesso!');
      break;
  }

  return Response.json({ received: true });
}
```

### 2. Configura URL Webhook

```sql
UPDATE tenants
SET webhook_url = 'https://my-saas.com/api/webhooks/whatsapp'
WHERE tenant_id = 'my_saas';
```

### 3. Testa

Quando ricevi un messaggio WhatsApp, il microservizio invierà automaticamente una POST al tuo endpoint!

## 🐛 Troubleshooting

### "Invalid API key"
- Verifica che l'API key sia corretta
- Controlla che il tenant sia `is_active = true` nel DB

### "Session not found"
- Verifica che la sessione esista: `SELECT * FROM whatsapp_sessions WHERE session_id = 'xxx';`
- Riavvia il servizio

### "QR Code scaduto"
- Il servizio rigenera automaticamente il QR
- Aspetta 10-20 secondi

### Messaggio non inviato
- Verifica status: `SELECT * FROM messages WHERE id = 'xxx';`
- Check error_message per dettagli
- Verifica che la sessione sia connessa

## 📚 Prossimi Passi

1. ✅ **Leggi la documentazione completa**: `MULTI_TENANT_GUIDE.md`
2. ✅ **Implementa permessi utente** nella tua SaaS
3. ✅ **Setup webhook** per ricevere messaggi
4. ✅ **Deploy su Railway**: `RAILWAY_DEPLOY.md`
5. ✅ **Monitora**: usa `/stats` e `/health` endpoints

## 🆘 Supporto

- **Documentazione**: `MULTI_TENANT_GUIDE.md`
- **Esempi**: `sdk/examples-nextjs.ts`
- **Issues**: https://github.com/niccolobasilico/whatsapp-microservice/issues

---

**Tempo totale setup**: ~10 minuti
**Difficoltà**: ⭐⭐ Facile

Buon coding! 🚀
