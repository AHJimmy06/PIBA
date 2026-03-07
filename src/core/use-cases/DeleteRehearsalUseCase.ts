import type { RehearsalRepository } from "../domain/ports/RehearsalRepository";

export class DeleteRehearsalUseCase {
  private rehearsalRepository: RehearsalRepository;

  constructor(rehearsalRepository: RehearsalRepository) {
    this.rehearsalRepository = rehearsalRepository;
  }

  async execute(rehearsalId: string, userId: string): Promise<void> {
    const rehearsal = await this.rehearsalRepository.getById(rehearsalId);
    
    if (!rehearsal) throw new Error("El ensayo no existe.");
    
    if (rehearsal.leaderId !== userId) {
      throw new Error("Permiso denegado: Solo el líder del ensayo puede eliminarlo.");
    }

    await this.rehearsalRepository.delete(rehearsalId);
  }
}
