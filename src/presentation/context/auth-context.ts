import { createContext } from 'react';
import type { User } from '@/core/domain/entities/User';

export interface AuthContextValue {
  user: User | null;
  recovering: boolean;
  revocationWarning: { requestId?: string } | null;
  login: (user: User) => void;
  logout: () => Promise<boolean>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
