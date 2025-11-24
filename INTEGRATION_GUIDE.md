# Guida Integrazione SaaS - WhatsApp Microservice

## 🎯 Obiettivo

Questa guida spiega **passo-passo** come integrare il microservizio WhatsApp nella tua applicazione SaaS.

---

## 📋 Prerequisiti

1. ✅ Database Supabase configurato con `supabase-safe-migration.sql`
2. ✅ Microservizio WhatsApp già in esecuzione (locale o Railway)
3. ✅ La tua SaaS (Next.js, Express, o altro framework)

---

## 🚀 Setup Completo (10 Passi)

### **Passo 1: Genera la Tua API Key**

Esegui questo script per generare una API key sicura:

```bash
node generate-api-key.js
```

**Output esempio:**
```
sk_live_mysaas_657ac92fb8323659e158a064efa292a2144538f1ad960c69ef33a8d94f342348
```

⚠️ **IMPORTANTE**: Salva questa chiave in un posto sicuro (file `.env` della tua SaaS).

---

### **Passo 2: Crea il Tenant nel Database**

Vai su **Supabase Dashboard** → SQL Editor ed esegui:

```sql
-- Sostituisci con i tuoi dati
INSERT INTO tenants (
  tenant_id,
  name,
  api_key,
  webhook_url,
  allowed_origins,
  rate_limit_per_minute
)
VALUES (
  'my_saas',                                         -- ID univoco della tua SaaS
  'La Mia SaaS',                                     -- Nome visualizzato
  'sk_live_mysaas_657ac92fb8323659e158a064efa...',  -- API Key generata al passo 1
  'https://my-saas.com/api/webhooks/whatsapp',       -- URL dove ricevere notifiche
  ARRAY['https://my-saas.com', 'http://localhost:3000'], -- Domini permessi (CORS)
  30                                                  -- Max 30 richieste/minuto
);
```

**Verifica** che sia stato creato:
```sql
SELECT * FROM tenants WHERE tenant_id = 'my_saas';
```

---

### **Passo 3: Crea le Tue Sessioni WhatsApp**

Ogni sessione = un numero WhatsApp che puoi usare.

```sql
-- Esempio: 2 numeri WhatsApp per la tua SaaS
INSERT INTO whatsapp_sessions (
  tenant_id,
  session_id,
  name,
  description,
  auth_path
)
VALUES
  -- Numero 1: Per le vendite
  (
    'my_saas',                      -- ID del tenant creato al passo 2
    'sales_team',                   -- ID univoco per questa sessione
    'Team Vendite',                 -- Nome visualizzato
    'Numero WhatsApp vendite',      -- Descrizione
    'auth_info_sales_team'          -- Cartella dove salvare credenziali
  ),
  -- Numero 2: Per il supporto
  (
    'my_saas',
    'customer_support',
    'Supporto Clienti',
    'Numero WhatsApp supporto',
    'auth_info_customer_support'
  );
```

**Verifica**:
```sql
SELECT * FROM whatsapp_sessions WHERE tenant_id = 'my_saas';
```

---

### **Passo 4: Riavvia il Microservizio**

Il microservizio deve caricare le nuove sessioni:

```bash
# Se in locale (Ctrl+C per fermare, poi:)
npm run dev

# Se su Railway: fai redeploy dal dashboard
```

**Output atteso nel terminale:**
```
Loading active sessions from database...
Creating new session: sales_team
[sales_team] QR Code generated. Scan with WhatsApp:
█████████████████████
█████████████████████
...

Creating new session: customer_support
[customer_support] QR Code generated. Scan with WhatsApp:
█████████████████████
...
```

---

### **Passo 5: Scansiona i QR Code**

Apri WhatsApp sul telefono:
1. Vai su **Impostazioni** → **Dispositivi collegati**
2. Clicca **"Collega un dispositivo"**
3. Scansiona il QR code nel terminale per `sales_team`
4. Ripeti per `customer_support`

✅ Nel terminale vedrai:
```
[sales_team] WhatsApp connection established successfully!
[customer_support] WhatsApp connection established successfully!
```

---

### **Passo 6: Installa l'SDK nella Tua SaaS**

Copia il file SDK nel tuo progetto SaaS:

```bash
# Dalla cartella del microservizio
cp sdk/whatsapp-client.ts /path/to/your-saas/lib/whatsapp/client.ts
```

**Oppure** copia manualmente il contenuto di `sdk/whatsapp-client.ts` nella tua SaaS.

---

### **Passo 7: Configura le Variabili d'Ambiente**

Nel file `.env` della **tua SaaS** (NON del microservizio):

```env
# .env della tua SaaS
WHATSAPP_API_URL=http://localhost:3000
WHATSAPP_API_KEY=sk_live_mysaas_657ac92fb8323659e158a064efa...
```

Se il microservizio è su Railway:
```env
WHATSAPP_API_URL=https://your-service.railway.app
WHATSAPP_API_KEY=sk_live_mysaas_657ac92fb8323659e158a064efa...
```

---

### **Passo 8: Crea il Client nella Tua SaaS**

Crea un file `lib/whatsapp/index.ts` nella tua SaaS:

```typescript
// lib/whatsapp/index.ts (nella tua SaaS)
import { WhatsAppClient } from './client';

if (!process.env.WHATSAPP_API_URL || !process.env.WHATSAPP_API_KEY) {
  throw new Error('Missing WhatsApp API configuration');
}

export const whatsapp = new WhatsAppClient({
  apiUrl: process.env.WHATSAPP_API_URL,
  apiKey: process.env.WHATSAPP_API_KEY,
});
```

---

### **Passo 9: Crea le API Routes nella Tua SaaS**

#### **Esempio per Next.js App Router:**

```typescript
// app/api/whatsapp/send/route.ts
import { whatsapp } from '@/lib/whatsapp';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    // 1. Autenticazione utente (usa il tuo sistema)
    const user = await getCurrentUser(req); // La tua funzione
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Verifica permessi (esempio)
    const hasPermission = await checkUserPermission(user.id, 'send_whatsapp');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 3. Ottieni i dati dalla richiesta
    const { sessionId, to, message } = await req.json();

    // 4. Invia tramite microservizio
    const result = await whatsapp.sendMessage(sessionId, to, message);

    // 5. Salva nel tuo database (opzionale)
    await db.sentMessages.create({
      userId: user.id,
      sessionId,
      to,
      message,
      sentAt: new Date(),
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('WhatsApp send error:', error);
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    );
  }
}
```

#### **Ottieni QR Code:**

```typescript
// app/api/whatsapp/qr/[sessionId]/route.ts
import { whatsapp } from '@/lib/whatsapp';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  req: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const user = await getCurrentUser(req);
    if (!user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await whatsapp.getQRCode(params.sessionId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to get QR' }, { status: 500 });
  }
}
```

#### **Webhook Handler (Ricevi Messaggi):**

```typescript
// app/api/webhooks/whatsapp/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { WebhookEvent } from '@/lib/whatsapp/types';

export async function POST(req: NextRequest) {
  try {
    const event: WebhookEvent = await req.json();

    console.log('Received webhook:', event.type);

    switch (event.type) {
      case 'message.received':
        // Salva messaggio ricevuto nel tuo database
        await db.receivedMessages.create({
          sessionId: event.session_id,
          from: event.data.phone_number || event.data.jid,
          message: event.data.message,
          receivedAt: new Date(event.timestamp),
          metadata: event.data.metadata,
        });

        // Notifica in tempo reale (esempio con Pusher)
        await pusher.trigger(
          `session-${event.session_id}`,
          'new-message',
          event.data
        );
        break;

      case 'session.disconnected':
        // Notifica admin che la sessione è disconnessa
        await notifyAdmin(`WhatsApp ${event.session_id} disconnesso!`);
        break;

      case 'session.connected':
        console.log(`Session ${event.session_id} connected:`, event.data);
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: 'Webhook failed' }, { status: 500 });
  }
}
```

---

### **Passo 10: Crea i Componenti Frontend**

#### **Componente React per Inviare Messaggi:**

