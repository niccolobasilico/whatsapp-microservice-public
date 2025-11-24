// Multi-Tenant Authentication Middleware
import { Request, Response, NextFunction } from 'express';
import { supabase } from '../supabase/client.js';
import { AuthenticatedTenant, Tenant, ApiCall } from '../types/index.js';

// Extend Express Request to include tenant info
export interface AuthenticatedRequest extends Request {
  tenant?: AuthenticatedTenant;
}

/**
 * Middleware per autenticare le richieste API tramite API Key
 * Verifica:
 * - API Key valida
 * - Tenant attivo
 * - Rate limiting
 */
export async function authenticateApiKey(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // 1. Estrai API key dall'header
    const apiKey = req.headers['x-api-key'] as string;

    if (!apiKey) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing API key. Include X-Api-Key header.',
      });
      return;
    }

    // 2. Verifica API key in Supabase
    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('*')
      .eq('api_key', apiKey)
      .eq('is_active', true)
      .single<Tenant>();

    if (error || !tenant) {
      console.warn(`Invalid API key attempted: ${apiKey.substring(0, 10)}...`);
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or inactive API key.',
      });
      return;
    }

    // 3. Rate limiting check
    const isAllowed = await checkRateLimit(
      tenant.tenant_id,
      tenant.rate_limit_per_minute
    );

    if (!isAllowed) {
      res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Max ${tenant.rate_limit_per_minute} requests per minute.`,
      });
      return;
    }

    // 4. Log API call per tracking
    await logApiCall(req, tenant.tenant_id);

    // 5. Attach tenant info to request
    req.tenant = {
      tenantId: tenant.tenant_id,
      name: tenant.name,
      webhookUrl: tenant.webhook_url || undefined,
      rateLimitPerMinute: tenant.rate_limit_per_minute,
      allowedOrigins: tenant.allowed_origins || undefined,
    };

    console.log(`[AUTH] Authenticated tenant: ${tenant.name} (${tenant.tenant_id})`);
    next();
  } catch (error) {
    console.error('[AUTH] Authentication error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication failed.',
    });
  }
}

/**
 * Middleware opzionale per endpoint pubblici
 * Se API key presente, autentica, altrimenti continua
 */
export async function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    // No API key, proceed without authentication
    next();
    return;
  }

  // API key presente, autentica normalmente
  return authenticateApiKey(req, res, next);
}

/**
 * Verifica se il tenant ha superato il rate limit
 */
async function checkRateLimit(
  tenantId: string,
  maxRequestsPerMinute: number
): Promise<boolean> {
  try {
    const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();

    // Conta richieste nell'ultimo minuto
    const { data, error } = await supabase
      .from('api_calls')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('created_at', oneMinuteAgo);

    if (error) {
      console.error('[RATE_LIMIT] Error checking rate limit:', error);
      return true; // In caso di errore, permetti la richiesta
    }

    const requestCount = data?.length || 0;
    return requestCount < maxRequestsPerMinute;
  } catch (error) {
    console.error('[RATE_LIMIT] Unexpected error:', error);
    return true; // Permetti in caso di errore
  }
}

/**
 * Log API call per tracking e analytics
 */
async function logApiCall(req: Request, tenantId: string): Promise<void> {
  try {
    const apiCall: Partial<ApiCall> = {
      tenant_id: tenantId,
      endpoint: `${req.method} ${req.path}`,
      session_id: req.params.sessionId || null,
      ip_address: req.ip || req.headers['x-forwarded-for']?.toString() || null,
      user_agent: req.headers['user-agent'] || null,
    };

    await supabase.from('api_calls').insert(apiCall);
  } catch (error) {
    // Non bloccare la richiesta se il logging fallisce
    console.error('[LOG] Error logging API call:', error);
  }
}

/**
 * Middleware per verificare che il tenant abbia accesso alla sessione richiesta
 */
export async function verifySessionAccess(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { sessionId } = req.params;
    const tenantId = req.tenant?.tenantId;

    if (!tenantId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required.',
      });
      return;
    }

    if (!sessionId) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Session ID is required.',
      });
      return;
    }

    // Verifica che la sessione appartenga al tenant
    const { data: session, error } = await supabase
      .from('whatsapp_sessions')
      .select('*')
      .eq('session_id', sessionId)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .single();

    if (error || !session) {
      res.status(403).json({
        error: 'Forbidden',
        message: `Session '${sessionId}' not found or access denied.`,
      });
      return;
    }

    console.log(`[AUTH] Session access granted: ${sessionId} for tenant ${tenantId}`);
    next();
  } catch (error) {
    console.error('[AUTH] Error verifying session access:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to verify session access.',
    });
  }
}
