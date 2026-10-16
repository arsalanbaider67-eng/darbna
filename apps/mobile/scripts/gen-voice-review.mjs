import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(root, process.env.VOICE_REVIEW_DIR || "public/voice-review");
const active = JSON.parse(fs.readFileSync(path.join(root, "assets/voice/phrases.json"), "utf8"));
const proposed = JSON.parse(fs.readFileSync(path.resolve(root, process.env.VOICE_PHRASES_FILE || "assets/voice/iraqi-review.json"), "utf8"));
const standard = proposed.review?.requiredSpeaker === "male Modern Standard Arabic";
const keys = standard ? Object.keys(proposed.phrases.ar) : ["mv_right", "mv_left", "mv_roundabout_plain", "mv_roundabout_1", "mv_roundabout_2", "mv_roundabout_exit", "d_200m", "then"];
const esc = s => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
fs.mkdirSync(path.join(out, "current"), { recursive: true });
for (const key of keys) fs.copyFileSync(path.join(root, `assets/voice/ar/${key}.mp3`), path.join(out, `current/${key}.mp3`));
const rows = keys.map(key => {
  const candidate = fs.existsSync(path.join(out, `ar/${key}.mp3`));
  return `<section><h2>${esc(proposed.phrases.ar[key])}</h2><p class="label">التسجيل السابق</p><p>${esc(active.phrases.ar[key])}</p><audio controls preload="none" src="current/${key}.mp3"></audio><p class="label">النص الجديد</p><p class="proposed">${esc(proposed.phrases.ar[key])}</p>${candidate ? `<p class="label">تسجيل تجريبي — يحتاج موافقتك على النطق</p><audio controls preload="none" src="ar/${key}.mp3"></audio>` : '<p class="pending">لم يُسجَّل هذا النص بعد. الصوت أعلاه هو التسجيل السابق.</p>'}</section>`;
}).join("");
const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>مراجعة صوت دربنا العربي</title><style>*{box-sizing:border-box}body{margin:0;background:#21194a;color:#fff5ef;font:17px/1.9 system-ui,Tahoma,sans-serif}main{max-width:680px;margin:auto;padding:24px 18px}h1{font-size:29px;line-height:1.5}h2{font-size:23px;color:#ffd25e}.intro,section{background:#2d2463;border:1px solid #453a78;border-radius:20px;padding:18px;margin:18px 0}.label{font-size:13px;color:#cbc4e3;margin-bottom:0}.pending{font-size:14px;color:#ffd25e}.proposed{font-size:23px}audio{width:100%;margin-top:8px}a{color:#ffd25e}</style><main><a href="../">رجوع لدربنا</a><h1>مراجعة صوت الإرشاد العربي</h1><div class="intro">${standard ? "جميع تعليمات الإرشاد باللغة العربية الفصحى، بصوت رجل وبسرعة طبيعية." : "مراجعة التسجيلات العراقية السابقة."} هذه تسجيلات تجريبية. استمع إليها قبل اعتمادها. سرعة تشغيل التسجيلات طبيعية.</div>${rows}</main><script>document.addEventListener('play',event=>{if(event.target.tagName==='AUDIO')document.querySelectorAll('audio').forEach(audio=>{if(audio!==event.target)audio.pause()})},true)</script></html>`;
fs.writeFileSync(path.join(out, "index.html"), html);
console.log(`Voice listening review written to ${out}`);
