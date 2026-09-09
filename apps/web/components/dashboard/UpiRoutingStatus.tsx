import { UPI_QR_ONLY_NOTICE, type SalonPaymentQrDto } from '@barbercue/shared';

export function UpiRoutingStatus({ current }: { current: SalonPaymentQrDto | null }) {
  const detected = current?.paymentQrImageUrl && current.upiQrDecoded === true && current.upiVpa && current.upiPayeeName;
  return <div role="status" style={{ marginBottom: 16, overflowWrap: 'anywhere' }}>
    <strong>Direct UPI</strong>
    {!current?.paymentQrImageUrl ? <p>Upload your shop UPI QR image. FastQue will detect its UPI account automatically.</p>
      : detected ? <>
        <p>QR uploaded successfully. UPI account detected.</p>
        <p>UPI ID: {current.upiVpa}<br />Payee: {current.upiPayeeName}</p>
        <p>Tap to Pay enabled. Check the detected account before accepting payments.</p>
      </> : <p>{UPI_QR_ONLY_NOTICE}</p>}
  </div>;
}
