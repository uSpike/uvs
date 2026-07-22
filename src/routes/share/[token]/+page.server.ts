import { error } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { CatalogRepository } from '$lib/server/catalog';
import { ShareLinkRepository } from '$lib/server/share-links';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
  const gameToken = new ShareLinkRepository().resolveGameToken(params.token);
  if (!gameToken) error(404, 'Share link not found or no longer active.');
  const game = new CatalogRepository().getGameViewByToken(gameToken);
  if (!game) error(404, 'Game not found.');
  if (!game.hasVideo) error(404, 'This game does not have video to share.');
  return {
    game: {
      title: game.title,
      teamName: game.teamName,
      settings: game.settings,
      metadataUrl: resolve(`/api/shares/${params.token}/metadata`),
      videoUrl: resolve(`/api/shares/${params.token}/video`),
    },
  };
};
