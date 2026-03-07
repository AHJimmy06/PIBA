import type { RehearsalRepository } from "../domain/ports/RehearsalRepository";

export class UpdateCustomChordsUseCase {
  private rehearsalRepository: RehearsalRepository;

  constructor(rehearsalRepository: RehearsalRepository) {
    this.rehearsalRepository = rehearsalRepository;
  }

  async execute(
    rehearsalId: string,
    songId: string,
    instrument: string,
    newChords: string,
  ): Promise<void> {
    if (!newChords.trim()) {
      throw new Error("Los acordes no pueden estar vacíos.");
    }

    await this.rehearsalRepository.saveCustomChords(
      rehearsalId,
      songId,
      instrument,
      newChords,
    );
  }
}
