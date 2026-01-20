// List of admin user IDs
export const ADMIN_USER_IDS = [
  "bfb638a8-e4e0-419d-96ff-2829471851b8",
];

export function isAdminUser(userId: string | undefined): boolean {
  if (!userId) return false;
  return ADMIN_USER_IDS.includes(userId);
}
