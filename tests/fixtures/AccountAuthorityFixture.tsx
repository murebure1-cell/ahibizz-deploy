"use client";

import { useMemo, useState } from "react";
import { AccountAuthorityBoundary } from "../../src/components/account/AccountAuthorityBoundary";
import { ConnectionsPanel } from "../../src/components/connections/ConnectionsPanel";
import { MessagingInbox } from "../../src/components/messaging/MessagingInbox";
import { PersonalProfileWorkspace } from "../../src/components/people/PersonalProfileWorkspace";
import { createMessagingPreviewApi } from "../../src/components/preview/messaging-preview-api";
import { AccountSettingsError } from "../../src/lib/account-settings";
import { ConnectionRequestError } from "../../src/lib/connections-client";
import { MessagingRequestError } from "../../src/lib/messaging-client";
import type { PersonalProfile } from "../../src/lib/people";
import { ProfileRequestError } from "../../src/lib/people-client";

const A = "fixture-account-a",
  B = "fixture-account-b";
const target = { kind: "person", targetId: "fixture-friend" } as const;
const person: PersonalProfile = {
  id: A,
  name: "ACCOUNT_A_PRIVATE_PROFILE",
  verified: false,
  platformFounder: false,
  platformAdministrator: false,
  birthDate: "1990-02-03",
  city: "Tuzla",
  countryCode: "BA",
  bio: "PRIVATE_A_BIO",
  skills: ["ACCOUNT_A_PRIVATE_SKILL"],
  workStatus: "business_owner",
  version: 1,
  photoVersion: null,
  coverVersion: null,
  canCustomizeCover: false,
};
const friend = {
  id: target.targetId,
  name: "ACCOUNT_A_PRIVATE_FRIEND",
  city: "Tuzla",
  countryCode: "BA",
  bio: null,
  skills: [],
  workStatus: "not_specified",
  photoVersion: null,
  coverVersion: null,
};

function harness(notify: () => void) {
  let actor = A,
    profileReads = 0,
    socialReads = 0,
    authorityReads = 0,
    messageReads = 0,
    messageWrites = 0,
    profileWrites = 0,
    abortedReads = 0,
    holdAuthority = false,
    holdMessage = false,
    offline = false,
    role: "member" | "owner" = "member",
    profile = structuredClone(person);
  const waitingAuthority: (() => void)[] = [],
    waitingMessages: (() => void)[] = [];
  const engine = createMessagingPreviewApi({
    self: () => ({ id: A, name: person.name }),
    person: (id) => (id === friend.id ? friend : null),
    business: () => null,
  });
  const snapshot = () => ({
    actor,
    profileReads,
    socialReads,
    authorityReads,
    messageReads,
    messageWrites,
    profileWrites,
    abortedReads,
    holdAuthority,
    holdMessage,
    offline,
    role,
    waitingAuthority: waitingAuthority.length,
    waitingMessages: waitingMessages.length,
  });
  return {
    snapshot,
    switchActor: (next: string) => {
      actor = next;
      notify();
    },
    toggleAuthority: () => {
      holdAuthority = !holdAuthority;
      notify();
    },
    toggleMessage: () => {
      holdMessage = !holdMessage;
      notify();
    },
    toggleOffline: () => {
      offline = !offline;
      notify();
    },
    toggleRole: () => {
      role = role === "member" ? "owner" : "member";
      notify();
    },
    releaseAuthority: () => {
      const next = waitingAuthority.shift();
      next?.();
      notify();
    },
    releaseMessage: () => {
      const next = waitingMessages.shift();
      next?.();
      notify();
    },
    authority: async (options: RequestInit = {}) => {
      authorityReads++;
      options.signal?.addEventListener(
        "abort",
        () => {
          abortedReads++;
          notify();
        },
        { once: true },
      );
      const account = {
        id: actor,
        name: actor === A ? person.name : "ACCOUNT_B",
        email: "fixture@example.invalid",
        emailVerified: true,
        role,
        approval: "approved",
        locale: "bs",
        appearance: "system",
      };
      const unavailable = offline;
      const invalidActor = new Headers(options.headers).get("X-AhiBizz-Account-ID") !== actor;
      notify();
      const respond = () => {
        if (unavailable) throw new Error("Isolated network unavailable");
        if (invalidActor) throw new AccountSettingsError(401, "ACCOUNT_IDENTITY_CHANGED");
        return { account };
      };
      if (!holdAuthority) return respond();
      return new Promise<unknown>((resolve, reject) => {
        waitingAuthority.push(() => {
          try {
            resolve(respond());
          } catch (failure) {
            reject(failure);
          }
        });
        notify();
      });
    },
    profile: async (path: string, options: RequestInit = {}) => {
      profileReads++;
      notify();
      if (actor !== A) throw new ProfileRequestError(401, "ACCOUNT_IDENTITY_CHANGED");
      if (options.method) {
        if (options.method !== "PUT" || path !== "me/media/photo")
          throw new ProfileRequestError(503, "FIXTURE_WRITE_DISABLED");
        profileWrites++;
        profile = { ...profile, version: profile.version + 1, photoVersion: profile.version + 1 };
        notify();
      }
      return { profile: structuredClone(profile) };
    },
    social: async (path: string) => {
      socialReads++;
      notify();
      if (actor !== A) throw new ConnectionRequestError(401, "ACCOUNT_IDENTITY_CHANGED");
      if (path === "visibility")
        return { visibility: { isPublic: false, profileVersion: profile.version } };
      return {
        items: [
          {
            id: "fixture-relationship",
            status: "accepted",
            direction: "outgoing",
            version: 1,
            personId: friend.id,
            person: structuredClone(friend),
          },
        ],
        page: 1,
        hasMore: false,
      };
    },
    messages: async (path: string, options: RequestInit = {}) => {
      if (new Headers(options.headers).get("X-AhiBizz-Account-ID") !== actor)
        throw new MessagingRequestError(401, "ACCOUNT_IDENTITY_CHANGED");
      const reply = await engine.request(path, options);
      if (options.method === "POST" && /\/messages$/.test(path)) {
        messageWrites++;
        notify();
        if (holdMessage)
          return new Promise<Record<string, unknown>>((resolve) => {
            waitingMessages.push(() => resolve(reply));
            notify();
          });
      } else messageReads++;
      notify();
      return reply;
    },
  };
}

