import { supabase } from './client.js';
import { Message } from '../types/index.js';

export async function getQueuedMessages(sessionId: string = 'default'): Promise<Message[]> {
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('status', 'QUEUED')
      .eq('platform', 'WHATSAPP')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) {
      console.error('Error fetching queued messages:', error);
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('Failed to get queued messages:', error);
    return [];
  }
}
