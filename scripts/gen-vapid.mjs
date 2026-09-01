// One-off helper: generates a VAPID keypair for Web Push.
// Run with `npm run gen-vapid`, then copy the output into .env.local and
// into your Vercel project's environment variables.
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log("VAPID_PUBLIC_KEY=" + publicKey);
console.log("VAPID_PRIVATE_KEY=" + privateKey);
console.log("VAPID_SUBJECT=mailto:you@example.com");
console.log("\n위 세 줄을 .env.local 과 Vercel 프로젝트 환경변수에 추가하세요.");
console.log("(VAPID_SUBJECT의 이메일은 실제 연락 가능한 주소로 바꾸세요.)");
