/**
 * WhatsApp Microservice Client SDK
 *
 * Esempio di utilizzo nelle tue SaaS:
 *
 * ```typescript
 * const client = new WhatsAppClient({
 *   apiUrl: 'https://your-service.railway.app',
 *   apiKey: 'sk_live_abc123...',
 * });
 *
 * // Invia messaggio
 * await client.sendMessage('crm_vendite', '3331234567', 'Ciao!');
 *
 * // Ottieni QR code
 * const qr = await client.getQRCode('crm_vendite');
 * ```
 */

export interface WhatsAppClientConfig {
  apiUrl: string;
  apiKey: string;
  timeout?: number; // milliseconds, default 30000
}

export interface SendMessageOptions {
  sessionId: string;
  to: string; // Phone number or JID
  message: string;
}

export interface SendMessageResponse {
  success: boolean;
  sessionId: string;
  to: string; // JID resolved
}

export interface SessionStatus {
  sessionId: string;
  status: 'connected' | 'disconnected';
  qr?: string | null;
}

export interface QRCodeResponse {
  sessionId: string;
  qr: string;
}

export interface Session {
  session_id: string;
  name: string;
  description?: string;
  whatsapp_number?: string;
  status: 'pending' | 'active' | 'disconnected' | 'error';
  connected_at?: string;
}

export interface TenantSessionsResponse {
  sessions: Session[];
  count: number;
}

export class WhatsAppClient {
  private apiUrl: string;
  private apiKey: string;
  private timeout: number;

  constructor(config: WhatsAppClientConfig) {
    this.apiUrl = config.apiUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || 30000;
  }

  /**
   * Invia un messaggio WhatsApp
   */
  async sendMessage(
    sessionId: string,
    to: string,
    message: string
  ): Promise<SendMessageResponse> {
    return this.request<SendMessageResponse>(`/session/${sessionId}/send`, {
      method: 'POST',
      body: { to, message },
    });
  }

  /**
   * Ottieni il QR code per una sessione
   */
  async getQRCode(sessionId: string): Promise<QRCodeResponse> {
    return this.request<QRCodeResponse>(`/session/${sessionId}/qr`);
  }

  /**
   * Ottieni lo status di una sessione
   */
  async getSessionStatus(sessionId: string): Promise<SessionStatus> {
    return this.request<SessionStatus>(`/session/${sessionId}/status`);
  }

  /**
   * Ottieni tutte le sessioni del tenant
   */
  async getSessions(): Promise<TenantSessionsResponse> {
    return this.request<TenantSessionsResponse>('/tenant/sessions');
  }

  /**
   * Crea una nuova sessione WhatsApp
   */
  async createSession(data: {
    session_id: string;
    name: string;
    description?: string;
  }): Promise<Session> {
    return this.request<Session>('/tenant/sessions', {
      method: 'POST',
      body: data,
    });
  }

  /**
   * Disconnetti una sessione
   */
  async disconnectSession(sessionId: string): Promise<{ success: boolean }> {
    return this.request(`/session/${sessionId}/disconnect`, {
      method: 'POST',
    });
  }

  /**
   * Health check del servizio
   */
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    return this.request('/health');
  }

  /**
   * Generic request handler
   */
  private async request<T = any>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
      body?: any;
      headers?: Record<string, string>;
    } = {}
  ): Promise<T> {
    const { method = 'GET', body, headers = {} } = options;

    const url = `${this.apiUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': this.apiKey,
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: 'Unknown error',
          message: response.statusText,
        }));

        throw new WhatsAppClientError(
          error.message || error.error || 'Request failed',
          response.status,
          error
        );
      }

      return response.json();
    } catch (error) {
      if (error instanceof WhatsAppClientError) {
        throw error;
      }

      throw new WhatsAppClientError(
        error instanceof Error ? error.message : 'Network error',
        0,
        error
      );
    }
  }
}

/**
 * Custom error class
 */
export class WhatsAppClientError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: any
  ) {
    super(message);
    this.name = 'WhatsAppClientError';
  }
}

/**
 * Webhook event types that your SaaS will receive
 */
export type WebhookEventType =
  | 'message.received'
  | 'message.sent'
  | 'message.failed'
  | 'session.connected'
  | 'session.disconnected'
  | 'session.qr_code';

export interface WebhookEvent {
  type: WebhookEventType;
  tenant_id: string;
  session_id: string;
  timestamp: string;
  data: any;
}

/**
 * Helper per validare webhook signature
 */
export function validateWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const crypto = require('crypto');
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return signature === expectedSignature;
}
