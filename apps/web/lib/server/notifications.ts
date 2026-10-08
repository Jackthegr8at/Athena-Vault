import "./server-only";

import nodemailer from "nodemailer";
import type { Database, OwnerNotificationPayload, OwnerNotificationType } from "@athena/database";
import { createNotificationRepository } from "@athena/database";
import { logSecurityEvent } from "./security-logging";

const DEDUPE_WINDOW_MS = 60_000;

type NotificationEnvironment = Readonly<Record<string, string | undefined>>;

function completeSmtpConfiguration(environment: NotificationEnvironment): boolean {
  return Boolean(
    environment.ATHENA_NOTIFICATION_SMTP_HOST?.trim()
    && environment.ATHENA_NOTIFICATION_SMTP_PORT?.trim()
    && environment.ATHENA_NOTIFICATION_SMTP_USER?.trim()
    && environment.ATHENA_NOTIFICATION_SMTP_PASSWORD?.trim()
    && environment.ATHENA_NOTIFICATION_FROM?.trim()
    && environment.ATHENA_NOTIFICATION_TO?.trim(),
  );
}

function safeEmailText(type: OwnerNotificationType, payload: OwnerNotificationPayload): string {
  const title = payload.title?.trim() || "Athena Vault security notification";
  const message = payload.message?.trim() || `Security event: ${type}`;
  return `${title}\n${message}`.slice(0, 1024);
}

async function sendOptionalEmail(type: OwnerNotificationType, payload: OwnerNotificationPayload, environment: NotificationEnvironment): Promise<void> {
  if (!completeSmtpConfiguration(environment)) return;
  const port = Number(environment.ATHENA_NOTIFICATION_SMTP_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return;
  const transport = nodemailer.createTransport({
    host: environment.ATHENA_NOTIFICATION_SMTP_HOST,
    port,
    secure: true,
    auth: { user: environment.ATHENA_NOTIFICATION_SMTP_USER, pass: environment.ATHENA_NOTIFICATION_SMTP_PASSWORD },
  });
  await transport.sendMail({
    from: environment.ATHENA_NOTIFICATION_FROM,
    to: environment.ATHENA_NOTIFICATION_TO,
    subject: "Athena Vault security notification",
    text: safeEmailText(type, payload),
  });
}

export async function createOwnerNotification(
  database: Database,
  ownerId: string,
  type: OwnerNotificationType,
  payload: OwnerNotificationPayload,
  now = new Date(),
  environment: NotificationEnvironment = process.env,
): Promise<void> {
  const repository = createNotificationRepository(database);
  const since = new Date(now.getTime() - DEDUPE_WINDOW_MS);
  if (await repository.hasRecentNotification(ownerId, type, since)) return;
  await repository.createOwnerNotification(ownerId, type, payload, now);
  try {
    await sendOptionalEmail(type, payload, environment);
  } catch (error) {
    logSecurityEvent({ event: "auth_security_event_failed", component: "auth", operation: "notification-email", error, status: 500 });
  }
}
