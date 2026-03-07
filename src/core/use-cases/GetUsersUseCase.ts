import type { User } from "../domain/entities/User";
import type { UserRepository } from "../domain/ports/UserRepository";

export class GetUsersUseCase {
  private userRepository: UserRepository;

  constructor(userRepository: UserRepository) {
    this.userRepository = userRepository;
  }

  async execute(): Promise<User[]> {
    return this.userRepository.getByRole('GENERAL');
  }
}
