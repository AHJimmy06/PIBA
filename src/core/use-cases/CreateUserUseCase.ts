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
  }): Promise<User> {
    if (!userData.firstName.trim() || !userData.lastName.trim()) {
      throw new Error("El nombre y el apellido son obligatorios.");
    }

    return await this.userRepository.create(userData);
  }
}
