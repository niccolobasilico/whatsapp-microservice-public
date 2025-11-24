// SSE Broadcaster - Manages Server-Sent Events connections
// This module is separate to avoid circular imports between index.ts and SessionManager.ts

import type { Response } from 'express';

// Store SSE connections per session
const sseClients = new Map<string, Set<Response>>();

/**
 * Broadcast a message to all SSE clients connected to a specific session
 * @param sessionId - The session ID to broadcast to
 * @param message - The message data to send
 */
export function broadcastMessageToSSE(sessionId: string, message: any): void {
  const clients = sseClients.get(sessionId);

  if (!clients || clients.size === 0) {
    return;
  }

  const eventData = JSON.stringify({
    type: 'message',
    data: message,
    timestamp: new Date().toISOString(),
  });

  console.log(`[SSE] Broadcasting to ${clients.size} client(s) on session ${sessionId}`);

  clients.forEach((res) => {
    try {
      res.write(`data: ${eventData}\n\n`);
    } catch (error) {
      console.error(`[SSE] Error broadcasting to client on session ${sessionId}:`, error);
      // Remove failed client
      clients.delete(res);
    }
  });
}

/**
 * Add a new SSE client connection for a session
 * @param sessionId - The session ID
 * @param response - The Express Response object
 */
export function addSSEClient(sessionId: string, response: Response): void {
  if (!sseClients.has(sessionId)) {
    sseClients.set(sessionId, new Set());
  }

  sseClients.get(sessionId)!.add(response);
  console.log(`[SSE] Client connected to session ${sessionId}, total: ${sseClients.get(sessionId)!.size}`);
}

/**
 * Remove an SSE client connection from a session
 * @param sessionId - The session ID
 * @param response - The Express Response object
 */
export function removeSSEClient(sessionId: string, response: Response): void {
  const clients = sseClients.get(sessionId);

  if (clients) {
    clients.delete(response);
    console.log(`[SSE] Client disconnected from session ${sessionId}, remaining: ${clients.size}`);

    // Clean up empty session
    if (clients.size === 0) {
      sseClients.delete(sessionId);
      console.log(`[SSE] No more clients for session ${sessionId}, cleaned up`);
    }
  }
}

/**
 * Get the number of active SSE clients for a session
 * @param sessionId - The session ID
 * @returns Number of connected clients
 */
export function getSSEClientCount(sessionId: string): number {
  return sseClients.get(sessionId)?.size || 0;
}

/**
 * Get total number of SSE connections across all sessions
 * @returns Total number of SSE clients
 */
export function getTotalSSEClients(): number {
  let total = 0;
  sseClients.forEach((clients) => {
    total += clients.size;
  });
  return total;
}

/**
 * Disconnect all SSE clients (useful for graceful shutdown)
 */
export function disconnectAllSSEClients(): void {
  console.log('[SSE] Disconnecting all SSE clients...');

  sseClients.forEach((clients, sessionId) => {
    clients.forEach((res) => {
      try {
        res.write(`data: ${JSON.stringify({ type: 'shutdown', message: 'Server shutting down' })}\n\n`);
        res.end();
      } catch (error) {
        // Ignore errors on shutdown
      }
    });
    console.log(`[SSE] Disconnected ${clients.size} client(s) from session ${sessionId}`);
  });

  sseClients.clear();
  console.log('[SSE] All SSE clients disconnected');
}
