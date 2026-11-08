# 奶油纸牌 · Native theme

Select **奶油纸牌** in the existing theme wardrobe or **小狼窝 → 外观 → 主题衣柜**.
The preset is opt-in and uses the existing device-local theme name storage.

Cream paper (#FFF7EC), off-white cards (#FFFDF6), blush selection/user bubbles
(#F0C9C1), cocoa outlines (#4F2E29), and warm gold (#E4BA68) follow the supplied
visual reference. Cards use a 2dp outline, a 4dp unblurred offset shadow and large
rounded corners. Composer buttons move 2dp while pressed without shrinking their
48dp touch targets. The drawing uses Compose shapes, without new assets or fonts.

The shared surface renderer covers messages, composer fields/buttons, status
cards and private draft cards. Shell/feature headers, drawer search/status/entries,
wardrobe previews and local settings fields/buttons use the same treatment.
Material components also receive the theme colors and rounded shape scale.

Custom user bubble colors, message opacity, reading fonts/weight and local
background images continue to apply. Shadows are cut out beneath translucent
paper so they do not turn the whole bubble brown. This preset uses its own rounded
paper shape; the saved Wave/Cut/Cloud selection is retained for other themes.
The appearance screen explains this while Cream Paper is active.

## Validation

- Run `gradle :app:testDebugUnitTest :app:assembleDebug --no-daemon --stacktrace`.
- Unit coverage: stored preset names and fallback, cream/pink text contrast,
  custom bubble/opacity handling and semantic control colors.
- On a phone: select from both wardrobe entrances, reopen the app, switch back
  to the previous theme, and confirm the saved paper shape/font/background remain.
- Inspect narrow screens and larger system font sizes: long messages, the multiline
  composer with the keyboard open, press/release and disabled send/stop states,
  drawer selection, feature headers and settings cards. Check that shadows are
  visible at list edges and that scrolling and existing navigation still work.

The Source Native build applies the same theme implementation while retaining
its separate application ID, visitor restrictions, system font fallbacks and
Source-only QA signing. No backend or PWA changes are part of this theme.
