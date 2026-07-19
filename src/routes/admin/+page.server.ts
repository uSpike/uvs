import { fail, redirect } from '@sveltejs/kit';
import { CatalogRepository } from '$lib/server/catalog';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
  const catalog = new CatalogRepository();
  return { teams: catalog.listTeams() };
};

export const actions: Actions = {
  createTeam: async ({ request, locals }) => {
    requireAdmin(locals.role);
    const form = await request.formData();
    const name = String(form.get('name') ?? '');
    const password = String(form.get('password') ?? '');
    try {
      new CatalogRepository().createTeam(name, password);
      return { action: 'createTeam', success: true };
    } catch (error) {
      return fail(400, {
        action: 'createTeam',
        error: errorMessage(error),
        name,
      });
    }
  },

};

function requireAdmin(role: App.Locals['role']): void {
  if (role !== 'admin') {
    redirect(303, '/login?next=/admin');
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}
