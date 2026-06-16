import type { BackgroundRepository } from "../domain/ports/BackgroundRepository";
import type { BackgroundAsset } from "../domain/entities/BackgroundAsset";

export class UploadBackgroundUseCase {
  private backgroundRepository: BackgroundRepository;

  constructor(backgroundRepository: BackgroundRepository) {
    this.backgroundRepository = backgroundRepository;
  }

  async execute(file: File, name: string, userId: string): Promise<BackgroundAsset> {
    if (!file.type.startsWith('image/')) {
      throw new Error("El archivo seleccionado no es una imagen válida.");
    }

    if (file.size > 5 * 1024 * 1024) { // 5MB limit
      throw new Error("La imagen es demasiado grande. El límite es de 5MB.");
    }

    return await this.backgroundRepository.upload(file, name, userId);
  }
}
