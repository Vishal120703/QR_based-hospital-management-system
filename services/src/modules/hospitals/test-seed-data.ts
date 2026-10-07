import { type BedType, type RequestPriority, type RoomType, type WardType } from '@prisma/client';
import { type PermissionKey } from '../roles/permissions.js';

// Dummy client hospitals for a full manual test: every role, a realistic
// layout, and two weeks of request history. No real patient data.
// See services/docs/full-testing-guide.md for who is who.

// Minutes before the seed runs, or [days ago, "HH:MM" hospital time].
export type When = number | readonly [daysAgo: number, time: string];

export type Scope = 'hospital' | `floor:${string}` | `ward:${string}` | `department:${string}`;
export type Coverage = 'hospital' | `floor:${string}` | `ward:${string}`;

export interface PersonSpec {
  readonly key: string;
  readonly name: string;
  readonly email: string;
  // A built-in role key (such as FLOOR_MANAGER) or a custom role name, and where it applies.
  readonly roles: readonly { readonly role: string; readonly scope: Scope }[];
  readonly departments?: readonly string[];
  readonly coverage?: readonly Coverage[];
  readonly onDuty?: boolean;
  readonly wentOffDuty?: { readonly at: When; readonly by: string };
  readonly suspended?: { readonly at: When; readonly by: string };
}

export interface BedSpec {
  readonly code: string;
  readonly name: string;
  readonly type?: BedType;
  readonly maintenance?: boolean;
}

export interface WardSpec {
  readonly code: string;
  readonly name: string;
  readonly unitType: WardType;
  readonly beds?: readonly BedSpec[];
  readonly rooms?: readonly {
    readonly code: string;
    readonly name: string;
    readonly roomType: RoomType;
    readonly beds: readonly BedSpec[];
  }[];
}

export interface FloorSpec {
  readonly key: string;
  readonly building?: { readonly code: string; readonly name: string };
  readonly code: string;
  readonly name: string;
  readonly level: number;
  readonly wards: readonly WardSpec[];
}

export interface StaySpec {
  readonly bed: string;
  readonly from: When;
  readonly to?: When;
  readonly by: string;
  readonly closedBy?: string;
}

export type Step =
  | { readonly do: 'assign'; readonly by: string; readonly to: string; readonly after: number }
  | {
      readonly do: 'transfer';
      readonly by: string;
      readonly to: string;
      readonly after: number;
      readonly reason: string;
    }
  | { readonly do: 'accept' | 'start' | 'complete'; readonly after: number }
  | { readonly do: 'close'; readonly by: string; readonly after: number }
  // by: 'patient' is a cancellation from the patient's phone.
  | { readonly do: 'cancel'; readonly by: string; readonly after: number; readonly reason: string }
  | { readonly do: 'reject'; readonly after: number; readonly reason: string };

export interface RequestSpec {
  readonly bed: string;
  readonly service: string;
  readonly at: When;
  readonly steps: readonly Step[];
}

