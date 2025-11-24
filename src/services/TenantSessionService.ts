// Tenant Session Service - Manages multi-tenant WhatsApp sessions
import { supabase } from '../supabase/client.js';
import { WhatsAppSession, Tenant } from '../types/index.js';

export class TenantSessionService {
  /**
   * Ottieni tutte le sessioni attive dal database
   */
  async getAllActiveSessions(): Promise<WhatsAppSession[]> {
    const { data, error } = await supabase
      .from('whatsapp_sessions')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[TenantSessionService] Error fetching sessions:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Ottieni sessioni per un tenant specifico
   */
  async getSessionsByTenant(tenantId: string): Promise<WhatsAppSession[]> {
    const { data, error } = await supabase
      .from('whatsapp_sessions')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[TenantSessionService] Error fetching tenant sessions:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Ottieni una singola sessione
   */
  async getSession(sessionId: string): Promise<WhatsAppSession | null> {
    const { data, error } = await supabase
      .from('whatsapp_sessions')
      .select('*')
      .eq('session_id', sessionId)
      .single();

    if (error) {
      console.error('[TenantSessionService] Error fetching session:', error);
      return null;
    }

    return data;
  }

  /**
   * Verifica se un tenant ha accesso a una sessione
   */
  async verifySessionAccess(
    sessionId: string,
    tenantId: string
  ): Promise<boolean> {
    const { data, error } = await supabase
      .from('whatsapp_sessions')
      .select('id')
      .eq('session_id', sessionId)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .single();

    return !error && !!data;
  }

  /**
   * Ottieni tenant da session_id
   */
  async getTenantBySession(sessionId: string): Promise<string | null> {
    const session = await this.getSession(sessionId);
    return session?.tenant_id || null;
  }

  /**
   * Ottieni webhook URL per una sessione
   */
  async getWebhookUrl(sessionId: string): Promise<string | null> {
    const session = await this.getSession(sessionId);
    if (!session) return null;

    const { data: tenant } = await supabase
      .from('tenants')
      .select('webhook_url')
      .eq('tenant_id', session.tenant_id)
      .single<Tenant>();

    return tenant?.webhook_url || null;
  }

  /**
   * Aggiorna status sessione
   */
  async updateSessionStatus(
    sessionId: string,
    status: 'pending' | 'active' | 'disconnected' | 'error',
    additionalData?: {
      whatsapp_number?: string;
      connected_at?: string;
      last_seen_at?: string;
    }
  ): Promise<void> {
    const updateData: any = {
      status,
      last_seen_at: new Date().toISOString(),
      ...additionalData,
    };

    if (status === 'active' && !additionalData?.connected_at) {
      updateData.connected_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('whatsapp_sessions')
      .update(updateData)
      .eq('session_id', sessionId);

    if (error) {
      console.error('[TenantSessionService] Error updating session status:', error);
    }
  }

  /**
   * Aggiorna numero WhatsApp dopo connessione
   */
  async updateWhatsAppNumber(
    sessionId: string,
    whatsappNumber: string
  ): Promise<void> {
    const { error } = await supabase
      .from('whatsapp_sessions')
      .update({
        whatsapp_number: whatsappNumber,
        status: 'active',
        connected_at: new Date().toISOString(),
      })
      .eq('session_id', sessionId);

    if (error) {
      console.error('[TenantSessionService] Error updating WhatsApp number:', error);
    }
  }

  /**
   * Crea una nuova sessione per un tenant
   */
  async createSession(data: {
    tenant_id: string;
    session_id: string;
    name: string;
    description?: string;
  }): Promise<WhatsAppSession | null> {
    const sessionData: Partial<WhatsAppSession> = {
      tenant_id: data.tenant_id,
      session_id: data.session_id,
      name: data.name,
      description: data.description,
      auth_path: `auth_info_${data.session_id}`,
      status: 'pending',
      is_active: true,
    };

    const { data: newSession, error } = await supabase
      .from('whatsapp_sessions')
      .insert(sessionData)
      .select()
      .single<WhatsAppSession>();

    if (error) {
      console.error('[TenantSessionService] Error creating session:', error);
      return null;
    }

    console.log(`[TenantSessionService] Created session: ${data.session_id} for tenant: ${data.tenant_id}`);
    return newSession;
  }

  /**
   * Disattiva una sessione
   */
  async deactivateSession(sessionId: string): Promise<void> {
    const { error } = await supabase
      .from('whatsapp_sessions')
      .update({
        is_active: false,
        status: 'disconnected',
      })
      .eq('session_id', sessionId);

    if (error) {
      console.error('[TenantSessionService] Error deactivating session:', error);
    }
  }

  /**
   * Elimina completamente una sessione dal database
   */
  async deleteSession(sessionId: string, tenantId: string): Promise<void> {
    // Verify tenant owns this session before deleting
    const hasAccess = await this.verifySessionAccess(sessionId, tenantId);

    if (!hasAccess) {
      throw new Error('Unauthorized: Tenant does not own this session');
    }

    const { error } = await supabase
      .from('whatsapp_sessions')
      .delete()
      .eq('session_id', sessionId)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('[TenantSessionService] Error deleting session:', error);
      throw new Error(`Failed to delete session: ${error.message}`);
    }

    console.log(`[TenantSessionService] Deleted session: ${sessionId} for tenant: ${tenantId}`);
  }

  /**
   * Ottieni tenant completo con tutte le sue sessioni
   */
  async getTenantWithSessions(tenantId: string): Promise<{
    tenant: Tenant | null;
    sessions: WhatsAppSession[];
  }> {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('*')
      .eq('tenant_id', tenantId)
      .single<Tenant>();

    const sessions = await this.getSessionsByTenant(tenantId);

    return {
      tenant: tenant || null,
      sessions,
    };
  }

  /**
   * Statistiche sessioni per tenant
   */
  async getSessionStats(tenantId?: string): Promise<{
    total: number;
    active: number;
    pending: number;
    disconnected: number;
    byTenant?: Record<string, number>;
  }> {
    let query = supabase
      .from('whatsapp_sessions')
      .select('status, tenant_id');

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    const { data, error } = await query;

    if (error || !data) {
      return { total: 0, active: 0, pending: 0, disconnected: 0 };
    }

    const stats = {
      total: data.length,
      active: data.filter((s) => s.status === 'active').length,
      pending: data.filter((s) => s.status === 'pending').length,
      disconnected: data.filter((s) => s.status === 'disconnected').length,
      byTenant: {} as Record<string, number>,
    };

    if (!tenantId) {
      data.forEach((s) => {
        stats.byTenant[s.tenant_id] = (stats.byTenant[s.tenant_id] || 0) + 1;
      });
    }

    return stats;
  }
}

// Export singleton instance
export const tenantSessionService = new TenantSessionService();
