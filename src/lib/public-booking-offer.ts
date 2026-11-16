import type { PublicBookingConfiguration } from "./booking";
import type { BookingQuote } from "./booking-submission";

type Snapshot = Readonly<{
  configuration: PublicBookingConfiguration | null;
  available: boolean;
  revision: number;
}>;

function copy(value: PublicBookingConfiguration | null) {
  if (!value) return null;
  if (!Number.isSafeInteger(value.version) || value.version < 0)
    throw new Error("invalid_booking_configuration");
  const result = {
    ...value,
    services: value.services.map((service) => Object.freeze({ ...service })),
  };
  Object.freeze(result.services);
  return Object.freeze(result);
}

/** Latest public offer and the offer still displayed for an unfinished command. */
export function createPublicBookingOffer(initial: PublicBookingConfiguration | null) {
  let latest: Snapshot = Object.freeze({
    configuration: copy(initial),
    available: initial !== null,
    revision: 0,
  });
  let applied = latest;

  function receive(next: PublicBookingConfiguration | null): boolean {
    if (next) {
      if (!Number.isSafeInteger(next.version) || next.version < 0)
        throw new Error("invalid_booking_configuration");
      const known = latest.configuration;
      if (known && next.version < known.version) return false;
      if (known?.version === next.version && latest.available) return false;
      latest = Object.freeze({
        configuration: known?.version === next.version ? known : copy(next),
        available: true,
        revision: latest.revision + 1,
      });
    } else {
      if (!latest.available) return false;
      // A failed optional read must stop new requests without destroying a pending quote.
      latest = Object.freeze({ ...latest, available: false, revision: latest.revision + 1 });
    }
    return true;
  }

  return {
    get latest() {
      return latest;
    },
    get applied() {
      return applied;
    },
    receive,
    receiveRead(next: PublicBookingConfiguration, expectedRevision: number) {
      return expectedRevision === latest.revision && receive(next);
    },
    apply(blocked: boolean) {
      if (!blocked) applied = latest;
      return applied;
    },
    canDispatch(quote: BookingQuote) {
      const value = latest.configuration;
      return Boolean(
        latest.available &&
          value?.enabled &&
          value.version === quote.configurationVersion &&
          value.services.some((service) => service.id === quote.serviceId),
      );
    },
  };
}
