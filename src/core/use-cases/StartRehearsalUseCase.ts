import type { RehearsalRepository } from "../domain/ports/RehearsalRepository";
import type { UserRepository } from "../domain/ports/UserRepository";

export class StartRehearsalUseCase {
  private rehearsalRepository: RehearsalRepository;
  private userRepository: UserRepository;

  constructor(
    rehearsalRepository: RehearsalRepository,
    userRepository: UserRepository,
  ) {
    this.rehearsalRepository = rehearsalRepository;
    this.userRepository = userRepository;
  }

  async execute(rehearsalId: string, userId: string): Promise<void> {
    const user = await this.userRepository.getById(userId);

    if (!user) {
      throw new Error("Usuario no encontrado.");
    }

    if (user.role !== "LIDER_REPASO") {
      throw new Error(
        "Permiso denegado: Solo el líder puede iniciar el repaso.",
      );
    }

    const rehearsal = await this.rehearsalRepository.getById(rehearsalId);

    if (!rehearsal) {
      throw new Error("El repaso no existe.");
    }

    await this.rehearsalRepository.updateStatus(rehearsalId, "IN_PROGRESS");
  }
}
