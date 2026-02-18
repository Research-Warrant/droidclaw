import { env } from '$env/dynamic/private';
import { UseSend } from 'usesend-js';

if (!env.USESEND_API_KEY) throw new Error('USESEND_API_KEY is not set');

const usesend = new UseSend(env.USESEND_API_KEY);

const EMAIL_FROM = 'noreply@app.droidclaw.ai';

export async function sendEmail({
	to,
	subject,
	text
}: {
	to: string;
	subject: string;
	text: string;
}) {
	return usesend.emails.send({
		to,
		from: EMAIL_FROM,
		subject,
		text
	});
}
