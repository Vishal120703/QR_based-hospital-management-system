import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fixturePath } from './fixture';

// Creates fresh hospitals in the test database for this run (see
// services/tests/support/e2e-setup.ts) and saves what the tests need.
export default function globalSetup(): void {
  const services = fileURLToPath(new URL('../../services', import.meta.url));
  const output = execFileSync(process.execPath, ['--import', 'tsx', 'tests/support/e2e-setup.ts'], {
    cwd: services,
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
    encoding: 'utf8',
  });
  writeFileSync(fixturePath, output);
}
