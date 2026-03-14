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

  async getByAccessCode(accessCode: string): Promise<User | null> {
    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .select("*")
      .eq("access_code", accessCode)
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

  async create(user: Omit<User, 'id' | 'accessCode'>): Promise<User> {
    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .insert({
        first_name: user.firstName,
        last_name: user.lastName,
        role: user.role,
        default_instrument: user.defaultInstrument,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Error al crear el usuario: ${error?.message}`);
    }

    return UserMapper.toDomain(data as UserRow);
  }
}
