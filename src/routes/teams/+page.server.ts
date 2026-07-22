import { CatalogRepository } from '$lib/server/catalog';
import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  if (locals.role === 'player') redirect(303, resolve(`/teams/${locals.teamSlug}`));
  return { teams: new CatalogRepository().listTeams() };
};
