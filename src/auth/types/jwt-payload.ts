// Claims stored in the access token. The frontend reads `role` and
// `permissions` to shape the UI; the backend re-checks `permissions` on every
// request through PermissionsGuard.
export interface JwtPayload {
  sub: number;
  email: string;
  roleId: number;
  role: string;
  permissions: string[];
  // Issued-at (seconds), set by the JWT library.
  iat?: number;
}
