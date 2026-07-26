import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import type { User } from '@/core/domain/entities/User';
import {
  isTransientSessionError,
  SESSION_CLEARED_EVENT,
  SESSION_RECOVERABLE_EVENT,
  sessionApi,
} from '@/infrastructure/api/SessionApi';
import { AuthContext } from './auth-context';

const RETRY_DELAYS = [500, 1_000, 2_000, 5_000];

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [recovering, setRecovering] = useState(true);
  const [revocationWarning, setRevocationWarning] = useState<{ requestId?: string } | null>(null);
  const operation = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);

  useEffect(() => {
    let active = true;
    let retry = 0;
    mounted.current = true;

    const hydrate = async () => {
      const currentOperation = ++operation.current;
      try {
        const currentUser = await sessionApi.currentUser();
        if (active && operation.current === currentOperation) {
          setUser(currentUser);
          setRecovering(false);
          retry = 0;
        }
      } catch (error) {
        if (!active || operation.current !== currentOperation) return;
        if (isTransientSessionError(error)) {
          setRecovering(true);
          const retryOperation = operation.current;
          retryTimer.current = setTimeout(() => {
            retryTimer.current = undefined;
            if (!active || operation.current !== retryOperation) return;
            void hydrate();
          }, RETRY_DELAYS[Math.min(retry++, RETRY_DELAYS.length - 1)]);
        } else {
          setUser(null);
          setRecovering(false);
        }
      }
    };
    const clearUser = () => {
      operation.current++;
      if (retryTimer.current !== undefined) {
        clearTimeout(retryTimer.current);
        retryTimer.current = undefined;
      }
      setUser(null);
      setRecovering(false);
    };
    const recover = () => {
      if (retryTimer.current !== undefined) {
        clearTimeout(retryTimer.current);
        retryTimer.current = undefined;
      }
      void hydrate();
    };

    window.addEventListener(SESSION_CLEARED_EVENT, clearUser);
    window.addEventListener(SESSION_RECOVERABLE_EVENT, recover);
    window.addEventListener('online', recover);
    void hydrate();
    return () => {
      active = false;
      mounted.current = false;
      if (retryTimer.current !== undefined) {
        clearTimeout(retryTimer.current);
        retryTimer.current = undefined;
      }
      window.removeEventListener(SESSION_CLEARED_EVENT, clearUser);
      window.removeEventListener(SESSION_RECOVERABLE_EVENT, recover);
      window.removeEventListener('online', recover);
    };
  }, []);

  const login = (userData: User) => {
    operation.current++;
    if (retryTimer.current !== undefined) {
      clearTimeout(retryTimer.current);
      retryTimer.current = undefined;
    }
    setRevocationWarning(null);
    setRecovering(false);
    setUser(userData);
  };

  const logout = async () => {
    const currentOperation = ++operation.current;
    if (retryTimer.current !== undefined) {
      clearTimeout(retryTimer.current);
      retryTimer.current = undefined;
    }
    const result = await sessionApi.logout();
    if (!mounted.current || operation.current !== currentOperation) return result.revoked;
    if (result.revoked) {
      setRevocationWarning(null);
      setRecovering(false);
      setUser(null);
    } else {
      setRevocationWarning({ requestId: result.requestId });
    }
    return result.revoked;
  };

  return (
    <AuthContext.Provider value={{ user, recovering, revocationWarning, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
