-- Starter data: roles, permissions and their mapping.
-- Run after schema.sql. Safe to re-run (idempotent).
-- Role ids matter: DEFAULT_ROLE_ID = 2 (student) in src/auth/auth.service.ts.

INSERT INTO roles (id, name, description) VALUES
    (1, 'admin',      'Full access to the platform'),
    (2, 'user',    'Default role: can enroll in and take courses')
ON CONFLICT (id) DO NOTHING;

INSERT INTO permissions (id, name, description) VALUES
    (1,  'users.read',        'View users'),
    (2,  'users.manage',      'Create, update and delete users'),
    (3,  'roles.manage',      'Manage roles and permissions'),
    (4,  'courses.read',      'View published courses'),
    (5,  'courses.create',    'Create courses'),
    (6,  'courses.update',    'Update courses'),
    (7,  'courses.delete',    'Delete courses'),
    (8,  'exams.manage',      'Create and manage exams and questions'),
    (9,  'exams.take',        'Take exams'),
    (10, 'enrollments.create','Enroll in a course'),
    (11, 'enrollments.manage','Manage any enrollment'),
    (12, 'payments.read',     'View payments'),
    (13, 'payments.manage',   'Refund and manage payments')
ON CONFLICT (id) DO NOTHING;

-- admin: everything
INSERT INTO role_permissions (role_id, permission_id)
SELECT 1, id FROM permissions
WHERE NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = 1 AND rp.permission_id = permissions.id
);

-- user
INSERT INTO role_permissions (role_id, permission_id)
SELECT 2, id FROM permissions WHERE name IN ('courses.read', 'exams.take', 'enrollments.create')
AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = 2 AND rp.permission_id = permissions.id
);


-- Explicit ids were used above, so move the sequences past them.
SELECT setval(pg_get_serial_sequence('roles', 'id'), (SELECT MAX(id) FROM roles));
SELECT setval(pg_get_serial_sequence('permissions', 'id'), (SELECT MAX(id) FROM permissions));