```tsx
// components/SendWhatsAppMessage.tsx
'use client';

import { useState } from 'react';

export function SendWhatsAppMessage() {
  const [sessionId, setSessionId] = useState('sales_team');
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleSend = async () => {
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, to, message }),
      });

      const data = await response.json();
      setResult(data);

      if (response.ok) {
        // Reset form
        setTo('');
        setMessage('');
        alert('Messaggio inviato con successo!');
      } else {
        alert('Errore: ' + data.error);
      }
    } catch (error) {
      alert('Errore di rete');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 border rounded">
      <h2 className="text-xl font-bold mb-4">Invia WhatsApp</h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Sessione</label>
          <select
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            className="w-full border rounded px-3 py-2"
          >
            <option value="sales_team">Team Vendite</option>
            <option value="customer_support">Supporto Clienti</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Numero (es: 3331234567)
          </label>
          <input
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="3331234567"
            className="w-full border rounded px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Messaggio</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Scrivi il tuo messaggio..."
            rows={4}
            className="w-full border rounded px-3 py-2"
          />
        </div>

        <button
          onClick={handleSend}
          disabled={loading || !to || !message}
          className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Invio in corso...' : 'Invia Messaggio'}
        </button>

        {result && (
          <pre className="mt-4 p-2 bg-gray-100 rounded text-xs overflow-auto">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
```

#### **Componente per Visualizzare QR Code (Admin):**

```tsx
// components/WhatsAppQRCode.tsx
'use client';

import { useState, useEffect } from 'react';
import QRCode from 'react-qr-code';

export function WhatsAppQRCode({ sessionId }: { sessionId: string }) {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'connected' | 'qr'>('loading');

  useEffect(() => {
    const fetchStatus = async () => {
      const response = await fetch(`/api/whatsapp/qr/${sessionId}`);
      const data = await response.json();

      if (data.connected) {
        setStatus('connected');
      } else if (data.qr) {
        setQrCode(data.qr);
        setStatus('qr');
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 5000); // Refresh ogni 5s

    return () => clearInterval(interval);
  }, [sessionId]);

  if (status === 'loading') {
    return <div>Caricamento...</div>;
  }

  if (status === 'connected') {
    return <div className="text-green-600">✅ Sessione connessa!</div>;
  }

  return (
    <div className="text-center">
      <h3 className="mb-4">Scansiona il QR Code con WhatsApp</h3>
      {qrCode && (
        <div className="inline-block p-4 bg-white">
          <QRCode value={qrCode} size={256} />
        </div>
      )}
      <p className="mt-2 text-sm text-gray-600">
        Apri WhatsApp → Impostazioni → Dispositivi collegati
      </p>
    </div>
  );
}
```

---

## 🎯 Testing Completo

### **1. Test tramite cURL (Senza Frontend)**

```bash
# Test invio messaggio
curl -X POST http://localhost:3000/session/sales_team/send \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: sk_live_mysaas_657ac92fb..." \
  -d '{
    "to": "3331234567",
    "message": "Test dal microservizio!"
  }'

# Test QR code
curl http://localhost:3000/session/sales_team/qr \
  -H "X-Api-Key: sk_live_mysaas_657ac92fb..."

# Test status
curl http://localhost:3000/session/sales_team/status \
  -H "X-Api-Key: sk_live_mysaas_657ac92fb..."

# Test lista sessioni
curl http://localhost:3000/tenant/sessions \
  -H "X-Api-Key: sk_live_mysaas_657ac92fb..."
```

### **2. Test dall'Applicazione SaaS**

1. **Apri** la tua SaaS (es: `http://localhost:3000` di Next.js)
2. **Vai** alla pagina con il componente `SendWhatsAppMessage`
3. **Compila** il form:
   - Sessione: `sales_team`
   - Numero: `3331234567`
   - Messaggio: `Ciao da SaaS!`
4. **Clicca** "Invia Messaggio"
5. **Verifica** che il messaggio sia stato inviato su WhatsApp

---

## 🔐 Sicurezza e Permessi

### **Nella Tua SaaS (Raccomandato):**

