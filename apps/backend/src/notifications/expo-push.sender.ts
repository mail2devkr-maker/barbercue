import { Injectable, Logger } from '@nestjs/common';
import type {
  PushMessage,
  PushReceiptResult,
  PushSender,
  PushSendResult,
} from './push-sender';

const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const BATCH_SIZE = 100;

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

type ExpoReceipt = ExpoTicket;

function classify(errorCode: string | undefined) {
  return {
    invalidToken: errorCode === 'DeviceNotRegistered',
    transient: errorCode === 'MessageRateExceeded',
  };
}

/** Production Expo Push Service adapter. Expo then delivers Android messages through FCM v1.
 * The optional access token is only required when Expo enhanced push security is enabled. */
@Injectable()
export class ExpoPushSender implements PushSender {
  private readonly logger = new Logger(ExpoPushSender.name);
  readonly configured =
    process.env.PUSH_PROVIDER?.trim().toLowerCase() === 'expo';

  async sendBatch(messages: PushMessage[]): Promise<PushSendResult[]> {
    if (!this.configured || messages.length === 0) return [];
    const results: PushSendResult[] = [];
    for (let start = 0; start < messages.length; start += BATCH_SIZE) {
      const batch = messages.slice(start, start + BATCH_SIZE);
      try {
        const response = await fetch(EXPO_SEND_URL, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(
            batch.map((message) => ({
              to: message.token,
              title: message.title,
              body: message.body,
              data: message.data,
              sound: 'default',
              priority: 'high',
              channelId: 'barbercue-operations',
            })),
          ),
        });
        if (!response.ok) throw new Error(`Expo push HTTP ${response.status}`);
        const body = (await response.json()) as { data?: ExpoTicket[] };
        const tickets = Array.isArray(body.data) ? body.data : [];
        batch.forEach((message, index) => {
          const ticket = tickets[index];
          if (ticket?.status === 'ok' && ticket.id) {
            results.push({
              notificationId: message.notificationId,
              ok: true,
              providerMessageId: ticket.id,
            });
            return;
          }
          if (!ticket) {
            results.push({
              notificationId: message.notificationId,
              ok: false,
              errorCode: 'EXPO_TICKET_MISSING',
              transient: true,
            });
            return;
          }
          const errorCode = ticket?.details?.error ?? 'EXPO_TICKET_ERROR';
          results.push({
            notificationId: message.notificationId,
            ok: false,
            errorCode,
            ...classify(errorCode),
          });
        });
      } catch (error) {
        this.logger.warn(
          `Expo push batch failed temporarily: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
        results.push(
          ...batch.map((message) => ({
            notificationId: message.notificationId,
            ok: false,
            errorCode: 'EXPO_TRANSPORT_ERROR',
            transient: true,
          })),
        );
      }
    }
    return results;
  }

  async getReceipts(
    providerMessageIds: string[],
  ): Promise<PushReceiptResult[]> {
    if (!this.configured || providerMessageIds.length === 0) return [];
    try {
      const response = await fetch(EXPO_RECEIPTS_URL, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ ids: providerMessageIds.slice(0, BATCH_SIZE) }),
      });
      if (!response.ok) throw new Error(`Expo receipt HTTP ${response.status}`);
      const body = (await response.json()) as {
        data?: Record<string, ExpoReceipt>;
      };
      const results: PushReceiptResult[] = [];
      for (const id of providerMessageIds) {
        const receipt = body.data?.[id];
        if (!receipt) continue;
        if (receipt.status === 'ok') {
          results.push({ providerMessageId: id, ok: true });
          continue;
        }
        const errorCode = receipt.details?.error ?? 'EXPO_RECEIPT_ERROR';
        results.push({
          providerMessageId: id,
          ok: false,
          errorCode,
          ...classify(errorCode),
        });
      }
      return results;
    } catch (error) {
      this.logger.warn(
        `Expo receipt check failed temporarily: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return providerMessageIds.map((providerMessageId) => ({
        providerMessageId,
        ok: false,
        errorCode: 'EXPO_RECEIPT_TRANSPORT_ERROR',
        transient: true,
      }));
    }
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    };
    const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return headers;
  }
}
