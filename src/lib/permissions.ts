/**
 * Role-based access control. The server enforces these on every admin API call and page;
 * the UI uses the same map only to hide controls a user cannot use.
 */
export const ROLES = ['customer', 'staff', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'dashboard:view',
  'catalog:manage',
  'inventory:manage',
  'orders:manage',
  'customers:view',
  'customers:manage',
  'coupons:manage',
  'shipping:manage',
  'settings:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  customer: [],
  staff: ['dashboard:view', 'catalog:manage', 'inventory:manage', 'orders:manage', 'customers:view'],
  admin: PERMISSIONS,
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function isStaffRole(role: Role | null | undefined): boolean {
  return role === 'staff' || role === 'admin';
}

export const ROLE_LABEL: Record<Role, string> = {
  customer: 'Customer',
  staff: 'Staff',
  admin: 'Administrator',
};
