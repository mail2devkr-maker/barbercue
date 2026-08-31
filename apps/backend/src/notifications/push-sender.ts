import type { PushNotificationData } from '@barbercue/shared';

export const PUSH_SENDER = Symbol('PUSH_SENDER');

export interface PushMessage {
  notificationId: string;
  token: string;
  title: string;
  body: string;
  data: PushNotificationData;
}

export interface PushSendResult {
  notificationId: string;
  ok: boolean;
  providerMessageId?: string;
  errorCode?: string;
  transient?: boolean;
  invalidToken?: boolean;
}

export interface PushReceiptResult {
  providerMessageId: string;
  ok: boolean;
  errorCode?: string;
  transient?: boolean;
  invalidToken?: boolean;
}

export interface PushSender {
  readonly configured: boolean;
  sendBatch(messages: PushMessage[]): Promise<PushSendResult[]>;
  getReceipts(providerMessageIds: string[]): Promise<PushReceiptResult[]>;
}
