import type { BackgroundRepository } from "../domain/ports/BackgroundRepository";

export class DeleteBackgroundUseCase {
  private backgroundRepository: BackgroundRepository;

  constructor(backgroundRepository: BackgroundRepository) {
    this.backgroundRepository = backgroundRepository;
  }

  async execute(id: string, storagePath: string): Promise<void> {
    await this.backgroundRepository.delete(id, storagePath);
  }
}
