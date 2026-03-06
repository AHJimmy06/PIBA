import type { User } from './User';
import type { Song } from './Song';

export type RehearsalStatus = 'PENDING' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED';

// Define los acordes adaptados por un instrumento específico
export interface RehearsalSongChord {
    instrument: string; // Ej: 'Guitarra', 'Bajo'
    customChords: string;
}

// Define una canción dentro del contexto de un repaso
export interface RehearsalSong {
    songId: string;
    songDetails?: Song;
    adjustedChords: RehearsalSongChord[];
}

// La entidad principal (Aggregate Root)
export interface Rehearsal {
    id: string;
    date: Date;
    status: RehearsalStatus;
    leaderId: string;
    assignedUsers: User[];
    songs: RehearsalSong[];
}