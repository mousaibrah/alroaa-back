// Role names as stored in `roles.name` (see database/seed.sql). Everyone who
// registers gets USER; admins are only created directly in the database.
export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
}
