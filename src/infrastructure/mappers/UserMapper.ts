import type { User, Role } from "../../core/domain/entities/User";

export interface UserRow {
  id: string;
  first_name: string;
  last_name: string;
  role: Role;
  default_instrument: string | null;
}

export class UserMapper {
  static toDomain(raw: UserRow): User {
    return {
      id: raw.id,
      firstName: raw.first_name,
      lastName: raw.last_name,
      role: raw.role,
      defaultInstrument: raw.default_instrument ?? undefined,
    };
  }

  static toPersistence(user: User): UserRow {
    return {
      id: user.id,
      first_name: user.firstName,
      last_name: user.lastName,
      role: user.role,
      default_instrument: user.defaultInstrument ?? null,
    };
  }
}
