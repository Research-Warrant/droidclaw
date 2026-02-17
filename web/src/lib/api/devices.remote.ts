import { query, getRequestEvent } from '$app/server';
import { env } from '$env/dynamic/private';

const SERVER_URL = env.SERVER_URL || 'http://localhost:8080';

export const listDevices = query(async () => {
	const { request } = getRequestEvent();

	const res = await fetch(`${SERVER_URL}/devices`, {
		headers: {
			cookie: request.headers.get('cookie') ?? ''
		}
	});

	if (!res.ok) return [];
	return res.json();
});
