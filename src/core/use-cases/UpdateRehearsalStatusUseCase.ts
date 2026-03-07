import type { RehearsalRepository } from "../domain/ports/RehearsalRepository";
import type { UserRepository } from "../domain/ports/UserRepository";
import type { RehearsalStatus } from "../domain/entities/Rehearsal";

export class UpdateRehearsalStatusUseCase {
  private rehearsalRepository: RehearsalRepository;
  private userRepository: UserRepository;

  constructor(rehearsalRepository: RehearsalRepository, userRepository: UserRepository) {
    this.rehearsalRepository = rehearsalRepository;
    this.userRepository = userRepository;
  }

  async execute(rehearsalId: string, userId: string, newStatus: RehearsalStatus): Promise<void> {
    const user = await this.userRepository.getById(userId);
    if (!user || user.role !== 'LIDER_REPASO') {
      throw new Error("Permiso denegado: Solo el líder puede cambiar el estado del ensayo.");
    }

    await this.rehearsalRepository.updateStatus(rehearsalId, newStatus);
  }
}
