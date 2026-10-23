import { describe, expect, it } from 'vitest';
import { pageResult, pageWindow } from '../../src/common/pagination.js';

describe('offset pagination', () => {
  it('turns a one-based page into a database window', () => {
    expect(pageWindow({ page: 1, pageSize: 25 })).toEqual({ skip: 0, take: 25 });
    expect(pageWindow({ page: 4, pageSize: 25 })).toEqual({ skip: 75, take: 25 });
  });

  it('uses one stable response shape for list endpoints', () => {
    expect(pageResult(['a', 'b'], { page: 2, pageSize: 2 }, 5)).toEqual({
      items: ['a', 'b'],
      page: 2,
      pageSize: 2,
      total: 5,
    });
  });
});
