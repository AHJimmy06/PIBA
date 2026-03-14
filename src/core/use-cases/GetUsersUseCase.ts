import type { User } from "../domain/entities/User";
import type { UserRepository } from "../domain/ports/UserRepository";

export class GetUsersUseCase {
  private userRepository: UserRepository;

  constructor(userRepository: UserRepository) {
    this.userRepository = userRepository;
  }

  async execute(): Promise<User[]> {
    const generalUsers = await this.userRepository.getByRole('GENERAL');
    const leaderUsers = await this.userRepository.getByRole('LIDER_REPASO');
    return [...leaderUsers, ...generalUsers];
  }
}
