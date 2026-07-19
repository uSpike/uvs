import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  if (locals.role === 'admin') {
    redirect(303, '/admin');
  }
  if (locals.role === 'player') {
    redirect(303, `/teams/${locals.teamSlug}`);
  }
  redirect(303, '/login');
};
