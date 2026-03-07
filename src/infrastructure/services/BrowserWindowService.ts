import type { WindowService } from "../../core/domain/ports/WindowService";

// 1. Definimos la estructura real que devuelve la Window Management API
interface ScreenDetailed {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
}

interface ScreenDetails {
  screens: ScreenDetailed[];
  currentScreen: ScreenDetailed;
}

// 2. Le enseñamos a TypeScript que Window devuelve esas estructuras, no un "any"
declare global {
  interface Window {
    getScreenDetails?: () => Promise<ScreenDetails>;
    getScreens?: () => Promise<ScreenDetailed[]>; // (Solo si aún lo usas como fallback)
  }
}

export class BrowserWindowService implements WindowService {
  async isMultiScreenAvailable(): Promise<boolean> {
    if (!('getScreenDetails' in window) && !('getScreens' in window)) return false;
    
    try {
      const permission = await navigator.permissions.query({ 
        name: 'window-management' as unknown as PermissionName 
      });
      return permission.state === 'granted';
    } catch {
      return false;
    }
  }

  async openFullscreenWindow(url: string, windowName: string): Promise<void> {
    if (window.getScreenDetails) {
      try {
        const screenDetails = await window.getScreenDetails();
        
        // 3. Ahora TypeScript sabe exactamente qué es 's', así que ya no nos da error
        const secondaryScreen = screenDetails.screens.find(
          (s: ScreenDetailed) => s !== screenDetails.currentScreen
        );

        if (secondaryScreen) {
          const features = `left=${secondaryScreen.availLeft},top=${secondaryScreen.availTop},width=${secondaryScreen.availWidth},height=${secondaryScreen.availHeight},fullscreen=yes`;
          window.open(url, windowName, features);
          return;
        }
      } catch (e) {
        console.warn("Error accediendo a Screen Details API:", e);
      }
    }

    // Fallback: Abrir en ventana normal si falla lo anterior
    window.open(url, windowName, 'width=800,height=600');
  }
}