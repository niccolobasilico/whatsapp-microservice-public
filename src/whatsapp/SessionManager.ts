// Baileys v7 SessionManager - Multi-session support
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  WAMessage,
  isPnUser,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { SessionConfig, SessionInfo, IncomingMessage } from '../types/index.js';
import { insertIncomingMessage } from '../supabase/insertIncomingMessage.js';
import { downloadAndSaveMedia, detectMediaType } from './mediaHandler.js';
import { rmSync, existsSync } from 'fs';
import { tenantSessionService } from '../services/TenantSessionService.js';
import {
  notifyTenant,
  createMessageReceivedEvent,
  createSessionConnectedEvent,
  createSessionDisconnectedEvent,
  createQRCodeEvent,
} from '../webhooks/notify.js';
import { broadcastMessageToSSE } from '../events/broadcaster.js';

interface SessionData {
  socket: WASocket;
  connected: boolean;
  reconnectAttempts: number;
  authPath: string;
  qrCode: string | null;
}

class SessionManager {
  private sessions: Map<string, SessionData> = new Map();
  private readonly maxReconnectAttempts = 5;
  private readonly logger = pino({ level: 'silent' }); // Silent logger for Baileys internal logs

  async createSession(config: SessionConfig): Promise<WASocket> {
    const { sessionId, authPath = `auth_info_${sessionId}` } = config;

    if (this.sessions.has(sessionId)) {
      console.log(`Session ${sessionId} already exists`);
      return this.sessions.get(sessionId)!.socket;
    }

    console.log(`Creating new session: ${sessionId}`);

    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, this.logger),
      },
      logger: this.logger,
      browser: ['WhatsApp Service', 'Chrome', '10.0'], // Shows as Windows Chrome
      printQRInTerminal: false,
      generateHighQualityLinkPreview: true,
      // Baileys v7: use default ACK behavior - don't force manual ACKs
      syncFullHistory: false,
      getMessage: async () => undefined, // Required for proper message handling
    });

    const sessionData: SessionData = {
      socket,
      connected: false,
      reconnectAttempts: 0,
      authPath,
      qrCode: null,
    };

    this.sessions.set(sessionId, sessionData);

    // Setup event handlers
    this.setupEventHandlers(sessionId, socket, saveCreds);

    return socket;
  }

  private setupEventHandlers(
    sessionId: string,
    socket: WASocket,
    saveCreds: () => Promise<void>
  ): void {
    // Save credentials on update
    socket.ev.on('creds.update', saveCreds);

    // Handle connection updates
    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log(`[${sessionId}] QR Code generated. Scan with WhatsApp:`);
        qrcode.generate(qr, { small: true });
        // Save QR code for API access
        const sessionData = this.sessions.get(sessionId);
        if (sessionData) {
          sessionData.qrCode = qr;
        }

        // Webhook: QR code generated
        this.sendWebhook(sessionId, async (tenantId, webhookUrl) => {
          const event = createQRCodeEvent(tenantId, sessionId, { qr });
          await notifyTenant(webhookUrl, event);
        });
      }

      if (connection === 'close') {
        const sessionData = this.sessions.get(sessionId);
        if (sessionData) {
          sessionData.connected = false;
        }

        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(
          `[${sessionId}] Connection closed. Status: ${statusCode}, Reconnecting: ${shouldReconnect}`
        );

        // Update database status
        await tenantSessionService.updateSessionStatus(sessionId, 'disconnected');

        // Webhook: Session disconnected
        this.sendWebhook(sessionId, async (tenantId, webhookUrl) => {
          const event = createSessionDisconnectedEvent(tenantId, sessionId, {
            reason: shouldReconnect ? 'Connection lost' : 'Logged out',
          });
          await notifyTenant(webhookUrl, event);
        });

        if (shouldReconnect && sessionData) {
          if (sessionData.reconnectAttempts < this.maxReconnectAttempts) {
            sessionData.reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, sessionData.reconnectAttempts), 30000);
            console.log(
              `[${sessionId}] Reconnecting in ${delay}ms (attempt ${sessionData.reconnectAttempts}/${this.maxReconnectAttempts})`
            );
            setTimeout(() => this.reconnectSession(sessionId), delay);
          } else {
            // Max reconnection attempts reached - regenerate QR code
            console.log('='.repeat(60));
            console.error(
              `[${sessionId}] ⚠️  Max reconnection attempts reached - Auto-regenerating QR Code`
            );
            console.log('='.repeat(60));
            await this.handleLogoutAndRegenerate(sessionId);
          }
        } else {
          // Logged out - regenerate QR code automatically
          console.log('='.repeat(60));
          console.log(`[${sessionId}] ⚠️  LOGOUT DETECTED - Auto-regenerating QR Code`);
          console.log('='.repeat(60));
          await this.handleLogoutAndRegenerate(sessionId);
        }
      } else if (connection === 'open') {
        const sessionData = this.sessions.get(sessionId);
        if (sessionData) {
          sessionData.connected = true;
          sessionData.reconnectAttempts = 0;
          sessionData.qrCode = null; // Clear QR code once connected
        }
        console.log(`[${sessionId}] WhatsApp connection established successfully!`);

        // Update session status in database
        const whatsappNumber = socket.user?.id.split(':')[0] || '';
        await tenantSessionService.updateSessionStatus(sessionId, 'active', {
          whatsapp_number: whatsappNumber,
          connected_at: new Date().toISOString(),
        });

        // Webhook: Session connected
        this.sendWebhook(sessionId, async (tenantId, webhookUrl) => {
          const event = createSessionConnectedEvent(tenantId, sessionId, {
            whatsapp_number: whatsappNumber,
            user: socket.user ? {
              id: socket.user.id,
              name: socket.user.name,
            } : undefined,
          });
          await notifyTenant(webhookUrl, event);
        });
      }
    });

    // Baileys v7: Handle LID mapping updates
    socket.ev.on('lid-mapping.update', (update) => {
      console.log(`[${sessionId}] LID mapping update:`, update);
      // You can store these mappings in Supabase if needed
    });

    // Handle all messages (incoming and outgoing)
    console.log(`[${sessionId}] ✅ Registered messages.upsert event handler`);
    socket.ev.on('messages.upsert', async ({ messages }) => {
      console.log(`[${sessionId}] 📬 Received ${messages.length} message(s) from Baileys`);
      for (const msg of messages) {
        if (msg.message) {
          // Handle both incoming and outgoing messages
          const isFromMe = msg.key.fromMe || false;
          const msgType = isFromMe ? 'outgoing' : 'incoming';
          console.log(`[${sessionId}] Processing ${msgType} message from ${msg.key.remoteJid}`);

          if (isFromMe) {
            // Message sent from this device (via phone or other clients)
            await this.handleOutgoingMessage(sessionId, msg);
          } else {
            // Message received from others
            await this.handleIncomingMessage(sessionId, msg);
          }
        } else {
          console.log(`[${sessionId}] Skipping message without content`);
        }
      }
    });
  }

  private async handleIncomingMessage(sessionId: string, msg: WAMessage): Promise<void> {
    try {
      const jid = msg.key.remoteJid;
      if (!jid) {
        console.warn(`[${sessionId}] Message without JID, skipping`);
        return;
      }

      // Extract phone number if available (only for PN-based JIDs)
      let phoneNumber: string | null = null;
      if (isPnUser(jid)) {
        phoneNumber = jid.replace('@s.whatsapp.net', '');
      }

      // Detect media type
      const mediaInfo = detectMediaType(msg);

      // Extract message text
      let messageText: string;
      if (mediaInfo.type === 'text') {
        messageText =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          '[Empty message]';
      } else {
        // For media messages, use caption or description
        messageText = mediaInfo.caption || `${mediaInfo.emoji} ${mediaInfo.description}`;
      }

      const sender = phoneNumber || jid;
      const senderDisplay = msg.pushName ? `${msg.pushName} (${sender})` : sender;

      // Download and save media if applicable
      let mediaData = mediaInfo;
      if (mediaInfo.type !== 'text') {
        console.log(`[${sessionId}] ${mediaInfo.emoji} Downloading ${mediaInfo.description} from ${senderDisplay}...`);
        mediaData = await downloadAndSaveMedia(msg, sessionId);
      }

      console.log(
        `[${sessionId}] ${mediaInfo.emoji} Received from ${senderDisplay}: ${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}`
      );

      const incomingMessage: IncomingMessage = {
        jid,
        phone_number: phoneNumber,
        message: messageText,
        platform: 'WHATSAPP',
        session_id: sessionId,
        received_at: new Date().toISOString(),
        metadata: {
          messageId: msg.key.id,
          timestamp: msg.messageTimestamp,
          pushName: msg.pushName,
          mediaType: mediaData.type,
          mediaEmoji: mediaData.emoji,
          fileName: mediaData.fileName,
          filePath: mediaData.filePath,
          mimeType: mediaData.mimeType,
          fileSize: mediaData.fileSize,
        },
      };

      await insertIncomingMessage(incomingMessage);

      // Broadcast to SSE clients for real-time updates
      broadcastMessageToSSE(sessionId, {
        id: incomingMessage.metadata?.messageId,
        jid,
        phone_number: phoneNumber,
        message: messageText,
        status: 'RECEIVED',
        platform: 'WHATSAPP',
        session_id: sessionId,
        created_at: incomingMessage.received_at,
        metadata: incomingMessage.metadata,
      });

      // Webhook: Message received
      this.sendWebhook(sessionId, async (tenantId, webhookUrl) => {
        const event = createMessageReceivedEvent(tenantId, sessionId, {
          id: incomingMessage.metadata?.messageId || 'unknown',
          from: phoneNumber || jid,
          message: messageText,
          jid,
          phone_number: phoneNumber || undefined,
          metadata: incomingMessage.metadata,
        });
        await notifyTenant(webhookUrl, event);
      });
    } catch (error) {
      console.error(`[${sessionId}] Error handling incoming message:`, error);
    }
  }

  private async handleOutgoingMessage(sessionId: string, msg: WAMessage): Promise<void> {
    try {
      const jid = msg.key.remoteJid;
      if (!jid) {
        console.warn(`[${sessionId}] Outgoing message without JID, skipping`);
        return;
      }

      // Extract phone number if available (only for PN-based JIDs)
      let phoneNumber: string | null = null;
      if (isPnUser(jid)) {
        phoneNumber = jid.replace('@s.whatsapp.net', '');
      }

      // Detect media type
      const mediaInfo = detectMediaType(msg);

      // Extract message text
      let messageText: string;
      if (mediaInfo.type === 'text') {
        messageText =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          '[Empty message]';
      } else {
        // For media messages, use caption or description
        messageText = mediaInfo.caption || `${mediaInfo.emoji} ${mediaInfo.description}`;
      }

      const recipient = phoneNumber || jid;

      // Download and save media if applicable
      let mediaData = mediaInfo;
      if (mediaInfo.type !== 'text') {
        console.log(`[${sessionId}] ${mediaInfo.emoji} Saving sent ${mediaInfo.description} to ${recipient}...`);
        mediaData = await downloadAndSaveMedia(msg, sessionId);
      }

      console.log(
        `[${sessionId}] 📤 Sent to ${recipient}: ${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}`
      );

      // Save outgoing message with status SENT
      const outgoingMessage: IncomingMessage = {
        jid,
        phone_number: phoneNumber,
        message: messageText,
        platform: 'WHATSAPP',
        session_id: sessionId,
        received_at: new Date().toISOString(),
        metadata: {
          messageId: msg.key.id,
          timestamp: msg.messageTimestamp,
          fromMe: true, // Mark as sent by us
          mediaType: mediaData.type,
          mediaEmoji: mediaData.emoji,
          fileName: mediaData.fileName,
          filePath: mediaData.filePath,
          mimeType: mediaData.mimeType,
          fileSize: mediaData.fileSize,
        },
      };

      await insertIncomingMessage(outgoingMessage);

      // Broadcast to SSE clients for real-time updates
      broadcastMessageToSSE(sessionId, {
        id: outgoingMessage.metadata?.messageId,
        jid,
        phone_number: phoneNumber,
        message: messageText,
        status: 'SENT',
        platform: 'WHATSAPP',
        session_id: sessionId,
        created_at: outgoingMessage.received_at,
        metadata: outgoingMessage.metadata,
      });
    } catch (error) {
      console.error(`[${sessionId}] Error handling outgoing message:`, error);
    }
  }

  private async handleLogoutAndRegenerate(sessionId: string): Promise<void> {
    const sessionData = this.sessions.get(sessionId);
    if (!sessionData) return;

    try {
      const authPath = sessionData.authPath;

      // Remove session from map
      this.sessions.delete(sessionId);

      // Delete authentication folder if it exists
      if (existsSync(authPath)) {
        console.log(`[${sessionId}] Deleting old credentials: ${authPath}`);
        rmSync(authPath, { recursive: true, force: true });
        console.log(`[${sessionId}] ✓ Credentials deleted successfully`);
      }

      // Wait a moment before recreating
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Create fresh session - this will generate a new QR code
      console.log(`[${sessionId}] Creating fresh session...`);
      await this.createSession({
        sessionId,
        authPath,
      });

      console.log('='.repeat(60));
      console.log(`[${sessionId}] ✓ New QR Code generated - Scan to reconnect!`);
      console.log('='.repeat(60));
    } catch (error) {
      console.error(`[${sessionId}] Error during logout and regenerate:`, error);
    }
  }

  private async reconnectSession(sessionId: string): Promise<void> {
    const sessionData = this.sessions.get(sessionId);
    if (!sessionData) return;

    try {
      console.log(`[${sessionId}] Attempting to reconnect...`);
      // Remove old session
      this.sessions.delete(sessionId);
      // Create new session with same config
      await this.createSession({
        sessionId,
        authPath: sessionData.authPath,
      });
    } catch (error) {
      console.error(`[${sessionId}] Reconnection failed:`, error);
    }
  }

  getSocket(sessionId: string): WASocket | null {
    return this.sessions.get(sessionId)?.socket || null;
  }

  getQRCode(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.qrCode || null;
  }

  isConnected(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.connected || false;
  }

  getSessionInfo(sessionId: string): SessionInfo | null {
    const sessionData = this.sessions.get(sessionId);
    if (!sessionData) return null;

    return {
      sessionId,
      connected: sessionData.connected,
      user: sessionData.socket.user
        ? {
            id: sessionData.socket.user.id,
            name: sessionData.socket.user.name,
          }
        : undefined,
    };
  }

  getAllSessions(): SessionInfo[] {
    return Array.from(this.sessions.entries()).map(([sessionId, data]) => ({
      sessionId,
      connected: data.connected,
      user: data.socket.user
        ? {
            id: data.socket.user.id,
            name: data.socket.user.name,
          }
        : undefined,
    }));
  }

  async closeSession(sessionId: string): Promise<void> {
    const sessionData = this.sessions.get(sessionId);
    if (sessionData) {
      console.log(`[${sessionId}] Closing session...`);
      await sessionData.socket.logout();
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Completely delete a session - close socket, remove from memory, delete auth files
   */
  async deleteSession(sessionId: string): Promise<void> {
    const sessionData = this.sessions.get(sessionId);

    console.log(`[${sessionId}] Deleting session completely...`);

    // Close socket if active
    if (sessionData?.socket) {
      try {
        console.log(`[${sessionId}] Closing socket...`);
        await sessionData.socket.logout();
      } catch (error) {
        console.error(`[${sessionId}] Error logging out:`, error);
        // Continue even if logout fails
      }
    }

    // Remove from sessions map
    if (this.sessions.has(sessionId)) {
      this.sessions.delete(sessionId);
      console.log(`[${sessionId}] Removed from sessions map`);
    }

    // Delete authentication files
    const authPath = sessionData?.authPath || `auth_info_${sessionId}`;
    if (existsSync(authPath)) {
      try {
        console.log(`[${sessionId}] Deleting auth files: ${authPath}`);
        rmSync(authPath, { recursive: true, force: true });
        console.log(`[${sessionId}] ✓ Auth files deleted successfully`);
      } catch (error) {
        console.error(`[${sessionId}] Error deleting auth files:`, error);
      }
    }

    console.log(`[${sessionId}] ✓ Session deleted completely`);
  }

  /**
   * Force regenerate QR code - useful when session exists but QR is not available
   */
  async regenerateQR(sessionId: string): Promise<void> {
    console.log(`[${sessionId}] Force regenerating QR code...`);

    const sessionData = this.sessions.get(sessionId);
    const authPath = sessionData?.authPath || `auth_info_${sessionId}`;

    // Close existing session if active
    if (sessionData) {
      try {
        if (sessionData.socket) {
          await sessionData.socket.logout();
        }
        this.sessions.delete(sessionId);
      } catch (error) {
        console.error(`[${sessionId}] Error closing session:`, error);
      }
    }

    // Delete auth files to force fresh QR generation
    if (existsSync(authPath)) {
      try {
        console.log(`[${sessionId}] Deleting auth files to force QR regeneration`);
        rmSync(authPath, { recursive: true, force: true });
      } catch (error) {
        console.error(`[${sessionId}] Error deleting auth files:`, error);
      }
    }

    // Wait a moment before recreating
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Create fresh session - this will generate a new QR code
    console.log(`[${sessionId}] Creating fresh session for QR generation...`);
    await this.createSession({
      sessionId,
      authPath,
    });

    console.log(`[${sessionId}] ✓ QR code regeneration initiated`);
  }

  async closeAllSessions(): Promise<void> {
    console.log('Closing all sessions...');
    for (const sessionId of this.sessions.keys()) {
      await this.closeSession(sessionId);
    }
  }

  /**
   * Helper method per inviare webhook in modo sicuro
   */
  private async sendWebhook(
    sessionId: string,
    callback: (tenantId: string, webhookUrl: string) => Promise<void>
  ): Promise<void> {
    try {
      const tenantId = await tenantSessionService.getTenantBySession(sessionId);
      const webhookUrl = await tenantSessionService.getWebhookUrl(sessionId);

      if (tenantId && webhookUrl) {
        await callback(tenantId, webhookUrl);
      }
    } catch (error) {
      console.error(`[${sessionId}] Error sending webhook:`, error);
      // Non bloccare l'esecuzione se il webhook fallisce
    }
  }
}

export const sessionManager = new SessionManager();
