import { query, command, getRequestEvent } from '$app/server';
import { env } from '$env/dynamic/private';

const SERVER_URL = () => env.SERVER_URL || 'http://localhost:8080';
const INTERNAL_SECRET = () => env.INTERNAL_SECRET || '';

/** Forward a POST request to the DroidClaw server with internal auth */
async function serverFetch(path: string, body?: Record<string, unknown>) {
	const { locals } = getRequestEvent();
	if (!locals.user) throw new Error('unauthorized');

	const res = await fetch(`${SERVER_URL()}${path}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-internal-secret': INTERNAL_SECRET(),
			'x-internal-user-id': locals.user.id
		},
		body: JSON.stringify(body ?? {})
	});
	const data = await res.json().catch(() => ({ error: 'Unknown error' }));
	if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
	return data;
}

/** Forward a GET request to the DroidClaw server with internal auth */
async function serverGet(path: string) {
	const { locals } = getRequestEvent();
	if (!locals.user) throw new Error('unauthorized');

	const res = await fetch(`${SERVER_URL()}${path}`, {
		method: 'GET',
		headers: {
			'x-internal-secret': INTERNAL_SECRET(),
			'x-internal-user-id': locals.user.id
		}
	});
	const data = await res.json().catch(() => ({ error: 'Unknown error' }));
	if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
	return data;
}

/** Generate a 6-digit pairing code for the current user */
export const createPairingCode = command(async () => {
	return serverFetch('/pairing/create') as Promise<{ code: string; expiresAt: string }>;
});

/** Check whether the user's pairing code has been claimed */
export const getPairingStatus = query(async () => {
	return serverGet('/pairing/status') as Promise<{ paired: boolean; expired?: boolean }>;
});
