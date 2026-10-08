import { describe, expect, it, vi } from "vitest";
import type { Database } from "@athena/database";
import { createOwnerNotification } from "./notifications";

const createOwnerNotificationRepository = vi.hoisted(() => vi.fn());
const sendMail = vi.hoisted(() => vi.fn());

vi.mock("@athena/database", () => ({
  createNotificationRepository: createOwnerNotificationRepository,
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail })) },
}));
vi.mock("./security-logging", () => ({ logSecurityEvent: vi.fn() }));

describe("notification delivery", () => {
  it("retains in-app delivery and skips incomplete email configuration", async () => {
    const create = vi.fn(async () => undefined);
    createOwnerNotificationRepository.mockReturnValue({ hasRecentNotification: vi.fn(async () => false), createOwnerNotification: create });
    const database = {} as Database;

    await createOwnerNotification(database, "owner-1", "new_session", { title: "New session", message: "Signed in" }, new Date("2026-09-04T00:00:00.000Z"), {});

    expect(create).toHaveBeenCalledOnce();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("does not reject when configured email delivery fails", async () => {
    const create = vi.fn(async () => undefined);
    createOwnerNotificationRepository.mockReturnValue({ hasRecentNotification: vi.fn(async () => false), createOwnerNotification: create });
    sendMail.mockRejectedValueOnce(new Error("smtp failure"));

    await expect(createOwnerNotification({} as Database, "owner-1", "passkey_registered", { message: "Registered" }, new Date(), {
      ATHENA_NOTIFICATION_SMTP_HOST: "smtp.example.test",
      ATHENA_NOTIFICATION_SMTP_PORT: "465",
      ATHENA_NOTIFICATION_SMTP_USER: "mailer",
      ATHENA_NOTIFICATION_SMTP_PASSWORD: "secret-not-logged",
      ATHENA_NOTIFICATION_FROM: "vault@example.test",
      ATHENA_NOTIFICATION_TO: "owner@example.test",
    })).resolves.toBeUndefined();
    expect(create).toHaveBeenCalled();
  });
  it("suppresses duplicate notifications within the dedupe window", async () => {
    const create = vi.fn(async () => undefined);
    const hasRecent = vi.fn(async () => true);
    createOwnerNotificationRepository.mockReturnValue({ hasRecentNotification: hasRecent, createOwnerNotification: create });

    await createOwnerNotification({} as Database, "owner-1", "new_session", { message: "Signed in" }, new Date("2026-09-04T00:00:00.000Z"), {});

    expect(hasRecent).toHaveBeenCalledWith("owner-1", "new_session", expect.any(Date));
    expect(create).not.toHaveBeenCalled();
  });

  it("never includes sensitive values in the email text", async () => {
    const create = vi.fn(async () => undefined);
    createOwnerNotificationRepository.mockReturnValue({ hasRecentNotification: vi.fn(async () => false), createOwnerNotification: create });
    const transport = { sendMail: vi.fn(async (message: { readonly text: string }) => { expect(message.text).not.toContain("token-secret"); }) };
    sendMail.mockImplementation(transport.sendMail);

    await createOwnerNotification({} as Database, "owner-1", "new_session", { message: "Signed in", token: "token-secret" }, new Date(), {
      ATHENA_NOTIFICATION_SMTP_HOST: "smtp.example.test", ATHENA_NOTIFICATION_SMTP_PORT: "465", ATHENA_NOTIFICATION_SMTP_USER: "mailer", ATHENA_NOTIFICATION_SMTP_PASSWORD: "password-not-logged", ATHENA_NOTIFICATION_FROM: "vault@example.test", ATHENA_NOTIFICATION_TO: "owner@example.test",
    });
    expect(transport.sendMail).toHaveBeenCalledOnce();
  });
});