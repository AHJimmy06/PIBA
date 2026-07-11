import type { BackgroundAsset } from "../entities/BackgroundAsset";

export interface BackgroundRepository {
    upload(file: File, name: string, userId: string): Promise<BackgroundAsset>;
    getAll(): Promise<BackgroundAsset[]>;
    delete(id: string, storagePath: string): Promise<void>;
}
