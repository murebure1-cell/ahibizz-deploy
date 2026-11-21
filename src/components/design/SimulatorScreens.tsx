"use client";
import { useMemo } from "react";
import type { bookingRequest } from "../../lib/booking-client";
import type { MessagingRequest } from "../../lib/messaging-client";
import type { VisualDesign } from "../../lib/visual-design";
import { AccountSummary } from "../account/AccountOverview";
import account from "../account/account.module.css";
import { AccountApprovals, type AdminAccountRequest } from "../admin/AccountApprovals";
import admin from "../admin/admin.module.css";
import { AuthForm } from "../auth/AuthForm";
import { PublicBooking } from "../booking/PublicBooking";
import { DirectoryResultCard } from "../directory/DirectoryResultCard";
import { DirectorySearchForm } from "../directory/DirectorySearchForm";
import { PublicBusinessProfile } from "../directory/PublicBusinessProfile";
import search from "../directory/public-search.module.css";
import { HomeBusinessRail, HomeSurface } from "../home/HomeSurface";
import { Icon } from "../Icon";
import { MessagingInbox } from "../messaging/MessagingInbox";
import { PersonalProfileCard } from "../people/PersonalProfileCard";
import { useBookingPreview } from "../preview/BookingPreviewState";
import { previewBusinesses } from "../preview/data";
import { useMessagingPreview } from "../preview/MessagingPreviewState";
import { usePeoplePreview } from "../preview/PeoplePreviewState";
import { previewPublicBusiness } from "../preview/public-view";
import type { SimulatorScreen } from "./simulator";

