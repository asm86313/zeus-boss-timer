// Browser-side helpers for Web Push subscription. Only ever imported from
// client components, so no "use client" directive needed here.

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function subscribePush(): Promise<PushSubscription> {
  if (!pushSupported()) throw new Error("이 브라우저는 푸시 알림을 지원하지 않습니다.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("알림 권한이 거부되었습니다.");

  const keyRes = await fetch("/api/vapid-public-key");
  const keyBody = await keyRes.json();
  if (!keyRes.ok || !keyBody.publicKey) {
    throw new Error(keyBody.error || "VAPID 공개키를 가져오지 못했습니다.");
  }

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(keyBody.publicKey) as BufferSource,
  });

  const res = await fetch("/api/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
  if (!res.ok) throw new Error("구독 정보를 서버에 저장하지 못했습니다.");

  return sub;
}

export async function unsubscribePush(): Promise<void> {
  const sub = await getExistingSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await fetch("/api/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
}
