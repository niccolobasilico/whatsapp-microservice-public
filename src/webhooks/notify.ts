// Webhook System - Notify tenants of WhatsApp events
import crypto from 'crypto';

export interface WebhookEvent {
  type:
    | 'message.received'
    | 'message.sent'
    | 'message.failed'
    | 'session.connected'
    | 'session.disconnected'
    | 'session.qr_code';
  tenant_id: string;
  session_id: string;
  timestamp: string;
  data: any;
}

/**
 * Invia webhook al tenant con retry logic e exponential backoff
 * Retry schedule: 5s, 30s, 5min (total 3 attempts)
 */
export async function notifyTenant(
  webhookUrl: string,
  event: WebhookEvent,
  secret?: string,
  maxRetries: number = 3
): Promise<void> {
  if (!webhookUrl) {
    console.log(`[WEBHOOK] No webhook URL configured for tenant ${event.tenant_id}`);
    return;
  }

  const delays = [0, 5000, 30000, 300000]; // immediate, 5s, 30s, 5min
  const payload = JSON.stringify(event);
  const signature = secret ? generateSignature(payload, secret) : undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Wait before retry (skip on first attempt)
      if (attempt > 0) {
        const delay = delays[attempt];
        console.log(
          `[WEBHOOK] Retrying webhook in ${delay / 1000}s... (attempt ${attempt + 1}/${maxRetries}) for ${event.type} to tenant ${event.tenant_id}`
        );
        await sleep(delay);
      }

      console.log(
        `[WEBHOOK] ${attempt > 0 ? `Retry ${attempt + 1}/${maxRetries}:` : ''} Sending ${event.type} to ${webhookUrl} (tenant: ${event.tenant_id})`
      );

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Source': 'whatsapp-microservice',
          'X-Webhook-Event': event.type,
          'X-Webhook-Timestamp': event.timestamp,
          'X-Webhook-Attempt': String(attempt + 1),
          ...(signature && { 'X-Webhook-Signature': signature }),
        },
        body: payload,
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      if (!response.ok) {
        const errorMsg = `${response.status} ${response.statusText}`;
        console.error(
          `[WEBHOOK] Attempt ${attempt + 1}/${maxRetries} failed: ${errorMsg} for ${webhookUrl}`
        );

        // If it's the last attempt, throw to log final failure
        if (attempt === maxRetries - 1) {
          throw new Error(`Webhook failed after ${maxRetries} attempts: ${errorMsg}`);
        }

        // Otherwise, continue to retry
        continue;
      }

      // Success!
      console.log(
        `[WEBHOOK] ✓ Successfully sent ${event.type} to tenant ${event.tenant_id} on attempt ${attempt + 1}${attempt > 0 ? ` (after ${attempt} retries)` : ''}`
      );
      return; // Exit on success
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isLastAttempt = attempt === maxRetries - 1;

      console.error(
        `[WEBHOOK] Attempt ${attempt + 1}/${maxRetries} error: ${errorMessage} for ${webhookUrl}`
      );

      if (isLastAttempt) {
        console.error(
          `[WEBHOOK] ❌ FINAL FAILURE after ${maxRetries} attempts for ${event.type} to tenant ${event.tenant_id}. Payload:`,
          event
        );
        // TODO: Consider implementing a dead letter queue (DLQ) here
        // Save to database table for manual retry or investigation
        return; // Exit after final failure
      }

      // Continue to next retry
    }
  }
}

/**
 * Helper function to sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Genera firma HMAC per validazione webhook
 */
function generateSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Helper per creare evento message.received
 */
export function createMessageReceivedEvent(
  tenantId: string,
  sessionId: string,
  data: {
    id: string;
    from: string;
    message: string;
    jid?: string;
    phone_number?: string;
    metadata?: any;
  }
): WebhookEvent {
  return {
    type: 'message.received',
    tenant_id: tenantId,
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    data,
  };
}

/**
 * Helper per creare evento message.sent
 */
export function createMessageSentEvent(
  tenantId: string,
  sessionId: string,
  data: {
    id: string;
    to: string;
    message: string;
    jid?: string;
  }
): WebhookEvent {
  return {
    type: 'message.sent',
    tenant_id: tenantId,
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    data,
  };
}

/**
 * Helper per creare evento message.failed
 */
export function createMessageFailedEvent(
  tenantId: string,
  sessionId: string,
  data: {
    id: string;
    to: string;
    message: string;
    error: string;
  }
): WebhookEvent {
  return {
    type: 'message.failed',
    tenant_id: tenantId,
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    data,
  };
}

/**
 * Helper per creare evento session.connected
 */
export function createSessionConnectedEvent(
  tenantId: string,
  sessionId: string,
  data: {
    whatsapp_number?: string;
    user?: {
      id: string;
      name?: string;
    };
  }
): WebhookEvent {
  return {
    type: 'session.connected',
    tenant_id: tenantId,
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    data,
  };
}

/**
 * Helper per creare evento session.disconnected
 */
export function createSessionDisconnectedEvent(
  tenantId: string,
  sessionId: string,
  data: {
    reason?: string;
  }
): WebhookEvent {
  return {
    type: 'session.disconnected',
    tenant_id: tenantId,
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    data,
  };
}

/**
 * Helper per creare evento session.qr_code
 */
export function createQRCodeEvent(
  tenantId: string,
  sessionId: string,
  data: {
    qr: string;
  }
): WebhookEvent {
  return {
    type: 'session.qr_code',
    tenant_id: tenantId,
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    data,
  };
}
