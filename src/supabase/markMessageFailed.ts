import { supabase } from './client.js';

export async function markMessageFailed(messageId: string, errorMessage: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('messages')
      .update({
        status: 'FAILED',
        error_message: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq('id', messageId);

    if (error) {
      console.error(`Error marking message ${messageId} as FAILED:`, error);
      throw error;
    }

    console.log(`Message ${messageId} marked as FAILED: ${errorMessage}`);
  } catch (error) {
    console.error(`Failed to mark message ${messageId} as FAILED:`, error);
    throw error;
  }
}
