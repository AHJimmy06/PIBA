export type Role = 'LIDER_REPASO' | 'GENERAL';

export interface User {
    id: string;
    name: string;
    role: Role;
    defaultInstrument?: string;
}