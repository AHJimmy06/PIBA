import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Rehearsal } from '@/core/domain/entities/Rehearsal';
import type { Song } from '@/core/domain/entities/Song';
import type { User } from '@/core/domain/entities/User';

const mocks = vi.hoisted(() => ({
  deleteRehearsal: vi.fn(),
  deleteSong: vi.fn(),
  getPendingRehearsals: vi.fn(),
  getSongs: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  navigate: vi.fn(),
  updateUserProfile: vi.fn(),
}));

const mockDependencies = {
  deleteRehearsal: { execute: mocks.deleteRehearsal },
  deleteSong: { execute: mocks.deleteSong },
  getPendingRehearsals: { execute: mocks.getPendingRehearsals },
  getSongs: { execute: mocks.getSongs },
  updateUserProfile: { execute: mocks.updateUserProfile },
};

vi.mock('@/presentation/context/DependenciesProvider', () => ({
  useDependencies: () => mockDependencies,
}));

const user: User = {
  id: 'user-1',
  firstName: 'Ada',
  lastName: 'Leader',
  role: 'LIDER_REPASO',
  defaultInstrument: 'Piano',
  accessCode: 'old-code',
};

vi.mock('@/presentation/context/AuthContext', () => ({
  useAuth: () => ({ user, login: mocks.login, logout: mocks.logout }),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...original,
    Navigate: () => null,
    useNavigate: () => mocks.navigate,
  };
});

import { DashboardView } from '@/presentation/views/DashboardView';
import { SongListView } from '@/presentation/views/SongListView';

const rehearsal: Rehearsal = {
  id: 'rehearsal-1',
  date: new Date('2026-07-20T19:00:00'),
  status: 'PENDING',
  leaderId: user.id,
  assignedUsers: [],
  songs: [],
};

const statusRehearsals: Rehearsal[] = [
  { ...rehearsal, id: 'in-progress', status: 'IN_PROGRESS' },
  { ...rehearsal, id: 'ready', status: 'READY' },
  { ...rehearsal, id: 'paused', status: 'PAUSED' },
];

const song: Song = {
  id: 'song-1',
  title: 'Amazing Grace',
  author: 'Traditional',
  lyrics: 'Amazing grace',
  baseChords: 'G',
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('migrated dialog contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPendingRehearsals.mockResolvedValue([]);
    mocks.getSongs.mockResolvedValue([]);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('keeps rehearsal deletion pending, closes after delete, and reports refresh failure precisely', async () => {
    const deletion = deferred<void>();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    mocks.getPendingRehearsals
      .mockResolvedValueOnce([rehearsal])
      .mockRejectedValueOnce(new Error('refresh failed'));
    mocks.deleteRehearsal.mockReturnValueOnce(deletion.promise);

    render(<DashboardView />);
    const trigger = await screen.findByRole('button', { name: 'Eliminar ensayo' });
    expect(screen.getByRole('button', { name: 'Editar ensayo' })).toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'CANCELAR ENSAYO' }));

    const pendingAction = screen.getByRole('button', { name: 'ELIMINANDO...' });
    expect(pendingAction).toBeDisabled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(pendingAction);
    expect(mocks.deleteRehearsal).toHaveBeenCalledTimes(1);

    deletion.resolve();

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(alertSpy).toHaveBeenCalledWith('El ensayo se eliminó, pero no se pudo actualizar la lista.');
    expect(alertSpy).not.toHaveBeenCalledWith('Error al eliminar el ensayo.');
  });

  it('keeps song deletion pending and leaves the dialog open when deletion fails', async () => {
    const deletion = deferred<void>();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    mocks.getSongs.mockResolvedValueOnce([song]);
    mocks.deleteSong.mockReturnValueOnce(deletion.promise);

    render(<SongListView />);
    const trigger = await screen.findByRole('button', { name: 'Eliminar canción' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'ELIMINAR AHORA' }));

    expect(screen.getByRole('button', { name: 'ELIMINANDO...' })).toBeDisabled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    deletion.reject(new Error('delete failed'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Error al eliminar la canción.'));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ELIMINAR AHORA' })).toBeEnabled();
  });

  it('prevents profile dismissal while saving and preserves the new access code result', async () => {
    const update = deferred<User>();
    mocks.updateUserProfile.mockReturnValueOnce(update.promise);

    render(<DashboardView />);
    fireEvent.click(screen.getByRole('button', { name: /Ada Leader/ }));
    fireEvent.click(screen.getByRole('button', { name: 'GUARDAR CAMBIOS' }));

    expect(screen.getByRole('button', { name: 'Guardando...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const overlay = document.querySelector<HTMLElement>('[data-state="open"].fixed.inset-0');
    expect(overlay).not.toBeNull();
    fireEvent.pointerDown(overlay!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    update.resolve({ ...user, accessCode: 'new-code' });

    expect(await screen.findByText('new-code')).toBeVisible();
    expect(screen.getByText('Perfil Actualizado')).toBeVisible();
    expect(mocks.login).toHaveBeenCalledWith(expect.objectContaining({ accessCode: 'new-code' }));
  });

  it('resets the profile dialog to its edit form after closing the access-code step', async () => {
    mocks.updateUserProfile.mockResolvedValueOnce({ ...user, accessCode: 'new-code' });

    render(<DashboardView />);
    fireEvent.click(screen.getByRole('button', { name: /Ada Leader/ }));
    fireEvent.click(screen.getByRole('button', { name: 'GUARDAR CAMBIOS' }));

    expect(await screen.findByText('new-code')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'ENTENDIDO' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Ada Leader/ }));
    expect(await screen.findByText('Editar Perfil')).toBeVisible();
    expect(screen.getByRole('button', { name: 'GUARDAR CAMBIOS' })).toBeEnabled();
    expect(screen.queryByText('new-code')).not.toBeInTheDocument();
  });

  it('renders a scrollable song detail dialog with a compact chord sheet from VER', async () => {
    mocks.getSongs.mockResolvedValueOnce([{ ...song, lyrics: '[CORO]\n[G]Amazing grace' }]);

    render(<SongListView />);
    fireEvent.click(await screen.findByRole('button', { name: 'VER' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveClass('max-w-3xl', 'max-h-[90vh]', 'overflow-y-auto');
    expect(within(dialog).getByRole('heading', { name: 'Amazing Grace' })).toBeVisible();
    expect(within(dialog).getByText('Traditional')).toBeVisible();
    expect(within(dialog).getAllByText('G').some((element) => element.classList.contains('bg-zinc-800'))).toBe(true);
    expect(within(dialog).getByText('CORO')).toBeVisible();
    expect(within(dialog).getByText('Amazing grace')).toHaveClass('text-xl');
  });

  it('maps rehearsal statuses to their observable Badge styles', async () => {
    mocks.getPendingRehearsals.mockResolvedValueOnce(statusRehearsals);

    render(<DashboardView />);

    expect(await screen.findByText('● En Vivo')).toHaveClass('bg-red-500/20', 'text-red-400');
    expect(screen.getByText('✨ Listo')).toHaveClass('bg-primary/20', 'text-primary');
    expect(screen.getByText('PAUSED')).toHaveClass('bg-muted', 'text-muted-foreground');
  });
});
