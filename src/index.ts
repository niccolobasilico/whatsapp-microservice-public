// Baileys v7 Multi-Tenant WhatsApp Microservice
import 'dotenv/config';
import express from 'express';
import { config } from './config/index.js';
import { sessionManager } from './whatsapp/index.js';
import { sendMessage } from './whatsapp/sendMessage.js';
import { sendImage, sendVideo, sendDocument, sendAudio } from './whatsapp/sendMedia.js';
import { getQueuedMessages } from './supabase/getQueuedMessages.js';
import { markMessageSent } from './supabase/markMessageSent.js';
import { markMessageFailed } from './supabase/markMessageFailed.js';
import { enqueue, dequeue, isQueueEmpty, getQueueStats } from './queue/queue.js';
import { QueuedMessage } from './types/index.js';
import { supabase } from './supabase/client.js';

// Multi-tenant imports
import { authenticateApiKey, optionalAuth, verifySessionAccess, AuthenticatedRequest } from './middleware/auth.js';
import { dynamicCors, publicCors } from './middleware/cors.js';
import { tenantSessionService } from './services/TenantSessionService.js';
import { notifyTenant, createMessageSentEvent, createMessageFailedEvent } from './webhooks/notify.js';

// SSE Broadcaster imports
import { addSSEClient, removeSSEClient, disconnectAllSSEClients } from './events/broadcaster.js';

// Serve static files
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const app = express();

// ============================================================
// MIDDLEWARE GLOBALI
// ============================================================
app.use(express.json({ limit: '20mb' }));
app.use(dynamicCors); // CORS dinamico per tutte le routes

// ============================================================
// STATIC FILES (pubblici)
// ============================================================
// Note: /files endpoint is now dynamic (see below) to support both local and Supabase storage
app.use(express.static(join(projectRoot, 'public')));

// ============================================================
// TRACKING SESSIONI ATTIVE
// ============================================================
const pollingLocks = new Map<string, boolean>();
const sendingLocks = new Map<string, boolean>();

// ============================================================
// FUNZIONI CORE (aggiornate per multi-tenant)
// ============================================================

async function pollSupabaseForMessages(sessionId: string) {
  if (pollingLocks.get(sessionId)) {
    return;
  }

  pollingLocks.set(sessionId, true);

  try {
    const messages = await getQueuedMessages(sessionId);

    if (messages.length > 0) {
      console.log(`[${sessionId}] Found ${messages.length} queued messages`);

      for (const msg of messages) {
        const recipient = msg.jid || msg.phone_number;

        if (!recipient) {
          console.error(`[${sessionId}] Message ${msg.id} has no JID or phone_number, skipping`);
          await markMessageFailed(msg.id, 'No recipient identifier provided');
          continue;
        }

        const queuedMessage: QueuedMessage = {
          id: msg.id,
          jid: msg.jid,
          phoneNumber: msg.phone_number,
          message: msg.message,
          retries: 0,
          sessionId: msg.session_id || sessionId,
        };
        enqueue(queuedMessage);
      }
    }
  } catch (error) {
    console.error(`[${sessionId}] Error polling Supabase:`, error);
  } finally {
    pollingLocks.set(sessionId, false);
  }
}

