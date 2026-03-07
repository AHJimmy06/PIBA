import { supabase } from "../api/supabaseClient";
import type { UserRepository } from "../../core/domain/ports/UserRepository";
import type { User, Role } from "../../core/domain/entities/User";
import { UserMapper, type UserRow } from "../mappers/UserMapper";

export class SupabaseUserRepository implements UserRepository {
  private readonly TABLE_NAME = "users";

  async getById(id: string): Promise<User | null> {
    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) return null;

    return UserMapper.toDomain(data as UserRow);
  }

  async getByRole(role: Role): Promise<User[]> {
    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .select("*")
      .eq("role", role);

    if (error || !data) return [];

    return data.map((row) => UserMapper.toDomain(row as UserRow));
  }

  async update(user: User): Promise<User> {
    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .upsert(UserMapper.toPersistence(user))
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Error al actualizar el usuario: ${error?.message}`);
    }

    return UserMapper.toDomain(data as UserRow);
  }
}
