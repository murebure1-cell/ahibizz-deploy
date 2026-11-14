"use client";
import { PublicBooking } from "../booking/PublicBooking";
import { useBookingPreview } from "./BookingPreviewState";
export function PreviewBooking({ businessId = "forma" }: { businessId?: string }) {
  const api = useBookingPreview();
  const configuration = api.getConfig(businessId);
  return (
    <PublicBooking
      key={`${businessId}-${configuration.version}`}
      businessId={businessId}
      configuration={configuration}
      preview
      request={api.customerRequest}
    />
  );
}
