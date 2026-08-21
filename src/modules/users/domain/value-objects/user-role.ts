/** Union y no enum: convención del repo (`type`, nunca `interface`; uniones sobre enums). */
export const USER_ROLES = ['admin', 'user'] as const;
export type UserRole = (typeof USER_ROLES)[number];
