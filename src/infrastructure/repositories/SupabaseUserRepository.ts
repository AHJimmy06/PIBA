import type { UserRepository } from "../../core/domain/ports/UserRepository";
import type { User, Role } from "../../core/domain/entities/User";
import { sessionApi } from '../api/SessionApi';

export class SupabaseUserRepository implements UserRepository {
  private readonly sessionApi = sessionApi;

  async getById(id: string): Promise<User | null> {
    return (await this.sessionApi.users()).find((user) => user.id === id) ?? null;
  }

  async login(accessCode: string): Promise<User> {
    return (await this.sessionApi.login(accessCode)).user;
  }

  async getByRole(role: Role): Promise<User[]> {
    return (await this.sessionApi.users()).filter((user) => user.role === role);
  }

  async update(user: User): Promise<User> {
    return this.sessionApi.updateProfile(user);
  }

  async create(user: Omit<User, 'id' | 'accessCode'>, operationId: string): Promise<User> {
    return this.sessionApi.createUser(user, operationId);
  }
}
