// lib/mailer.ts (Phase 3)
// Outgoing email via the operator's OWN EU-based mail host over SMTP (nodemailer) — no
// third-party SaaS mailer (Resend/SendGrid/Postmark), avoiding an unvetted US-based
// processor and the GDPR Art. 44 transfer analysis that would require
// ([REVIEW-FIX: privacy-dsgvo #6]: this closes the live `notifyEmail` schema flag).
//
// Credentials come from the environment (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD; see
// .env.example). Dev/CI boxes have no mail server: if SMTP_HOST is unset this module
// LOGS-AND-NOOPs instead of throwing, so the notification flow keeps working without one.
import nodemailer from 'nodemailer'

const FROM = process.env.SMTP_FROM ?? 'BeybladeX.de <noreply@beybladex.de>'

let transporter: nodemailer.Transporter | null | undefined

function getTransporter(): nodemailer.Transporter | null {
  if (transporter !== undefined) return transporter
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    transporter = null
  } else {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    })
  }
  return transporter
}

export interface NotificationEmail {
  to: string
  subject: string
  text: string
}

export async function sendNotificationEmail(email: NotificationEmail): Promise<void> {
  const transport = getTransporter()
  if (!transport) {
    // Deliberate, loud no-op (not silent): dev/CI without SMTP stays functional.
    console.log(`[mailer] SMTP not configured — would send to ${email.to}: ${email.subject}`)
    return
  }
  await transport.sendMail({ from: FROM, ...email })
}
