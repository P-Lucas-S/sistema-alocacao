import prisma from '../prisma.js';
import webPush from 'web-push';

const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT     || 'mailto:noreply@example.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const generateId = () => Math.random().toString(36).substring(2, 15);

export type NotificationType = 'info' | string;

interface NotifyPayload {
  userIds: string[];
  title: string;
  message: string;
  type: NotificationType;
  taskId?: string;
}

export async function notify(payload: NotifyPayload) {
  const { userIds, title, message, type, taskId } = payload;
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return;

  await prisma.notification.createMany({
    data: uniqueIds.map(userId => ({
      id: generateId(),
      userId,
      title,
      message,
      type,
      taskId: taskId || null,
      read: false,
    })),
  });

  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    sendPushToUsers(uniqueIds, { title, body: message, type, taskId }).catch(console.error);
  }
}

async function sendPushToUsers(
  userIds: string[],
  payload: { title: string; body: string; type: string; taskId?: string }
) {
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: { in: userIds } },
  });

  const pushPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    data: { type: payload.type, taskId: payload.taskId, url: '/' },
  });

  const results = await Promise.allSettled(
    subscriptions.map(sub =>
      webPush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        pushPayload
      )
    )
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'rejected' && (result.reason as any)?.statusCode === 410) {
      await prisma.pushSubscription.delete({ where: { id: subscriptions[i].id } }).catch(() => {});
    }
  }
}

export async function getAdminAndCoordinatorIds(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { role: { in: ['admin', 'coordenacao'] } },
    select: { id: true },
  });
  return users.map(u => u.id);
}

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}
