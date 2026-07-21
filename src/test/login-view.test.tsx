import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginView } from '@/presentation/views/LoginView';
import { CreateUserView } from '@/presentation/views/CreateUserView';

const mocks = vi.hoisted(() => ({
  loginRequest: vi.fn(),
  loginContext: vi.fn(),
  navigate: vi.fn(),
  user: null as null | { id: string; firstName: string; lastName: string; role: 'GENERAL' | 'LIDER_REPASO' },
  revocationWarning: null as null | { requestId?: string },
  createUser: vi.fn(),
}));

vi.mock('@/presentation/context/DependenciesProvider', () => ({
  useDependencies: () => ({
    userRepository: { login: mocks.loginRequest },
    createUser: { execute: mocks.createUser },
  }),
}));
vi.mock('@/presentation/context/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user, recovering: false, revocationWarning: mocks.revocationWarning, login: mocks.loginContext, logout: vi.fn() }),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  useNavigate: () => mocks.navigate,
}));

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'ENTRAR AL PANEL' }));

describe('LoginView', () => {
  beforeEach(() => {
    mocks.loginRequest.mockReset();
    mocks.loginContext.mockReset();
    mocks.navigate.mockReset();
    mocks.user = null;
    mocks.revocationWarning = null;
    window.sessionStorage.clear();
  });

  it('preserves the access code while typing and validates empty input', () => {
    render(<LoginView />);
    const input = screen.getByLabelText('Código de Acceso');
    fireEvent.change(input, { target: { value: ' 123Ada ' } });
    expect(input).toHaveValue(' 123Ada ');
    fireEvent.change(input, { target: { value: '   ' } });
    submit();
    expect(screen.getByText('Por favor ingresa tu código de acceso.')).toBeInTheDocument();
    expect(mocks.loginRequest).not.toHaveBeenCalled();
  });

  it.each(['invalid', 'throttled'])('shows the same generic failure for %s login', async () => {
    mocks.loginRequest.mockRejectedValue(new Error('sensitive server detail'));
    render(<LoginView />);
    fireEvent.change(screen.getByLabelText('Código de Acceso'), { target: { value: 'bad-code' } });
    submit();
    expect(await screen.findByText('No se pudo iniciar sesión. Verifica el código e intenta nuevamente.')).toBeInTheDocument();
  });

  it('disables input and submit while the request is loading', async () => {
    mocks.loginRequest.mockReturnValue(new Promise(() => undefined));
    render(<LoginView />);
    fireEvent.change(screen.getByLabelText('Código de Acceso'), { target: { value: 'code' } });
    submit();
    expect(await screen.findByRole('button', { name: 'Verificando...' })).toBeDisabled();
    expect(screen.getByLabelText('Código de Acceso')).toBeDisabled();
  });

  it('navigates after successful cookie-backed login without web storage authority', async () => {
    const user = { id: 'u', firstName: 'Ada', lastName: 'L', role: 'GENERAL' as const };
    mocks.loginRequest.mockResolvedValue(user);
    render(<LoginView />);
    fireEvent.change(screen.getByLabelText('Código de Acceso'), { target: { value: ' code ' } });
    submit();

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/dashboard'));
    expect(mocks.loginRequest).toHaveBeenCalledWith('code');
    expect(mocks.loginContext).toHaveBeenCalledWith(user);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('redirects a restored valid tab session', () => {
    mocks.user = { id: 'u', firstName: 'Ada', lastName: 'L', role: 'GENERAL' };
    render(<LoginView />);
    expect(mocks.navigate).toHaveBeenCalledWith('/dashboard', { replace: true });
  });

  it('stays on login after an expired or revoked session is cleared', () => {
    render(<LoginView />);
    expect(screen.getByRole('button', { name: 'ENTRAR AL PANEL' })).toBeEnabled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('shows actionable unresolved revocation state and request ID after redirect', () => {
    mocks.revocationWarning = { requestId: 'request-7' };
    render(<LoginView />);

    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos confirmar el cierre de sesión en el servidor.');
    expect(screen.getByRole('alert')).toHaveTextContent('La sesión continúa activa');
    expect(screen.getByRole('alert')).toHaveTextContent('Solicitud: request-7');
    expect(window.sessionStorage.getItem('piba_session_v2')).toBeNull();
  });
});

describe('CreateUserView idempotency', () => {
  beforeEach(() => {
    mocks.createUser.mockReset();
    mocks.navigate.mockReset();
    mocks.user = { id: 'leader', firstName: 'Ada', lastName: 'L', role: 'LIDER_REPASO' };
    window.sessionStorage.clear();
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
  });

  const fillAndSubmit = (firstName: string, lastName = 'Hopper') => {
    fireEvent.change(screen.getByPlaceholderText('Ej: Juan'), { target: { value: firstName } });
    fireEvent.change(screen.getByPlaceholderText('Ej: Pérez'), { target: { value: lastName } });
    fireEvent.click(screen.getByRole('button', { name: 'REGISTRAR INTEGRANTE' }));
  };

  it('reuses the nonsecret pending operation across remount after a lost response', async () => {
    mocks.createUser.mockRejectedValue(new Error('lost response'));
    const first = render(<CreateUserView />);
    fillAndSubmit('Grace');
    await waitFor(() => expect(mocks.createUser).toHaveBeenCalledTimes(1));
    const firstOperation = mocks.createUser.mock.calls[0][1];
    first.unmount();

    render(<CreateUserView />);
    fillAndSubmit(' Grace ');
    await waitFor(() => expect(mocks.createUser).toHaveBeenCalledTimes(2));
    expect(mocks.createUser.mock.calls[1][1]).toBe(firstOperation);
    const persisted = window.sessionStorage.getItem('piba_create_user_pending_v1') ?? '';
    expect(persisted).toContain(firstOperation);
    expect(persisted).not.toContain('Grace');
  });

  it('rotates the operation for a different normalized payload and clears it on confirmed success', async () => {
    mocks.createUser
      .mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValueOnce({ firstName: 'Katherine', lastName: 'Johnson', accessCode: 'code' });
    const first = render(<CreateUserView />);
    fillAndSubmit('Grace');
    await waitFor(() => expect(mocks.createUser).toHaveBeenCalledTimes(1));
    first.unmount();

    render(<CreateUserView />);
    fillAndSubmit('Katherine', 'Johnson');
    await waitFor(() => expect(mocks.createUser).toHaveBeenCalledTimes(2));
    expect(mocks.createUser.mock.calls[1][1]).not.toBe(mocks.createUser.mock.calls[0][1]);
    await waitFor(() => expect(window.sessionStorage.getItem('piba_create_user_pending_v1')).toBeNull());
  });
});
