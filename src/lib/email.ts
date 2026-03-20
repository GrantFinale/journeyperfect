import nodemailer from "nodemailer"

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "mail.journeyperfect.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: false, // STARTTLS
  auth: {
    user: process.env.SMTP_USER || "admin@journeyperfect.com",
    pass: process.env.SMTP_PASS || "",
  },
  tls: {
    rejectUnauthorized: false, // self-signed certs ok for our own server
  },
})

interface EmailOptions {
  to: string
  subject: string
  text?: string
  html?: string
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  try {
    await transporter.sendMail({
      from: '"JourneyPerfect" <admin@journeyperfect.com>',
      ...options,
    })
    return true
  } catch (err) {
    console.error("[email] Failed to send:", err)
    return false
  }
}

// Pre-built email templates
export async function sendWelcomeEmail(email: string, name: string) {
  return sendEmail({
    to: email,
    subject: "Welcome to JourneyPerfect!",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #4f46e5; padding: 24px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">JourneyPerfect</h1>
        </div>
        <div style="padding: 24px; background: #f9fafb; border-radius: 0 0 12px 12px;">
          <h2 style="color: #111827;">Welcome, ${name || "Traveler"}!</h2>
          <p style="color: #4b5563;">Your account is ready. Start planning your next adventure.</p>
          <p style="color: #4b5563;">You can forward flight, hotel, and rental car confirmation emails to your personal import address to automatically add them to your trips.</p>
          <a href="https://journeyperfect.com/dashboard" style="display: inline-block; background: #4f46e5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px;">Go to Dashboard</a>
        </div>
      </div>
    `,
  })
}

export async function sendCollaboratorInvite(email: string, inviterName: string, tripTitle: string, role: string) {
  return sendEmail({
    to: email,
    subject: `${inviterName} invited you to "${tripTitle}" on JourneyPerfect`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #4f46e5; padding: 24px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">JourneyPerfect</h1>
        </div>
        <div style="padding: 24px; background: #f9fafb; border-radius: 0 0 12px 12px;">
          <h2 style="color: #111827;">You're invited!</h2>
          <p style="color: #4b5563;"><strong>${inviterName}</strong> invited you to collaborate on the trip <strong>"${tripTitle}"</strong> as a <strong>${role}</strong>.</p>
          <a href="https://journeyperfect.com/login" style="display: inline-block; background: #4f46e5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px;">Accept Invitation</a>
          <p style="color: #9ca3af; font-size: 12px; margin-top: 16px;">Sign in with Google to accept. If you don't have an account, one will be created automatically.</p>
        </div>
      </div>
    `,
  })
}

export async function sendFlightAlert(email: string, flightNumber: string, status: string, details: string) {
  return sendEmail({
    to: email,
    subject: `Flight Alert: ${flightNumber} - ${status}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: ${status === "cancelled" ? "#dc2626" : "#f59e0b"}; padding: 24px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Flight ${status.toUpperCase()}</h1>
        </div>
        <div style="padding: 24px; background: #f9fafb; border-radius: 0 0 12px 12px;">
          <h2 style="color: #111827;">${flightNumber}</h2>
          <p style="color: #4b5563;">${details}</p>
          <a href="https://journeyperfect.com/dashboard" style="display: inline-block; background: #4f46e5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px;">View Trip</a>
        </div>
      </div>
    `,
  })
}

export async function sendInboundConfirmation(email: string, itemsSummary: string, tripTitle: string) {
  return sendEmail({
    to: email,
    subject: `Added to your "${tripTitle}" trip on JourneyPerfect`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #4f46e5; padding: 24px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">JourneyPerfect</h1>
        </div>
        <div style="padding: 24px; background: #f9fafb; border-radius: 0 0 12px 12px;">
          <h2 style="color: #111827;">Email processed!</h2>
          <p style="color: #4b5563;">${itemsSummary}</p>
          <p style="color: #4b5563;">Added to your trip: <strong>${tripTitle}</strong></p>
          <a href="https://journeyperfect.com/dashboard" style="display: inline-block; background: #4f46e5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px;">View Trip</a>
        </div>
      </div>
    `,
  })
}
