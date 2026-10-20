// Permission names as stored in `permissions.name` (see database/seed.sql).
export enum Permission {
  USERS_READ = 'users.read',
  USERS_MANAGE = 'users.manage',
  ROLES_MANAGE = 'roles.manage',
  COURSES_READ = 'courses.read',
  COURSES_CREATE = 'courses.create',
  COURSES_UPDATE = 'courses.update',
  COURSES_DELETE = 'courses.delete',
  EXAMS_MANAGE = 'exams.manage',
  EXAMS_TAKE = 'exams.take',
  ENROLLMENTS_CREATE = 'enrollments.create',
  ENROLLMENTS_MANAGE = 'enrollments.manage',
  PAYMENTS_READ = 'payments.read',
  PAYMENTS_MANAGE = 'payments.manage',
}
