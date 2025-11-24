// Dynamic CORS Middleware - Reads allowed origins from authenticated tenant
import cors from 'cors';
import { AuthenticatedRequest } from './auth.js';

/**
 * CORS middleware dinamico che:
 * 1. Permette localhost per sviluppo
 * 2. Verifica allowed_origins del tenant autenticato
 * 3. Supporta credenziali (cookies, auth headers)
 */
export const dynamicCors = cors({
  origin: (origin, callback) => {
    // Permetti richieste senza origin (es: Postman, server-to-server)
    if (!origin) {
      callback(null, true);
      return;
    }

    // Sempre permetti localhost per sviluppo
    if (
      origin.includes('localhost') ||
      origin.includes('127.0.0.1') ||
      origin.includes('192.168.')
    ) {
      callback(null, true);
      return;
    }

    // La verifica tenant-specific viene fatta dopo l'autenticazione
    // Per ora permetti tutto (sarà verificato nel middleware auth)
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key'],
  exposedHeaders: ['X-Total-Count', 'X-Rate-Limit-Remaining'],
});

/**
 * Middleware aggiuntivo per verificare CORS specifici del tenant
 * Da usare DOPO authenticateApiKey
 */
export function verifyTenantCors(
  req: AuthenticatedRequest,
  res: any,
  next: any
): void {
  const origin = req.headers.origin;
  const tenant = req.tenant;

  // Se non c'è origin o tenant, skip
  if (!origin || !tenant) {
    next();
    return;
  }

  // Se il tenant ha allowed_origins configurati, verificali
  if (tenant.allowedOrigins && tenant.allowedOrigins.length > 0) {
    const isAllowed = tenant.allowedOrigins.some(
      (allowed) => origin === allowed || origin.endsWith(allowed)
    );

    if (!isAllowed) {
      console.warn(
        `[CORS] Origin ${origin} not allowed for tenant ${tenant.tenantId}`
      );
      res.status(403).json({
        error: 'Forbidden',
        message: `Origin ${origin} is not allowed for this tenant.`,
      });
      return;
    }
  }

  console.log(`[CORS] Origin ${origin} allowed for tenant ${tenant.tenantId}`);
  next();
}

/**
 * Configurazione CORS semplice per endpoint pubblici
 */
export const publicCors = cors({
  origin: true, // Permetti tutti gli origin
  credentials: false,
  methods: ['GET', 'OPTIONS'],
});