```typescript
// lib/permissions.ts
export async function canSendWhatsApp(userId: string, sessionId: string) {
  // Verifica nel tuo database se l'utente può usare questa sessione
  const user = await db.users.findUnique({
    where: { id: userId },
    include: { whatsappPermissions: true },
  });

  return user?.whatsappPermissions?.some(
    (p) => p.sessionId === sessionId && p.canSend
  );
}

// Usalo nelle API routes:
const hasPermission = await canSendWhatsApp(user.id, sessionId);
if (!hasPermission) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

### **Multi-Livello:**

```
┌─────────────────────────────────────────┐
│ Livello 1: Autenticazione Utente (SaaS) │  ← Login, sessione utente
├─────────────────────────────────────────┤
│ Livello 2: Permessi Utente (SaaS)       │  ← Può usare WhatsApp?
├─────────────────────────────────────────┤
│ Livello 3: API Key (Microservizio)      │  ← Tenant valido?
├─────────────────────────────────────────┤
│ Livello 4: Sessione (Microservizio)     │  ← Tenant possiede sessione?
└─────────────────────────────────────────┘
```

---

## 🌐 Deploy in Produzione

### **Microservizio su Railway:**

Segui `RAILWAY_DEPLOY.md`, poi:
- URL: `https://whatsapp-service-production-xxxx.up.railway.app`
- Aggiorna `.env` della SaaS:
  ```env
  WHATSAPP_API_URL=https://whatsapp-service-production-xxxx.up.railway.app
  ```

### **SaaS su Vercel/Netlify:**

1. Aggiungi le variabili d'ambiente:
   - `WHATSAPP_API_URL`
   - `WHATSAPP_API_KEY`
2. Configura il webhook URL nel database:
   ```sql
   UPDATE tenants
   SET webhook_url = 'https://my-saas.vercel.app/api/webhooks/whatsapp'
   WHERE tenant_id = 'my_saas';
   ```

---

## 📊 Monitoring

### **Dashboard Health Check:**

Crea una pagina admin per visualizzare lo stato:

```tsx
// app/admin/whatsapp/page.tsx
export default async function WhatsAppAdminPage() {
  const health = await fetch(`${process.env.WHATSAPP_API_URL}/health`, {
    headers: { 'X-Api-Key': process.env.WHATSAPP_API_KEY! },
  }).then((r) => r.json());

  return (
    <div>
      <h1>WhatsApp Status</h1>
      {health.sessions.map((session: any) => (
        <div key={session.sessionId}>
          {session.sessionId}: {session.connected ? '✅ Connected' : '❌ Disconnected'}
        </div>
      ))}
    </div>
  );
}
```

---

## 🆘 Troubleshooting

### **Errore: "Invalid API key"**
- Verifica che l'API key sia corretta in `.env`
- Controlla che il tenant sia `is_active = true` nel database Supabase

### **Errore: "Session not found"**
- Verifica che la sessione esista: `SELECT * FROM whatsapp_sessions WHERE session_id = 'xxx';`
- Riavvia il microservizio per caricare le nuove sessioni

### **Webhook non arriva**
- Verifica che `webhook_url` sia configurato nel database
- Testa manualmente: `curl -X POST https://my-saas.com/api/webhooks/whatsapp -d '{}'`
- Controlla i log del microservizio

---

## ✅ Checklist Finale

- [ ] API key generata e salvata in `.env` della SaaS
- [ ] Tenant creato in Supabase
- [ ] Sessioni WhatsApp create in Supabase
- [ ] Microservizio riavviato e QR code scansionati
- [ ] SDK copiato nella SaaS
- [ ] Variabili d'ambiente configurate nella SaaS
- [ ] API routes create (`/api/whatsapp/send`, `/api/webhooks/whatsapp`)
- [ ] Componenti React creati
- [ ] Sistema di permessi implementato nella SaaS
- [ ] Test inviato con successo
- [ ] Webhook ricevuto correttamente

---

## 🎓 Concetti Chiave

1. **Il microservizio gestisce solo WhatsApp** (connessione Baileys, invio messaggi)
2. **La tua SaaS gestisce utenti e permessi** (chi può fare cosa)
3. **L'API key identifica la SaaS**, non l'utente finale
4. **I webhook notificano la SaaS** quando succede qualcosa (messaggi ricevuti, disconnessioni)
5. **Ogni SaaS può avere N sessioni** (N numeri WhatsApp diversi)

---

**Tempo totale setup**: ~30 minuti
**Difficoltà**: ⭐⭐⭐ Media

Buon coding! 🚀