export interface HospitalSpec {
  readonly code: string;
  readonly name: string;
  readonly domain: string;
  readonly createdAt: When;
  readonly logo: {
    readonly color: readonly [number, number, number];
    readonly shape: 'square' | 'circle';
  };
  // The first person is the Hospital Manager created with the hospital.
  readonly people: readonly PersonSpec[];
  readonly customRoles?: readonly {
    readonly name: string;
    readonly description: string;
    readonly scopeLevel: 'HOSPITAL' | 'FLOOR' | 'WARD' | 'DEPARTMENT';
    readonly permissions: readonly PermissionKey[];
  }[];
  readonly extraDepartments?: readonly (readonly [code: string, name: string])[];
  readonly catalog?: {
    readonly slas?: readonly { name: string; acceptMinutes: number; completeMinutes: number }[];
    readonly categories?: readonly { name: string; sortOrder: number }[];
    readonly services?: readonly {
      name: string;
      category: string;
      department: string;
      sla: string;
      priority: RequestPriority;
      active?: boolean;
    }[];
    readonly escalation?: {
      readonly name: string;
      // 'ASSIGNEE' or the name of a role to alert.
      readonly levels: readonly { afterMinutes: number; target: string }[];
      readonly services: readonly string[];
    };
  };
  readonly floors: readonly FloorSpec[];
  readonly qrIssuedBy: string;
  readonly stays: readonly StaySpec[];
  readonly qrChanges?: {
    readonly rotated?: readonly { bed: string; at: When; by: string }[];
    readonly revoked?: readonly { bed: string; at: When; by: string }[];
  };
  readonly requests: readonly RequestSpec[];
  // Everyday completed work, generated for the given number of past days.
  readonly routine?: {
    readonly days: number;
    readonly perDay: readonly [min: number, max: number];
    readonly services: readonly (readonly [name: string, weight: number])[];
    readonly managers: {
      readonly departments: Readonly<Record<string, readonly string[]>>;
      readonly wards: Readonly<Record<string, readonly string[]>>;
      readonly floors: Readonly<Record<string, readonly string[]>>;
      readonly fallback: readonly string[];
    };
  };
  readonly shifts?: readonly {
    person: string;
    department: string;
    from: When;
    hours: number;
    by: string;
  }[];
}

const numbered = (prefix: string, name: string, count: number, type?: BedType): BedSpec[] =>
  Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(2, '0');
    return { code: `${prefix}-${number}`, name: `${name} ${number}`, ...(type ? { type } : {}) };
  });

const careStaff = (scope: Scope = 'hospital') => [{ role: 'CARE_STAFF', scope }] as const;

