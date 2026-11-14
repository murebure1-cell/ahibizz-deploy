import type {
  BookingEntry,
  BookingServiceOption,
  BookingSettings,
  BookingStatus,
  PublicBookingConfiguration,
} from "../../lib/booking";
import { BookingRequestError, type bookingRequest } from "../../lib/booking-client";
import { addDays, dailySlots, dateKey, isTimeZone } from "../../lib/booking-time";

const OWNER = "00100000-0000-4000-8000-000000000001";
const CUSTOMER = "00100000-0000-4000-8000-000000000002";
const MINUTE = 60_000;
const DAY = 86_400_000;
const clone = <T>(value: T): T => structuredClone(value);
function reject(status: number, code = "INVALID_BOOKING_INPUT"): never {
  throw new BookingRequestError(code, status);
}
function record(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) reject(400);
  if (Object.keys(input).some((key) => !keys.includes(key))) reject(400);
  return input as Record<string, unknown>;
}
function integer(value: unknown, min: number, max = 2_147_483_646): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) reject(400);
  return value as number;
}
function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value)
  )
    reject(400);
  return value.toLowerCase();
}
function text(value: unknown, max: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > max ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return (
        code < 32 ||
        code === 127 ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069)
      );
    })
  )
    reject(400);
  return value.trim();
}
function optionalText(value: unknown, max: number) {
  return value === undefined || value === null || value === "" ? null : text(value, max);
}
function instant(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  )
    reject(400);
  const result = new Date(value);
  if (
    !Number.isFinite(result.getTime()) ||
    result.toISOString().replace(".000Z", "Z") !== value.replace(".000Z", "Z")
  )
    reject(400);
  return result.toISOString();
}
const emptySettings = (): BookingSettings => ({
  enabled: false,
  timezone: "Europe/Sarajevo",
  version: 0,
  windows: [],
  services: [],
});
function publicConfig(settings: BookingSettings): PublicBookingConfiguration {
  const enabled =
    settings.enabled &&
    settings.windows.length > 0 &&
    settings.services.some((service) => service.active);
  return {
    enabled,
    timezone: settings.timezone,
    version: settings.version,
    services: enabled
      ? settings.services
          .filter((service) => service.active)
          .map(({ active: _active, ...service }) => service)
      : [],
  };
}

