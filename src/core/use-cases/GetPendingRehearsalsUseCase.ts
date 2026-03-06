import type { RehearsalRepository } from "../domain/ports/RehearsalRepository";
import type { Rehearsal } from "../domain/entities/Rehearsal";

export class GetPendingRehearsalsUseCase {
  // 1. Declaramos la propiedad privada
  private rehearsalRepository: RehearsalRepository;

  // 2. Recibimos el parámetro sin la palabra "private"
  constructor(rehearsalRepository: RehearsalRepository) {
    // 3. Asignamos el valor
    this.rehearsalRepository = rehearsalRepository;
  }

  async execute(userId: string): Promise<Rehearsal[]> {
    if (!userId) {
      throw new Error("El ID del usuario es requerido.");
    }

    // El repositorio ya debería filtrar por status = 'PENDING' internamente
    return await this.rehearsalRepository.getPendingForUser(userId);
  }
}