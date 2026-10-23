// Shared offset-pagination vocabulary. Keeping the calculation and response
// shape here means a new list endpoint does not need to invent either one.

export interface PageRequest {
  readonly page: number;
  readonly pageSize: number;
}

export interface PageWindow {
  readonly skip: number;
  readonly take: number;
}

export interface PageResult<T> extends PageRequest {
  readonly items: readonly T[];
  readonly total: number;
}

export function pageWindow({ page, pageSize }: PageRequest): PageWindow {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function pageResult<T>(
  items: readonly T[],
  request: PageRequest,
  total: number,
): PageResult<T> {
  return { items, page: request.page, pageSize: request.pageSize, total };
}
