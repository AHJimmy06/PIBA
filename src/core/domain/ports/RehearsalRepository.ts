import type { Rehearsal, RehearsalStatus } from '../entities/Rehearsal';

export interface RehearsalRepository {
    // Crea un nuevo repaso (asignando fecha, líder, usuarios y canciones)
    create(rehearsal: Omit<Rehearsal, 'id'>): Promise<Rehearsal>;

    // Actualiza un repaso existente (fecha, usuarios y canciones)
    update(rehearsal: Rehearsal): Promise<Rehearsal>;

    // Busca un repaso específico por su ID
    getById(id: string): Promise<Rehearsal | null>;

    // Lista los repasos asignados a un usuario que todavía no suceden
    getPendingForUser(userId: string): Promise<Rehearsal[]>;

    // Permite al líder cambiar el estado (ej. de PENDING a IN_PROGRESS)
    updateStatus(id: string, status: RehearsalStatus): Promise<void>;

    // Guarda los acordes específicos ajustados por un instrumento en una canción de este repaso
    saveCustomChords(rehearsalId: string, songId: string, instrument: string, chords: string): Promise<void>;

    // Elimina un ensayo y todas sus relaciones asociadas
    delete(id: string): Promise<void>;

    // Asigna un fondo de pantalla a un ensayo específico
    setBackground(rehearsalId: string, backgroundId: string | null): Promise<void>;
}