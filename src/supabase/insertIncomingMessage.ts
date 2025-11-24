import { supabase } from './client.js';
import { IncomingMessage } from '../types/index.js';

export async function insertIncomingMessage(message: IncomingMessage): Promise<any> {
  try {
    // Determine status based on whether the message is from us
    const isFromMe = message.metadata?.fromMe || false;
    const status = isFromMe ? 'SENT' : 'RECEIVED';

    const { data, error } = await supabase
      .from('messages')
      .insert({
        jid: message.jid,
        phone_number: message.phone_number,
        message: message.message,
        platform: message.platform,
        session_id: message.session_id,
        status: status,
        created_at: message.received_at,
        metadata: message.metadata,
      })
      .select()
      .single();

    if (error) {
      console.error('Error inserting message:', error);
      throw error;
    }

    const identifier = message.phone_number || message.jid;
    const direction = isFromMe ? 'sent to' : 'received from';
    console.log(`✅ Message ${direction} ${identifier} saved to database (ID: ${data?.id})`);

    // Return the inserted message with database ID
    return data;
  } catch (error) {
    console.error('Failed to insert message:', error);
    throw error;
  }
}
