import type { User } from './types';

// Fake current user state
let currentUser: User | null = null;

export async function login(): Promise<User> {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 500));
  currentUser = {
    id: 'user_123',
    email: 'hello@example.com',
    createdAt: new Date().toISOString(),
  };
  return currentUser;
}

export async function logout(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  currentUser = null;
}

export async function getCurrentUser(): Promise<User | null> {
  await new Promise((resolve) => setTimeout(resolve, 100));
  return currentUser;
}