export function AccountAuthorityFixture() {
  const [, render] = useState(0),
    [mode, setMode] = useState<"profile" | "connections" | "messages">("profile"),
    [tall, setTall] = useState(false);
  const h = useMemo(() => harness(() => render((n) => n + 1)), []);
  const selectedPhotoReturns = () => {
    const input = document.querySelector<HTMLInputElement>('#private-fixture input[type="file"]');
    if (!input) return;
    // A controlled file-picker return ordering test, not a real upload or network call.
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2gU9sAAAAASUVORK5CYII=",
      ),
      (value) => value.charCodeAt(0),
    );
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "isolated-photo.png", { type: "image/png" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  return (
    <>
      <aside className="fixture" style={{ position: "sticky", top: 0, zIndex: 10 }}>
        <strong>IZOLIRANA PROBA — stvarne komponente, lokalni podaci</strong>
        <div>
          <button type="button" onClick={() => setMode("profile")}>
            Profil
          </button>
          <button type="button" onClick={() => setMode("connections")}>
            Prijatelji
          </button>
          <button type="button" onClick={() => setMode("messages")}>
            Poruke
          </button>
          <button type="button" onClick={() => window.dispatchEvent(new Event("blur"))}>
            Sakrij prozor
          </button>
          <button type="button" onClick={() => h.switchActor(B)}>
            Prijavi B
          </button>
          <button type="button" onClick={() => h.switchActor(A)}>
            Prijavi A
          </button>
          <button type="button" onClick={() => window.dispatchEvent(new Event("focus"))}>
            Vrati u prozor
          </button>
          <button type="button" onClick={h.toggleAuthority}>
            Zadrži provjere
          </button>
          <button type="button" onClick={h.releaseAuthority}>
            Pusti provjeru
          </button>
          <button type="button" onClick={h.toggleMessage}>
            Zadrži odgovor poruke
          </button>
          <button type="button" onClick={h.releaseMessage}>
            Pusti odgovor poruke
          </button>
          <button type="button" onClick={h.toggleOffline}>
            Promijeni mrežu
          </button>
          <button type="button" onClick={h.toggleRole}>
            Promijeni ulogu
          </button>
          <button type="button" onClick={selectedPhotoReturns}>
            Vrati odabranu sliku
          </button>
          <button type="button" onClick={() => setTall(!tall)}>
            Duga probna stranica
          </button>
        </div>
        <output id="fixture-status">{JSON.stringify(h.snapshot())}</output>
      </aside>
      <AccountAuthorityBoundary expectedAccountId={A} expectedRole="member" request={h.authority}>
        {() => (
          <main id="private-fixture">
            <div hidden={mode !== "profile"}>
              <PersonalProfileWorkspace
                active={mode === "profile"}
                expectedAccountId={A}
                request={h.profile}
                connectionsRequest={h.social}
                photoUrl={null}
                coverUrl={null}
              />
            </div>
            <div hidden={mode !== "connections"}>
              <ConnectionsPanel
                active={mode === "connections"}
                expectedAccountId={A}
                request={h.social}
              />
            </div>
            <div hidden={mode !== "messages"}>
              <MessagingInbox
                active={mode === "messages"}
                expectedAccountId={A}
                preview
                request={h.messages}
                initialTarget={target}
              />
            </div>
            {tall && <div aria-hidden="true" style={{ height: 1800 }} />}
          </main>
        )}
      </AccountAuthorityBoundary>
    </>
  );
}
