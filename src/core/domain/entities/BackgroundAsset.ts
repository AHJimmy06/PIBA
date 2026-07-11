export interface BackgroundAsset {
    id: string;
    name: string;
    storagePath: string;
    width?: number;
    height?: number;
    category: string;
    createdAt: Date;
    createdBy: string;
    publicUrl: string;
}
