import type { RehearsalRepository } from "../domain/ports/RehearsalRepository";
import type { UserRepository } from "../domain/ports/UserRepository";

export class StartRehearsalUseCase {
  // 1. Declaramos las propiedades privadas aquí arriba (esto sí se borra al compilar)
  private rehearsalRepository: RehearsalRepository;
  private userRepository: UserRepository;

  // 2. Quitamos la palabra "private" de los parámetros del constructor
  constructor(
    rehearsalRepository: RehearsalRepository,
    userRepository: UserRepository,
  ) {
    // 3. Hacemos la asignación manual
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
