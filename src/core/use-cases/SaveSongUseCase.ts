import type { Song } from "../domain/entities/Song";
import type { SongRepository } from "../domain/ports/SongRepository";

export class SaveSongUseCase {
  private songRepository: SongRepository;

  constructor(songRepository: SongRepository) {
    this.songRepository = songRepository;
  }

  /**
   * Ejecuta el guardado de una canción. 
   * Si incluye id, se actualiza la existente.
   */
  async execute(song: Song | Omit<Song, 'id'>): Promise<Song> {
    if (!song.title.trim()) throw new Error("El título de la canción es obligatorio.");
    if (!song.author.trim()) throw new Error("El autor de la canción es obligatorio.");
    if (!song.lyrics.trim()) throw new Error("La letra de la canción es obligatoria.");
    if (!song.baseChords.trim()) throw new Error("Los acordes base son obligatorios.");
    
    return this.songRepository.save(song);
  }
}
