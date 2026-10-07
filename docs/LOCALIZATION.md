# Localization

| Locale | File | Direction | State |
|---|---|---|---|
| Iraqi Arabic (default) | `apps/mobile/src/i18n/ar.ts` | RTL | Written for Iraqi drivers; **needs native review** |
| Kurdish Sorani | `apps/mobile/src/i18n/ckb.ts` | RTL | **Draft — needs a native Sorani reviewer from the KRI** |
| English | `apps/mobile/src/i18n/en.ts` | LTR | Complete |

`ckb.ts` and `en.ts` are typed against `ar.ts`, so a missing key is a compile error, and
`apps/mobile/test/i18n.test.ts` checks placeholder parity and flags untranslated strings.

## Choices that need a native speaker's sign-off
- Colloquial guidance: "لف يمين", "استمر دوغري", "خلّيك يمين", "بالفلكة، اطلع من المخرج الثاني".
  The alternative is neutral MSA ("انعطف يميناً"). Decide with drivers which reads and sounds clearer.
- "طسة / حفرة" for pothole, "غرق / مياه" for flooding, "الدوام" for work, "وين رايح؟" in search.
- Every Sorani string, including "فلکە" for roundabout and the ordinal forms.
- Spoken numbers: prompts pass Western digits to TTS ("بعد 500 متر"); confirm each common
  Android/iOS Arabic voice reads them naturally.

## Rules the code follows
- Layout direction follows the language (RTL for ar/ckb). Changing between RTL and LTR
  reloads the app once (`src/rtl.ts`).
- Maneuver arrows are never mirrored; a right turn points right in every language.
- Back arrows *do* follow reading direction.
- Distances in metres/kilometres; durations in minutes/hours; Arabic-Indic digits are an
  option in Settings (Western digits default, as on Iraqi road signs and most phones).
- Place names come from the server in the requested language with fallback ar → any.
