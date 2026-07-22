import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  if (locals.role === 'admin') {
    redirect(303, resolve('/admin'));
  }
  if (locals.role === 'player') {
    redirect(303, resolve(`/teams/${locals.teamSlug}`));
  }
  redirect(303, resolve('/login'));
};
