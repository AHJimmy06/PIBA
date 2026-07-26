import { supabase } from "../api/supabaseClient";
import type { SongRepository } from "../../core/domain/ports/SongRepository";
import type { Song } from "../../core/domain/entities/Song";
import { SongMapper, type SongRow } from "../mappers/SongMapper";

export class SupabaseSongRepository implements SongRepository {
  private readonly TABLE_NAME = "songs";

  async getAll(): Promise<Song[]> {
    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .select("*")
      .order("title", { ascending: true });

    if (error || !data) return [];

    return data.map((row) => SongMapper.toDomain(row as SongRow));
  }

  async getById(id: string): Promise<Song | null> {
    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) return null;

    return SongMapper.toDomain(data as SongRow);
  }

  /**
   * Guarda una canción (Crea si no tiene ID, Actualiza si lo tiene).
   */
  async save(song: Song | Omit<Song, "id">): Promise<Song> {
    const persistenceData: Omit<SongRow, "id"> & { id?: string } = {
      title: song.title,
      author: song.author,
      lyrics: song.lyrics,
      base_chords: song.baseChords, // Corregido: base_chords (un solo guión bajo)
    };

    // Si viene con ID, es una actualización
    if ('id' in song) {
      persistenceData.id = song.id;
    }

    const { data, error } = await supabase
      .from(this.TABLE_NAME)
      .upsert(persistenceData)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Error al guardar la canción: ${error?.message}`);
    }

    return SongMapper.toDomain(data as SongRow);
  }

  async delete(id: string): Promise<void> {
    const { error } = await supabase
      .from(this.TABLE_NAME)
      .delete()
      .eq("id", id);

    if (error) {
      throw new Error(`Error al eliminar la canción: ${error.message}`);
    }
  }
}
