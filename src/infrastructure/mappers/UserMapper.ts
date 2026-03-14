import type { User, Role } from "../../core/domain/entities/User";

export interface UserRow {
  id: string;
  first_name: string;
  last_name: string;
  role: string;
  default_instrument?: string;
  access_code?: string;
}

export class UserMapper {
  static toDomain(raw: UserRow): User {
    return {
      id: raw.id,
      firstName: raw.first_name || "",
      lastName: raw.last_name || "",
      role: (raw.role as Role) || "GENERAL",
      defaultInstrument: raw.default_instrument,
      accessCode: raw.access_code,
    };
  }

  static toPersistence(user: User): UserRow {
    return {
      id: user.id,
      first_name: user.firstName,
      last_name: user.lastName,
      role: user.role,
      default_instrument: user.defaultInstrument,
      access_code: user.accessCode,
    };
  }
}
