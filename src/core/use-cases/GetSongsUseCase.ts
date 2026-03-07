import type { Song } from "../domain/entities/Song";
import type { SongRepository } from "../domain/ports/SongRepository";

export class GetSongsUseCase {
  private songRepository: SongRepository;

  constructor(songRepository: SongRepository) {
    this.songRepository = songRepository;
  }

  async execute(): Promise<Song[]> {
    return this.songRepository.getAll();
  }
}
