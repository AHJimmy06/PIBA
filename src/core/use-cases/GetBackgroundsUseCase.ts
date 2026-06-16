import type { BackgroundRepository } from "../domain/ports/BackgroundRepository";
import type { BackgroundAsset } from "../domain/entities/BackgroundAsset";

export class GetBackgroundsUseCase {
  private backgroundRepository: BackgroundRepository;

  constructor(backgroundRepository: BackgroundRepository) {
    this.backgroundRepository = backgroundRepository;
  }

  async execute(): Promise<BackgroundAsset[]> {
    return await this.backgroundRepository.getAll();
  }
}
