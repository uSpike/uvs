import { error } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { CatalogRepository } from '$lib/server/catalog';
import { ShareLinkRepository } from '$lib/server/share-links';
import { directBrowserVideoSource } from '$lib/server/video-source';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
  const gameToken = new ShareLinkRepository().resolveGameToken(params.token);
  if (!gameToken) error(404, 'Share link not found or no longer active.');
  const game = new CatalogRepository().getGameViewByToken(gameToken);
  if (!game) error(404, 'Game not found.');
  if (!game.hasVideo) error(404, 'This game does not have video to share.');
  const videoSource = new CatalogRepository().getVideoSourceByToken(gameToken);
  if (!videoSource) error(404, 'Game video not found.');
  return {
    game: {
      title: game.title,
      teamName: game.teamName,
      settings: game.settings,
      metadataUrl: resolve(`/api/shares/${params.token}/metadata`),
      videoUrl: directBrowserVideoSource(videoSource)
        ?? resolve(`/api/shares/${params.token}/video`),
    },
  };
};
