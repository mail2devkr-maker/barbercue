-- Synthetic pre-register staff (what production looks like before the HR migration). Disposable databases only.
INSERT INTO users (id, email, status, "passwordHash", "updatedAt") VALUES
  ('u-exist-1', 'existing1@example.test', 'ACTIVE',    'x', now()),
  ('u-exist-2', 'existing2@example.test', 'SUSPENDED', 'x', now()),
  ('u-exist-3', 'existing3@example.test', 'ACTIVE',    'x', now());
INSERT INTO employee_profiles (id, "userId", "employeeCode", "fullName", territory, "joinedAt", "updatedAt") VALUES
  ('ep-exist-1', 'u-exist-1', 'FQ-FE-00101', 'Existing  Employee One', 'Patna',  '2026-03-02T04:00:00Z', now()),
  ('ep-exist-2', 'u-exist-2', 'FQ-FE-00102', 'Existing Employee Two',  'Delhi',  '2026-04-06T04:00:00Z', now()),
  ('ep-exist-3', 'u-exist-3', 'FQ-FE-00007', 'Reserved Employee',      'Mumbai', '2026-01-05T04:00:00Z', now());
