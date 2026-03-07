export interface SyncService {
    publish<T>(channel: string, message: T): void;
    subscribe<T>(channel: string, callback: (message: T) => void): () => void;
}
