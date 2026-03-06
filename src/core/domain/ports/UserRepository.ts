import type { User, Role } from '../entities/User';

export interface UserRepository {
    getById(id: string): Promise<User | null>;
    getByRole(role: Role): Promise<User[]>;
}