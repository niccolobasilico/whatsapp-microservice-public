import { supabase } from './client.js';

export async function markMessageSent(messageId: string, sentJid?: string): Promise<void> {
  try {
    const updateData: any = {
      status: 'SENT',
      updated_at: new Date().toISOString(),
    };

    // Store the actual JID used for sending if provided
    if (sentJid) {
      updateData.jid = sentJid;
    }

    const { error } = await supabase
      .from('messages')
      .update(updateData)
      .eq('id', messageId);

    if (error) {
      console.error(`Error marking message ${messageId} as SENT:`, error);
      throw error;
    }

    console.log(`Message ${messageId} marked as SENT`);
  } catch (error) {
    console.error(`Failed to mark message ${messageId} as SENT:`, error);
    throw error;
  }
}
