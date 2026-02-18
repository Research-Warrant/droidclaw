import { UseSend } from 'usesend-js';

const usesend = new UseSend(process.env.USESEND_API_KEY!);

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
