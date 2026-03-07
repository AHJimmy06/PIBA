import React, { createContext, useContext, useState, type ReactNode } from 'react';
import type { User } from '@/core/domain/entities/User';

interface AuthContextType {
  user: User | null;
  login: (user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Recuperar sesión persistente
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('piba_session');
    return saved ? JSON.parse(saved) : null;
  });

  const login = (userData: User) => {
    setUser(userData);
    localStorage.setItem('piba_session', JSON.stringify(userData));
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('piba_session');
  };

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth debe usarse dentro de un AuthProvider");
  return context;
};
