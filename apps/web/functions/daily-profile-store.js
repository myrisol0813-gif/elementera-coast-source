import { ensureDailySchema } from './daily-schema.js';
import { DailyStoreError } from './daily-store.js';

const OWNER_ID = 'owner';
const DEFAULT_MODEL_PARTNER_DISPLAY_NAME = '另一位屋主';
export const DAILY_PROFILE_LIMITS = Object.freeze({
  avatarDataUrl: 360_000,
  coverDataUrl: 1_200_000,
  displayName: 80,
});

function validDataUrl(value, maxLength, label) {
  const clean = String(value || '');
  if (!clean) return '';
  if (clean.length > maxLength) {
    throw new DailyStoreError('daily_profile_image_too_large', `${label}压缩后仍然太大，请换一张更小的图片。`, 413, {
      max_length: maxLength,
      actual_length: clean.length,
    });
  }
  if (!/^data:image\/(?:png|jpe?g|webp);base64,/i.test(clean)) {
    throw new DailyStoreError('invalid_daily_profile_image', `${label}需要是 PNG、JPEG 或 WebP 图片。`, 400);
  }
  return clean;
}

function displayName(value) {
  const clean = String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, DAILY_PROFILE_LIMITS.displayName);
  return clean || DEFAULT_MODEL_PARTNER_DISPLAY_NAME;
}

function profileFromRow(row) {
  const source = row || {};
  return {
    xiaohan_avatar_dataurl: source.xiaohan_avatar_dataurl || '',
    myri_avatar_dataurl: source.myri_avatar_dataurl || '',
    moment_cover_dataurl: source.moment_cover_dataurl || '',
    myri_display_name: displayName(source.myri_display_name),
    updated_at: source.updated_at ? new Date(Number(source.updated_at)).toISOString() : null,
  };
}

async function row(db) {
  await ensureDailySchema(db);
  return db.prepare('SELECT * FROM daily_profile WHERE id = ?').bind(OWNER_ID).first();
}

export async function readDailyProfile(db) {
  return profileFromRow(await row(db));
}

export async function writeDailyProfile(db, patch = {}) {
  const current = await readDailyProfile(db);
  const has = (key) => Object.prototype.hasOwnProperty.call(patch, key);
  const next = {
    xiaohan_avatar_dataurl: has('xiaohan_avatar_dataurl')
      ? validDataUrl(patch.xiaohan_avatar_dataurl, DAILY_PROFILE_LIMITS.avatarDataUrl, '屋主头像')
      : current.xiaohan_avatar_dataurl,
    myri_avatar_dataurl: has('myri_avatar_dataurl')
      ? validDataUrl(patch.myri_avatar_dataurl, DAILY_PROFILE_LIMITS.avatarDataUrl, '另一位屋主头像')
      : current.myri_avatar_dataurl,
    moment_cover_dataurl: has('moment_cover_dataurl')
      ? validDataUrl(patch.moment_cover_dataurl, DAILY_PROFILE_LIMITS.coverDataUrl, '碳硅圈封面')
      : current.moment_cover_dataurl,
    myri_display_name: has('myri_display_name')
      ? displayName(patch.myri_display_name)
      : current.myri_display_name,
  };
  const now = Date.now();
  await db.prepare(`INSERT INTO daily_profile (
      id, xiaohan_avatar_dataurl, myri_avatar_dataurl, moment_cover_dataurl, myri_display_name, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      xiaohan_avatar_dataurl = excluded.xiaohan_avatar_dataurl,
      myri_avatar_dataurl = excluded.myri_avatar_dataurl,
      moment_cover_dataurl = excluded.moment_cover_dataurl,
      myri_display_name = excluded.myri_display_name,
      updated_at = excluded.updated_at`)
    .bind(
      OWNER_ID,
      next.xiaohan_avatar_dataurl,
      next.myri_avatar_dataurl,
      next.moment_cover_dataurl,
      next.myri_display_name,
      now,
    )
    .run();
  return { ...next, updated_at: new Date(now).toISOString() };
}