export const cityCare: HospitalSpec = {
  code: 'CITYCARE',
  name: 'CityCare Multispeciality Hospital',
  domain: 'citycare.example',
  createdAt: [20, '10:00'],
  logo: { color: [13, 148, 136], shape: 'square' },
  people: [
    {
      key: 'meera',
      name: 'Dr. Meera Iyer',
      email: 'meera.iyer',
      roles: [{ role: 'HOSPITAL_MANAGER', scope: 'hospital' }],
    },
    {
      key: 'arjun',
      name: 'Arjun Mehta',
      email: 'arjun.mehta',
      roles: [{ role: 'Operations Manager', scope: 'hospital' }],
    },
    {
      key: 'kavita',
      name: 'Kavita Joshi',
      email: 'kavita.joshi',
      roles: [{ role: 'Admission Desk', scope: 'hospital' }],
    },
    {
      key: 'ravi',
      name: 'Ravi Shankar',
      email: 'ravi.shankar',
      roles: [{ role: 'FLOOR_MANAGER', scope: 'floor:MAIN/F1' }],
    },
    {
      key: 'sunita',
      name: 'Sunita Rao',
      email: 'sunita.rao',
      roles: [{ role: 'FLOOR_MANAGER', scope: 'floor:MAIN/F2' }],
    },
    {
      key: 'priya',
      name: 'Priya Nair',
      email: 'priya.nair',
      roles: [{ role: 'WARD_MANAGER', scope: 'ward:ICU' }],
    },
    {
      key: 'imran',
      name: 'Imran Khan',
      email: 'imran.khan',
      roles: [{ role: 'DEPARTMENT_SUPERVISOR', scope: 'department:PANTRY' }],
    },
    {
      key: 'lakshmi',
      name: 'Lakshmi Pillai',
      email: 'lakshmi.pillai',
      roles: [{ role: 'DEPARTMENT_SUPERVISOR', scope: 'department:HOUSEKEEPING' }],
    },
    {
      key: 'anjali',
      name: 'Anjali Sharma',
      email: 'anjali.sharma',
      roles: careStaff(),
      departments: ['NURSING'],
      coverage: ['floor:MAIN/F1'],
      onDuty: true,
    },
    {
      key: 'deepa',
      name: 'Deepa Thomas',
      email: 'deepa.thomas',
      roles: careStaff(),
      departments: ['NURSING'],
      coverage: ['floor:MAIN/F2'],
      onDuty: true,
    },
    {
      key: 'rahul',
      name: 'Rahul Verma',
      email: 'rahul.verma',
      roles: careStaff(),
      departments: ['NURSING'],
      coverage: ['floor:MAIN/F1', 'floor:MAIN/F2'],
      onDuty: false,
      wentOffDuty: { at: [1, '20:00'], by: 'arjun' },
    },
    {
      key: 'farah',
      name: 'Farah Ali',
      email: 'farah.ali',
      roles: careStaff(),
      departments: ['NURSING'],
      coverage: ['floor:MAIN/G', 'ward:DIAL'],
      onDuty: true,
    },
    {
      key: 'pavan',
      name: 'Pavan Kumar',
      email: 'pavan.kumar',
      roles: careStaff(),
      departments: ['PANTRY'],
      coverage: ['hospital'],
      onDuty: true,
    },
    {
      key: 'neha',
      name: 'Neha Gupta',
      email: 'neha.gupta',
      roles: careStaff(),
      departments: ['PANTRY'],
      coverage: ['floor:MAIN/F1', 'floor:MAIN/F2'],
      onDuty: true,
    },
    {
      key: 'suresh',
      name: 'Suresh Yadav',
      email: 'suresh.yadav',
      roles: careStaff(),
      departments: ['HOUSEKEEPING'],
      coverage: ['hospital'],
      onDuty: true,
    },
    {
      key: 'geeta',
      name: 'Geeta Devi',
      email: 'geeta.devi',
      roles: careStaff(),
      departments: ['HOUSEKEEPING'],
      coverage: ['floor:MAIN/F2'],
      onDuty: true,
    },
    {
      key: 'manoj',
      name: 'Manoj Singh',
      email: 'manoj.singh',
      roles: careStaff(),
      departments: ['TRANSPORT', 'PATIENT-ASSIST'],
      coverage: ['hospital'],
      onDuty: true,
    },
    {
      key: 'vikram',
      name: 'Vikram Patil',
      email: 'vikram.patil',
      roles: careStaff(),
      departments: ['MAINTENANCE'],
      coverage: ['hospital'],
      onDuty: true,
    },
    {
      key: 'karan',
      name: 'Karan Malhotra',
      email: 'karan.malhotra',
      roles: careStaff(),
      departments: ['HOUSEKEEPING'],
      coverage: ['floor:MAIN/F1'],
      onDuty: false,
      suspended: { at: [3, '18:30'], by: 'arjun' },
    },
  ],
  customRoles: [
    {
      name: 'Operations Manager',
      description:
        'Runs day-to-day operations: staff duty, admissions, requests, reports, and the audit log. Cannot change roles, QR codes, or hospital settings.',
      scopeLevel: 'HOSPITAL',
      permissions: [
        'hospital.read',
        'role.read',
        'location.read',
        'bed.read',
        'bedSession.manage',
        'staff.read',
        'staff.manage',
        'service.read',
        'request.read',
        'request.assign',
        'request.accept',
        'request.start',
        'request.complete',
        'request.close',
        'request.transfer',
        'request.cancel',
        'request.reject',
        'analytics.read',
        'audit.read',
      ],
    },
    {
      name: 'Admission Desk',
      description: 'Admits and discharges patients and prints bed QR labels.',
      scopeLevel: 'HOSPITAL',
      permissions: ['location.read', 'bed.read', 'bedSession.manage', 'qr.generate', 'qr.rotate'],
    },
  ],
  extraDepartments: [['LAB', 'Laboratory']],
  catalog: {
    slas: [{ name: 'Within 30 minutes', acceptMinutes: 10, completeMinutes: 30 }],
    categories: [
      { name: 'Repairs', sortOrder: 35 },
      { name: 'Billing & Discharge', sortOrder: 50 },
    ],
    services: [
      {
        name: 'Meal / Diet Query',
        category: 'Food & Water',
        department: 'PANTRY',
        sla: 'Standard',
        priority: 'NORMAL',
      },
      {
        name: 'Extra Blanket / Linen',
        category: 'Room & Cleaning',
        department: 'HOUSEKEEPING',
        sla: 'Within 30 minutes',
        priority: 'NORMAL',
      },
      {
        name: 'Washroom Help',
        category: 'Assistance',
        department: 'PATIENT-ASSIST',
        sla: 'Quick response',
        priority: 'HIGH',
      },
      {
        name: 'AC / Light / TV Not Working',
        category: 'Repairs',
        department: 'MAINTENANCE',
        sla: 'Standard',
        priority: 'NORMAL',
      },
      {
        name: 'Billing Query',
        category: 'Billing & Discharge',
        department: 'BILLING',
        sla: 'Standard',
        priority: 'NORMAL',
      },
      {
        name: 'Newspaper',
        category: 'Assistance',
        department: 'PATIENT-ASSIST',
        sla: 'Standard',
        priority: 'NORMAL',
        active: false,
      },
    ],
    escalation: {
      name: 'Nursing overdue',
      levels: [
        { afterMinutes: 0, target: 'ASSIGNEE' },
        { afterMinutes: 5, target: 'Floor Manager' },
        { afterMinutes: 15, target: 'Hospital Manager' },
      ],
      services: ['Nurse Assistance'],
    },
  },
  floors: [
    {
      key: 'MAIN/G',
      building: { code: 'MAIN', name: 'Main Block' },
      code: 'G',
      name: 'Ground Floor',
      level: 0,
      wards: [
        {
          code: 'ER',
          name: 'Emergency',
          unitType: 'EMERGENCY',
          beds: numbered('ER', 'Trolley', 4, 'EMERGENCY_TROLLEY'),
        },
      ],
    },
    {
      key: 'MAIN/F1',
      building: { code: 'MAIN', name: 'Main Block' },
      code: 'F1',
      name: 'First Floor',
      level: 1,
      wards: [
        {
          code: 'GW-A',
          name: 'General Ward A',
          unitType: 'GENERAL',
          beds: [
            ...numbered('A', 'Bed A', 7),
            { code: 'A-08', name: 'Bed A 08', maintenance: true },
          ],
        },
        {
          code: 'PVT',
          name: 'Private Rooms',
          unitType: 'PRIVATE',
          rooms: ['101', '102', '103', '104'].map((number) => ({
            code: number,
            name: `Room ${number}`,
            roomType: 'PRIVATE' as const,
            beds: [{ code: `P${number}`, name: `Bed ${number}` }],
          })),
        },
      ],
    },
    {
      key: 'MAIN/F2',
      building: { code: 'MAIN', name: 'Main Block' },
      code: 'F2',
      name: 'Second Floor',
      level: 2,
      wards: [
        {
          code: 'ICU',
          name: 'ICU',
          unitType: 'ICU',
          beds: [
            ...numbered('ICU', 'ICU Bed', 4, 'ICU'),
            { code: 'ICU-05', name: 'ICU Bed 05', type: 'VENTILATOR' },
            { code: 'ICU-06', name: 'ICU Bed 06', type: 'VENTILATOR' },
          ],
        },
        {
          code: 'MAT',
          name: 'Maternity Ward',
          unitType: 'MATERNITY',
          rooms: ['201', '202'].map((number) => ({
            code: number,
            name: `Room ${number}`,
            roomType: 'SEMI_PRIVATE' as const,
            beds: ['A', 'B'].map((letter) => ({
              code: `M${number}-${letter}`,
              name: `Bed ${number}-${letter}`,
            })),
          })),
        },
      ],
    },
    {
      key: 'DAY/G',
      building: { code: 'DAY', name: 'Day Care Block' },
      code: 'G',
      name: 'Ground Floor',
      level: 0,
      wards: [
        {
          code: 'DIAL',
          name: 'Dialysis Unit',
          unitType: 'DIALYSIS',
          beds: numbered('D', 'Dialysis Chair', 3, 'DIALYSIS_CHAIR'),
        },
      ],
    },
  ],
  qrIssuedBy: 'kavita',
  stays: [
    // Patients in their beds now.
    { bed: 'A-01', from: [12, '09:30'], by: 'kavita' },
    { bed: 'A-02', from: [9, '11:00'], by: 'kavita' },
    { bed: 'A-03', from: [6, '14:20'], by: 'ravi' },
    { bed: 'A-04', from: [3, '10:05'], by: 'kavita' },
    { bed: 'A-05', from: [1, '18:40'], by: 'kavita' },
    { bed: 'P101', from: [10, '12:00'], by: 'kavita' },
    { bed: 'P102', from: [4, '16:30'], by: 'kavita' },
    { bed: 'ICU-01', from: [8, '02:15'], by: 'priya' },
    { bed: 'ICU-02', from: [5, '07:45'], by: 'priya' },
    { bed: 'ICU-03', from: [2, '21:10'], by: 'sunita' },
    { bed: 'M201-A', from: [3, '06:30'], by: 'sunita' },
    { bed: 'M201-B', from: [7, '13:00'], by: 'kavita' },
    { bed: 'ER-01', from: 200, by: 'kavita' },
    { bed: 'D-01', from: 180, by: 'kavita' },
    // Discharged.
    { bed: 'A-06', from: [13, '10:00'], to: [7, '12:00'], by: 'kavita', closedBy: 'ravi' },
    { bed: 'A-07', from: [11, '09:00'], to: [8, '17:30'], by: 'kavita', closedBy: 'kavita' },
    { bed: 'P103', from: [11, '15:00'], to: [4, '11:00'], by: 'kavita', closedBy: 'kavita' },
    { bed: 'ICU-04', from: [12, '04:00'], to: [6, '10:00'], by: 'priya', closedBy: 'priya' },
    { bed: 'ER-02', from: [2, '08:00'], to: [2, '13:00'], by: 'kavita', closedBy: 'meera' },
    { bed: 'D-02', from: [5, '09:00'], to: [5, '13:30'], by: 'kavita', closedBy: 'kavita' },
    { bed: 'D-01', from: [3, '09:00'], to: [3, '13:00'], by: 'kavita', closedBy: 'kavita' },
  ],
  qrChanges: {
    rotated: [{ bed: 'A-01', at: [5, '09:15'], by: 'kavita' }],
    revoked: [{ bed: 'ER-03', at: [6, '17:00'], by: 'meera' }],
  },
  requests: [
    // Today: work waiting, in progress, and done.
    { bed: 'A-04', service: 'Drinking Water', at: 2, steps: [] },
    { bed: 'ICU-02', service: 'Nurse Assistance', at: 25, steps: [] },
    { bed: 'P102', service: 'Billing Query', at: 40, steps: [] },
    {
      bed: 'A-02',
      service: 'Room Cleaning',
      at: 32,
      steps: [{ do: 'assign', by: 'ravi', to: 'suresh', after: 6 }],
    },
    {
      bed: 'A-03',
      service: 'Meal / Diet Query',
      at: 4,
      steps: [{ do: 'assign', by: 'imran', to: 'neha', after: 1 }],
    },
    {
      bed: 'ER-01',
      service: 'Nurse Assistance',
      at: 8,
      steps: [{ do: 'assign', by: 'meera', to: 'farah', after: 1 }],
    },
    {
      bed: 'ICU-01',
      service: 'Nurse Assistance',
      at: 12,
      steps: [
        { do: 'assign', by: 'priya', to: 'deepa', after: 1 },
        { do: 'accept', after: 1 },
      ],
    },
    {
      bed: 'D-01',
      service: 'Washroom Help',
      at: 15,
      steps: [
        { do: 'assign', by: 'arjun', to: 'manoj', after: 2 },
        { do: 'accept', after: 1 },
      ],
    },
    {
      bed: 'M201-A',
      service: 'Extra Blanket / Linen',
      at: 20,
      steps: [
        { do: 'assign', by: 'lakshmi', to: 'geeta', after: 2 },
        { do: 'accept', after: 2 },
        { do: 'start', after: 3 },
      ],
    },
    {
      bed: 'A-01',
      service: 'Wheelchair',
      at: 50,
      steps: [
        { do: 'assign', by: 'ravi', to: 'manoj', after: 3 },
        { do: 'accept', after: 2 },
        { do: 'start', after: 5 },
      ],
    },
    {
      bed: 'ICU-03',
      service: 'Drinking Water',
      at: 45,
      steps: [
        { do: 'assign', by: 'imran', to: 'pavan', after: 2 },
        { do: 'accept', after: 1 },
        {
          do: 'transfer',
          by: 'imran',
          to: 'neha',
          after: 15,
          reason: 'Busy with another patient',
        },
      ],
    },
    {
      bed: 'P101',
      service: 'Meal / Diet Query',
      at: 70,
      steps: [
        { do: 'assign', by: 'imran', to: 'pavan', after: 2 },
        { do: 'accept', after: 1 },
        { do: 'start', after: 2 },
        { do: 'complete', after: 12 },
      ],
    },
    {
      bed: 'A-05',
      service: 'AC / Light / TV Not Working',
      at: 95,
      steps: [
        { do: 'assign', by: 'arjun', to: 'vikram', after: 4 },
        { do: 'accept', after: 3 },
        { do: 'start', after: 10 },
        { do: 'complete', after: 35 },
      ],
    },
    {
      bed: 'A-04',
      service: 'Room Cleaning',
      at: 190,
      steps: [{ do: 'cancel', by: 'patient', after: 20, reason: 'Not needed any more' }],
    },
    {
      bed: 'A-01',
      service: 'Nurse Assistance',
      at: 150,
      steps: [
        { do: 'assign', by: 'ravi', to: 'anjali', after: 1 },
        { do: 'accept', after: 1 },
        { do: 'start', after: 1 },
        { do: 'complete', after: 6 },
        { do: 'close', by: 'ravi', after: 10 },
      ],
    },
    {
      bed: 'M201-B',
      service: 'Drinking Water',
      at: 130,
      steps: [
        { do: 'assign', by: 'sunita', to: 'pavan', after: 2 },
        { do: 'accept', after: 1 },
        { do: 'start', after: 1 },
        { do: 'complete', after: 4 },
        { do: 'close', by: 'sunita', after: 30 },
      ],
    },
    {
      bed: 'A-02',
      service: 'Drinking Water',
      at: 240,
      steps: [
        { do: 'assign', by: 'ravi', to: 'neha', after: 1 },
        { do: 'accept', after: 1 },
        { do: 'start', after: 2 },
        { do: 'complete', after: 5 },
        { do: 'close', by: 'ravi', after: 20 },
      ],
    },
    {
      bed: 'ICU-02',
      service: 'Room Cleaning',
      at: 300,
      steps: [
        { do: 'assign', by: 'lakshmi', to: 'geeta', after: 4 },
        { do: 'accept', after: 3 },
        { do: 'start', after: 5 },
        { do: 'complete', after: 40 },
        { do: 'close', by: 'priya', after: 15 },
      ],
    },
    // Earlier days: why some requests were not completed.
    {
      bed: 'A-01',
      service: 'Drinking Water',
      at: [1, '10:15'],
      steps: [{ do: 'cancel', by: 'patient', after: 2, reason: 'Family brought water' }],
    },
    {
      bed: 'P102',
      service: 'Drinking Water',
      at: [1, '19:40'],
      steps: [
        { do: 'assign', by: 'imran', to: 'neha', after: 2 },
        { do: 'accept', after: 1 },
        { do: 'start', after: 1 },
        { do: 'complete', after: 6 },
      ],
    },
    {
      bed: 'ICU-02',
      service: 'Drinking Water',
      at: [2, '08:30'],
      steps: [
        { do: 'assign', by: 'priya', to: 'pavan', after: 2 },
        {
          do: 'reject',
          after: 3,
          reason: 'Patient is fasting before surgery (nil by mouth) - checked with the nurse',
        },
      ],
    },
    {
      bed: 'A-04',
      service: 'Wheelchair',
      at: [2, '11:00'],
      steps: [
        { do: 'assign', by: 'ravi', to: 'manoj', after: 6 },
        { do: 'accept', after: 4 },
        { do: 'start', after: 20 },
        { do: 'complete', after: 65 },
        { do: 'close', by: 'ravi', after: 10 },
      ],
    },
    {
      bed: 'ER-02',
      service: 'Nurse Assistance',
      at: [2, '08:20'],
      steps: [
        { do: 'assign', by: 'meera', to: 'farah', after: 1 },
        { do: 'accept', after: 1 },
        { do: 'start', after: 1 },
        { do: 'complete', after: 5 },
        { do: 'close', by: 'meera', after: 10 },
      ],
    },
    {
      bed: 'A-03',
      service: 'Drinking Water',
      at: [3, '13:10'],
      steps: [{ do: 'cancel', by: 'ravi', after: 4, reason: 'Duplicate request' }],
    },
    {
      bed: 'ICU-02',
      service: 'Nurse Assistance',
      at: [3, '22:05'],
      steps: [
        { do: 'assign', by: 'priya', to: 'deepa', after: 1 },
        { do: 'accept', after: 1 },
        { do: 'transfer', by: 'priya', to: 'rahul', after: 3, reason: 'My shift has ended' },
        { do: 'accept', after: 2 },
        { do: 'start', after: 1 },
        { do: 'complete', after: 7 },
        { do: 'close', by: 'priya', after: 40 },
      ],
    },
    {
      bed: 'A-02',
      service: 'Meal / Diet Query',
      at: [4, '12:30'],
      steps: [
        { do: 'assign', by: 'imran', to: 'neha', after: 3 },
        { do: 'reject', after: 5, reason: 'Diet chart not yet updated by the dietician' },
      ],
    },
    {
      bed: 'ICU-01',
      service: 'Room Cleaning',
      at: [5, '10:45'],
      steps: [
        { do: 'assign', by: 'lakshmi', to: 'geeta', after: 5 },
        {
          do: 'cancel',
          by: 'priya',
          after: 10,
          reason: 'Patient taken for a CT scan; will request again',
        },
      ],
    },
    {
      bed: 'D-02',
      service: 'Washroom Help',
      at: [5, '10:00'],
      steps: [
        { do: 'assign', by: 'arjun', to: 'manoj', after: 2 },
        { do: 'accept', after: 1 },
        { do: 'start', after: 2 },
        { do: 'complete', after: 8 },
        { do: 'close', by: 'arjun', after: 30 },
      ],
    },
    {
      bed: 'P103',
      service: 'Room Cleaning',
      at: [6, '16:20'],
      steps: [
        { do: 'assign', by: 'lakshmi', to: 'karan', after: 4 },
        { do: 'reject', after: 12, reason: 'Patient asleep - family asked us to come back later' },
      ],
    },
    {
      bed: 'M201-B',
      service: 'Extra Blanket / Linen',
      at: [7, '23:10'],
      steps: [{ do: 'cancel', by: 'patient', after: 15, reason: 'Not needed any more' }],
    },
    {
      bed: 'P101',
      service: 'Billing Query',
      at: [8, '15:00'],
      steps: [{ do: 'cancel', by: 'arjun', after: 25, reason: 'Answered at the billing counter' }],
    },
    {
      bed: 'A-01',
      service: 'Wheelchair',
      at: [9, '09:40'],
      steps: [
        { do: 'assign', by: 'ravi', to: 'manoj', after: 3 },
        { do: 'reject', after: 2, reason: 'Wheelchair under repair - none free on this floor' },
      ],
    },
    {
      bed: 'A-07',
      service: 'Room Cleaning',
      at: [10, '11:30'],
      steps: [
        { do: 'assign', by: 'lakshmi', to: 'karan', after: 3 },
        { do: 'accept', after: 4 },
        { do: 'transfer', by: 'lakshmi', to: 'suresh', after: 20, reason: 'Karan went on break' },
        { do: 'accept', after: 2 },
        { do: 'start', after: 3 },
        { do: 'complete', after: 25 },
        { do: 'close', by: 'lakshmi', after: 15 },
      ],
    },
    {
      bed: 'ICU-04',
      service: 'Nurse Assistance',
      at: [11, '03:20'],
      steps: [
        { do: 'assign', by: 'sunita', to: 'deepa', after: 9 },
        { do: 'accept', after: 3 },
        { do: 'start', after: 2 },
        { do: 'complete', after: 15 },
        { do: 'close', by: 'sunita', after: 120 },
      ],
    },
    {
      bed: 'A-06',
      service: 'Drinking Water',
      at: [12, '18:00'],
      steps: [
        { do: 'assign', by: 'ravi', to: 'neha', after: 2 },
        { do: 'accept', after: 1 },
        { do: 'start', after: 1 },
        { do: 'complete', after: 3 },
        { do: 'close', by: 'ravi', after: 5 },
      ],
    },
  ],
  routine: {
    days: 13,
    perDay: [4, 8],
    services: [
      ['Drinking Water', 25],
      ['Nurse Assistance', 20],
      ['Room Cleaning', 12],
      ['Meal / Diet Query', 10],
      ['Extra Blanket / Linen', 10],
      ['Washroom Help', 8],
      ['Wheelchair', 8],
      ['AC / Light / TV Not Working', 7],
    ],
    managers: {
      departments: { PANTRY: ['imran'], HOUSEKEEPING: ['lakshmi'] },
      wards: { ICU: ['priya'] },
      floors: { 'MAIN/F1': ['ravi'], 'MAIN/F2': ['sunita'] },
      fallback: ['meera', 'arjun'],
    },
  },
  shifts: [
    { person: 'rahul', department: 'NURSING', from: [-1, '08:00'], hours: 8, by: 'arjun' },
    { person: 'anjali', department: 'NURSING', from: [-1, '14:00'], hours: 8, by: 'arjun' },
    { person: 'geeta', department: 'HOUSEKEEPING', from: [-1, '06:00'], hours: 8, by: 'arjun' },
    { person: 'pavan', department: 'PANTRY', from: [-2, '07:00'], hours: 8, by: 'arjun' },
  ],
};

