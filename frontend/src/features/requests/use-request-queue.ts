import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, staffApi, type RequestQueue, type RequestQueueQuery } from '../../api';

export type Tab = 'open' | 'completed' | 'history';
// Narrows the open list: everything, only overdue, or only unassigned.
export type OpenFilter = 'all' | 'overdue' | 'waiting';
export const pageSize = 25;

// One page of a request list, kept current: it loads again when the list,
// filter, page, or linked request changes, and on refresh(). A slower, older
// answer never replaces a newer one, and refreshes never overlap.
export function useRequestQueue(
  token: string,
  view: { tab: Tab; filter: OpenFilter; selected: string | null },
  reportError: (error: unknown) => void,
) {
  const { tab, filter, selected } = view;
  const [queue, setQueue] = useState<RequestQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const loading = useRef(false);
  const loadSequence = useRef(0);

  // The page being shown. The server orders it: overdue work first, then the
  // oldest, so nothing outstanding hides behind newer requests.
  const query = useMemo<RequestQueueQuery>(
    () => ({
      view: tab,
      page: selected ? 1 : page,
      pageSize,
      ...(selected ? { id: selected } : {}),
      ...(!selected && tab === 'open' && filter === 'overdue' ? { overdue: true } : {}),
      ...(!selected && tab === 'open' && filter === 'waiting'
        ? { status: 'SUBMITTED' as const }
        : {}),
    }),
    [tab, page, filter, selected],
  );
  const show = useCallback((loaded: RequestQueue) => {
    // The last item on a later page may have just moved on: step back.
    if (loaded.serviceRequests.length === 0 && loaded.page > 1 && loaded.total > 0) {
      setPage(Math.ceil(loaded.total / loaded.pageSize));
      return;
    }
    setQueue(loaded);
    setUpdatedAt(Date.now());
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    const current = ++loadSequence.current;
    try {
      const loaded = await staffApi.requests(token, query);
      if (current === loadSequence.current) show(loaded);
    } catch (cause) {
      if (current !== loadSequence.current) return;
      setError(cause instanceof Error ? cause.message : 'Could not load requests.');
      if (cause instanceof ApiError && cause.status === 401) reportError(cause);
    } finally {
      loading.current = false;
    }
  }, [token, query, show, reportError]);

  useEffect(() => {
    const current = ++loadSequence.current;
    loading.current = false;
    staffApi.requests(token, query).then(
      (loaded) => {
        if (current === loadSequence.current) show(loaded);
      },
      (cause: unknown) => {
        if (current !== loadSequence.current) return;
        setError(cause instanceof Error ? cause.message : 'Could not load requests.');
        if (cause instanceof ApiError && cause.status === 401) reportError(cause);
      },
    );
    return () => {
      loadSequence.current += 1;
    };
  }, [token, query, show, reportError]);

  return { queue, error, updatedAt, page, setPage, refresh };
}
