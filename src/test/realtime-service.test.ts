import { describe, expect, it, vi } from 'vitest';

import { SupabaseRealtimeService } from '@/infrastructure/services/SupabaseRealtimeService';

const transport = vi.hoisted(() => ({
  channel: vi.fn(),
  removeChannel: vi.fn(),
}));

vi.mock('@/infrastructure/api/supabaseClient', () => ({
  supabase: transport,
}));

describe('SupabaseRealtimeService', () => {
  it('fails closed without constructing or publishing to a Supabase channel', () => {
    const service = new SupabaseRealtimeService();
    const callback = vi.fn();

    expect(service.available).toBe(false);
    service.publish('rehearsal-1', { type: 'CHANGE_BLOCK' });
    const cleanup = service.subscribe('rehearsal-1', callback);
    cleanup();
    cleanup();

    expect(callback).not.toHaveBeenCalled();
    expect(transport.channel).not.toHaveBeenCalled();
    expect(transport.removeChannel).not.toHaveBeenCalled();
  });

  it('keeps immediate resubscribe and repeated cleanup stateless and race-free', () => {
    const service = new SupabaseRealtimeService();
    const firstCleanup = service.subscribe('rehearsal-1', vi.fn());
    firstCleanup();
    const secondCleanup = service.subscribe('rehearsal-1', vi.fn());

    expect(() => {
      firstCleanup();
      secondCleanup();
      secondCleanup();
    }).not.toThrow();
    expect(transport.channel).not.toHaveBeenCalled();
    expect(transport.removeChannel).not.toHaveBeenCalled();
  });
});
