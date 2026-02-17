import { svelteKitHandler } from 'better-auth/svelte-kit';
import { auth } from '$lib/server/auth';
import { building } from '$app/environment';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	try {
		const session = await auth.api.getSession({
			headers: event.request.headers
		});

		if (session) {
			event.locals.session = session.session;
			event.locals.user = session.user;
		} else if (event.url.pathname.startsWith('/api/')) {
			console.log(`[Auth] No session for ${event.request.method} ${event.url.pathname}`);
			console.log(`[Auth] Cookie header: ${event.request.headers.get('cookie')?.slice(0, 80) ?? 'NONE'}`);
		}
	} catch (err) {
		console.error(`[Auth] getSession error for ${event.request.method} ${event.url.pathname}:`, err);
	}

	return svelteKitHandler({ event, resolve, auth, building });
};
