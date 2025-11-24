// Baileys v7 compatible message sending with LID/JID support
import { WASocket, isPnUser } from '@whiskeysockets/baileys';

/**
 * Send a text message using Baileys v7
 * Supports both phone numbers and JIDs (including LIDs)
 */
export async function sendMessage(
  socket: WASocket,
  recipient: string,
  message: string
): Promise<{ success: boolean; jid: string }> {
  if (!socket) {
    throw new Error('WhatsApp socket is not initialized');
  }

  let targetJid = recipient;

  // If the recipient doesn't have a suffix, assume it's a phone number
  // and format it as a proper JID
  if (!recipient.includes('@')) {
    targetJid = `${recipient}@s.whatsapp.net`;
  }

  // Baileys v7: Try to get LID for phone numbers if available
  // This is optional - Baileys will handle PN->LID conversion automatically
  if (isPnUser(targetJid) && socket.signalRepository) {
    try {
      // Check if getLIDForPN exists before calling it
      const repo = socket.signalRepository as any;
      if (typeof repo.getLIDForPN === 'function') {
        const lid = await repo.getLIDForPN(targetJid);
        if (lid) {
          console.log(`Resolved PN ${targetJid} to LID ${lid}`);
          targetJid = lid;
        }
      }
    } catch (error) {
      // LID not available, will use PN format
      console.log(`No LID mapping found for ${targetJid}, using PN format`);
    }
  }

  try {
    await socket.sendMessage(targetJid, { text: message });
    console.log(`Message sent to ${targetJid}: ${message.substring(0, 50)}...`);
    return { success: true, jid: targetJid };
  } catch (error) {
    console.error(`Failed to send message to ${targetJid}:`, error);
    throw error;
  }
}

/**
 * Extract phone number from JID if it's in PN format
 */
export function extractPhoneNumber(jid: string): string | null {
  if (isPnUser(jid)) {
    return jid.replace('@s.whatsapp.net', '');
  }
  return null;
}
