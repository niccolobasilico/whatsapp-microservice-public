// ============================================================
// ESEMPIO INTEGRAZIONE CREDIA (app.usecredia.com)
// ============================================================
// Copia questi file nella tua web app Next.js/React
// ============================================================

// ============================================================
// FILE 1: lib/whatsapp-client.ts
// ============================================================
// Client TypeScript per chiamare il microservizio WhatsApp

interface SendMessageOptions {
  to: string;
  message: string;
  sessionId?: string;
}

interface WhatsAppResponse {
  success: boolean;
  sessionId: string;
  to: string;
  messageId?: string;
}

interface SessionStatus {
  sessionId: string;
  connected: boolean;
  qr?: string;
  user?: {
    id: string;
    name: string;
  };
}

export class CrediaWhatsAppClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    // Configurazione da variabili d'ambiente
    this.baseUrl = process.env.WHATSAPP_API_URL || 'http://localhost:3000';
    this.apiKey = process.env.CREDIA_WHATSAPP_API_KEY || '';

    if (!this.apiKey) {
      throw new Error('CREDIA_WHATSAPP_API_KEY non configurata!');
    }
  }

  /**
   * Invia un messaggio WhatsApp
   */
  async sendMessage({ to, message, sessionId = 'credia_main' }: SendMessageOptions): Promise<WhatsAppResponse> {
    const response = await fetch(`${this.baseUrl}/session/${sessionId}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.apiKey,
      },
      body: JSON.stringify({ to, message }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`WhatsApp API Error: ${error.error || response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Controlla lo stato di una sessione WhatsApp
   */
  async getSessionStatus(sessionId = 'credia_main'): Promise<SessionStatus> {
    const response = await fetch(`${this.baseUrl}/session/${sessionId}/status`, {
      method: 'GET',
      headers: {
        'X-Api-Key': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to get session status');
    }

    return await response.json();
  }

  /**
   * Ottieni tutte le sessioni Credia
   */
  async getSessions() {
    const response = await fetch(`${this.baseUrl}/tenant/sessions`, {
      method: 'GET',
      headers: {
        'X-Api-Key': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to get sessions');
    }

    return await response.json();
  }

  /**
   * Ottieni il QR code per connettere una sessione
   */
  async getQRCode(sessionId = 'credia_main') {
    const response = await fetch(`${this.baseUrl}/session/${sessionId}/qr`, {
      method: 'GET',
      headers: {
        'X-Api-Key': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to get QR code');
    }

    return await response.json();
  }
}

// Singleton instance
export const whatsappClient = new CrediaWhatsAppClient();

// ============================================================
// FILE 2: app/api/webhooks/whatsapp/route.ts
// ============================================================
// Endpoint webhook per ricevere eventi dal microservizio

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma'; // Il tuo database Credia

// Tipi eventi webhook
interface WebhookEvent {
  type: 'message.received' | 'message.sent' | 'message.failed' | 'session.connected' | 'session.disconnected' | 'session.qr_code';
  tenant_id: string;
  session_id: string;
  timestamp: string;
  data: any;
}

export async function POST(req: NextRequest) {
  try {
    const event: WebhookEvent = await req.json();

    console.log(`[WEBHOOK] Received event: ${event.type} from session ${event.session_id}`);

    // Gestisci i diversi tipi di eventi
    switch (event.type) {
      case 'message.received':
        await handleIncomingMessage(event);
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

      default:
        console.warn(`[WEBHOOK] Unknown event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[WEBHOOK] Error processing webhook:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Gestisce messaggi WhatsApp ricevuti
 */
async function handleIncomingMessage(event: WebhookEvent) {
  const { from, message, jid, metadata } = event.data;

  console.log(`[WEBHOOK] New message from ${from}: ${message}`);

  // TODO: Salva il messaggio nel database Credia
  await prisma.whatsappMessage.create({
    data: {
      direction: 'incoming',
      from: from,
      message: message,
      jid: jid,
      sessionId: event.session_id,
      metadata: metadata,
      receivedAt: new Date(event.timestamp),
    },
  });

  // TODO: Logica personalizzata Credia
  // - Notifica l'utente
  // - Trigger automazione
  // - Analisi sentiment
  // - etc.
}

/**
 * Messaggio inviato con successo
 */
async function handleMessageSent(event: WebhookEvent) {
  const { id, to, message, jid } = event.data;

  console.log(`[WEBHOOK] Message sent to ${to}`);

  // Aggiorna lo stato del messaggio nel database
  await prisma.whatsappMessage.update({
    where: { id },
    data: {
      status: 'sent',
      sentAt: new Date(event.timestamp),
      jid: jid,
    },
  });
}

/**
 * Messaggio fallito
 */
async function handleMessageFailed(event: WebhookEvent) {
  const { id, to, message, error } = event.data;

  console.error(`[WEBHOOK] Message failed to ${to}: ${error}`);

  // Aggiorna lo stato del messaggio
  await prisma.whatsappMessage.update({
    where: { id },
    data: {
      status: 'failed',
      errorMessage: error,
      failedAt: new Date(event.timestamp),
    },
  });

  // TODO: Invia notifica all'admin
}

/**
 * Sessione WhatsApp connessa
 */
async function handleSessionConnected(event: WebhookEvent) {
  const { whatsapp_number, user } = event.data;

  console.log(`[WEBHOOK] Session ${event.session_id} connected: ${whatsapp_number}`);

  // Aggiorna lo stato della sessione
  await prisma.whatsappSession.update({
    where: { sessionId: event.session_id },
    data: {
      status: 'connected',
      whatsappNumber: whatsapp_number,
      connectedAt: new Date(event.timestamp),
    },
  });
}

/**
 * Sessione WhatsApp disconnessa
 */
async function handleSessionDisconnected(event: WebhookEvent) {
  const { reason } = event.data;

  console.warn(`[WEBHOOK] Session ${event.session_id} disconnected: ${reason}`);

  // Aggiorna lo stato della sessione
  await prisma.whatsappSession.update({
    where: { sessionId: event.session_id },
    data: {
      status: 'disconnected',
      disconnectedAt: new Date(event.timestamp),
    },
  });

  // TODO: Notifica admin per riconnettere
}

/**
 * Nuovo QR code generato
 */
async function handleQRCode(event: WebhookEvent) {
  const { qr } = event.data;

  console.log(`[WEBHOOK] New QR code for session ${event.session_id}`);

  // Salva il QR code (opzionale - per mostrarlo nell'admin panel)
  await prisma.whatsappSession.update({
    where: { sessionId: event.session_id },
    data: {
      qrCode: qr,
      qrCodeGeneratedAt: new Date(event.timestamp),
    },
  });
}

// ============================================================
// FILE 3: .env.local (Configurazione)
// ============================================================
/*
# Microservizio WhatsApp
WHATSAPP_API_URL=https://your-microservice.railway.app
CREDIA_WHATSAPP_API_KEY=sk_live_credia_a1b2c3d4e5f6g7h8i9j0...

# Database Credia (per salvare messaggi)
DATABASE_URL=postgresql://...
*/

// ============================================================
// FILE 4: app/admin/whatsapp/page.tsx
// ============================================================
// Admin panel per gestire le sessioni WhatsApp

'use client';

import { useEffect, useState } from 'react';
import { whatsappClient } from '@/lib/whatsapp-client';

export default function WhatsAppAdminPage() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSessions();
  }, []);

  async function loadSessions() {
    try {
      const data = await whatsappClient.getSessions();
      setSessions(data.sessions);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setLoading(false);
    }
  }

  async function showQRCode(sessionId: string) {
    try {
      const data = await whatsappClient.getQRCode(sessionId);
      if (data.qr) {
        // Mostra QR code in un modal
        alert(`QR Code: ${data.qr}`);
      } else {
        alert('Session already connected!');
      }
    } catch (error) {
      console.error('Failed to get QR code:', error);
    }
  }

  if (loading) return <div>Loading...</div>;

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">WhatsApp Sessions - Credia</h1>

      <div className="grid gap-4">
        {sessions.map((session) => (
          <div key={session.session_id} className="border p-4 rounded-lg">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-semibold">{session.name}</h3>
                <p className="text-sm text-gray-600">{session.session_id}</p>
                {session.whatsapp_number && (
                  <p className="text-sm text-green-600">📱 {session.whatsapp_number}</p>
                )}
              </div>

              <div className="flex items-center gap-4">
                <div
                  className={`px-3 py-1 rounded-full text-sm ${
                    session.connected
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {session.connected ? '✓ Connected' : '○ Disconnected'}
                </div>

                {!session.connected && (
                  <button
                    onClick={() => showQRCode(session.session_id)}
                    className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                  >
                    Show QR Code
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// FILE 5: app/api/send-whatsapp/route.ts
// ============================================================
// API route per inviare messaggi dalla web app Credia

import { NextRequest, NextResponse } from 'next/server';
import { whatsappClient } from '@/lib/whatsapp-client';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const { userId, phoneNumber, message, sessionId } = await req.json();

    // Validazione
    if (!phoneNumber || !message) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Invia il messaggio via microservizio
    const result = await whatsappClient.sendMessage({
      to: phoneNumber,
      message,
      sessionId: sessionId || 'credia_main',
    });

    // Salva nel database Credia
    const savedMessage = await prisma.whatsappMessage.create({
      data: {
        userId: userId,
        direction: 'outgoing',
        to: phoneNumber,
        message: message,
        sessionId: result.sessionId,
        status: 'queued',
      },
    });

    return NextResponse.json({
      success: true,
      messageId: savedMessage.id,
      whatsappResponse: result,
    });
  } catch (error) {
    console.error('Failed to send WhatsApp message:', error);
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    );
  }
}

// ============================================================
// ESEMPIO UTILIZZO NEI COMPONENTI
// ============================================================

// Esempio: Invia messaggio da un form
/*
'use client';

import { useState } from 'react';

export function SendWhatsAppForm() {
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch('/api/send-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: phone,
          message: message,
          sessionId: 'credia_main',
        }),
      });

      if (response.ok) {
        alert('Message sent!');
        setPhone('');
        setMessage('');
      } else {
        alert('Failed to send message');
      }
    } catch (error) {
      console.error(error);
      alert('Error sending message');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input
        type="tel"
        placeholder="Phone number (3331234567)"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        className="w-full px-4 py-2 border rounded"
      />
      <textarea
        placeholder="Message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        className="w-full px-4 py-2 border rounded"
        rows={4}
      />
      <button
        type="submit"
        disabled={loading}
        className="px-6 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
      >
        {loading ? 'Sending...' : 'Send WhatsApp Message'}
      </button>
    </form>
  );
}
*/
