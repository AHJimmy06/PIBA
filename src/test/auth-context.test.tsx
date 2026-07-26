import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const user = (firstName: string) => ({ id: 'u', firstName, lastName: 'User', role: 'GENERAL' as const });

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('AuthProvider', () => {
  beforeEach(() => {
    mocks.currentUser.mockReset();
    mocks.logout.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
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
    expect(mocks.currentUser).toHaveBeenCalledTimes(2);
  });

  it('cancels a scheduled retry when the session-cleared event arrives', async () => {
    vi.useFakeTimers();
    mocks.currentUser
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(user('Stale'));
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => undefined);

    await act(async () => window.dispatchEvent(new Event('piba-session-cleared')));
    await act(async () => vi.advanceTimersByTimeAsync(500));

    expect(mocks.currentUser).toHaveBeenCalledOnce();
    expect(screen.getByText('signed-out')).toBeInTheDocument();
    expect(screen.getByText('settled')).toBeInTheDocument();
  });

  it('cancels a scheduled retry when logout starts', async () => {
    vi.useFakeTimers();
    mocks.currentUser
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(user('Stale'));
    mocks.logout.mockResolvedValue({ revoked: true });
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => undefined);

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'logout' })));
    await act(async () => vi.advanceTimersByTimeAsync(500));

    expect(mocks.currentUser).toHaveBeenCalledOnce();
    expect(screen.getByText('signed-out')).toBeInTheDocument();
    expect(screen.getByText('settled')).toBeInTheDocument();
  });

  it('cancels a scheduled retry when an explicit login succeeds', async () => {
    vi.useFakeTimers();
    mocks.currentUser
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(user('Stale'));
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => undefined);

    fireEvent.click(screen.getByRole('button', { name: 'login' }));
    await act(async () => vi.advanceTimersByTimeAsync(500));

    expect(mocks.currentUser).toHaveBeenCalledOnce();
    expect(screen.getByText('Updated')).toBeInTheDocument();
    expect(screen.getByText('settled')).toBeInTheDocument();
  });

  it.each(['session clear', 'explicit login'])('ignores in-flight hydration after %s', async (actionName) => {
    const hydration = deferred<ReturnType<typeof user>>();
    mocks.currentUser.mockReturnValue(hydration.promise);
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => undefined);

    if (actionName === 'session clear') {
      await act(async () => window.dispatchEvent(new Event('piba-session-cleared')));
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'login' }));
    }
    await act(async () => hydration.resolve(user('Stale')));

    expect(screen.getByText(actionName === 'session clear' ? 'signed-out' : 'Updated')).toBeInTheDocument();
    expect(screen.queryByText('Stale')).not.toBeInTheDocument();
  });

  it('clears a pending retry on unmount without starting another hydration', async () => {
    vi.useFakeTimers();
    mocks.currentUser.mockRejectedValueOnce(new Error('transient'));
    const view = render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => undefined);

    view.unmount();
    await act(async () => vi.advanceTimersByTimeAsync(5_000));

    expect(mocks.currentUser).toHaveBeenCalledOnce();
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

  it('keeps a newer completed login when an older logout resolves later', async () => {
    const pendingLogout = deferred<{ revoked: boolean }>();
    mocks.currentUser.mockResolvedValue(user('Server'));
    mocks.logout.mockReturnValue(pendingLogout.promise);
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText('Server')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'logout' }));
    fireEvent.click(screen.getByRole('button', { name: 'login' }));
    expect(screen.getByText('Updated')).toBeInTheDocument();

    await act(async () => pendingLogout.resolve({ revoked: true }));
    expect(screen.getByText('Updated')).toBeInTheDocument();
    expect(screen.getByText('settled')).toBeInTheDocument();
    expect(screen.getByText('revocation-confirmed')).toBeInTheDocument();
  });

  it('ignores an in-flight logout completion after provider unmount', async () => {
    const pendingLogout = deferred<{ revoked: boolean; requestId: string }>();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.currentUser.mockResolvedValue(user('Server'));
    mocks.logout.mockReturnValue(pendingLogout.promise);
    const view = render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText('Server')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'logout' }));
    expect(mocks.logout).toHaveBeenCalledOnce();
    view.unmount();
    await act(async () => pendingLogout.resolve({ revoked: false, requestId: 'late-warning' }));

    expect(consoleError).not.toHaveBeenCalled();
    expect(mocks.currentUser).toHaveBeenCalledOnce();
    expect(mocks.logout).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