/** Isolated design fixtures only. This adapter never calls fetch or imports server/database code. */
export function createBookingPreviewApi({ now = () => new Date() }: { now?: () => Date } = {}) {
  const businesses = new Map<
    string,
    { title: string; settings: BookingSettings; serviceIds: Set<string> }
  >();
  const entries = new Map<string, BookingEntry>();
  const receipts = new Map<string, { payload: string; entryId: string }>();
  const credits = new Map<string, { businessId: string; recipient: string; amount: number }>();
  const listeners = new Set<() => void>();
  let revision = 0;
  function changed() {
    revision++;
    for (const listener of listeners) listener();
  }
  function clock() {
    const result = now();
    if (!(result instanceof Date) || !Number.isFinite(result.getTime()))
      reject(503, "BOOKING_UNAVAILABLE");
    return new Date(result.getTime());
  }
  function registerBusiness(id: string, title: string, enabled = false) {
    if (!/^[A-Za-z0-9-]{1,128}$/.test(id)) reject(400);
    const name = text(title, 200),
      old = businesses.get(id);
    if (old) {
      if (old.title !== name) {
        old.title = name;
        changed();
      }
      return;
    }
    businesses.set(id, {
      title: name,
      settings: { ...emptySettings(), enabled },
      serviceIds: new Set(),
    });
    changed();
  }
  registerBusiness("forma", "Studio Forma · ogledni profil");
  const forma = businesses.get("forma");
  if (forma) {
    forma.settings = {
      enabled: true,
      timezone: "Europe/Sarajevo",
      version: 1,
      windows: Array.from({ length: 6 }, (_, index) => ({
        weekday: index + 1,
        startMinute: 540,
        endMinute: 1020,
      })),
      services: [
        {
          id: "00100000-0000-4000-8000-000000000101",
          name: "Klasična masaža",
          durationMinutes: 45,
          priceMinor: 4500,
          active: true,
        },
        {
          id: "00100000-0000-4000-8000-000000000102",
          name: "Sportska masaža",
          durationMinutes: 60,
          priceMinor: 6000,
          active: true,
        },
        {
          id: "00100000-0000-4000-8000-000000000103",
          name: "Fizioterapija",
          durationMinutes: 30,
          priceMinor: 4000,
          active: true,
        },
      ],
    };
    forma.serviceIds = new Set(forma.settings.services.map((service) => service.id));
  }
  function business(id: string) {
    const result = businesses.get(id);
    if (!result) reject(404, "BUSINESS_NOT_FOUND");
    return result;
  }
  const getConfig = (id = "forma") =>
    clone(publicConfig(businesses.get(id)?.settings ?? emptySettings()));
  const getSettings = (id = "forma") => clone(businesses.get(id)?.settings ?? emptySettings());
  const held = (id: string) =>
    [...entries.values()].filter(
      (entry) => entry.businessId === id && ["requested", "confirmed"].includes(entry.status),
    );
  function free(id: string, startsAt: string, endsAt: string, except?: string) {
    if (
      held(id).some(
        (entry) => entry.id !== except && entry.startsAt < endsAt && entry.endsAt > startsAt,
      )
    )
      reject(409, "SLOT_UNAVAILABLE");
  }
  function activeService(settings: BookingSettings, id: unknown) {
    const key = uuid(id),
      service = settings.services.find((item) => item.id === key && item.active);
    if (!service) reject(400);
    return service;
  }
  function slots(id: string, serviceId: unknown, date: unknown) {
    const config = business(id).settings;
    if (!publicConfig(config).enabled) reject(409, "BOOKING_DISABLED");
    const service = activeService(config, serviceId),
      time = clock();
    if (
      typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
    )
      reject(400);
    const today = dateKey(time, config.timezone);
    if (date < today || date > addDays(today, 90)) reject(400);
    return {
      timezone: config.timezone,
      date,
      serviceId: service.id,
      configurationVersion: config.version,
      slots: dailySlots({
        date,
        timezone: config.timezone,
        windows: config.windows,
        durationMinutes: service.durationMinutes,
        occupied: held(id),
        now: time,
      }),
    };
  }
  function save(id: string, input: unknown) {
    const row = business(id),
      before = row.settings;
    const value = record(input, ["expectedVersion", "enabled", "timezone", "windows", "services"]);
    if (integer(value.expectedVersion, 0) !== before.version) reject(409, "VERSION_CONFLICT");
    if (
      typeof value.enabled !== "boolean" ||
      !isTimeZone(value.timezone) ||
      !Array.isArray(value.windows) ||
      value.windows.length > 28 ||
      !Array.isArray(value.services) ||
      value.services.length > 20
    )
      reject(400);
    if (
      value.timezone !== before.timezone &&
      held(id).some((entry) => Date.parse(entry.endsAt) > clock().getTime())
    )
      reject(409, "BOOKING_TIMEZONE_IN_USE");
    const windows = value.windows
      .map((input) => {
        const item = record(input, ["weekday", "startMinute", "endMinute"]),
          weekday = integer(item.weekday, 1, 7),
          startMinute = integer(item.startMinute, 0, 1439),
          endMinute = integer(item.endMinute, 1, 1440);
        if (endMinute <= startMinute) reject(400);
        return { weekday, startMinute, endMinute };
      })
      .sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
    for (let i = 1; i < windows.length; i++) {
      const previous = windows[i - 1],
        current = windows[i];
      if (
        previous &&
        current &&
        previous.weekday === current.weekday &&
        previous.endMinute > current.startMinute
      )
        reject(400);
    }
    const seen = new Set<string>();
    const services = value.services.map((input): BookingServiceOption => {
      const item = record(input, ["id", "name", "durationMinutes", "priceMinor", "active"]),
        id = item.id === undefined ? crypto.randomUUID() : uuid(item.id);
      if (
        (item.id !== undefined && !row.serviceIds.has(id)) ||
        seen.has(id) ||
        typeof item.active !== "boolean"
      )
        reject(400);
      seen.add(id);
      const durationMinutes = integer(item.durationMinutes, 15, 240);
      if (durationMinutes % 5) reject(400);
      return {
        id,
        name: text(item.name, 120),
        durationMinutes,
        priceMinor: integer(item.priceMinor, 0, 10_000_000),
        active: item.active,
      };
    });
    row.settings = {
      enabled: value.enabled,
      timezone: value.timezone,
      windows,
      services,
      version: before.version + 1,
    };
    for (const service of services) row.serviceIds.add(service.id);
    changed();
    return { settings: row.settings };
  }
  function create(id: string, input: unknown, actor: string, key: string, manual: boolean) {
    const row = business(id),
      config = row.settings;
    const value = record(
      input,
      manual
        ? ["kind", "serviceId", "startsAt", "endsAt", "clientName", "clientPhone"]
        : ["serviceId", "startsAt", "configurationVersion"],
    );
    const startsAt = instant(value.startsAt);
    const kind = manual ? value.kind : "customer";
    if (
      !["customer", "manual", "block"].includes(kind as string) ||
      (manual && kind === "customer")
    )
      reject(400);
    const serviceId =
      value.serviceId === undefined || value.serviceId === null ? null : uuid(value.serviceId);
    if ((kind === "block" && serviceId) || (kind !== "block" && !serviceId)) reject(400);
    const endsInput = value.endsAt === undefined ? null : instant(value.endsAt);
    const clientName = manual ? optionalText(value.clientName, 120) : "Ogledni korisnik";
    const clientPhone = manual ? optionalText(value.clientPhone, 40) : null;
    if (clientPhone && !/^[+0-9][0-9 ().-]{3,39}$/.test(clientPhone)) reject(400);
    const quoteVersion = manual ? null : integer(value.configurationVersion, 1);
    const payload = JSON.stringify([
      id,
      manual,
      kind,
      serviceId,
      startsAt,
      endsInput,
      clientName,
      clientPhone,
      quoteVersion,
    ]);
    const receiptKey = `${actor}:${uuid(key)}`,
      old = receipts.get(receiptKey);
    if (old) {
      if (old.payload !== payload) reject(409, "IDEMPOTENCY_CONFLICT");
      const prior = entries.get(old.entryId);
      if (!prior) reject(404, "BOOKING_NOT_FOUND");
      return { entry: prior };
    }
    if (!manual && actor === OWNER) reject(403, "SELF_BOOKING_NOT_ALLOWED");
    if (!manual && quoteVersion !== config.version) reject(409, "BOOKING_CONFIGURATION_CHANGED");
    if (!manual && !publicConfig(config).enabled) reject(409, "BOOKING_DISABLED");
    const service = kind === "block" ? null : activeService(config, serviceId);
    let endsAt = service
      ? new Date(Date.parse(startsAt) + service.durationMinutes * MINUTE).toISOString()
      : endsInput;
    if (!manual) {
      const selected = slots(
        id,
        serviceId,
        dateKey(new Date(startsAt), config.timezone),
      ).slots.find((slot) => slot.startsAt === startsAt);
      if (!selected) reject(409, "SLOT_UNAVAILABLE");
      endsAt = selected.endsAt;
    }
    if (
      !endsAt ||
      (manual && service && endsInput && endsInput !== endsAt) ||
      Date.parse(startsAt) <= clock().getTime() ||
      Date.parse(endsAt) <= Date.parse(startsAt) ||
      (kind === "block" && Date.parse(endsAt) - Date.parse(startsAt) > 31 * DAY)
    )
      reject(400);
    free(id, startsAt, endsAt);
    const entry: BookingEntry = {
      id: crypto.randomUUID(),
      businessId: id,
      businessTitle: row.title,
      timezone: config.timezone,
      kind: kind as BookingEntry["kind"],
      serviceId: service?.id ?? null,
      serviceName: service?.name ?? null,
      durationMinutes: service?.durationMinutes ?? null,
      priceMinor: service?.priceMinor ?? 0,
      status: manual ? "confirmed" : "requested",
      version: 1,
      customerId: manual ? null : CUSTOMER,
      clientName,
      clientEmail: manual ? null : "korisnik@booking-preview.invalid",
      clientPhone,
      startsAt,
      endsAt,
    };
    entries.set(entry.id, entry);
    receipts.set(receiptKey, { payload, entryId: entry.id });
    changed();
    return { entry };
  }
  function transition(id: string, input: unknown, actor: string) {
    const value = record(input, ["expectedVersion", "action"]),
      key = uuid(id),
      before = entries.get(key);
    if (!before || (actor !== OWNER && before.customerId !== actor))
      reject(404, "BOOKING_NOT_FOUND");
    if (integer(value.expectedVersion, 1) !== before.version) reject(409, "VERSION_CONFLICT");
    if (!["approve", "decline", "cancel", "complete"].includes(value.action as string)) reject(400);
    const manages = actor === OWNER,
      time = clock().getTime();
    let status: BookingStatus;
    if (value.action === "approve") {
      if (!manages || before.status !== "requested" || Date.parse(before.startsAt) <= time)
        reject(409, "INVALID_BOOKING_TRANSITION");
      free(before.businessId, before.startsAt, before.endsAt, before.id);
      status = "confirmed";
    } else if (value.action === "decline") {
      if (!manages || before.status !== "requested") reject(409, "INVALID_BOOKING_TRANSITION");
      status = "declined";
    } else if (value.action === "cancel") {
      if (
        !["requested", "confirmed"].includes(before.status) ||
        (!manages && Date.parse(before.startsAt) <= time)
      )
        reject(409, "INVALID_BOOKING_TRANSITION");
      status = "cancelled";
    } else {
      if (
        !manages ||
        before.kind === "block" ||
        before.status !== "confirmed" ||
        Date.parse(before.endsAt) > time
      )
        reject(409, "INVALID_BOOKING_TRANSITION");
      status = "completed";
    }
    const entry = { ...before, status, version: before.version + 1 };
    entries.set(key, entry);
    if (
      status === "completed" &&
      before.kind === "customer" &&
      before.customerId &&
      before.customerId !== OWNER &&
      !credits.has(key)
    )
      credits.set(key, { businessId: before.businessId, recipient: OWNER, amount: 5 });
    changed();
    return { entry };
  }
  function requestFor(actor: string): typeof bookingRequest {
    return async (path, options = {}) => {
      options.signal?.throwIfAborted();
      if (
        !/^[A-Za-z0-9/?=&%_.:-]+$/.test(path) ||
        path.startsWith("/") ||
        path.includes(":") ||
        path.includes("..") ||
        path.length > 8192
      )
        reject(400);
      const url = new URL(path, "https://booking-preview.invalid/"),
        method = options.method ?? "GET";
      function query(keys: string[]) {
        const values: Record<string, unknown> = {};
        for (const [key, value] of url.searchParams) {
          if (!keys.includes(key) || Object.hasOwn(values, key)) reject(400);
          values[key] = value;
        }
        return values;
      }
      const owner = /^\/mine\/businesses\/([A-Za-z0-9-]{1,128})\/(settings|calendar|entries)$/.exec(
          url.pathname,
        ),
        pub = /^\/businesses\/([A-Za-z0-9-]{1,128})(?:\/(slots|requests))?$/.exec(url.pathname),
        action = /^\/entries\/([a-f\d-]+)\/action$/.exec(url.pathname);
      if (owner && actor !== OWNER) reject(403, "OWNER_REQUIRED");
      let result: unknown;
      if (method === "GET") {
        if (url.pathname === "/mine") {
          const value = query(["page"]),
            page =
              value.page === undefined
                ? 1
                : /^\d{1,3}$/.test(String(value.page))
                  ? integer(Number(value.page), 1, 500)
                  : reject(400);
          const own = [...entries.values()]
            .filter((entry) => entry.customerId === actor)
            .sort((a, b) => b.startsAt.localeCompare(a.startsAt) || b.id.localeCompare(a.id));
          result = {
            entries: own.slice((page - 1) * 20, page * 20),
            page,
            hasMore: own.length > page * 20,
            credits: [...credits.values()]
              .filter((credit) => credit.recipient === actor)
              .reduce((sum, credit) => sum + credit.amount, 0),
          };
        } else if (pub?.[1] && !pub[2]) {
          query([]);
          business(pub[1]);
          result = { booking: getConfig(pub[1]) };
        } else if (pub?.[1] && pub[2] === "slots") {
          const value = query(["serviceId", "date"]);
          result = slots(pub[1], value.serviceId, value.date);
        } else if (owner?.[1] && owner[2] === "settings") {
          query([]);
          result = { settings: business(owner[1]).settings };
        } else if (owner?.[1] && owner[2] === "calendar") {
          business(owner[1]);
          const value = query(["from", "to"]),
            from = instant(value.from),
            to = instant(value.to);
          if (Date.parse(to) <= Date.parse(from) || Date.parse(to) - Date.parse(from) > 32 * DAY)
            reject(400);
          result = {
            entries: [...entries.values()]
              .filter(
                (entry) =>
                  entry.businessId === owner[1] && entry.startsAt < to && entry.endsAt > from,
              )
              .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id)),
            earnedCredits: [...credits.values()]
              .filter((credit) => credit.businessId === owner[1])
              .reduce((sum, credit) => sum + credit.amount, 0),
          };
        } else reject(404, "NOT_FOUND");
      } else {
        query([]);
        if (
          typeof options.body !== "string" ||
          new TextEncoder().encode(options.body).byteLength > 16384
        )
          reject(400);
        let body: unknown;
        try {
          body = JSON.parse(options.body);
        } catch {
          reject(400);
        }
        const key = new Headers(options.headers).get("Idempotency-Key") ?? "";
        if (method === "PATCH" && owner?.[1] && owner[2] === "settings")
          result = save(owner[1], body);
        else if (method === "POST" && owner?.[1] && owner[2] === "entries")
          result = create(owner[1], body, actor, key, true);
        else if (method === "POST" && pub?.[1] && pub[2] === "requests")
          result = create(pub[1], body, actor, key, false);
        else if (method === "POST" && action?.[1]) result = transition(action[1], body, actor);
        else reject(404, "NOT_FOUND");
      }
      return clone(result);
    };
  }
  const customerRequest = requestFor(CUSTOMER),
    ownerRequest = requestFor(OWNER);
  return {
    customerRequest,
    ownerRequest,
    request: customerRequest,
    getConfig,
    getSettings,
    registerBusiness,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshotVersion: () => revision,
  };
}
