export type Role = 'LIDER_REPASO' | 'GENERAL';

export interface User {
    id: string;
    firstName: string;
    lastName: string;
    role: Role;
    defaultInstrument?: string;
    accessCode?: string;
}