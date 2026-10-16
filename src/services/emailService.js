import nodemailer from "nodemailer";

export function isEmailServiceConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS
  );
}

function createTransporter() {
  if (!isEmailServiceConfigured()) {
    throw new Error("SMTP is not configured");
  }

  const port = Number(process.env.SMTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a valid port number");
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure:
      process.env.SMTP_SECURE === "true" || port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export async function sendPasswordResetEmail({ to, resetUrl }) {
  const transporter = createTransporter();
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;

  await transporter.sendMail({
    from,
    to,
    subject: "Reset your LogiGo password",
    text: [
      "We received a request to reset your LogiGo password.",
      "",
      `Use this secure link within 15 minutes: ${resetUrl}`,
      "",
      "If you did not request this, you can ignore this email.",
      "Your password will not change unless the link is used.",
    ].join("\n"),
    html: `
      <div style="font-family:Inter,Arial,sans-serif;color:#172033;line-height:1.6;max-width:560px;margin:0 auto;padding:24px">
        <div style="display:inline-block;background:#f97316;color:#fff;padding:10px 14px;border-radius:12px;font-weight:800;font-size:20px">LogiGo</div>
        <h1 style="font-size:24px;margin:24px 0 8px">Reset your password</h1>
        <p>We received a request to reset your LogiGo password. Use the button below to choose a new password.</p>
        <p style="margin:28px 0"><a href="${resetUrl}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;font-weight:700;padding:14px 20px;border-radius:12px">Reset password</a></p>
        <p>This link expires in <strong>15 minutes</strong> and can only be used once.</p>
        <p style="color:#64748b;font-size:13px">If you did not request this, ignore this email. Your password will not change unless the link is used.</p>
      </div>
    `,
  });
}
