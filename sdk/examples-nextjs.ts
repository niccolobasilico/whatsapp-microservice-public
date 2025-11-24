/**
 * ESEMPI DI INTEGRAZIONE CON NEXT.JS
 *
 * Copia questi esempi nella tua SaaS Next.js
 */

import { WhatsAppClient } from './whatsapp-client';

// ============================================================
// 1. Setup Client (lib/whatsapp.ts)
// ============================================================

export const whatsapp = new WhatsAppClient({
  apiUrl: process.env.WHATSAPP_API_URL!,
  apiKey: process.env.WHATSAPP_API_KEY!,
});

// ============================================================
// 2. API Route: Invia Messaggio (app/api/whatsapp/send/route.ts)
// ============================================================

export async function POST(req: Request) {
  try {
    const { sessionId, to, message } = await req.json();

    // Validazione
    if (!sessionId || !to || !message) {
      return Response.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Invia messaggio
    const result = await whatsapp.sendMessage(sessionId, to, message);

    return Response.json(result);
  } catch (error: any) {
    console.error('Error sending WhatsApp message:', error);
    return Response.json(
      { error: error.message || 'Failed to send message' },
      { status: error.statusCode || 500 }
    );
  }
}

// ============================================================
// 3. API Route: Webhook Handler (app/api/webhooks/whatsapp/route.ts)
// ============================================================

import { WebhookEvent } from './whatsapp-client';
import { db } from '@/lib/db'; // Il tuo database
import { pusher } from '@/lib/pusher'; // Per real-time

export async function POST(req: Request) {
  try {
    const event: WebhookEvent = await req.json();

    // Verifica firma (opzionale ma consigliato)
    // const signature = req.headers.get('x-webhook-signature');
    // const isValid = validateWebhookSignature(
    //   JSON.stringify(event),
    //   signature!,
    //   process.env.WEBHOOK_SECRET!
    // );
    // if (!isValid) {
    //   return Response.json({ error: 'Invalid signature' }, { status: 401 });
    // }

    console.log('Received webhook:', event.type, event.session_id);

    // Gestisci evento
    switch (event.type) {
      case 'message.received':
        await handleMessageReceived(event);
        break;

      case 'message.sent':
        await handleMessageSent(event);
        break;

      case 'message.failed':
        await handleMessageFailed(event);
        break;

      case 'session.connected':
        await handleSessionConnected(event);
        break;

      case 'session.disconnected':
        await handleSessionDisconnected(event);
        break;

      case 'session.qr_code':
        await handleQRCode(event);
        break;
    }

    return Response.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return Response.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}

async function handleMessageReceived(event: WebhookEvent) {
  const { session_id, data } = event;

  // Salva nel database
  await db.messages.create({
    data: {
      sessionId: session_id,
      from: data.phone_number || data.jid,
      message: data.message,
      direction: 'inbound',
      status: 'received',
      metadata: data.metadata,
    },
  });

  // Notifica in real-time (es: Pusher, Socket.io)
  await pusher.trigger(`session-${session_id}`, 'new-message', {
    from: data.phone_number,
    message: data.message,
  });

  // Trigger automazioni (se necessario)
  // await processAutomations(session_id, data);
}

async function handleMessageSent(event: WebhookEvent) {
  const { data } = event;

  // Update status nel database
  await db.messages.update({
    where: { id: data.id },
    data: { status: 'sent', sentAt: new Date() },
  });
}

async function handleMessageFailed(event: WebhookEvent) {
  const { data } = event;

  // Update status e salva errore
  await db.messages.update({
    where: { id: data.id },
    data: {
      status: 'failed',
      error: data.error,
      failedAt: new Date(),
    },
  });

  // Notifica utente dell'errore
  console.error(`Message ${data.id} failed:`, data.error);
}

async function handleSessionConnected(event: WebhookEvent) {
  const { session_id, data } = event;

  // Update session status nel database
  await db.whatsappSessions.update({
    where: { sessionId: session_id },
    data: {
      status: 'connected',
      whatsappNumber: data.whatsapp_number,
      connectedAt: new Date(),
    },
  });

  console.log(`Session ${session_id} connected:`, data.whatsapp_number);
}

async function handleSessionDisconnected(event: WebhookEvent) {
  const { session_id, data } = event;

  // Update session status
  await db.whatsappSessions.update({
    where: { sessionId: session_id },
    data: {
      status: 'disconnected',
      disconnectedAt: new Date(),
      disconnectReason: data.reason,
    },
  });

  console.warn(`Session ${session_id} disconnected:`, data.reason);
}

async function handleQRCode(event: WebhookEvent) {
  const { session_id, data } = event;

  // Salva QR code temporaneamente (es: Redis, DB)
  await db.qrCodes.upsert({
    where: { sessionId: session_id },
    update: { qr: data.qr, generatedAt: new Date() },
    create: { sessionId: session_id, qr: data.qr },
  });

  // Notifica frontend via real-time
  await pusher.trigger(`session-${session_id}`, 'qr-code', {
    qr: data.qr,
  });
}

// ============================================================
// 4. Server Component: Lista Sessioni (app/dashboard/sessions/page.tsx)
// ============================================================

export default async function SessionsPage() {
  const { sessions } = await whatsapp.getSessions();

  return (
    <div>
      <h1>Le Mie Sessioni WhatsApp</h1>
      {sessions.map((session) => (
        <div key={session.session_id}>
          <h3>{session.name}</h3>
          <p>Status: {session.status}</p>
          <p>Numero: {session.whatsapp_number || 'Non connesso'}</p>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// 5. Client Component: Invia Messaggio (components/SendMessageForm.tsx)
// ============================================================

'use client';

import { useState } from 'react';

export function SendMessageForm({ sessionId }: { sessionId: string }) {
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, to, message }),
      });

      if (!res.ok) throw new Error('Failed to send');

      alert('Messaggio inviato!');
      setMessage('');
    } catch (error) {
      alert('Errore invio messaggio');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="tel"
        placeholder="Numero destinatario"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        required
      />
      <textarea
        placeholder="Messaggio"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        required
      />
      <button type="submit" disabled={loading}>
        {loading ? 'Invio...' : 'Invia'}
      </button>
    </form>
  );
}

// ============================================================
// 6. Client Component: Mostra QR Code (components/QRCodeDisplay.tsx)
// ============================================================

'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode.react';

export function QRCodeDisplay({ sessionId }: { sessionId: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchQR();

    // Real-time updates con Pusher
    const channel = pusher.subscribe(`session-${sessionId}`);
    channel.bind('qr-code', (data: { qr: string }) => {
      setQr(data.qr);
      setLoading(false);
    });

    return () => {
      pusher.unsubscribe(`session-${sessionId}`);
    };
  }, [sessionId]);

  const fetchQR = async () => {
    try {
      const res = await fetch(`/api/whatsapp/qr/${sessionId}`);
      const data = await res.json();
      setQr(data.qr);
    } catch (error) {
      console.error('Error fetching QR:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div>Caricamento...</div>;
  if (!qr) return <div>QR non disponibile</div>;

  return (
    <div>
      <h3>Scansiona con WhatsApp</h3>
      <QRCode value={qr} size={256} />
    </div>
  );
}

// ============================================================
// 7. Environment Variables (.env.local)
// ============================================================

/*
WHATSAPP_API_URL=https://your-microservice.railway.app
WHATSAPP_API_KEY=sk_live_your_api_key_here
WEBHOOK_SECRET=your_webhook_secret  # Per validare firme
*/
