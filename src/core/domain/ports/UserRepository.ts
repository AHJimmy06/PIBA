import type { User, Role } from '../entities/User';

export interface UserRepository {
    getById(id: string): Promise<User | null>;
    login(accessCode: string): Promise<User>;
    getByRole(role: Role): Promise<User[]>;
    update(user: User): Promise<User>;
    create(user: Omit<User, 'id' | 'accessCode'>, operationId: string): Promise<User>;
}
