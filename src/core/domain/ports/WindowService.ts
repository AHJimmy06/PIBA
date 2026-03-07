export interface WindowService {
    openFullscreenWindow(url: string, windowName: string): Promise<void>;
    isMultiScreenAvailable(): Promise<boolean>;
}
