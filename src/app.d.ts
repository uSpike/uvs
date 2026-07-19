declare global {
  namespace App {
    interface Locals {
      role: import('$lib/server/auth').AccessRole;
      teamId: number | null;
      teamSlug: string | null;
    }
  }
}

export {};
