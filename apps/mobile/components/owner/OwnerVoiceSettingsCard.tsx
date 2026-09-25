import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Speech from 'expo-speech';
import {
  OWNER_VOICE_STYLES,
  OWNER_VOICE_STYLE_LABELS,
  OWNER_VOICE_TONES,
  OWNER_VOICE_TONE_LABELS,
  speechLocaleForVoiceStyle,
  type OwnerVoiceStyle,
  type OwnerVoiceTone,
} from '@barbercue/shared';
import { useLanguage } from '../../lib/language-context';
import {
  setMobileOwnerVoiceProfile,
  useMobileOwnerVoiceProfile,
} from '../../lib/owner-voice-preference';
import { speakBooking } from '../../lib/voice-announce';
import { color, font, fontSize, lineHeightFor, radius, space } from '../../lib/theme';
import { Button, Card } from '../ui';

function primarySubtag(locale: string | undefined): string {
  return locale?.split(/[-_]/)[0]?.toLowerCase() ?? '';
}

export function OwnerVoiceSettingsCard() {
  const { language } = useLanguage();
  const profile = useMobileOwnerVoiceProfile();
  const [voices, setVoices] = useState<Speech.Voice[]>([]);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Speech.getAvailableVoicesAsync()
      .then((result) => {
        if (!cancelled) setVoices(result);
      })
      .catch(() => {
        if (!cancelled) setVoices([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const locale = speechLocaleForVoiceStyle(profile.style, language);
  const compatibleVoices = useMemo(() => {
    const primary = primarySubtag(locale);
    return voices
      .filter((voice) => primarySubtag(voice.language) === primary)
      .sort((left, right) => {
        const leftExact = left.language?.toLowerCase() === locale.toLowerCase() ? 0 : 1;
        const rightExact = right.language?.toLowerCase() === locale.toLowerCase() ? 0 : 1;
        return leftExact - rightExact || left.name.localeCompare(right.name);
      });
  }, [locale, voices]);

  function setStyle(style: OwnerVoiceStyle) {
    setWarning(null);
    void setMobileOwnerVoiceProfile({ ...profile, style, voiceIdentifier: null });
  }

  function setTone(tone: OwnerVoiceTone) {
    setWarning(null);
    void setMobileOwnerVoiceProfile({ ...profile, tone });
  }

  function selectVoice(identifier: string | null) {
    setWarning(null);
    void setMobileOwnerVoiceProfile({ ...profile, voiceIdentifier: identifier });
  }

  function preview() {
    setWarning(null);
    speakBooking({
      event: 'preview',
      bookingId: 'voice-preview',
      language,
      onHindiVoiceMissing: () =>
        setWarning('Hindi voice is not installed on this phone. Enable a Hindi TTS voice in Android text-to-speech settings, then try again.'),
    });
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>Booking voice & regional announcements</Text>
      <Text style={styles.note}>
        Choose announcement language independently from the app language. Voice choices are saved on
        this phone because installed TTS voices differ from device to device.
      </Text>

      <Text style={styles.label}>Announcement language</Text>
      <View style={styles.pillRow}>
        {OWNER_VOICE_STYLES.map((style) => (
          <Pressable
            key={style}
            onPress={() => setStyle(style)}
            style={[styles.pill, profile.style === style && styles.pillActive]}
          >
            <Text style={[styles.pillText, profile.style === style && styles.pillTextActive]}>
              {OWNER_VOICE_STYLE_LABELS[style]}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Voice tone</Text>
      <View style={styles.pillRow}>
        {OWNER_VOICE_TONES.map((tone) => (
          <Pressable
            key={tone}
            onPress={() => setTone(tone)}
            style={[styles.pill, profile.tone === tone && styles.pillActive]}
          >
            <Text style={[styles.pillText, profile.tone === tone && styles.pillTextActive]}>
              {OWNER_VOICE_TONE_LABELS[tone]}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.caption}>
        Female-style and male-style adjust pitch. The actual voice identity comes from the TTS voices
        installed on this phone, so use Preview before choosing.
      </Text>

      <Text style={styles.label}>Installed voice</Text>
      <Pressable
        onPress={() => selectVoice(null)}
        style={[styles.voiceRow, profile.voiceIdentifier === null && styles.voiceRowActive]}
      >
        <Text style={styles.voiceName}>Automatic best match</Text>
        <Text style={styles.voiceMeta}>{locale}</Text>
      </Pressable>
      {compatibleVoices.map((voice) => (
        <Pressable
          key={voice.identifier}
          onPress={() => selectVoice(voice.identifier)}
          style={[styles.voiceRow, profile.voiceIdentifier === voice.identifier && styles.voiceRowActive]}
        >
          <Text style={styles.voiceName}>{voice.name}</Text>
          <Text style={styles.voiceMeta}>{voice.language}</Text>
        </Pressable>
      ))}
      {compatibleVoices.length === 0 && (
        <Text style={styles.warning}>
          No matching installed voice was found for {locale}. FastQue will use the safest available
          system behavior; Hindi announcements will not fall back to an English voice.
        </Text>
      )}

      {warning && <Text style={styles.warning}>{warning}</Text>}
      <Button title="Preview selected voice" variant="outline" onPress={preview} style={styles.previewButton} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: space[4] },
  title: {
    fontFamily: font.displaySemiBold,
    fontSize: fontSize.lg,
    lineHeight: lineHeightFor(fontSize.lg),
    color: color.ink,
    marginBottom: space[2],
  },
  note: {
    fontFamily: font.bodyRegular,
    fontSize: fontSize.sm,
    lineHeight: lineHeightFor(fontSize.sm),
    color: color.muted,
    marginBottom: space[4],
  },
  label: {
    fontFamily: font.bodySemiBold,
    fontSize: fontSize.sm,
    lineHeight: lineHeightFor(fontSize.sm),
    color: color.ink,
    marginTop: space[2],
    marginBottom: space[2],
  },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  pill: {
    minHeight: 40,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  pillActive: { backgroundColor: color.ink, borderColor: color.ink },
  pillText: {
    fontFamily: font.bodySemiBold,
    fontSize: fontSize.xs,
    lineHeight: lineHeightFor(fontSize.xs),
    color: color.ink,
  },
  pillTextActive: { color: color.accentContrast },
  caption: {
    fontFamily: font.bodyRegular,
    fontSize: fontSize.xs,
    lineHeight: lineHeightFor(fontSize.xs),
    color: color.muted,
    marginTop: space[2],
    marginBottom: space[2],
  },
  voiceRow: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    marginBottom: space[2],
  },
  voiceRowActive: { borderColor: color.accent, backgroundColor: color.goldSoft },
  voiceName: {
    fontFamily: font.bodySemiBold,
    fontSize: fontSize.sm,
    lineHeight: lineHeightFor(fontSize.sm),
    color: color.ink,
  },
  voiceMeta: {
    fontFamily: font.bodyRegular,
    fontSize: fontSize.xs,
    lineHeight: lineHeightFor(fontSize.xs),
    color: color.muted,
    marginTop: 2,
  },
  warning: {
    fontFamily: font.bodyMedium,
    fontSize: fontSize.xs,
    lineHeight: lineHeightFor(fontSize.xs),
    color: color.accent,
    marginTop: space[2],
  },
  previewButton: { marginTop: space[3] },
});
