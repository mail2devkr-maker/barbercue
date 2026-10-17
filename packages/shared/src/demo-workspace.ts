import { z } from "zod";

export const DEMO_WORKSPACE_BANNER =
  "DEMO DATA — Not real business records" as const;
export const DEMO_DELETE_CONFIRMATION = "DELETE DEMO DATA" as const;

export const deleteDemoWorkspaceSchema = z
  .object({
    workspaceId: z.string().uuid(),
    confirmation: z.literal(DEMO_DELETE_CONFIRMATION),
    confirmationToken: z.string().min(32).max(2048),
  })
  .strict();
export type DeleteDemoWorkspaceInput = z.infer<
  typeof deleteDemoWorkspaceSchema
>;
export const demoWorkspaceIdempotencyKeySchema = z.string().uuid();

export interface DemoWorkspaceCountsDto {
  customers: number;
  staff: number;
  chairs: number;
  services: number;
  visits: number;
  bookings: number;
  invoices: number;
  reviews: number;
}

export interface DemoWorkspaceDatasetDto {
  schemaVersion: 1;
  banner: typeof DEMO_WORKSPACE_BANNER;
  generatedAt: string;
  timezone: string;
  currency: string;
  demoShop: { id: string; name: "FastQue Sample Studio"; synthetic: true };
  counts: DemoWorkspaceCountsDto;
  customers: Array<{
    id: string;
    name: string;
    email: string;
    phone: null;
    firstVisitAt: string;
    lastVisitAt: string;
    visitCount: number;
  }>;
  staff: Array<{
    id: string;
    name: string;
    role: "BARBER" | "MANAGER";
    serviceIds: string[];
  }>;
  chairs: Array<{
    id: string;
    label: string;
    status: "AVAILABLE" | "OCCUPIED";
  }>;
  services: Array<{
    id: string;
    name: string;
    category: string;
    durationMinutes: number;
    listPriceMinor: number;
  }>;
  visits: Array<{
    id: string;
    source: "LIVE_QUEUE";
    status: "COMPLETED" | "CANCELLED" | "NO_SHOW" | "WAITING" | "IN_SERVICE";
    customerId: string | null;
    customerName: string;
    serviceId: string;
    staffId: string | null;
    chairId: string | null;
    joinedAt: string;
    completedAt: string | null;
    estimatedValueMinor: number;
    simulatedCollectionMinor: number;
    paymentProjection: "SIMULATED_ONLY";
  }>;
  bookings: Array<{
    id: string;
    source: "FASTQUE_WEB" | "FASTQUE_APP";
    status: "CONFIRMED" | "COMPLETED" | "CANCELLED";
    customerId: string;
    serviceIds: string[];
    slotStart: string;
    slotEnd: string;
    linkedQueueVisitId: null;
  }>;
  invoices: Array<{
    id: string;
    status: "PAID" | "PARTIALLY_PAID" | "AWAITING_PAYMENT";
    totalMinor: number;
    simulatedCollectionProjectionMinor: number;
    isRecordedPayment: false;
  }>;
  reviews: Array<{
    id: string;
    customerName: string;
    rating: 1 | 2 | 3 | 4 | 5;
    comment: string;
  }>;
  revenue: {
    disclaimer: "All amounts below are synthetic projections, not recorded revenue or payments.";
    daily: Array<{
      date: string;
      estimatedValueMinor: number;
      collectionProjectionMinor: number;
    }>;
    weekly: Array<{
      weekStarting: string;
      estimatedValueMinor: number;
      collectionProjectionMinor: number;
    }>;
    monthly: Array<{
      month: string;
      estimatedValueMinor: number;
      collectionProjectionMinor: number;
    }>;
    byService: Array<{
      serviceId: string;
      completedVisits: number;
      estimatedValueMinor: number;
      collectionProjectionMinor: number;
    }>;
    byStaff: Array<{
      staffId: string;
      completedVisits: number;
      estimatedValueMinor: number;
      collectionProjectionMinor: number;
    }>;
    byCustomer: Array<{
      customerId: string;
      completedVisits: number;
      estimatedValueMinor: number;
      collectionProjectionMinor: number;
    }>;
  };
}

export interface DemoWorkspaceSnapshotDto {
  id: string;
  salonId: string;
  createdAt: string;
  updatedAt: string;
  dataset: DemoWorkspaceDatasetDto;
}

export interface DemoWorkspaceStatusDto {
  active: boolean;
  workspaceId: string | null;
  label: typeof DEMO_WORKSPACE_BANNER;
  counts: Partial<DemoWorkspaceCountsDto> | null;
}

export type ImportDemoWorkspaceResultDto = DemoWorkspaceStatusDto;

export interface DemoWorkspaceDeletePreviewDto {
  confirmationToken: string;
  expiresAt: string;
}

export interface DemoWorkspaceReadDto {
  workspaceId: string;
  salonId: string;
  label: typeof DEMO_WORKSPACE_BANNER;
  dataset: DemoWorkspaceDatasetDto;
}

export interface DeleteDemoWorkspaceResultDto {
  deleted: boolean;
  deletedWorkspaceId: string | null;
}
