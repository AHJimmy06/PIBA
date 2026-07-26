import type { SyncService } from "../../core/domain/ports/SyncService";

/**
 * Realtime is intentionally unavailable in the limited session-staging client.
 * Public Broadcast cannot provide server-enforced rehearsal authorization.
 */
export class SupabaseRealtimeService implements SyncService {
  readonly available = false;

  publish<T>(channelName: string, message: T): void {
    void channelName;
    void message;
    // Fail closed: do not construct a channel or send anonymous Broadcast traffic.
  }

  subscribe<T>(channelName: string, callback: (message: T) => void): () => void {
    void channelName;
    void callback;
    // No state or async teardown means cleanup and immediate resubscribe are race-free.
    return () => undefined;
  }
}
