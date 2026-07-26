import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Rehearsal } from '@/core/domain/entities/Rehearsal';
import type { User } from '@/core/domain/entities/User';

const state = vi.hoisted(() => ({ user: null as User | null }));
const mocks = vi.hoisted(() => ({
  getById: vi.fn(),
  navigate: vi.fn(),
  openFullscreenWindow: vi.fn(),
  publish: vi.fn(),
  setBackground: vi.fn(),
  startRehearsal: vi.fn(),
  subscribe: vi.fn(),
  updateCustomChords: vi.fn(),
  updateRehearsalStatus: vi.fn(),
}));

const dependencies = {
  rehearsalRepository: { getById: mocks.getById, setBackground: mocks.setBackground },
  startRehearsal: { execute: mocks.startRehearsal },
  syncService: { available: false, publish: mocks.publish, subscribe: mocks.subscribe },
  updateCustomChords: { execute: mocks.updateCustomChords },
  updateRehearsalStatus: { execute: mocks.updateRehearsalStatus },
  windowService: { openFullscreenWindow: mocks.openFullscreenWindow },
};

vi.mock('@/presentation/context/AuthContext', () => ({
  useAuth: () => ({ user: state.user }),
}));
vi.mock('@/presentation/context/DependenciesProvider', () => ({
  useDependencies: () => dependencies,
}));
vi.mock('@/presentation/components/rehearsal/ChordSheet', () => ({
  ChordSheet: ({ content }: { content: string }) => <div data-testid="chord-sheet">{content}</div>,
}));
vi.mock('@/presentation/components/rehearsal/BackgroundManager', () => ({
  BackgroundManager: () => null,
}));

import { RehearsalView } from '@/presentation/views/RehearsalView';

const leader: User = {
  id: 'leader-1',
  firstName: 'Ada',
  lastName: 'Leader',
  role: 'LIDER_REPASO',
  defaultInstrument: 'Piano',
};
const rehearsal: Rehearsal = {
  id: 'rehearsal-1',
  date: new Date('2026-07-26T12:00:00Z'),
  status: 'IN_PROGRESS',
  leaderId: leader.id,
  assignedUsers: [leader],
  songs: [{
    songId: 'song-1',
    adjustedChords: [],
    songDetails: {
      id: 'song-1',
      title: 'Song One',
      author: 'Author',
      lyrics: 'Verse one\n\nVerse two',
      baseChords: 'C',
    },
  }],
};

const renderView = () => render(
  <MemoryRouter initialEntries={['/rehearsals/rehearsal-1']}>
    <Routes>
      <Route path="/" element={<div>Login route</div>} />
      <Route path="/rehearsals/:rehearsalId" element={<RehearsalView />} />
    </Routes>
  </MemoryRouter>,
);

describe('RehearsalView side-effect boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.user = leader;
    mocks.getById.mockResolvedValue(rehearsal);
    mocks.subscribe.mockImplementation(() => vi.fn());
  });

  it('redirects safely on auth loss without opening realtime or producing later side effects', async () => {
    const view = renderView();
    await screen.findAllByText('Song One');
    const repositoryCalls = mocks.getById.mock.calls.length;

    state.user = null;
    view.rerender(
      <MemoryRouter initialEntries={['/rehearsals/rehearsal-1']}>
        <Routes>
          <Route path="/" element={<div>Login route</div>} />
          <Route path="/rehearsals/:rehearsalId" element={<RehearsalView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Login route')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(mocks.getById).toHaveBeenCalledTimes(repositoryCalls);
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('performs no repository, realtime, or keyboard work without authentication', async () => {
    state.user = null;
    renderView();
    expect(await screen.findByText('Login route')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: ' ' });
    expect(mocks.getById).not.toHaveBeenCalled();
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('keeps local shortcuts controlled while realtime transport remains unavailable', async () => {
    renderView();
    await screen.findAllByText('Song One');
    mocks.publish.mockClear();

    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'ACORDES' }), { key: ' ' });
    expect(screen.getByTestId('chord-sheet')).toHaveTextContent('Song One');
    expect(mocks.publish).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByTestId('chord-sheet')).toHaveTextContent('Verse one'));
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});
