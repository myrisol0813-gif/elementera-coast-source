import { compressImageFile, escapeAttribute } from '../../core/dom.js';

export function createDailyProfile({ state, client, chat, persistCache, router, toast }) {
  function ownerAvatar() {
    const image = state.profile.ownerAvatarDataurl || '';
    return image ? `<span class="daily-avatar has-image" style="background-image:url(${escapeAttribute(image)})"></span>` : '<span class="daily-avatar">H</span>';
  }

  function modelPartnerAvatar() {
    const image = chat?.getProfile?.()?.assistant_avatar_dataurl || state.profile.modelPartnerAvatarDataurl || '';
    return image ? `<span class="daily-avatar is-model_partner has-image" style="background-image:url(${escapeAttribute(image)})"></span>` : '<span class="daily-avatar is-model_partner has-image" style="background-image:url(\'/public/media/model-partner-default-avatar.jpg\')"></span>';
  }

  function modelPartnerDisplayName() {
    return String(state.profile.modelPartnerDisplayName || '模型伙伴').trim() || '模型伙伴';
  }

  async function saveModelPartnerDisplayName(value) {
    const clean = String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80) || '模型伙伴';
    try {
      state.profile = await client.saveProfile({ model_partner_display_name: clean });
      persistCache();
      toast(`碳硅圈里的名字已经改成 ${state.profile.modelPartnerDisplayName}。`);
      await router.refresh({ preserveScroll: true });
      return state.profile.modelPartnerDisplayName;
    } catch (error) {
      console.warn('[daily-profile-name]', error);
      toast('名字保存失败：' + (error?.message || '服务器没有完成保存。'), 3600);
      throw error;
    }
  }

  async function chooseProfileImage(field) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', async () => {
      const isCover = field === 'moment_cover_dataurl';
      let image = '';
      try {
        image = await compressImageFile(input.files?.[0], {
          maxDimension: isCover ? 1600 : 512,
          maxDataUrlLength: isCover ? 1_200_000 : 360_000,
          quality: isCover ? 0.82 : 0.86,
        });
      } catch (error) {
        console.warn('[daily-profile-image]', error);
        toast(error?.message === 'image_too_large'
          ? '图片压缩后仍然太大，请换一张更小的图片。'
          : '这张图片暂时无法读取，请换一张试试。', 3600);
        return;
      }
      if (!image) return;
      try {
        if (field === 'model_partner_avatar_dataurl') {
          const profile = await chat.updateProfile({ assistant_avatar_dataurl: image });
          state.profile.modelPartnerAvatarDataurl = profile.assistant_avatar_dataurl || image;
        } else {
          state.profile = await client.saveProfile({ [field]: image });
        }
        persistCache();
        toast('已经保存在前端。');
        await router.refresh({ preserveScroll: true });
      } catch (error) {
        console.warn('[daily-profile-save]', error);
        toast('保存失败：' + (error?.message || '服务器没有完成保存。'), 3600);
      }
    }, { once: true });
    input.click();
  }

  return Object.freeze({ ownerAvatar, modelPartnerAvatar, modelPartnerDisplayName, saveModelPartnerDisplayName, chooseProfileImage });
}
