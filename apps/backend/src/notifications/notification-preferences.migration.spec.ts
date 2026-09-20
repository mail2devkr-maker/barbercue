import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// A guard for the hardest requirement of the notification-preferences feature: existing users with no
// preference rows must stay ON by default, and no migration may silently create (or flip) OFF rows.
// "No stored row" is what means "default", so any migration that writes to notification_preferences
// would break that promise for someone. This test reads every migration that touches the table.
describe('notification preference migrations', () => {
  const migrationsDir = join(__dirname, '..', '..', 'prisma', 'migrations');
  const sql = (dir: string) => readFileSync(join(migrationsDir, dir, 'migration.sql'), 'utf8');

  it('the ARRIVAL_ALERTS migration only adds an enum value - it writes no preference rows', () => {
    const dir = readdirSync(migrationsDir).find((d) => d.endsWith('_add_arrival_alerts_notification_category'));
    expect(dir).toBeDefined();
    const text = sql(dir!);
    const code = text
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(code).toMatch(/ALTER TYPE "NotificationCategory" ADD VALUE 'ARRIVAL_ALERTS'/);
    expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    expect(code).not.toMatch(/notification_preferences/i);
  });

  it('no migration ever inserts, updates or deletes rows in notification_preferences (no silent OFF rows)', () => {
    for (const dir of readdirSync(migrationsDir).filter((d) => /^\d/.test(d))) {
      const code = sql(dir)
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');
      const writesPrefs =
        /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(\s+TABLE)?)\s+"?notification_preferences"?/i.test(code);
      expect({ dir, writesPrefs }).toEqual({ dir, writesPrefs: false });
    }
  });
});