async function processDripQueue(sessionId: string) {
  if (sendingLocks.get(sessionId) || isQueueEmpty(sessionId)) {
    return;
  }

  if (!sessionManager.isConnected(sessionId)) {
    return;
  }

  sendingLocks.set(sessionId, true);

  try {
    const message = dequeue(sessionId);
    if (!message) {
      sendingLocks.set(sessionId, false);
      return;
    }

    const recipient = message.jid || message.phoneNumber;
    if (!recipient) {
      console.error(`[${sessionId}] Message ${message.id} has no recipient`);
      await markMessageFailed(message.id, 'No recipient identifier');
      sendingLocks.set(sessionId, false);
      return;
    }

    console.log(`[${sessionId}] Processing message ${message.id} to ${recipient}`);

    const socket = sessionManager.getSocket(sessionId);
    if (!socket) {
      console.error(`[${sessionId}] Socket not available`);
      sendingLocks.set(sessionId, false);
      return;
    }

    try {
      const result = await sendMessage(socket, recipient, message.message);
      await markMessageSent(message.id, result.jid);
      console.log(`[${sessionId}] Message ${message.id} sent successfully`);

      // Notifica tenant via webhook
      const tenantId = await tenantSessionService.getTenantBySession(sessionId);
      const webhookUrl = await tenantSessionService.getWebhookUrl(sessionId);

      if (tenantId && webhookUrl) {
        const event = createMessageSentEvent(tenantId, sessionId, {
          id: message.id,
          to: recipient,
          message: message.message,
          jid: result.jid,
        });
        await notifyTenant(webhookUrl, event);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[${sessionId}] Failed to send message ${message.id}:`, errorMessage);

      if (message.retries < config.queue.maxRetries) {
        message.retries++;
        enqueue(message);
        console.log(
          `[${sessionId}] Message ${message.id} re-queued. Retry ${message.retries}/${config.queue.maxRetries}`
        );
      } else {
        await markMessageFailed(message.id, errorMessage);
        console.log(
          `[${sessionId}] Message ${message.id} marked as FAILED after ${config.queue.maxRetries} retries`
        );

        // Notifica failure via webhook
        const tenantId = await tenantSessionService.getTenantBySession(sessionId);
        const webhookUrl = await tenantSessionService.getWebhookUrl(sessionId);

        if (tenantId && webhookUrl) {
          const event = createMessageFailedEvent(tenantId, sessionId, {
            id: message.id,
            to: recipient,
            message: message.message,
            error: errorMessage,
          });
          await notifyTenant(webhookUrl, event);
        }
      }
    }
  } catch (error) {
    console.error(`[${sessionId}] Error in processDripQueue:`, error);
  } finally {
    sendingLocks.set(sessionId, false);
  }
}

// ============================================================
// SSE BROADCAST (Now handled by events/broadcaster.ts)
// ============================================================
// The broadcastMessageToSSE function has been moved to a separate module
// to avoid circular imports between index.ts and SessionManager.ts

// ============================================================
// PUBLIC ENDPOINTS (no auth required)
// ============================================================

app.get('/health', publicCors, (_req, res) => {
  const sessions = sessionManager.getAllSessions();
  const stats = getQueueStats();

  res.status(200).json({
    status: 'ok',
    sessions: sessions.map((s) => ({
      sessionId: s.sessionId,
      connected: s.connected,
    })),
    queue: stats,
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// FILES ENDPOINT - Serve media files (local or Supabase Storage)
// ============================================================

/**
 * GET /files/:sessionId/:fileName
 * Serves media files from local filesystem or Supabase Storage
 * Supports both development (local) and production (Supabase) modes
 */
app.get('/files/:sessionId/:fileName', publicCors, async (req, res): Promise<void> => {
  try {
    const { sessionId, fileName } = req.params;

    if (!sessionId || !fileName) {
      res.status(400).json({ error: 'Missing sessionId or fileName' });
      return;
    }

    // Security: Prevent path traversal attacks
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      res.status(403).json({ error: 'Invalid file name' });
      return;
    }

    if (config.storage.mode === 'supabase') {
      // Production mode: Serve from Supabase Storage
      const storagePath = `${sessionId}/${fileName}`;

      // Get public URL from Supabase Storage
      const { data: urlData } = supabase.storage
        .from(config.storage.bucket)
        .getPublicUrl(storagePath);

      if (!urlData || !urlData.publicUrl) {
        res.status(404).json({ error: 'File not found in Supabase Storage' });
        return;
      }

      // Redirect to Supabase public URL
      res.redirect(urlData.publicUrl);
      return;
    } else {
      // Development mode: Serve from local filesystem
      const mediaDir = join(projectRoot, 'media', sessionId);
      const filePath = join(mediaDir, fileName);

      // Security: Ensure file is within media directory
      const normalizedMediaDir = join(projectRoot, 'media');
      if (!filePath.startsWith(normalizedMediaDir)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      // Check if file exists
      if (!existsSync(filePath)) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      // Determine content type from file extension
      const ext = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
      const contentTypes: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.pdf': 'application/pdf',
        '.mp4': 'video/mp4',
        '.mp3': 'audio/mpeg',
        '.ogg': 'audio/ogg',
        '.wav': 'audio/wav',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };

      const contentType = contentTypes[ext] || 'application/octet-stream';

      // Set headers for caching and CORS
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
      res.setHeader('Access-Control-Allow-Origin', '*');

      // Send file
      res.sendFile(filePath);
      return;
    }
  } catch (error) {
    console.error('[FILES] Error serving file:', error);
    res.status(500).json({
      error: 'Failed to serve file',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
    return;
  }
});

// ============================================================
// PROTECTED ENDPOINTS (auth required)
// ============================================================

// Stats con autenticazione opzionale
app.get('/stats', optionalAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const sessions = sessionManager.getAllSessions();
    const stats = getQueueStats();

    // Se autenticato, mostra solo le sue sessioni
    let filteredSessions = sessions;
    if (req.tenant) {
      const tenantSessions = await tenantSessionService.getSessionsByTenant(req.tenant.tenantId);
      const tenantSessionIds = new Set(tenantSessions.map(s => s.session_id));
      filteredSessions = sessions.filter(s => tenantSessionIds.has(s.sessionId));
    }

    res.json({
      sessions: filteredSessions,
      queue: stats,
      config: {
        pollIntervalMs: config.queue.pollIntervalMs,
        sendIntervalMs: config.queue.sendIntervalMs,
        maxMessagesPerMinute: config.queue.maxMessagesPerMinute,
      },
    });
  } catch (error) {
    console.error('Error in /stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// TENANT MANAGEMENT ENDPOINTS
// ============================================================

// Ottieni tutte le sessioni del tenant
app.get('/tenant/sessions', authenticateApiKey, async (req: AuthenticatedRequest, res) => {
  try {
    const sessions = await tenantSessionService.getSessionsByTenant(req.tenant!.tenantId);

    // Arricchisci con info di connessione
    const enrichedSessions = sessions.map(session => {
      const sessionInfo = sessionManager.getSessionInfo(session.session_id);
      return {
        ...session,
        connected: sessionInfo?.connected || false,
        user: sessionInfo?.user,
      };
    });

    res.json({
      sessions: enrichedSessions,
      count: enrichedSessions.length,
    });
  } catch (error) {
    console.error('Error fetching tenant sessions:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Crea nuova sessione per il tenant
app.post('/tenant/sessions', authenticateApiKey, async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const { session_id, name, description } = req.body;

    if (!session_id || !name) {
      res.status(400).json({
        error: 'Missing required fields: session_id, name',
      });
      return;
    }

    // Crea sessione nel database
    const session = await tenantSessionService.createSession({
      tenant_id: req.tenant!.tenantId,
      session_id,
      name,
      description,
    });

    if (!session) {
      res.status(500).json({ error: 'Failed to create session' });
      return;
    }

    // Inizializza sessione WhatsApp
    await sessionManager.createSession({
      sessionId: session.session_id,
      authPath: session.auth_path,
    });

    res.status(201).json(session);
    return;
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ error: 'Failed to create session' });
    return;
  }
});

// Statistiche sessioni del tenant
app.get('/tenant/stats', authenticateApiKey, async (req: AuthenticatedRequest, res) => {
  try {
    const stats = await tenantSessionService.getSessionStats(req.tenant!.tenantId);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Retrieve all messages for a tenant (multi-session)
app.get('/tenant/messages', authenticateApiKey, async (req: AuthenticatedRequest, res) => {
  const tenantId = req.tenant!.tenantId;
  const limit = parseInt(req.query.limit as string) || 100;
  const offset = parseInt(req.query.offset as string) || 0;
  const status = req.query.status as string;

  try {
    // Get all session IDs for this tenant
    const { data: sessions, error: sessionsError } = await supabase
      .from('whatsapp_sessions')
      .select('session_id')
      .eq('tenant_id', tenantId)
      .eq('is_active', true);

    if (sessionsError) {
      return res.status(500).json({
        error: 'Failed to fetch tenant sessions',
        details: sessionsError.message
      });
    }

    const sessionIds = (sessions || []).map(s => s.session_id);

    if (sessionIds.length === 0) {
      return res.json({
        messages: [],
        total: 0,
        limit,
        offset,
        hasMore: false,
      });
    }

    // Build query for messages - order by created_at ascending for normal chat behavior (oldest first)
    let query = supabase
      .from('messages')
      .select('*', { count: 'exact' })
      .in('session_id', sessionIds)
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    // Filter by status if provided
    if (status && ['SENT', 'RECEIVED', 'FAILED', 'QUEUED'].includes(status)) {
      query = query.eq('status', status);
    }

    const { data: messages, error, count } = await query;

    if (error) {
      console.error('Error fetching tenant messages:', error);
      return res.status(500).json({
        error: 'Failed to fetch messages',
        details: error.message
      });
    }

    return res.json({
      messages: messages || [],
      total: count || 0,
      limit,
      offset,
      hasMore: (count || 0) > offset + limit,
      sessionIds,
    });
  } catch (error: any) {
    console.error('Exception in /tenant/messages:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// ============================================================
// SESSION ENDPOINTS (auth + session access verification)
// ============================================================

// Ottieni QR code
app.get('/session/:sessionId/qr', authenticateApiKey, verifySessionAccess, async (req: AuthenticatedRequest, res) => {
  try {
    const { sessionId } = req.params;
    const qr = sessionManager.getQRCode(sessionId);

    if (!qr) {
      return res.status(404).json({
        error: 'No QR code available',
        message: 'Session is already connected or QR code expired',
      });
    }

    return res.json({ sessionId, qr });
  } catch (error) {
    console.error('Error getting QR code:', error);
    return res.status(500).json({ error: 'Failed to get QR code' });
  }
});

// Status sessione
app.get('/session/:sessionId/status', authenticateApiKey, verifySessionAccess, (req: AuthenticatedRequest, res) => {
  try {
    const { sessionId } = req.params;
    const socket = sessionManager.getSocket(sessionId);
    const qr = sessionManager.getQRCode(sessionId);

    if (!socket) {
      return res.status(404).json({
        sessionId,
        status: 'disconnected',
        message: 'Session not found',
      });
    }

    return res.json({
      sessionId,
      status: socket ? 'connected' : 'disconnected',
      qr: qr || null,
    });
  } catch (error) {
    console.error('Error getting session status:', error);
    return res.status(500).json({ error: 'Failed to get session status' });
  }
});

// Retrieve message history with pagination
app.get('/session/:sessionId/messages', authenticateApiKey, verifySessionAccess, async (req: AuthenticatedRequest, res) => {
  const { sessionId } = req.params;
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;
  const status = req.query.status as string; // Optional: SENT, RECEIVED, FAILED

  try {
    // Build query - order by created_at ascending for normal chat behavior (oldest first)
    let query = supabase
      .from('messages')
      .select('*', { count: 'exact' })
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    // Filter by status if provided
    if (status && ['SENT', 'RECEIVED', 'FAILED', 'QUEUED'].includes(status)) {
      query = query.eq('status', status);
    }

    const { data: messages, error, count } = await query;

    if (error) {
      console.error('Error fetching messages:', error);
      return res.status(500).json({
        error: 'Failed to fetch messages',
        details: error.message
      });
    }

    return res.json({
      messages: messages || [],
      total: count || 0,
      limit,
      offset,
      hasMore: (count || 0) > offset + limit,
    });
  } catch (error: any) {
    console.error('Exception in /session/:sessionId/messages:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Server-Sent Events stream for real-time messages
app.get('/session/:sessionId/messages/stream', authenticateApiKey, verifySessionAccess, async (req: AuthenticatedRequest, res) => {
  const { sessionId } = req.params;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Add this connection to the SSE broadcaster
  addSSEClient(sessionId, res);

  // Send initial connection message
  res.write(`data: ${JSON.stringify({
    type: 'connected',
    sessionId,
    timestamp: new Date().toISOString()
  })}\n\n`);

  // Send heartbeat every 30 seconds to keep connection alive
  const heartbeatInterval = setInterval(() => {
    try {
      res.write(`data: ${JSON.stringify({
        type: 'heartbeat',
        timestamp: new Date().toISOString()
      })}\n\n`);
    } catch (error) {
      clearInterval(heartbeatInterval);
    }
  }, 30000);

  // Handle client disconnect
  req.on('close', () => {
    clearInterval(heartbeatInterval);
    removeSSEClient(sessionId, res);
    res.end();
  });
});

// Invia messaggio
app.post('/session/:sessionId/send', authenticateApiKey, verifySessionAccess, async (req: AuthenticatedRequest, res) => {
  try {
    const { sessionId } = req.params;
    const { to, message } = req.body;

    if (!to || !message) {
      return res.status(400).json({ error: 'Missing required fields: to, message' });
    }

    const socket = sessionManager.getSocket(sessionId);
    if (!socket) {
      return res.status(404).json({
        error: 'Session not found or not connected',
        sessionId,
      });
    }

    const result = await sendMessage(socket, to, message);
    return res.json({
      success: result.success,
      sessionId,
      to: result.jid,
    });
  } catch (error) {
    console.error('Error sending message:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to send message', details: errorMessage });
  }
});

// Send image
app.post('/session/:sessionId/send-image', authenticateApiKey, verifySessionAccess, async (req: AuthenticatedRequest, res) => {
  try {
    const { sessionId } = req.params;
    const { to, image, caption } = req.body;

    if (!to || !image) {
      return res.status(400).json({ error: 'Missing required fields: to, image' });
    }

    const socket = sessionManager.getSocket(sessionId);
    if (!socket) {
      return res.status(404).json({
        error: 'Session not found or not connected',
        sessionId,
      });
    }

    const result = await sendImage(socket, to, image, caption);
    return res.json({
      success: result.success,
      sessionId,
      to: result.jid,
    });
  } catch (error) {
    console.error('Error sending image:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to send image', details: errorMessage });
  }
});

// Send video
app.post('/session/:sessionId/send-video', authenticateApiKey, verifySessionAccess, async (req: AuthenticatedRequest, res) => {
  try {
    const { sessionId } = req.params;
    const { to, video, caption } = req.body;

    if (!to || !video) {
      return res.status(400).json({ error: 'Missing required fields: to, video' });
    }

    const socket = sessionManager.getSocket(sessionId);
    if (!socket) {
      return res.status(404).json({
        error: 'Session not found or not connected',
        sessionId,
      });
    }

    const result = await sendVideo(socket, to, video, caption);
    return res.json({
      success: result.success,
      sessionId,
      to: result.jid,
    });
  } catch (error) {
    console.error('Error sending video:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to send video', details: errorMessage });
  }
});

// Send document
app.post('/session/:sessionId/send-document', authenticateApiKey, verifySessionAccess, async (req: AuthenticatedRequest, res) => {
  try {
    const { sessionId } = req.params;
    const { to, document, fileName, caption, mimetype } = req.body;

    if (!to || !document || !fileName) {
      return res.status(400).json({ error: 'Missing required fields: to, document, fileName' });
    }

    const socket = sessionManager.getSocket(sessionId);
    if (!socket) {
      return res.status(404).json({
        error: 'Session not found or not connected',
        sessionId,
      });
    }

    const result = await sendDocument(socket, to, document, fileName, caption, mimetype);
    return res.json({
      success: result.success,
      sessionId,
      to: result.jid,
    });
  } catch (error) {
    console.error('Error sending document:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to send document', details: errorMessage });
  }
});

// Send audio
app.post('/session/:sessionId/send-audio', authenticateApiKey, verifySessionAccess, async (req: AuthenticatedRequest, res) => {
  try {
    const { sessionId } = req.params;
    const { to, audio, ptt } = req.body;

    if (!to || !audio) {
      return res.status(400).json({ error: 'Missing required fields: to, audio' });
    }

    const socket = sessionManager.getSocket(sessionId);
    if (!socket) {
      return res.status(404).json({
        error: 'Session not found or not connected',
        sessionId,
      });
    }

    const result = await sendAudio(socket, to, audio, ptt);
    return res.json({
      success: result.success,
      sessionId,
      to: result.jid,
    });
  } catch (error) {
    console.error('Error sending audio:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to send audio', details: errorMessage });
  }
});

// Disconnetti sessione
app.post('/session/:sessionId/disconnect', authenticateApiKey, verifySessionAccess, async (req: AuthenticatedRequest, res) => {
  try {
    const { sessionId } = req.params;
    await sessionManager.closeSession(sessionId);
    await tenantSessionService.updateSessionStatus(sessionId, 'disconnected');

    res.json({ success: true, message: 'Session disconnected' });
  } catch (error) {
    console.error('Error disconnecting session:', error);
    res.status(500).json({ error: 'Failed to disconnect session' });
  }
});

// Elimina completamente sessione (disconnect + rimuove auth + rimuove da DB)
app.delete('/session/:sessionId', authenticateApiKey, verifySessionAccess, async (req: AuthenticatedRequest, res) => {
  try {
    const { sessionId } = req.params;
    const tenantId = req.tenant!.tenantId;

    // Delete session from SessionManager (socket + auth files)
    await sessionManager.deleteSession(sessionId);

    // Delete session from database
    await tenantSessionService.deleteSession(sessionId, tenantId);

    console.log(`[${sessionId}] Session deleted successfully for tenant ${tenantId}`);
    res.json({ success: true, message: 'Session deleted completely' });
  } catch (error) {
    console.error('Error deleting session:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to delete session', details: errorMessage });
  }
});

// Rigenera QR code (forza logout e ricrea sessione)
app.post('/session/:sessionId/regenerate-qr', authenticateApiKey, verifySessionAccess, async (req: AuthenticatedRequest, res) => {
  try {
    const { sessionId } = req.params;

    // Regenerate QR code
    await sessionManager.regenerateQR(sessionId);

    // Wait a moment for QR to be generated
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Get new QR code
    const qr = sessionManager.getQRCode(sessionId);

    if (!qr) {
      return res.status(500).json({
        error: 'QR code not generated',
        message: 'QR regeneration initiated but code not yet available. Please try again in a few seconds.',
      });
    }

    return res.json({
      success: true,
      message: 'QR code regenerated',
      sessionId,
      qr,
    });
  } catch (error) {
    console.error('Error regenerating QR code:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to regenerate QR code', details: errorMessage });
  }
});

// ============================================================
// MEDIA ENDPOINTS (manteniamo gli esistenti, opzionalmente protetti)
// ============================================================

app.get('/media', optionalAuth, async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;

    const mediaMessages = data
      .filter((msg: any) => {
        return (
          msg.metadata &&
          typeof msg.metadata === 'object' &&
          msg.metadata.mediaType &&
          msg.metadata.mediaType !== 'text'
        );
      })
      .slice(0, 100)
      .map((msg: any) => ({
        id: msg.id,
        phone_number: msg.phone_number,
        message: msg.message,
        status: msg.status,
        created_at: msg.created_at,
        mediaType: msg.metadata?.mediaType,
        emoji: msg.metadata?.mediaEmoji,
        fileName: msg.metadata?.fileName,
        filePath: msg.metadata?.filePath,
        mimeType: msg.metadata?.mimeType,
        fileSize: msg.metadata?.fileSize,
        fromMe: msg.metadata?.fromMe || false,
      }));

    return res.json({ media: mediaMessages, count: mediaMessages.length });
  } catch (error) {
    console.error('Error fetching media:', error);
    return res.status(500).json({ error: 'Failed to fetch media', details: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.get('/media/stats', optionalAuth, async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('metadata')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const stats: Record<string, { count: number; totalSize: number }> = {};

    data
      .filter((msg: any) => {
        return (
          msg.metadata &&
          typeof msg.metadata === 'object' &&
          msg.metadata.mediaType &&
          msg.metadata.mediaType !== 'text'
        );
      })
      .forEach((msg: any) => {
        const mediaType = msg.metadata?.mediaType;
        const fileSize = msg.metadata?.fileSize || 0;

        if (!stats[mediaType]) {
          stats[mediaType] = { count: 0, totalSize: 0 };
        }
        stats[mediaType].count++;
        stats[mediaType].totalSize += fileSize;
      });

    const formattedStats = Object.entries(stats).map(([type, data]) => ({
      type,
      count: data.count,
      totalSize: formatBytes(data.totalSize),
    }));

    return res.json({ stats: formattedStats });
  } catch (error) {
    console.error('Error fetching media stats:', error);
    return res.status(500).json({ error: 'Failed to fetch media stats', details: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.get('/media/download/:messageId', optionalAuth, async (req, res): Promise<void> => {
  try {
    const { messageId } = req.params;

    const { data, error } = await supabase
      .from('messages')
      .select('metadata')
      .eq('id', messageId)
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Media not found' });
      return;
    }

    const filePath = data.metadata?.filePath;
    const fileName = data.metadata?.fileName;

    if (!filePath) {
      res.status(404).json({ error: 'No media file associated with this message' });
      return;
    }

    if (config.storage.mode === 'supabase') {
      const { data: urlData } = supabase.storage
        .from(config.storage.bucket)
        .getPublicUrl(filePath);

      res.redirect(urlData.publicUrl);
      return;
    } else {
      const normalizedPath = filePath.replace(/\\/g, '/');
      const absolutePath = join(projectRoot, normalizedPath);
      res.download(absolutePath, fileName || 'download');
      return;
    }
  } catch (error) {
    console.error('Error downloading media:', error);
    res.status(500).json({ error: 'Failed to download media' });
    return;
  }
});

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// ============================================================
// STARTUP - Inizializza sessioni dal database
// ============================================================

async function startService() {
  console.log('='.repeat(60));
  console.log('Starting Multi-Tenant WhatsApp Service');
  console.log('Baileys v7 - Session-Based Multi-Tenancy');
  console.log('='.repeat(60));

  try {
    // Carica tutte le sessioni attive dal database
    console.log('Loading active sessions from database...');
    const sessions = await tenantSessionService.getAllActiveSessions();

    console.log(`Found ${sessions.length} active sessions`);

    // Inizializza ogni sessione
    for (const session of sessions) {
      try {
        console.log(`[${session.session_id}] Initializing session for tenant: ${session.tenant_id}`);
        await sessionManager.createSession({
          sessionId: session.session_id,
          authPath: session.auth_path,
        });

        // Setup polling e processing per questa sessione
        setInterval(() => pollSupabaseForMessages(session.session_id), config.queue.pollIntervalMs);
        setInterval(() => processDripQueue(session.session_id), config.queue.sendIntervalMs);

        console.log(`[${session.session_id}] ✓ Session initialized`);
      } catch (error) {
        console.error(`[${session.session_id}] Failed to initialize:`, error);
      }
    }

    // Start Express server
    app.listen(config.server.port, () => {
      console.log('='.repeat(60));
      console.log(`Express server running on port ${config.server.port}`);
      console.log(`Health check: http://localhost:${config.server.port}/health`);
      console.log(`Protected routes require X-Api-Key header`);
      console.log('='.repeat(60));
    });

    console.log('Multi-Tenant WhatsApp Service started successfully!');
  } catch (error) {
    console.error('Failed to start service:', error);
    process.exit(1);
  }
}

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  disconnectAllSSEClients();
  await sessionManager.closeAllSessions();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down gracefully...');
  disconnectAllSSEClients();
  await sessionManager.closeAllSessions();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

startService().catch((error) => {
  console.error('Failed to start service:', error);
  process.exit(1);
});
