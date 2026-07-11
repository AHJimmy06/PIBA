import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChordSheet } from '@/presentation/components/rehearsal/ChordSheet';

describe('ChordSheet section Badge colors', () => {
  it.each([
    ['CORO', 'bg-primary/20', 'text-primary'],
    ['ESTRIBILLO', 'bg-primary/20', 'text-primary'],
    ['PUENTE', 'bg-amber-500/20', 'text-amber-500'],
    ['INTRO', 'bg-zinc-500/20', 'text-zinc-500'],
    ['FINAL', 'bg-zinc-500/20', 'text-zinc-500'],
    ['VERSO', 'bg-blue-500/20', 'text-blue-500'],
  ])('renders %s with its established color mapping', (section, background, text) => {
    render(<ChordSheet content={`[${section}]`} showChords />);

    expect(screen.getByText(section)).toHaveClass(background, text);
  });
});
