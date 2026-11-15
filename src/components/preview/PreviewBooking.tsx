"use client";
import { PublicBooking } from "../booking/PublicBooking";
import { useBookingPreview } from "./BookingPreviewState";
export function PreviewBooking({ businessId = "forma" }: { businessId?: string }) {
  const api = useBookingPreview();
  const configuration = api.getConfig(businessId);
  return (
    <PublicBooking
      key={businessId}
      expectedAccountId="00100000-0000-4000-8000-000000000002"
      businessId={businessId}
      configuration={configuration}
      preview
      request={api.customerRequest}
    />
  );
}
