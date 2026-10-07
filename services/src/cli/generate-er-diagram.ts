import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Prisma } from '@prisma/client';

// Writes the database ER diagrams (Mermaid) from the Prisma schema, so the
// documentation always matches the real tables. Run: npm run docs:er

type Model = (typeof Prisma.dmmf.datamodel.models)[number];
type Field = Model['fields'][number];

const models = Prisma.dmmf.datamodel.models;
const enums = new Set(Prisma.dmmf.datamodel.enums.map((item) => item.name));

// Tables grouped the way the backend modules own them.
const domains: readonly { title: string; about: string; models: readonly string[] }[] = [
  {
    title: 'Clients, hospitals, and sign-in',
    about:
      'A client (customer) owns hospitals. A user signs in to a hospital through a membership; super admins have a separate platform account and session.',
    models: [
      'Client',
      'Hospital',
      'HospitalLogo',
      'HospitalSetting',
      'User',
      'PlatformAdmin',
      'PlatformSession',
      'HospitalMembership',
      'StaffSession',
    ],
  },
  {
    title: 'Roles and access',
    about:
      'A role is a set of permissions. A person holds a role (UserRole) for one or more places (ScopeAssignment): the hospital, a floor, a ward, or a department.',
    models: [
      'HospitalMembership',
      'Role',
      'Permission',
      'RolePermission',
      'UserRole',
      'ScopeAssignment',
    ],
  },
  {
    title: 'Locations, QR codes, and patient access',
    about:
      'Building → Floor → Ward → Room → Bed. Each bed has at most one QR code. A bed session is one patient stay; scanning the QR creates a short-lived guest session for it.',
    models: ['Building', 'Floor', 'Ward', 'Room', 'Bed', 'BedQrCode', 'BedSession', 'GuestSession'],
  },
  {
    title: 'Staff, departments, and shifts',
    about:
      'Staff belong to departments and cover parts of the hospital. Shifts are informational; duty status decides who can receive work.',
    models: [
      'HospitalMembership',
      'Department',
      'StaffDepartment',
      'StaffLocationScope',
      'Shift',
      'Floor',
      'Ward',
    ],
  },
  {
    title: 'Service catalog and response targets',
    about:
      'Services are grouped in categories, handled by a department, and timed by a versioned SLA policy. Escalation policies are configured for later automation.',
    models: [
      'ServiceCategory',
      'ServiceItem',
      'Department',
      'SlaPolicy',
      'SlaPolicyVersion',
      'EscalationPolicy',
      'EscalationLevel',
      'Role',
    ],
  },
  {
    title: 'Requests and audit',
    about:
      'A request copies its service and SLA at submission. Every change appends one RequestEvent (never edited). AuditLog records every administrative change.',
    models: [
      'ServiceRequest',
      'RequestEvent',
      'Bed',
      'BedSession',
      'ServiceItem',
      'Department',
      'HospitalMembership',
      'SlaPolicyVersion',
      'AuditLog',
      'Hospital',
    ],
  },
];

// In the overview, every tenant table's link to Hospital would hide the
// structure; these are the ones worth drawing.
const overviewHospitalChildren = new Set([
  'HospitalLogo',
  'HospitalSetting',
  'HospitalMembership',
  'Role',
  'Building',
  'Floor',
  'Department',
  'ServiceCategory',
  'SlaPolicy',
  'EscalationPolicy',
  'AuditLog',
]);

function modelNamed(name: string): Model {
  const model = models.find((item) => item.name === name);
  if (!model) throw new Error(`Unknown model ${name}`);
  return model;
}

function foreignKeys(model: Model): Set<string> {
  return new Set(model.fields.flatMap((field) => [...(field.relationFromFields ?? [])]));
}

function columnType(field: Field): string {
  if (enums.has(field.type)) return field.type;
  if (field.type === 'String' && (field.name === 'id' || field.name.endsWith('Id'))) return 'uuid';
  return field.type.toLowerCase();
}

function attributes(model: Model): string[] {
  const keys = foreignKeys(model);
  return model.fields
    .filter((field) => field.kind !== 'object')
    .map((field) => {
      const marks = [
        field.isId ? 'PK' : null,
        keys.has(field.name) ? 'FK' : null,
        field.isUnique ? 'UK' : null,
      ].filter(Boolean);
      const optional = field.isRequired ? '' : ' "optional"';
      return `    ${columnType(field)}${field.isList ? '_list' : ''} ${field.name}${marks.length ? ` ${marks.join(', ')}` : ''}${optional}`;
    });
}

