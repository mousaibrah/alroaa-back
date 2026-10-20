import { SetMetadata } from '@nestjs/common';
import type { Permission } from '../constants/permissions.js';

export const PERMISSIONS_KEY = 'permissions';

// The caller must hold ALL of the listed permissions.
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
