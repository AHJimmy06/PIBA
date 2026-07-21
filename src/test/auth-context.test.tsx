import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/presentation/context/AuthContext';

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('@/infrastructure/api/SessionApi', () => ({
  SESSION_CLEARED_EVENT: 'piba-session-cleared',
  SESSION_RECOVERABLE_EVENT: 'piba-session-recoverable',
  isTransientSessionError: (error: unknown) => error instanceof Error && error.message === 'transient',
  sessionApi: {
    currentUser: mocks.currentUser,
    logout: mocks.logout,
  },
}));

const Probe = () => {
  const { user, recovering, revocationWarning, login, logout: logoutContext } = useAuth();
  return (
    <div>
      <span>{user?.firstName ?? 'signed-out'}</span>
      <span>{recovering ? 'recovering' : 'settled'}</span>
      <span>{revocationWarning?.requestId ?? (revocationWarning ? 'revocation-unresolved' : 'revocation-confirmed')}</span>
      <button onClick={() => login({ id: 'u', firstName: 'Updated', lastName: 'User', role: 'GENERAL' })}>login</button>
      <button onClick={() => void logoutContext()}>logout</button>
    </div>
  );
};

describe('AuthProvider', () => {
  beforeEach(() => {
    mocks.currentUser.mockReset();
    mocks.logout.mockReset();
  });

  it('hydrates display identity from the HttpOnly-cookie current-user boundary', async () => {
    mocks.currentUser.mockResolvedValue({ id: 'u', firstName: 'Server', lastName: 'User', role: 'GENERAL' });
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(screen.getByText('recovering')).toBeInTheDocument();
    expect(await screen.findByText('Server')).toBeInTheDocument();
    expect(screen.getByText('settled')).toBeInTheDocument();
  });

  it('keeps transient startup recoverable and retries immediately when connectivity returns', async () => {
    mocks.currentUser
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({ id: 'u', firstName: 'Recovered', lastName: 'User', role: 'GENERAL' });
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => undefined);
    expect(screen.getByText('recovering')).toBeInTheDocument();

    await act(async () => window.dispatchEvent(new Event('online')));
    expect(await screen.findByText('Recovered')).toBeInTheDocument();
  });

  it('keeps a startup timeout visible as recoverable and retries on bounded backoff', async () => {
    vi.useFakeTimers();
    mocks.currentUser
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({ id: 'u', firstName: 'Backoff', lastName: 'User', role: 'GENERAL' });
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => undefined);
    expect(screen.getByText('recovering')).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(screen.getByText('Backoff')).toBeInTheDocument();
    expect(screen.getByText('settled')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('retains authenticated UI and exposes an actionable warning when logout revocation fails', async () => {
    mocks.currentUser.mockResolvedValue({ id: 'u', firstName: 'Server', lastName: 'User', role: 'GENERAL' });
    mocks.logout.mockResolvedValue({ revoked: false, requestId: 'request-7' });
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText('Server')).toBeInTheDocument();

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'logout' })));
    expect(screen.getByText('Server')).toBeInTheDocument();
    expect(await screen.findByText('request-7')).toBeInTheDocument();
  });

  it('clears identity only after confirmed revocation', async () => {
    mocks.currentUser.mockResolvedValue({ id: 'u', firstName: 'Server', lastName: 'User', role: 'GENERAL' });
    mocks.logout.mockResolvedValue({ revoked: true });
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText('Server')).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'logout' })));
    expect(screen.getByText('signed-out')).toBeInTheDocument();
  });

  it('prevents an older logout completion from overwriting a newer result or login', async () => {
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    mocks.currentUser.mockResolvedValue({ id: 'u', firstName: 'Server', lastName: 'User', role: 'GENERAL' });
    mocks.logout
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText('Server')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'logout' }));
    fireEvent.click(screen.getByRole('button', { name: 'logout' }));
    await act(async () => resolveSecond({ revoked: false, requestId: 'newer' }));
    await act(async () => resolveFirst({ revoked: true }));
    expect(screen.getByText('Server')).toBeInTheDocument();
    expect(screen.getByText('newer')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'login' }));
    expect(screen.getByText('Updated')).toBeInTheDocument();
  });
});
