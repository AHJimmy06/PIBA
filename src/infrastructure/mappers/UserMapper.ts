import type { User, Role } from "../../core/domain/entities/User";

export interface UserRow {
  id: string;
  name?: string;
  full_name?: string;
  role: string;
  default_instrument?: string;
}

export class UserMapper {
  static toDomain(raw: UserRow): User {
    return {
      id: raw.id,
      name: raw.name || raw.full_name || "",
      role: (raw.role as Role) || "GENERAL",
      defaultInstrument: raw.default_instrument,
    };
  }

  static toPersistence(user: User): UserRow {
    return {
      id: user.id,
      name: user.name,
      role: user.role,
      default_instrument: user.defaultInstrument,
    };
  }
}
