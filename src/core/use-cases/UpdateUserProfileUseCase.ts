import type { User } from "../domain/entities/User";
import type { UserRepository } from "../domain/ports/UserRepository";

export class UpdateUserProfileUseCase {
  private userRepository: UserRepository;

  constructor(userRepository: UserRepository) {
    this.userRepository = userRepository;
  }

  async execute(user: User): Promise<User> {
    if (!user.firstName.trim() || !user.lastName.trim()) {
      throw new Error("El nombre y el apellido no pueden estar vacíos.");
    }

    return await this.userRepository.update(user);
  }
}
