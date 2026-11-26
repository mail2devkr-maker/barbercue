import { Logger } from '@nestjs/common';

/**
 * Minimal email delivery for alerts and scheduled reports. The existing EmailSender only covers auth mail,
 * so this is separate and OFF unless VI_EMAIL_ENABLED=true, RESEND_API_KEY and VI_EMAIL_FROM are set.
 * When off, callers record "not delivered (email not configured)" instead of pretending it was sent.
 */
const logger = new Logger('ViMailer');

export function viEmailConfigured(): boolean {
  return (
    process.env.VI_EMAIL_ENABLED === 'true' &&
    !!process.env.RESEND_API_KEY &&
    !!process.env.VI_EMAIL_FROM
  );
}

export async function viSendEmail(
  to: string[],
  subject: string,
  text: string,
  attachment?: { filename: string; content: Buffer },
): Promise<'sent' | 'not_configured' | 'failed'> {
  if (!viEmailConfigured() || !to.length) return 'not_configured';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.VI_EMAIL_FROM,
        to,
        subject: subject.slice(0, 200),
        text,
        ...(attachment
          ? {
              attachments: [
                {
                  filename: attachment.filename,
                  content: attachment.content.toString('base64'),
                },
              ],
            }
          : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok ? 'sent' : 'failed';
  } catch (e) {
    logger.warn(`email failed: ${e instanceof Error ? e.message : e}`);
    return 'failed';
  }
}