interface Relationship {
  readonly parent: string;
  readonly child: string;
  readonly line: string;
}

// One line per foreign key, drawn from the referenced table to the table
// that holds the key.
function relationships(): Relationship[] {
  const lines: Relationship[] = [];
  for (const child of models) {
    for (const field of child.fields) {
      if (field.kind !== 'object' || !field.relationFromFields?.length) continue;
      const parent = modelNamed(field.type);
      const back = parent.fields.find(
        (item) => item.relationName === field.relationName && item.type === child.name,
      );
      const parentSide = field.isRequired ? '||' : '|o';
      const childSide = back?.isList ? 'o{' : 'o|';
      lines.push({
        parent: parent.name,
        child: child.name,
        line: `  ${parent.name} ${parentSide}--${childSide} ${child.name} : "${field.name}"`,
      });
    }
  }
  return lines;
}

function diagram(
  names: readonly string[],
  withAttributes: boolean,
  filter?: (r: Relationship) => boolean,
) {
  const included = new Set(names);
  const body: string[] = ['```mermaid', 'erDiagram'];
  if (withAttributes) {
    for (const name of names) {
      body.push(`  ${name} {`, ...attributes(modelNamed(name)), '  }');
    }
  }
  for (const relation of relationships()) {
    if (!included.has(relation.parent) || !included.has(relation.child)) continue;
    if (filter && !filter(relation)) continue;
    body.push(relation.line);
  }
  body.push('```');
  return body.join('\n');
}

async function main(): Promise<void> {
  const sourceSchema = await readFile(resolve('prisma/schema.prisma'), 'utf8');
  const generatedSchema = await readFile(
    resolve('node_modules/.prisma/client/schema.prisma'),
    'utf8',
  ).catch(() => '');
  if (sourceSchema !== generatedSchema) {
    throw new Error('Prisma client is missing or stale: run npm run prisma:generate first');
  }

  const check = process.argv.includes('--check');
  const target = resolve(
    process.argv.slice(2).find((argument) => argument !== '--check') ??
      '../docs/database/er-diagram.md',
  );
  const sections = [
    '# Database ER diagrams',
    '',
    '> Generated by `npm run docs:er` (in `services/`) from `services/prisma/schema.prisma`. Do not edit by hand: change the schema, add a migration, run `npm run prisma:generate`, and then regenerate this file.',
    '',
    'How to read the lines: `||` exactly one, `|o` zero or one, `o{` zero or many. The label is the field that holds the link. Keys: **PK** primary key, **FK** foreign key, **UK** unique.',
    '',
    'Hospital-owned tables carry `hospitalId`; tenant-owned references use composite foreign keys where needed to prevent cross-hospital links. `Client`, `Hospital`, `User`, `Permission`, `PlatformAdmin`, and `PlatformSession` are platform/global tables.',
    '',
    '## Overview (all tables)',
    '',
    'Only the main links to `Hospital` are drawn here; the domain diagrams below show every column.',
    '',
    diagram(
      models.map((model) => model.name),
      false,
      (relation) => relation.parent !== 'Hospital' || overviewHospitalChildren.has(relation.child),
    ),
    '',
  ];
  for (const domain of domains) {
    sections.push(`## ${domain.title}`, '', domain.about, '', diagram(domain.models, true), '');
  }
  sections.push(
    '## Enumerations',
    '',
    '| Enum | Values |',
    '|---|---|',
    ...Prisma.dmmf.datamodel.enums.map(
      (item) =>
        `| \`${item.name}\` | ${item.values.map((value) => `\`${value.name}\``).join(', ')} |`,
    ),
    '',
  );
  const generated = sections.join('\n');
  if (check) {
    if ((await readFile(target, 'utf8')) !== generated) {
      throw new Error(`ER diagram is out of date: run npm run docs:er to update ${target}`);
    }
    process.stdout.write(`ER diagram is current: ${target}\n`);
  } else {
    await writeFile(target, generated);
    process.stdout.write(`Wrote ${target}\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
