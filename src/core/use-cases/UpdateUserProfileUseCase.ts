import type { User } from "../domain/entities/User";
import type { UserRepository } from "../domain/ports/UserRepository";

export class UpdateUserProfileUseCase {
  private userRepository: UserRepository;

  constructor(userRepository: UserRepository) {
    this.userRepository = userRepository;
  }

  async execute(user: User): Promise<User> {
    if (!user.name.trim()) {
      throw new Error("El nombre no puede estar vacío.");
    }

    return await this.userRepository.update(user);
  }
}
