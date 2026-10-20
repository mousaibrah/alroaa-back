// Role names as stored in `roles.name` (see database/seed.sql).
export enum UserRole {
  ADMIN = 'admin',
  STUDENT = 'student',
  INSTRUCTOR = 'instructor',
}

// Roles a caller may pick on the public register endpoint. ADMIN is
// deliberately absent: admins are only created directly in the database.
export enum RegisterRole {
  STUDENT = UserRole.STUDENT,
  INSTRUCTOR = UserRole.INSTRUCTOR,
}
