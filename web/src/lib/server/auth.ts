import { betterAuth } from 'better-auth';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { apiKey } from 'better-auth/plugins';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './db';
import { getRequestEvent } from '$app/server';
import * as schema from './db/schema';
import { sendEmail } from './email';

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: 'pg',
		schema
	}),
	plugins: [sveltekitCookies(getRequestEvent), apiKey()],
	emailVerification: {
		sendVerificationEmail: async ({ user, url }) => {
			try {
				await sendEmail({
					to: user.email,
					subject: 'Verify your DroidClaw email',
					text: `Hi ${user.name || 'there'},\n\nClick the link below to verify your email:\n\n${url}\n\nThis link expires in 1 hour.\n\n-- DroidClaw`
				});
			} catch (err) {
				console.error('Failed to send verification email:', err);
			}
		},
		sendOnSignUp: true,
		sendOnSignIn: true,
		autoSignInAfterVerification: true,
		expiresIn: 3600
	},
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true
	}
});
