import { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  AUTH_PATHS,
  AccountDeletionResolution,
  type AccountDeletionRequestDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { dateLocaleFor } from "../../lib/date-locale";
import { useLanguage } from "../../lib/language-context";
import { color, font, fontSize, space } from "../../lib/theme";
import { Card, Button, InlineError } from "../ui";

/**
 * Non-destructive request surface for accounts with staff, owner, administrator, or mixed roles.
 * The signed-in server identity is authoritative; this card never asks for a target account ID.
 */
export function AccountDeletionRequestCard() {
  const { t, language } = useLanguage();
  const [status, setStatus] = useState<AccountDeletionRequestDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setStatus(
        await apiFetch<AccountDeletionRequestDto>(
          `auth/${AUTH_PATHS.accountDeletionRequest}`,
        ),
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : t.accountDeletionLoadError,
      );
    } finally {
      setLoading(false);
    }
  }, [t.accountDeletionLoadError]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function submitRequest() {
    setSubmitting(true);
    setError(null);
    try {
      const next = await apiFetch<AccountDeletionRequestDto>(
        `auth/${AUTH_PATHS.accountDeletionRequest}`,
        {
          method: "POST",
          body: JSON.stringify({ confirmation: "REQUEST_DELETION" }),
        },
      );
      setStatus(next);
      setConfirming(false);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : t.accountDeletionSubmitError,
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function withdrawRequest() {
    setSubmitting(true);
    setError(null);
    try {
      const next = await apiFetch<AccountDeletionRequestDto>(
        `auth/${AUTH_PATHS.accountDeletionRequest}`,
        { method: "DELETE" },
      );
      setStatus(next);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : t.accountDeletionWithdrawError,
      );
    } finally {
      setSubmitting(false);
    }
  }

  function resolutionMessage(): string {
    const shopCount = status?.relatedShopCount ?? 0;
    const shops =
      shopCount === 1
        ? t.accountDeletionOneShop
        : t.accountDeletionManyShops.replace("{count}", String(shopCount));
    switch (status?.resolution) {
      case AccountDeletionResolution.EMPLOYMENT_RESOLUTION_REQUIRED:
        return t.accountDeletionStaffGuidance.replace("{shops}", shops);
      case AccountDeletionResolution.OWNER_TRANSFER_REQUIRED:
        return t.accountDeletionOwnerGuidance.replace("{shops}", shops);
      case AccountDeletionResolution.ADMIN_GOVERNANCE_REVIEW_REQUIRED:
        return t.accountDeletionAdminGuidance;
      case AccountDeletionResolution.MIXED_ROLE_RESOLUTION_REQUIRED:
        return t.accountDeletionMixedGuidance.replace("{shops}", shops);
      case AccountDeletionResolution.ACCOUNT_ROLE_REVIEW_REQUIRED:
        return t.accountDeletionReviewGuidance;
      case AccountDeletionResolution.CUSTOMER_DIRECT_DELETE:
        return t.accountDeletionCustomerGuidance;
      default:
        return t.accountDeletionDefaultGuidance;
    }
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.cardTitle}>{t.accountDeletionRequestTitle}</Text>
      {loading ? (
        <ActivityIndicator
          accessibilityLabel="Loading account deletion status"
          color={color.muted}
        />
      ) : status?.request?.status === "REQUESTED" ? (
        <>
          <Text style={styles.requestStatus}>
            {t.accountDeletionRequestReceived} ·{" "}
            {new Date(status.request.createdAt).toLocaleDateString(
              dateLocaleFor(language),
            )}
          </Text>
          <Text style={styles.noteText}>
            {t.accountDeletionStatusUpdated.replace(
              "{date}",
              new Date(status.request.updatedAt).toLocaleDateString(
                dateLocaleFor(language),
              ),
            )}
          </Text>
          <Text style={styles.noteText}>{resolutionMessage()}</Text>
          <Text style={styles.noteText}>{t.accountDeletionPendingNotice}</Text>
          <Button
            title={
              submitting
                ? t.accountDeletionWithdrawing
                : t.accountDeletionWithdraw
            }
            variant="outline"
            onPress={() => void withdrawRequest()}
            disabled={submitting}
            style={styles.button}
          />
        </>
      ) : status?.request?.status === "CANCELLED" ? (
        <>
          <Text style={styles.requestStatus}>
            {t.accountDeletionRequestWithdrawn.replace(
              "{date}",
              new Date(status.request.updatedAt).toLocaleDateString(
                dateLocaleFor(language),
              ),
            )}
          </Text>
          <Text style={styles.noteText}>{resolutionMessage()}</Text>
          {!confirming ? (
            <Button
              title={t.accountDeletionStart}
              variant="outline"
              onPress={() => setConfirming(true)}
              style={styles.button}
            />
          ) : (
            <>
              <Text style={styles.warning}>
                {t.accountDeletionConfirmPrompt}
              </Text>
              <Button
                title={
                  submitting
                    ? t.accountDeletionSubmitting
                    : t.accountDeletionConfirm
                }
                onPress={() => void submitRequest()}
                disabled={submitting}
                style={styles.button}
              />
              <Pressable
                disabled={submitting}
                onPress={() => setConfirming(false)}
              >
                <Text style={styles.cancel}>
                  {t.accountDeletionCancelSetup}
                </Text>
              </Pressable>
            </>
          )}
        </>
      ) : (
        <>
          <Text style={styles.noteText}>{resolutionMessage()}</Text>
          <Text style={styles.noteText}>{t.accountDeletionRequestNotice}</Text>
          {!confirming ? (
            <Button
              title={t.accountDeletionStart}
              variant="outline"
              onPress={() => setConfirming(true)}
              style={styles.button}
            />
          ) : (
            <>
              <Text style={styles.warning}>
                {t.accountDeletionConfirmPrompt}
              </Text>
              <Button
                title={
                  submitting
                    ? t.accountDeletionSubmitting
                    : t.accountDeletionConfirm
                }
                onPress={() => void submitRequest()}
                disabled={submitting}
                style={styles.button}
              />
              <Pressable
                disabled={submitting}
                onPress={() => setConfirming(false)}
              >
                <Text style={styles.cancel}>
                  {t.accountDeletionCancelSetup}
                </Text>
              </Pressable>
            </>
          )}
        </>
      )}
      {error && <InlineError message={error} />}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: space[4] },
  cardTitle: {
    fontFamily: font.displaySemiBold,
    fontSize: fontSize.lg,
    color: color.ink,
    marginBottom: space[3],
  },
  requestStatus: {
    color: color.ink,
    fontFamily: font.displaySemiBold,
    marginBottom: space[2],
  },
  noteText: {
    color: color.muted,
    fontFamily: font.bodyRegular,
    fontSize: fontSize.sm,
    marginBottom: space[2],
  },
  warning: {
    color: color.accent,
    fontFamily: font.bodySemiBold,
    fontSize: fontSize.sm,
    marginVertical: space[2],
  },
  button: { marginTop: space[2] },
  cancel: {
    color: color.accent,
    fontFamily: font.bodySemiBold,
    fontSize: fontSize.sm,
    paddingVertical: space[3],
  },
});