// A second, small client to check that hospitals never see each other's data.
export const greenValley: HospitalSpec = {
  code: 'GREENVALLEY',
  name: 'Green Valley Clinic',
  domain: 'greenvalley.example',
  createdAt: [10, '11:00'],
  logo: { color: [22, 163, 74], shape: 'circle' },
  people: [
    {
      key: 'rohan',
      name: 'Dr. Rohan Das',
      email: 'rohan.das',
      roles: [{ role: 'HOSPITAL_MANAGER', scope: 'hospital' }],
    },
    {
      key: 'sneha',
      name: 'Sneha Kulkarni',
      email: 'sneha.kulkarni',
      roles: careStaff(),
      departments: ['NURSING'],
      coverage: ['hospital'],
      onDuty: true,
    },
  ],
  floors: [
    {
      key: 'G',
      code: 'G',
      name: 'Ground Floor',
      level: 0,
      wards: [
        {
          code: 'DC',
          name: 'Day Care',
          unitType: 'DAY_CARE',
          beds: numbered('DC', 'Chair', 4, 'DAY_CARE_CHAIR'),
        },
      ],
    },
  ],
  qrIssuedBy: 'rohan',
  stays: [
    { bed: 'DC-01', from: 240, by: 'rohan' },
    { bed: 'DC-02', from: 120, by: 'rohan' },
    { bed: 'DC-03', from: [1, '09:00'], to: [1, '14:00'], by: 'rohan', closedBy: 'rohan' },
  ],
  requests: [
    {
      bed: 'DC-03',
      service: 'Nurse Assistance',
      at: [1, '10:00'],
      steps: [
        { do: 'assign', by: 'rohan', to: 'sneha', after: 2 },
        { do: 'accept', after: 1 },
        { do: 'start', after: 1 },
        { do: 'complete', after: 6 },
        { do: 'close', by: 'rohan', after: 20 },
      ],
    },
    { bed: 'DC-01', service: 'Drinking Water', at: 30, steps: [] },
    {
      bed: 'DC-02',
      service: 'Room Cleaning',
      at: 60,
      steps: [{ do: 'cancel', by: 'patient', after: 5, reason: 'Not needed any more' }],
    },
  ],
};

export const testHospitalSpecs: readonly HospitalSpec[] = [cityCare, greenValley];
