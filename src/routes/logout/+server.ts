import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { clearRoleSession } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ cookies }) => {
  clearRoleSession(cookies);
  redirect(303, resolve('/login'));
};
