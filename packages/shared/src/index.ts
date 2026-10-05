export interface ServiceStatus {
  readonly service: string;
  readonly status: 'ok' | 'unavailable';
}
