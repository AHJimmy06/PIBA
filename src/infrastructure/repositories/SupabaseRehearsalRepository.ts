import { supabase } from "../api/supabaseClient";
import type { RehearsalRepository } from "../../core/domain/ports/RehearsalRepository";
import type { Rehearsal, RehearsalStatus } from "../../core/domain/entities/Rehearsal";
import { RehearsalMapper, type RehearsalRow } from "../mappers/RehearsalMapper";

export class SupabaseRehearsalRepository implements RehearsalRepository {
  private readonly TABLE_NAME = "rehearsals";

  /**
   * Obtiene un repaso completo con todas sus relaciones (usuarios, canciones y acordes adaptados).
   */
  async getById(id: string): Promise<Rehearsal | null> {
    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .select(`
        *,
        rehearsal_users (
          users (*)
        ),
        rehearsal_songs (
          song_id,
          songs (*),
          rehearsal_song_chords (*)
        )
      `)
      .eq("id", id)
      .single();

    if (error || !data) return null;

    return RehearsalMapper.toDomain(data as RehearsalRow);
  }

  /**
   * Crea un nuevo ensayo y sus relaciones iniciales de forma ATÓMICA usando RPC.
   */
  async create(rehearsal: Omit<Rehearsal, "id">): Promise<Rehearsal> {
    const { data: rehearsalId, error } = await supabase.rpc('create_rehearsal_with_details', {
      p_date: rehearsal.date.toISOString(),
      p_status: rehearsal.status,
      p_leader_id: rehearsal.leaderId,
      p_user_ids: rehearsal.assignedUsers.map(u => u.id),
      p_song_ids: rehearsal.songs.map(s => s.songId)
    });

    if (error || !rehearsalId) {
      throw new Error(`Error transaccional al crear el ensayo: ${error?.message}`);
    }

    // Devolvemos el objeto reconstruido desde la DB para asegurar integridad
    const fullRehearsal = await this.getById(rehearsalId);
    if (!fullRehearsal) throw new Error("No se pudo recuperar el ensayo recién creado.");
    
    return fullRehearsal;
  }

  async update(rehearsal: Rehearsal): Promise<Rehearsal> {
    const { error } = await supabase.rpc('update_rehearsal_with_details', {
      p_rehearsal_id: rehearsal.id,
      p_date: rehearsal.date.toISOString(),
      p_user_ids: rehearsal.assignedUsers.map(u => u.id),
      p_song_ids: rehearsal.songs.map(s => s.songId)
    });

    if (error) {
      throw new Error(`Error transaccional al actualizar el ensayo: ${error.message}`);
    }

    const updated = await this.getById(rehearsal.id);
    if (!updated) throw new Error("No se pudo recuperar el ensayo actualizado.");
    
    return updated;
  }

  async getPendingForUser(userId: string): Promise<Rehearsal[]> {
    // 1. Ensayos que LIDERAS
    const ledPromise = supabase
      .from(this.TABLE_NAME)
      .select(`
        *,
        rehearsal_users (
          user_id,
          users (*)
        ),
        rehearsal_songs (
          song_id,
          songs (*),
          rehearsal_song_chords (*)
        )
      `)
      .eq("leader_id", userId)
      .neq("status", "COMPLETED");

    // 2. Ensayos donde eres INTEGRANTE
    const memberPromise = supabase
      .from(this.TABLE_NAME)
      .select(`
        *,
        rehearsal_users!inner (
          user_id,
          users (*)
        ),
        rehearsal_songs (
          song_id,
          songs (*),
          rehearsal_song_chords (*)
        )
      `)
      .eq("rehearsal_users.user_id", userId)
      .neq("status", "COMPLETED");

    const [ledRes, memberRes] = await Promise.all([ledPromise, memberPromise]);

    const allData = [...(ledRes.data || []), ...(memberRes.data || [])];
    
    // Eliminar duplicados (si eres líder e integrante al mismo tiempo)
    const uniqueData = Array.from(new Map(allData.map(item => [item.id, item])).values());
    
    // Ordenar por fecha
    uniqueData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return uniqueData.map((row) => RehearsalMapper.toDomain(row as RehearsalRow));
  }

  async updateStatus(id: string, status: RehearsalStatus): Promise<void> {
    const { error } = await supabase
      .from(this.TABLE_NAME)
      .update({ status })
      .eq("id", id);

    if (error) {
      throw new Error(`Error al actualizar el estado del ensayo: ${error.message}`);
    }
  }

  async saveCustomChords(rehearsalId: string, songId: string, instrument: string, chords: string): Promise<void> {
    const { error } = await supabase
      .from("rehearsal_song_chords")
      .upsert({
        rehearsal_id: rehearsalId,
        song_id: songId,
        instrument: instrument,
        custom_chords: chords,
      }, { 
        onConflict: 'rehearsal_id,song_id,instrument' 
      });

    if (error) {
      throw new Error(`Error al guardar los acordes personalizados: ${error.message}`);
    }
  }

  async delete(id: string): Promise<void> {
    const { error } = await supabase
      .from(this.TABLE_NAME)
      .delete()
      .eq("id", id);

    if (error) {
      throw new Error(`Error al eliminar el ensayo: ${error.message}`);
    }
  }

  async setBackground(rehearsalId: string, backgroundId: string | null): Promise<void> {
    const { error } = await supabase
      .from(this.TABLE_NAME)
      .update({ background_id: backgroundId })
      .eq("id", rehearsalId);

    if (error) {
      throw new Error(`Error al asignar el fondo: ${error.message}`);
    }
  }
}
