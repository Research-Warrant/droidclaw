import { redirect } from '@sveltejs/kit';
import { form, getRequestEvent, query } from '$app/server';
import { auth } from '$lib/server/auth';
import { signupSchema, loginSchema } from '$lib/schema/auth';

export const signup = form(signupSchema, async (user) => {
	await auth.api.signUpEmail({ body: user });
	redirect(307, '/verify-email');
});

export const login = form(loginSchema, async (user) => {
	const { request, url } = getRequestEvent();
	await auth.api.signInEmail({ body: user, headers: request.headers });
	const next = url.searchParams.get('redirect') || '/dashboard';
	redirect(303, next);
});

export const signout = form(async () => {
	const { request } = getRequestEvent();
	await auth.api.signOut({ headers: request.headers });
	redirect(303, '/login');
});

export const getUser = query(async () => {
	const { locals } = getRequestEvent();
	if (!locals.user) {
		redirect(307, '/login');
	}
	return locals.user;
});
