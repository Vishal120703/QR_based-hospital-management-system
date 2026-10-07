import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api';
import { useLoad } from '../src/lib/use-load';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('useLoad', () => {
  it('loads, then keeps the data on screen while reloading', async () => {
    const load = vi.fn().mockResolvedValueOnce(['first']).mockResolvedValueOnce(['second']);
    const { result } = renderHook(() =>
      useLoad<string[]>(load, { failure: 'Could not load.', onUnauthorized: vi.fn() }),
    );
    expect(result.current).toMatchObject({ data: null, loading: true, error: null });
    await waitFor(() => expect(result.current.data).toEqual(['first']));

    act(() => result.current.reload());
    expect(result.current).toMatchObject({ data: ['first'], loading: true });
    await waitFor(() => expect(result.current.data).toEqual(['second']));
    expect(result.current.loading).toBe(false);
  });

  it('shows a failed load on the screen and signs out only for an expired session', async () => {
    const onUnauthorized = vi.fn();
    const load = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'Server unavailable.'))
      .mockRejectedValueOnce(new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.'));
    const { result } = renderHook(() =>
      useLoad(load, { failure: 'Could not load.', onUnauthorized }),
    );
    await waitFor(() => expect(result.current.error).toBe('Server unavailable.'));
    expect(onUnauthorized).not.toHaveBeenCalled();

    await act(() => result.current.refresh());
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('ignores an answer that arrives after a newer request', async () => {
    const slow = deferred<string>();
    const fast = deferred<string>();
    const load = vi.fn().mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
    const onLoaded = vi.fn();
    const { result } = renderHook(() =>
      useLoad(load, { failure: 'Could not load.', onUnauthorized: vi.fn(), onLoaded }),
    );
    act(() => result.current.reload());
    await act(async () => {
      fast.resolve('new');
      await fast.promise;
    });
    await act(async () => {
      slow.resolve('old');
      await slow.promise;
    });
    expect(result.current.data).toBe('new');
    expect(onLoaded).toHaveBeenCalledExactlyOnceWith('new');
  });
});
