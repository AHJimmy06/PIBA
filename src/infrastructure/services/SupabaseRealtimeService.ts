import { supabase } from "../api/supabaseClient";
import type { SyncService } from "../../core/domain/ports/SyncService";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Implementación de sincronización GLOBAL optimizada usando Supabase Realtime.
 */
export class SupabaseRealtimeService implements SyncService {
  private activeChannels: Map<string, RealtimeChannel> = new Map();

  private getOrCreateChannel(channelName: string): RealtimeChannel {
    if (this.activeChannels.has(channelName)) {
      return this.activeChannels.get(channelName)!;
    }

    const channel = supabase.channel(channelName, {
      config: {
        broadcast: { self: false },
      },
    });

    channel.subscribe();
    this.activeChannels.set(channelName, channel);
    return channel;
  }

  publish<T>(channelName: string, message: T): void {
    const channel = this.getOrCreateChannel(channelName);
    channel.send({
      type: 'broadcast',
      event: 'sync',
      payload: message,
    });
  }

  subscribe<T>(channelName: string, callback: (message: T) => void): () => void {
    const channel = this.getOrCreateChannel(channelName);

    channel.on('broadcast', { event: 'sync' }, (payload) => {
      callback(payload.payload as T);
    });

    return () => {};
  }
}
