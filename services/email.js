import crypto from "crypto";
import net from "net";
import tls from "tls";

const DEFAULT_SMTP_HOST = "smtp.gmail.com";
const DEFAULT_SMTP_PORT = 465;

const readLine = (socket, timeoutMs = 15_000) =>
  new Promise((resolve, reject) => {
    let buffer = "";
    let settled = false;

    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      cleanup();
      reject(new Error("smtp_timeout"));
    }, timeoutMs);

    const onError = (error) => {
      if (settled) return;
      cleanup();
      reject(error);
    };

    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      if (!lines.length) return;

      const lastLine = lines[lines.length - 1];
      if (/^\d{3} /.test(lastLine)) {
        cleanup();
        resolve(lines.join("\n"));
      }
    };

    socket.on("data", onData);
    socket.on("error", onError);
  });

const sendLine = async (socket, line) => {
  socket.write(`${line}\r\n`);
  return readLine(socket);
};

const assertSmtpCode = (response, codes) => {
  const allowedCodes = Array.isArray(codes) ? codes : [codes];
  const code = Number(String(response || "").slice(0, 3));
  if (!allowedCodes.includes(code)) {
    throw new Error(`smtp_unexpected_response:${String(response || "").replace(/\s+/g, " ")}`);
  }
};

const dotStuff = (value) =>
  String(value || "")
    .replace(/\r?\n/g, "\r\n")
    .replace(/^\./gm, "..");

const encodeHeader = (value) => {
  const normalized = String(value || "").replace(/\r?\n/g, " ").trim();
  if (/^[\x00-\x7F]*$/.test(normalized)) return normalized;
  return `=?UTF-8?B?${Buffer.from(normalized, "utf8").toString("base64")}?=`;
};

const formatAddress = (email, name) => {
  const cleanEmail = String(email || "").trim();
  const cleanName = String(name || "").replace(/"/g, "'").trim();
  return cleanName ? `"${encodeHeader(cleanName)}" <${cleanEmail}>` : cleanEmail;
};

const createSocket = ({ host, port, secure }) =>
  new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host, port, servername: host })
      : net.connect({ host, port });

    socket.once("error", reject);
    socket.once(secure ? "secureConnect" : "connect", () => {
      socket.off("error", reject);
      resolve(socket);
    });
  });

const upgradeToTls = (socket, host) =>
  new Promise((resolve, reject) => {
    const secureSocket = tls.connect({ socket, servername: host });
    secureSocket.once("error", reject);
    secureSocket.once("secureConnect", () => {
      secureSocket.off("error", reject);
      resolve(secureSocket);
    });
  });

export const getSmtpConfig = () => {
  const user = process.env.SMTP_USER?.trim() || process.env.GMAIL_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim() || process.env.GMAIL_APP_PASSWORD?.trim();

  return {
    host: process.env.SMTP_HOST?.trim() || DEFAULT_SMTP_HOST,
    port: Number(process.env.SMTP_PORT || DEFAULT_SMTP_PORT),
    secure: String(process.env.SMTP_SECURE ?? "true").toLowerCase() !== "false",
    user,
    pass,
    fromEmail:
      process.env.ONBOARDING_FROM_EMAIL?.trim() ||
      user ||
      "voltapizza@gmail.com",
    fromName: process.env.ONBOARDING_FROM_NAME?.trim() || "Volta Pizza",
  };
};

export const isSmtpConfigured = (config = getSmtpConfig()) =>
  Boolean(config.host && config.port && config.user && config.pass);

export async function sendSmtpEmail({ to, subject, text, html, replyTo }) {
  const config = getSmtpConfig();

  if (!isSmtpConfigured(config)) {
    return { ok: false, skipped: true, reason: "smtp_not_configured" };
  }

  let socket = await createSocket(config);

  try {
    assertSmtpCode(await readLine(socket), 220);

    let response = await sendLine(socket, `EHLO ${process.env.SMTP_HELO_DOMAIN || "voltapizza.com"}`);
    assertSmtpCode(response, 250);

    if (!config.secure) {
      response = await sendLine(socket, "STARTTLS");
      assertSmtpCode(response, 220);
      socket = await upgradeToTls(socket, config.host);
      response = await sendLine(socket, `EHLO ${process.env.SMTP_HELO_DOMAIN || "voltapizza.com"}`);
      assertSmtpCode(response, 250);
    }

    response = await sendLine(socket, "AUTH PLAIN");
    assertSmtpCode(response, 334);

    const authPayload = Buffer.from(`\u0000${config.user}\u0000${config.pass}`, "utf8").toString("base64");
    response = await sendLine(socket, authPayload);
    assertSmtpCode(response, 235);

    response = await sendLine(socket, `MAIL FROM:<${config.fromEmail}>`);
    assertSmtpCode(response, 250);

    response = await sendLine(socket, `RCPT TO:<${to}>`);
    assertSmtpCode(response, [250, 251]);

    response = await sendLine(socket, "DATA");
    assertSmtpCode(response, 354);

    const boundary = `volta-${crypto.randomBytes(12).toString("hex")}`;
    const messageId = `${crypto.randomBytes(16).toString("hex")}@voltapizza.com`;
    const headers = [
      `From: ${formatAddress(config.fromEmail, config.fromName)}`,
      `To: ${formatAddress(to)}`,
      `Subject: ${encodeHeader(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${messageId}>`,
      "MIME-Version: 1.0",
      replyTo ? `Reply-To: ${formatAddress(replyTo)}` : null,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ].filter(Boolean);

    const body = [
      ...headers,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      dotStuff(text),
      "",
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      dotStuff(html || text),
      "",
      `--${boundary}--`,
      ".",
    ].join("\r\n");

    socket.write(`${body}\r\n`);
    response = await readLine(socket);
    assertSmtpCode(response, 250);

    await sendLine(socket, "QUIT").catch(() => null);
    return { ok: true };
  } finally {
    socket.end();
  }
}
