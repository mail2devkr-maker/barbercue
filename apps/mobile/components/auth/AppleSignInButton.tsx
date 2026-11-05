import { useEffect, useState } from "react";
import * as AppleAuthentication from "expo-apple-authentication";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { AUTH_PATHS, type AuthMethodsDto } from "@barbercue/shared";
import { ApiError, apiFetch } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useLanguage } from "../../lib/language-context";
import { color, font, fontSize, space } from "../../lib/theme";

type Audience = "customer" | "staff";

/** Native Apple-provided button; never rendered on Android or if the backend cannot verify Apple. */
export function AppleSignInButton({
  audience,
  onBeforeSignIn,
}: {
  audience: Audience;
  onBeforeSignIn?: () => void;
}) {
  const { appleLogin, staffAppleLogin } = useAuth();
  const { t } = useLanguage();
  const [available, setAvailable] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (Platform.OS !== "ios") return;
    Promise.all([
      AppleAuthentication.isAvailableAsync(),
      apiFetch<AuthMethodsDto>(`auth/${AUTH_PATHS.methods}`),
    ])
      .then(([nativeAvailable, methods]) => {
        if (!cancelled) setAvailable(nativeAvailable && methods.apple === true);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handlePress() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const challenge = await apiFetch<{ nonce: string }>(
        `auth/${AUTH_PATHS.appleNonce}`,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      );
      const credential = await AppleAuthentication.signInAsync({
        nonce: challenge.nonce,
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        ],
      });
      if (!credential.identityToken || !credential.authorizationCode) {
        setError(t.couldNotCompleteAppleSignIn);
        return;
      }
      onBeforeSignIn?.();
      const input = {
        identityToken: credential.identityToken,
        nonce: challenge.nonce,
        authorizationCode: credential.authorizationCode,
      };
      if (audience === "staff") await staffAppleLogin(input);
      else await appleLogin(input);
    } catch (err) {
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        err.code === "ERR_REQUEST_CANCELED"
      )
        return;
      setError(
        err instanceof ApiError ? err.message : t.couldNotCompleteAppleSignIn,
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (Platform.OS !== "ios" || !available) return null;

  return (
    <View style={styles.container}>
      {submitting && (
        <ActivityIndicator style={styles.loading} color={color.ink} />
      )}
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={12}
        style={styles.button}
        onPress={() => void handlePress()}
      />
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: space[3] },
  button: { width: "100%", height: 52 },
  loading: { position: "absolute", right: 16, top: 16, zIndex: 1 },
  error: {
    marginTop: space[2],
    color: "#8f302d",
    fontFamily: font.bodyMedium,
    fontSize: fontSize.xs,
  },
});
