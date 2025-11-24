// Media download and handling for WhatsApp messages
import { WAMessage, downloadMediaMessage } from '@whiskeysockets/baileys';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { supabase } from '../supabase/client.js';
import { config } from '../config/index.js';

export interface MediaInfo {
  type: 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'text';
  emoji: string;
  description: string;
  fileName?: string;
  filePath?: string;
  mimeType?: string;
  fileSize?: number;
  caption?: string;
}

/**
 * Detect media type from message
 */
export function detectMediaType(msg: WAMessage): MediaInfo {
  const message = msg.message;

  if (!message) {
    return {
      type: 'text',
      emoji: '💬',
      description: 'Text message',
    };
  }

  // Image
  if (message.imageMessage) {
    return {
      type: 'image',
      emoji: '📷',
      description: 'Photo',
      mimeType: message.imageMessage.mimetype || undefined,
      caption: message.imageMessage.caption || undefined,
    };
  }

  // Video
  if (message.videoMessage) {
    return {
      type: 'video',
      emoji: '🎥',
      description: 'Video',
      mimeType: message.videoMessage.mimetype || undefined,
      caption: message.videoMessage.caption || undefined,
    };
  }

  // Audio/Voice
  if (message.audioMessage) {
    const isVoice = message.audioMessage.ptt; // push-to-talk
    return {
      type: 'audio',
      emoji: isVoice ? '🎤' : '🎵',
      description: isVoice ? 'Voice message' : 'Audio',
      mimeType: message.audioMessage.mimetype || undefined,
    };
  }

  // Document
  if (message.documentMessage) {
    return {
      type: 'document',
      emoji: '📄',
      description: 'Document',
      fileName: message.documentMessage.fileName || undefined,
      mimeType: message.documentMessage.mimetype || undefined,
    };
  }

  // Sticker
  if (message.stickerMessage) {
    return {
      type: 'sticker',
      emoji: '🎭',
      description: 'Sticker',
      mimeType: message.stickerMessage.mimetype || undefined,
    };
  }

  // Text messages
  if (message.conversation || message.extendedTextMessage) {
    return {
      type: 'text',
      emoji: '💬',
      description: 'Text message',
    };
  }

  // Unsupported
  return {
    type: 'text',
    emoji: '❓',
    description: 'Unsupported message',
  };
}

/**
 * Download and save media (supports both local and Supabase Storage)
 */
export async function downloadAndSaveMedia(
  msg: WAMessage,
  sessionId: string
): Promise<MediaInfo> {
  const mediaInfo = detectMediaType(msg);

  // If it's just text, no need to download
  if (mediaInfo.type === 'text') {
    return mediaInfo;
  }

  try {
    // Download media buffer
    const buffer = await downloadMediaMessage(
      msg,
      'buffer',
      {}
    );

    if (!buffer) {
      console.warn('Failed to download media: buffer is empty');
      return mediaInfo;
    }

    // Generate filename
    const timestamp = Date.now();
    const ext = getExtensionFromMimeType(mediaInfo.mimeType || '');
    const fileName = mediaInfo.fileName || `${mediaInfo.type}_${timestamp}${ext}`;
    const sanitizedFileName = fileName.replace(/[^a-z0-9._-]/gi, '_');

    mediaInfo.fileName = sanitizedFileName;
    mediaInfo.fileSize = (buffer as Buffer).length;

    // Save based on storage mode
    if (config.storage.mode === 'supabase') {
      // Save to Supabase Storage
      const storagePath = `${sessionId}/${sanitizedFileName}`;

      const { error } = await supabase.storage
        .from(config.storage.bucket)
        .upload(storagePath, buffer as Buffer, {
          contentType: mediaInfo.mimeType,
          upsert: false,
        });

      if (error) {
        console.error('Error uploading to Supabase Storage:', error);
        throw error;
      }

      mediaInfo.filePath = storagePath; // Store relative path

      console.log(
        `${mediaInfo.emoji} Media uploaded to Supabase Storage: ${storagePath} (${formatBytes(mediaInfo.fileSize)})`
      );
    } else {
      // Save to local filesystem (development mode)
      const mediaDir = join(process.cwd(), 'media', sessionId);
      if (!existsSync(mediaDir)) {
        await mkdir(mediaDir, { recursive: true });
      }

      const filePath = join(mediaDir, sanitizedFileName);
      const relativeFilePath = `media/${sessionId}/${sanitizedFileName}`;

      await writeFile(filePath, buffer as Buffer);

      mediaInfo.filePath = relativeFilePath;

      console.log(
        `${mediaInfo.emoji} Media saved locally: ${relativeFilePath} (${formatBytes(mediaInfo.fileSize)})`
      );
    }

    return mediaInfo;
  } catch (error) {
    console.error('Error downloading media:', error);
    return mediaInfo;
  }
}

/**
 * Get file extension from MIME type
 */
function getExtensionFromMimeType(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/3gpp': '.3gp',
    'audio/ogg': '.ogg',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/amr': '.amr',
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  };

  return map[mimeType] || '';
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}
