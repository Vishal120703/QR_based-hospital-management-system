// Job processors are added in their owning feature phase. Keeping the worker as a
// separate process boundary now avoids coupling background execution to HTTP startup.
export const serviceName = 'CARE QR Worker';