const businesses = previewBusinesses.map(previewPublicBusiness);
const categories = [
  { id: "beauty", label: "Za tebe", icon: "heart", href: "/pretraga?categoryId=beauty" },
  { id: "home", label: "Za dom", icon: "home", href: "/pretraga?categoryId=home" },
  { id: "food", label: "Hrana i piće", icon: "coffee", href: "/pretraga?categoryId=food" },
  { id: "service", label: "Usluge", icon: "shop", href: "/pretraga?categoryId=service" },
] as const;
const cardList = businesses.map((business) => (
  <DirectoryResultCard key={business.id} preview business={business} />
));
const first = businesses[0];
const readFixtureAccounts: AdminAccountRequest = async (path, init) => {
  if (init?.method && init.method !== "GET") return Response.json({}, { status: 405 });
  const query = new URL(path, "https://fixture.invalid").searchParams;
  const approval = query.get("approval") || "pending";
  return Response.json({
    approval,
    page: Number(query.get("page") || 1),
    accounts: [],
    limit: 30,
    hasMore: false,
  });
};
const sampleThreadTarget = { kind: "person", targetId: "preview-designer" } as const;
function FixtureBooking() {
  const api = useBookingPreview();
  const request = useMemo<typeof bookingRequest>(
    () =>
      (path, options = {}) => {
        if (options.method && options.method !== "GET")
          return Promise.reject(new Error("preview_read_only"));
        return api.customerRequest(path, options);
      },
    [api],
  );
  return (
    <PublicBooking
      preview
      expectedAccountId="00100000-0000-4000-8000-000000000002"
      businessId="forma"
      configuration={api.getConfig("forma")}
      request={request}
    />
  );
}
function FixtureInbox() {
  const { api, ready } = useMessagingPreview();
  const person = usePeoplePreview();
  const request = useMemo<MessagingRequest>(
    () =>
      (path, options = {}) => {
        // The simulated conversation is seeded in memory. No other write is available to controls.
        if (options.method && options.method !== "GET" && path !== "threads")
          return Promise.reject(new Error("preview_read_only"));
        return api.request(path, options);
      },
    [api],
  );
  return ready ? (
    <MessagingInbox
      preview
      request={request}
      expectedAccountId={person.getProfile().id}
      initialTarget={sampleThreadTarget}
    />
  ) : null;
}
export function SimulatorScreens({
  screen,
  design,
}: {
  screen: SimulatorScreen;
  design: VisualDesign;
}) {
  const person = usePeoplePreview();
  if (screen === "home")
    return (
      <HomeSurface
        design={design}
        searchAction="/pretraga"
        placeField="mjesto"
        categories={categories}
        featuredHref="/pretraga"
        featured={cardList}
        newest={cardList.slice(0, 1)}
        advertisingHref="/nalog?odjeljak=oglasi"
        nearbyControl={<span>Tuzla</span>}
        nearby={<HomeBusinessRail label="Djelatnosti u blizini" cards={cardList.slice(1)} />}
      />
    );
  if (screen === "auth") return <AuthForm mode="sign-in" available />;
  if (screen === "search")
    return (
      <main className={search.page}>
        <header className={search.intro}>
          <h1>Pretraga djelatnosti</h1>
        </header>
        <DirectorySearchForm
          query=""
          city=""
          categoryId=""
          subcategoryId=""
          categories={categories.map((c) => ({ id: c.id, name: c.label, parentId: null }))}
        />
        <div className={search.grid}>{cardList}</div>
      </main>
    );
  if (screen === "business" && first)
    return (
      <PublicBusinessProfile preview business={{ ...first, latitude: null, longitude: null }}>
        <FixtureBooking />
      </PublicBusinessProfile>
    );
  if (screen === "admin")
    return (
      <main className={admin.layout}>
        <aside className={admin.sidebar}>
          <div className={admin.identity}>
            <span>
              <Icon name="shield" />
            </span>
            <div>
              <strong>Administracija</strong>
              <small>Administrator</small>
            </div>
          </div>
          <nav aria-label="Administratorski odjeljci">
            <button type="button" aria-current="page">
              <Icon name="people" />
              Nalozi
            </button>
            <a href="/pretraga">
              <Icon name="shop" />
              Djelatnosti
            </a>
          </nav>
        </aside>
        <section className={admin.content} data-design="admin-panel">
          <header className={admin.pageHeading} data-design="admin-heading">
            <h1>Korisnički nalozi</h1>
          </header>
          <AccountApprovals
            embedded
            expectedAccountId="design-owner-fixture"
            request={readFixtureAccounts}
          />
        </section>
      </main>
    );
  const profile = (
    <PersonalProfileCard profile={person.getProfile()} photoUrl={null} coverUrl={null} />
  );
  if (screen === "profile") return <main className={search.page}>{profile}</main>;
  if (screen === "booking")
    return (
      <main className={search.page}>
        <FixtureBooking />
      </main>
    );
  return (
    <main className={account.layout}>
      <aside className={account.sidebar} data-design="account-sidebar">
        <div className={account.identity}>
          <span aria-hidden="true">A</span>
          <div>
            <strong>{person.getProfile().name}</strong>
            <small>Moj AhiBizz</small>
          </div>
        </div>
        <div className={account.navigationViewport}>
          <nav aria-label="Moj nalog">
            <a href="/nalog" aria-current={screen === "account" ? "page" : undefined}>
              <Icon name="home" />
              Pregled
            </a>
            <a href="/nalog?odjeljak=djelatnosti">
              <Icon name="shop" />
              Djelatnosti
            </a>
            <a
              href="/nalog?odjeljak=poruke"
              aria-current={screen === "messages" ? "page" : undefined}
            >
              <Icon name="message" />
              Poruke
            </a>
            <a href="/nalog?odjeljak=termini">
              <Icon name="calendar" />
              Moji termini
            </a>
          </nav>
        </div>
      </aside>
      <section className={account.content} data-design="account-panel">
        {screen === "messages" ? (
          <FixtureInbox />
        ) : (
          <AccountSummary
            facts={{
              accountId: person.getProfile().id,
              joinedAt: "2026-11-01T09:00:00Z",
              businesses: 2,
              unreadThreads: 1,
              promotedBusinesses: 1,
              credits: 5,
            }}
            onSection={() => {}}
          />
        )}
      </section>
    </main>
  );
}
