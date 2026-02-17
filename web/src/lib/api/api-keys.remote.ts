import { form, getRequestEvent, query } from '$app/server';
import { auth } from '$lib/server/auth';
import { createKeySchema, deleteKeySchema } from '$lib/schema/api-keys';

export const listKeys = query(async () => {
	const { request } = getRequestEvent();
	return await auth.api.listApiKeys({ headers: request.headers });
});

export const createKey = form(createKeySchema, async ({ name }) => {
	const { request } = getRequestEvent();
	const result = await auth.api.createApiKey({
		body: { name, prefix: 'dc' },
		headers: request.headers
	});
	return result;
});

export const deleteKey = form(deleteKeySchema, async ({ keyId }) => {
	const { request } = getRequestEvent();
	await auth.api.deleteApiKey({
		body: { keyId },
		headers: request.headers
	});
	return { deleted: true };
});
