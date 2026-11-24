"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { CalendarTarget } from "../../lib/business-today";
import { directoryActorRequest } from "../../lib/directory-client";
import type { DirectoryBusiness } from "../../server/directory/types";
import { useT } from "../i18n/LocaleProvider";
import styles from "./overview.module.css";

const BusinessBookingManager = dynamic(() =>
  import("../booking/BusinessBookingManager").then((m) => m.BusinessBookingManager),
);
const RentalFleet = dynamic(() => import("../rentals/RentalFleet").then((m) => m.RentalFleet));
const StayUnits = dynamic(() => import("../stays/StayUnits").then((m) => m.StayUnits));

export function OwnerCalendarPanel({
  target,
  accountId,
  onBack,
}: {
  target: CalendarTarget;
  accountId: string;
  onBack: () => void;
}) {
  const t = useT();
  const [business, setBusiness] = useState<DirectoryBusiness | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry repeats the ownership check after a failure.
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    void directoryActorRequest(accountId)(`mine/${target.businessId}`, {
      signal: controller.signal,
    })
      .then(({ business }) => {
        if (
          !business ||
          business.id !== target.businessId ||
          business.ownerId !== accountId ||
          business.status === "archived"
        )
          throw Error("unavailable");
        if (!controller.signal.aborted) setBusiness(business);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setBusiness(null);
          setFailed(true);
        }
      });
    return () => controller.abort();
  }, [accountId, target.businessId, retry]);
  return (
    <section className={styles.workspace}>
      <button type="button" className={styles.manage} onClick={onBack}>
        {t("Nazad na djelatnosti")}
      </button>
      {!business &&
        (failed ? (
          <p role="status">
            {t("Kalendar nije dostupan.")}{" "}
            <button type="button" onClick={() => setRetry(retry + 1)}>
              {t("Pokušaj ponovo")}
            </button>
          </p>
        ) : (
          <span
            role="status"
            aria-label={t("Učitavanje kalendara")}
            className={styles.placeholder}
          />
        ))}
      {business && (
        <>
          <h2>{business.title}</h2>
          {target.kind === "service" && (
            <BusinessBookingManager
              initialDay={target.day}
              businessId={business.id}
              businessTitle={business.title}
              expectedAccountId={accountId}
            />
          )}
          {target.kind === "rental" && (
            <RentalFleet
              businessId={business.id}
              actor={accountId}
              photos={business.media?.gallery}
              mediaOnReview={business.pendingMedia}
            />
          )}
          {target.kind === "stay" && (
            <StayUnits
              businessId={business.id}
              businessTitle={business.title}
              actor={accountId}
              photos={business.media?.gallery}
              mediaOnReview={business.pendingMedia}
            />
          )}
        </>
      )}
    </section>
  );
}
