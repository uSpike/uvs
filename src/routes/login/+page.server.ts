import { fail, redirect } from '@sveltejs/kit';
import {
  authenticateAdminPassword,
  authenticateTeamPassword,
  loginDestination,
  setAuthSession,
} from '$lib/server/auth';
import { CatalogRepository } from '$lib/server/catalog';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, locals }) => ({
  currentRole: locals.role,
  currentTeamSlug: locals.teamSlug,
  teams: new CatalogRepository().listTeams(),
  next: url.searchParams.get('next') ?? '',
});

export const actions: Actions = {
  default: async ({ request, cookies, url }) => {
    const form = await request.formData();
    const teamSlug = String(form.get('teamSlug') ?? '');
    const password = String(form.get('password') ?? '');
    const session = teamSlug
      ? authenticateTeamPassword(teamSlug, password)
      : authenticateAdminPassword(password)
        ? { role: 'admin' as const, teamId: null, teamSlug: null }
        : null;
    if (!session) {
      return fail(400, { invalid: true, teamSlug });
    }
    setAuthSession(cookies, session);
    redirect(303, loginDestination(session, url.searchParams.get('next')));
  },
};
