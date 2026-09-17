import { z } from 'zod'

const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Username must be at least 3 characters.')
  .max(32, 'Username must be 32 characters or fewer.')
  .regex(/^[a-z0-9._-]+$/, 'Use only letters, numbers, dots, underscores and hyphens.')

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(128, 'Password is too long.')
  .regex(/[a-z]/, 'Include at least one lowercase letter.')
  .regex(/[A-Z]/, 'Include at least one uppercase letter.')
  .regex(/\d/, 'Include at least one number.')

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Enter your username.'),
  password: z.string().min(1, 'Enter your password.'),
})
export type LoginInput = z.infer<typeof loginSchema>

export const createUserSchema = z.object({
  username,
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  name: z.string().trim().min(2, 'Enter a full name.').max(80),
  jobTitle: z.string().trim().max(80).optional().or(z.literal('')),
  password,
  roleKey: z.enum(['ADMIN', 'PROJECT_MANAGER', 'USER']),
  mustChangePassword: z.boolean().default(true),
})
export type CreateUserInput = z.infer<typeof createUserSchema>

export const updateUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  name: z.string().trim().min(2, 'Enter a full name.').max(80),
  jobTitle: z.string().trim().max(80).optional().or(z.literal('')),
  roleKey: z.enum(['ADMIN', 'PROJECT_MANAGER', 'USER']),
})
export type UpdateUserInput = z.infer<typeof updateUserSchema>

export const adminResetPasswordSchema = z.object({
  userId: z.string().min(1),
  password,
  mustChangePassword: z.boolean().default(true),
})
export type AdminResetPasswordInput = z.infer<typeof adminResetPasswordSchema>

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: password,
    confirmPassword: z.string().min(1, 'Confirm your new password.'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: 'Choose a password different from your current one.',
    path: ['newPassword'],
  })
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>

export const setUserActiveSchema = z.object({
  userId: z.string().min(1),
  isActive: z.boolean(),
})
export type SetUserActiveInput = z.infer<typeof setUserActiveSchema>

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2, 'Enter a full name.').max(80),
  jobTitle: z.string().trim().max(80).optional().or(z.literal('')),
})
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
