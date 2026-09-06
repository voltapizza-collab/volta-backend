// Trusted operator CLI. No public admin endpoint or hardcoded master password.
import fs from 'node:fs';
import crypto from 'node:crypto';
import prisma from '../services/prisma.js';
import { digest, randomToken, setDeviceStatus } from '../services/posIdentity.js';
const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'enroll-code') {
    const [name, actor, outputFile] = args;
    if (!name || !actor || !outputFile) throw Error('Usage: enroll-code NAME ACTOR OUTPUT_FILE');
    const token = randomToken();
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    // Exclusive creation prevents overwriting an existing credentials file.
    const fd = fs.openSync(outputFile, 'wx', 0o600);
    try {
      const row = await prisma.posEnrollment.create({ data: { id: crypto.randomUUID(), tokenHash: digest(token),
        name: name.slice(0, 120), createdBy: actor.slice(0, 120), expiresAt } });
      fs.writeFileSync(fd, JSON.stringify({ code: token, expiresAt, enrollmentId: row.id }));
    } finally { fs.closeSync(fd); }
    console.log('One-use enrollment code written to the requested private file. Valid for 15 minutes.');
  } else if (command === 'list') {
    const devices = await prisma.posDevice.findMany({ select: { id: true, name: true, model: true, status: true,
      lastSeenAt: true, session: { select: { storeId: true, expiresAt: true } } }, orderBy: { createdAt: 'asc' } });
    console.log(JSON.stringify(devices, null, 2));
  } else if (command === 'status') {
    const [id, status, actor, reason] = args;
    console.log(JSON.stringify(await setDeviceStatus(prisma, id, status, actor, reason)));
  } else throw Error('Commands: list | enroll-code NAME ACTOR OUTPUT_FILE | status ID AUTHORIZED/SUSPENDED/REVOKED ACTOR REASON');
} catch (error) {
  console.error(error.status ? error.code : (error.code || error.message)); process.exitCode = 1;
} finally { await prisma.$disconnect(); }
