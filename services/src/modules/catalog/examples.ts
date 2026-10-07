import { type Prisma, type RequestPriority } from '@prisma/client';
import { createSlaPolicy } from '../sla/index.js';
import { CategoryRepository } from './category.repository.js';
import { ServiceItemRepository } from './service-item.repository.js';

// Editable examples for a new hospital, matching the services in the V1 plan.
// They are data: no code depends on these names or timings.
const slaExamples = [
  { name: 'Quick response', acceptMinutes: 3, completeMinutes: 10 },
  { name: 'Standard', acceptMinutes: 10, completeMinutes: 60 },
] as const;

const categoryExamples = [
  { name: 'Food & Water', sortOrder: 10, emergencyNotice: false },
  { name: 'Nursing Help', sortOrder: 20, emergencyNotice: true },
  { name: 'Room & Cleaning', sortOrder: 30, emergencyNotice: false },
  { name: 'Assistance', sortOrder: 40, emergencyNotice: false },
] as const;

const serviceExamples: readonly {
  name: string;
  category: (typeof categoryExamples)[number]['name'];
  department: string;
  sla: (typeof slaExamples)[number]['name'];
  priority: RequestPriority;
}[] = [
  {
    name: 'Drinking Water',
    category: 'Food & Water',
    department: 'PANTRY',
    sla: 'Quick response',
    priority: 'NORMAL',
  },
  {
    name: 'Nurse Assistance',
    category: 'Nursing Help',
    department: 'NURSING',
    sla: 'Quick response',
    priority: 'HIGH',
  },
  {
    name: 'Room Cleaning',
    category: 'Room & Cleaning',
    department: 'HOUSEKEEPING',
    sla: 'Standard',
    priority: 'NORMAL',
  },
  {
    name: 'Wheelchair',
    category: 'Assistance',
    department: 'TRANSPORT',
    sla: 'Standard',
    priority: 'NORMAL',
  },
];

export async function seedExampleCatalog(
  transaction: Prisma.TransactionClient,
  hospitalId: string,
  departmentIdByCode: ReadonlyMap<string, string>,
): Promise<void> {
  const slaIdByName = new Map<string, string>();
  for (const example of slaExamples) {
    slaIdByName.set(example.name, await createSlaPolicy(transaction, hospitalId, example));
  }

  const categories = await new CategoryRepository().createMany(
    transaction,
    hospitalId,
    categoryExamples,
  );
  const categoryIdByName = new Map(categories.map((category) => [category.name, category.id]));

  await new ServiceItemRepository().createMany(
    transaction,
    serviceExamples.map((example, index) => ({
      hospitalId,
      name: example.name,
      priority: example.priority,
      sortOrder: index * 10,
      categoryId: required(categoryIdByName, example.category),
      departmentId: required(departmentIdByCode, example.department),
      slaPolicyId: required(slaIdByName, example.sla),
    })),
  );
}

function required(map: ReadonlyMap<string, string>, key: string): string {
  const value = map.get(key);
  if (!value) {
    throw new Error(`Example catalog references unknown "${key}".`);
  }
  return value;
}
