import type { Song } from "../../core/domain/entities/Song";

export interface SongRow {
  id: string;
  title: string;
  author: string;
  lyrics: string;
  base_chords: string;
}

export class SongMapper {
  static toDomain(raw: SongRow): Song {
    return {
      id: raw.id,
      title: raw.title,
      author: raw.author || "Desconocido",
      lyrics: raw.lyrics,
      baseChords: raw.base_chords,
    };
  }

  static toPersistence(song: Song): SongRow {
    return {
      id: song.id,
      title: song.title,
      author: song.author,
      lyrics: song.lyrics,
      base_chords: song.baseChords,
    };
  }
}
