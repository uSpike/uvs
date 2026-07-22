import { error, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, params, url }) => {
  if (locals.role === 'guest') {
    redirect(303, `${resolve('/login')}?next=${encodeURIComponent(url.pathname)}`);
  }
  if (locals.role === 'player' && locals.teamSlug !== params.slug) {
    error(403, 'This team requires its own team password.');
  }
  return {};
};
