import { QueuedMessage } from '../types/index.js';

class MessageQueue {
  private queues: Map<string, QueuedMessage[]> = new Map();
  private processedIds: Set<string> = new Set();

  enqueue(message: QueuedMessage): void {
    const sessionId = message.sessionId || 'default';

    if (this.processedIds.has(message.id)) {
      console.log(`[${sessionId}] Message ${message.id} already processed, skipping`);
      return;
    }

    if (!this.queues.has(sessionId)) {
      this.queues.set(sessionId, []);
    }

    const queue = this.queues.get(sessionId)!;
    const exists = queue.some((m) => m.id === message.id);
    if (exists) {
      console.log(`[${sessionId}] Message ${message.id} already in queue`);
      return;
    }

    queue.push(message);
    console.log(`[${sessionId}] Message ${message.id} added to queue. Queue size: ${queue.length}`);
  }

  dequeue(sessionId: string = 'default'): QueuedMessage | null {
    const queue = this.queues.get(sessionId);
    if (!queue || queue.length === 0) {
      return null;
    }

    const message = queue.shift()!;
    this.processedIds.add(message.id);
    console.log(`[${sessionId}] Message ${message.id} dequeued. Remaining: ${queue.length}`);
    return message;
  }

  size(sessionId: string = 'default'): number {
    return this.queues.get(sessionId)?.length || 0;
  }

  isEmpty(sessionId: string = 'default'): boolean {
    return this.size(sessionId) === 0;
  }

  clear(sessionId: string = 'default'): void {
    this.queues.set(sessionId, []);
    console.log(`[${sessionId}] Queue cleared`);
  }

  clearAllQueues(): void {
    this.queues.clear();
    console.log('All queues cleared');
  }

  clearProcessedIds(): void {
    this.processedIds.clear();
    console.log('Processed IDs cleared');
  }

  getStats(sessionId?: string) {
    if (sessionId) {
      return {
        queueSize: this.size(sessionId),
        processedCount: this.processedIds.size,
      };
    }

    // Return stats for all sessions
    const stats: Record<string, any> = {};
    for (const [sid, queue] of this.queues.entries()) {
      stats[sid] = {
        queueSize: queue.length,
      };
    }
    stats.totalProcessed = this.processedIds.size;
    return stats;
  }
}

export const messageQueue = new MessageQueue();

export function enqueue(message: QueuedMessage): void {
  messageQueue.enqueue(message);
}

export function dequeue(sessionId: string = 'default'): QueuedMessage | null {
  return messageQueue.dequeue(sessionId);
}

export function getQueueSize(sessionId: string = 'default'): number {
  return messageQueue.size(sessionId);
}

export function isQueueEmpty(sessionId: string = 'default'): boolean {
  return messageQueue.isEmpty(sessionId);
}

export function getQueueStats(sessionId?: string) {
  return messageQueue.getStats(sessionId);
}
