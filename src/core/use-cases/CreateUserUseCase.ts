import type { User, Role } from "../domain/entities/User";
import type { UserRepository } from "../domain/ports/UserRepository";

export class CreateUserUseCase {
  private userRepository: UserRepository;

  constructor(userRepository: UserRepository) {
    this.userRepository = userRepository;
  }

  async execute(userData: {
    firstName: string;
    lastName: string;
    role: Role;
    defaultInstrument?: string;
  }, operationId: string): Promise<User> {
    if (!userData.firstName.trim() || !userData.lastName.trim()) {
      throw new Error("El nombre y el apellido son obligatorios.");
    }

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
      throw new Error("Invalid create-user operation ID.");
    }

    return await this.userRepository.create(userData, operationId);
  }
}
