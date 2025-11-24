// Baileys v7 compatible types with LID/JID support

export interface Message {
  id: string;
  jid?: string | null; // Technical identifier (can be LID or PN format)
  phone_number?: string | null; // Human-readable phone number
  message: string;
  status: 'QUEUED' | 'SENT' | 'FAILED' | 'RECEIVED';
  platform: 'WHATSAPP' | 'SMS';
  session_id?: string;
  created_at?: string;
  updated_at?: string;
  error_message?: string;
  metadata?: Record<string, any>;
}

export interface QueuedMessage {
  id: string;
  jid?: string | null;
  phoneNumber?: string | null;
  message: string;
  retries: number;
  sessionId: string;
}

export interface IncomingMessage {
  jid: string; // The technical JID from Baileys
  phone_number?: string | null; // Extracted phone number if available
  message: string;
  platform: 'WHATSAPP';
  session_id: string;
  received_at: string;
  metadata?: Record<string, any>;
}

export interface SessionConfig {
  sessionId: string;
  authPath?: string;
}

export interface SessionInfo {
  sessionId: string;
  connected: boolean;
  user?: {
    id: string;
    name?: string;
  };
}

// ============================================================
// Multi-Tenant Types
// ============================================================

export interface Tenant {
  id: string;
  tenant_id: string;
  name: string;
  api_key: string;
  webhook_url?: string | null;
  allowed_origins?: string[] | null;
  rate_limit_per_minute: number;
  is_active: boolean;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface WhatsAppSession {
  id: string;
  tenant_id: string;
  session_id: string;
  name: string;
  description?: string | null;
  whatsapp_number?: string | null;
  status: 'pending' | 'active' | 'disconnected' | 'error';
  auth_path: string;
  is_active: boolean;
  metadata?: Record<string, any>;
  connected_at?: string | null;
  last_seen_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiCall {
  id: string;
  tenant_id: string;
  endpoint: string;
  session_id?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  created_at: string;
}

export interface AuthenticatedTenant {
  tenantId: string;
  name: string;
  webhookUrl?: string;
  rateLimitPerMinute: number;
  allowedOrigins?: string[];
}
