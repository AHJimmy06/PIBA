import type { Song } from "../domain/entities/Song";
import type { SongRepository } from "../domain/ports/SongRepository";

export class GetSongByIdUseCase {
  private songRepository: SongRepository;

  constructor(songRepository: SongRepository) {
    this.songRepository = songRepository;
  }

  async execute(id: string): Promise<Song | null> {
    if (!id) throw new Error("Se requiere un ID de canción válido.");
    
    // Aquí podrías meter lógica extra en el futuro:
    // - Logging de quién vió la canción
    // - Transformaciones de datos
    // - Cache
    
    return this.songRepository.getById(id);
  }
}
