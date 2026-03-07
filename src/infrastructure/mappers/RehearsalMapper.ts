import type { Rehearsal, RehearsalStatus, RehearsalSong } from "../../core/domain/entities/Rehearsal";
import { UserMapper, type UserRow } from "./UserMapper";
import { SongMapper, type SongRow } from "./SongMapper";

export interface RehearsalSongChordRow {
  instrument: string;
  custom_chords: string;
}

export interface RehearsalSongRow {
  song_id: string;
  songs?: SongRow;
  rehearsal_song_chords?: RehearsalSongChordRow[];
}

export interface RehearsalUserRow {
  users: UserRow;
}

export interface RehearsalRow {
  id: string;
  date: string;
  status: string;
  leader_id: string;
  rehearsal_users?: RehearsalUserRow[];
  rehearsal_songs?: RehearsalSongRow[];
}

export class RehearsalMapper {
  static toDomain(raw: RehearsalRow): Rehearsal {
    const assignedUsers = Array.isArray(raw.rehearsal_users) 
      ? raw.rehearsal_users.map((ru) => UserMapper.toDomain(ru.users))
      : [];

    const songs: RehearsalSong[] = Array.isArray(raw.rehearsal_songs)
      ? raw.rehearsal_songs.map((rs) => ({
          songId: rs.song_id,
          songDetails: rs.songs ? SongMapper.toDomain(rs.songs) : undefined,
          adjustedChords: Array.isArray(rs.rehearsal_song_chords)
            ? rs.rehearsal_song_chords.map((rc) => ({
                instrument: rc.instrument,
                customChords: rc.custom_chords,
              }))
            : [],
        }))
      : [];

    return {
      id: raw.id,
      date: new Date(raw.date),
      status: (raw.status as RehearsalStatus) || "PENDING",
      leaderId: raw.leader_id,
      assignedUsers,
      songs,
    };
  }
}
