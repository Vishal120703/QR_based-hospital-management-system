import { type Prisma, type PrismaClient } from '@prisma/client';

// What a repository runs its queries on: the shared client, or the
// transaction a service opened. Repositories never open transactions
// themselves; services decide what must happen together.
export type Db = PrismaClient | Prisma.TransactionClient;
