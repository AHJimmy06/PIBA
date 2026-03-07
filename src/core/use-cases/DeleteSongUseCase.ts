import type { SongRepository } from "../domain/ports/SongRepository";

export class DeleteSongUseCase {
  private songRepository: SongRepository;

  constructor(songRepository: SongRepository) {
    this.songRepository = songRepository;
  }

  async execute(songId: string): Promise<void> {
    if (!songId) throw new Error("El ID de la canción es requerido.");
    
    // Aquí se podrían añadir validaciones de negocio adicionales
    await this.songRepository.delete(songId);
  }
}
