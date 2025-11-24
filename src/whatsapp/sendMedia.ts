// Baileys v7 compatible media message sending
import { WASocket, isPnUser } from '@whiskeysockets/baileys';

/**
 * Convert base64 string to Buffer
 */
function base64ToBuffer(base64String: string): Buffer {
  // Remove data URL prefix if present (e.g., "data:image/png;base64,")
  const base64Data = base64String.includes(',')
    ? base64String.split(',')[1]
    : base64String;

  return Buffer.from(base64Data, 'base64');
}

/**
 * Resolve recipient to proper JID format
 */
async function resolveRecipient(socket: WASocket, recipient: string): Promise<string> {
  let targetJid = recipient;

  // If the recipient doesn't have a suffix, assume it's a phone number
  if (!recipient.includes('@')) {
    targetJid = `${recipient}@s.whatsapp.net`;
  }

  // Try to get LID for phone numbers if available
  if (isPnUser(targetJid) && socket.signalRepository) {
    try {
      const repo = socket.signalRepository as any;
      if (typeof repo.getLIDForPN === 'function') {
        const lid = await repo.getLIDForPN(targetJid);
        if (lid) {
          console.log(`Resolved PN ${targetJid} to LID ${lid}`);
          targetJid = lid;
        }
      }
    } catch (error) {
      console.log(`No LID mapping found for ${targetJid}, using PN format`);
    }
  }

  return targetJid;
}

/**
 * Send an image message
 */
export async function sendImage(
  socket: WASocket,
  recipient: string,
  image: string | Buffer,
  caption?: string
): Promise<{ success: boolean; jid: string }> {
  if (!socket) {
    throw new Error('WhatsApp socket is not initialized');
  }

  const targetJid = await resolveRecipient(socket, recipient);

  try {
    // Convert base64 to buffer if needed
    const imageBuffer = typeof image === 'string' ? base64ToBuffer(image) : image;

    await socket.sendMessage(targetJid, {
      image: imageBuffer,
      caption: caption || undefined,
    });

    console.log(`Image sent to ${targetJid}`);
    return { success: true, jid: targetJid };
  } catch (error) {
    console.error(`Failed to send image to ${targetJid}:`, error);
    throw error;
  }
}

/**
 * Send a video message
 */
export async function sendVideo(
  socket: WASocket,
  recipient: string,
  video: string | Buffer,
  caption?: string
): Promise<{ success: boolean; jid: string }> {
  if (!socket) {
    throw new Error('WhatsApp socket is not initialized');
  }

  const targetJid = await resolveRecipient(socket, recipient);

  try {
    // Convert base64 to buffer if needed
    const videoBuffer = typeof video === 'string' ? base64ToBuffer(video) : video;

    await socket.sendMessage(targetJid, {
      video: videoBuffer,
      caption: caption || undefined,
    });

    console.log(`Video sent to ${targetJid}`);
    return { success: true, jid: targetJid };
  } catch (error) {
    console.error(`Failed to send video to ${targetJid}:`, error);
    throw error;
  }
}

/**
 * Send a document message
 */
export async function sendDocument(
  socket: WASocket,
  recipient: string,
  document: string | Buffer,
  fileName: string,
  caption?: string,
  mimetype?: string
): Promise<{ success: boolean; jid: string }> {
  if (!socket) {
    throw new Error('WhatsApp socket is not initialized');
  }

  const targetJid = await resolveRecipient(socket, recipient);

  try {
    // Convert base64 to buffer if needed
    const documentBuffer = typeof document === 'string' ? base64ToBuffer(document) : document;

    // Detect mimetype from filename if not provided
    let detectedMimetype = mimetype;
    if (!detectedMimetype) {
      const ext = fileName.split('.').pop()?.toLowerCase();
      switch (ext) {
        case 'pdf':
          detectedMimetype = 'application/pdf';
          break;
        case 'doc':
          detectedMimetype = 'application/msword';
          break;
        case 'docx':
          detectedMimetype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          break;
        case 'xls':
          detectedMimetype = 'application/vnd.ms-excel';
          break;
        case 'xlsx':
          detectedMimetype = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          break;
        case 'txt':
          detectedMimetype = 'text/plain';
          break;
        default:
          detectedMimetype = 'application/octet-stream';
      }
    }

    await socket.sendMessage(targetJid, {
      document: documentBuffer,
      fileName: fileName,
      caption: caption || undefined,
      mimetype: detectedMimetype,
    });

    console.log(`Document sent to ${targetJid}: ${fileName}`);
    return { success: true, jid: targetJid };
  } catch (error) {
    console.error(`Failed to send document to ${targetJid}:`, error);
    throw error;
  }
}

/**
 * Send an audio message
 */
export async function sendAudio(
  socket: WASocket,
  recipient: string,
  audio: string | Buffer,
  ptt: boolean = false
): Promise<{ success: boolean; jid: string }> {
  if (!socket) {
    throw new Error('WhatsApp socket is not initialized');
  }

  const targetJid = await resolveRecipient(socket, recipient);

  try {
    // Convert base64 to buffer if needed
    const audioBuffer = typeof audio === 'string' ? base64ToBuffer(audio) : audio;

    await socket.sendMessage(targetJid, {
      audio: audioBuffer,
      ptt: ptt, // Set to true for voice messages
      mimetype: 'audio/mp4',
    });

    console.log(`Audio sent to ${targetJid}`);
    return { success: true, jid: targetJid };
  } catch (error) {
    console.error(`Failed to send audio to ${targetJid}:`, error);
    throw error;
  }
}
