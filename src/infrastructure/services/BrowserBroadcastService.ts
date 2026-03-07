import type { SyncService } from "../../core/domain/ports/SyncService";

/**
 * Implementación de sincronización usando Broadcast Channel API (Nativo de Chromium).
 */
export class BrowserBroadcastService implements SyncService {
  private channels: Map<string, BroadcastChannel> = new Map();

  publish<T>(channelName: string, message: T): void {
    const channel = this.getOrCreateChannel(channelName);
    channel.postMessage(message);
  }

  subscribe<T>(channelName: string, callback: (message: T) => void): () => void {
    const channel = this.getOrCreateChannel(channelName);
    
    const handler = (event: MessageEvent) => {
      callback(event.data as T);
    };

    channel.addEventListener('message', handler);

    // Retornamos función de limpieza (unsubscribe)
    return () => {
      channel.removeEventListener('message', handler);
    };
  }

  private getOrCreateChannel(name: string): BroadcastChannel {
    if (!this.channels.has(name)) {
      this.channels.set(name, new BroadcastChannel(name));
    }
    return this.channels.get(name)!;
  }
}
