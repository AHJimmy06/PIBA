import type { User, Role } from '../entities/User';

export interface UserRepository {
    getById(id: string): Promise<User | null>;
    getByAccessCode(accessCode: string): Promise<User | null>;
    getByRole(role: Role): Promise<User[]>;
    update(user: User): Promise<User>;
    create(user: Omit<User, 'id' | 'accessCode'>): Promise<User>;
}