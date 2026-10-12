import { describe, it, expect, jest, beforeAll, afterEach } from "@jest/globals";

// Stub the native card element so setConfig/hass just record what they receive.
class StubMapCard extends HTMLElement {
  setConfig(config) {
    this.lastConfig = config;
  }
  set hass(h) {
    this._hass = h;
  }
  getCardSize() {
    return 7;
  }
}

beforeAll(async () => {
  customElements.define("hui-map-card", StubMapCard);
  // The card creates its inner element via HA's card helpers. Stub that: build
  // the native card the same way the real helper does (create + setConfig).
  window.loadCardHelpers = async () => ({
    createCardElement: (config) => {
      const el = document.createElement("hui-map-card");
      el.setConfig(config);
      return el;
    },
  });
  await import("./map-card-extended.js");
});

afterEach(() => {
  document.body.innerHTML = "";
});

// Inner-card creation is async (loadCardHelpers). Build the card, then wait a
// microtask tick so the inner element is appended before assertions run.
async function makeCard(config, hass) {
  const el = document.createElement("map-card-extended");
  document.body.appendChild(el);
  if (hass) el.hass = hass;
  if (config) el.setConfig(config);
  await Promise.resolve();
  await Promise.resolve();
  return el;
}

describe("map-card-extended", () => {
  it("registers the custom element", () => {
    expect(customElements.get("map-card-extended")).toBeDefined();
  });

  it("forwards a native-shaped config to hui-map-card and strips custom keys", async () => {
    const el = await makeCard({
      type: "custom:map-card-extended",
      default_zoom: 12,
      entities: [
        { entity: "person.a", color: "#fff", tap_action: { action: "none" } },
        "person.b",
      ],
    });
    const inner = el.querySelector("hui-map-card");
    expect(inner.lastConfig.type).toBe("map");
    expect(inner.lastConfig.default_zoom).toBe(12);
    // Native per-entity color preserved; our tap_action stripped from entity.
    expect(inner.lastConfig.entities[0]).toEqual({ entity: "person.a", color: "#fff" });
    expect(inner.lastConfig.entities[1]).toBe("person.b");
  });

  it("intercepts hass-more-info for an entity with a tap_action and runs navigate", async () => {
    const pushState = jest.spyOn(window.history, "pushState").mockImplementation(() => {});
    const locationChanged = jest.fn();
    window.addEventListener("location-changed", locationChanged);

    const el = await makeCard({
      type: "custom:map-card-extended",
      entities: [
        {
          entity: "person.a",
          tap_action: { action: "navigate", navigation_path: "/lovelace/a" },
        },
      ],
    });

    // Native marker click bubbles hass-more-info from inside the inner card.
    const inner = el.querySelector("hui-map-card");
    inner.dispatchEvent(
      new CustomEvent("hass-more-info", {
        detail: { entityId: "person.a" },
        bubbles: true,
        composed: true,
      })
    );

    expect(pushState).toHaveBeenCalledWith(null, "", "/lovelace/a");
    expect(locationChanged).toHaveBeenCalled();

    pushState.mockRestore();
    window.removeEventListener("location-changed", locationChanged);
  });

  it("runs a call-service tap_action via hass.callService", async () => {
    const callService = jest.fn();
    const el = await makeCard(
      {
        type: "custom:map-card-extended",
        entities: [
          {
            entity: "light.k",
            tap_action: { action: "perform-action", perform_action: "light.toggle" },
          },
        ],
      },
      { callService }
    );

    el.querySelector("hui-map-card").dispatchEvent(
      new CustomEvent("hass-more-info", {
        detail: { entityId: "light.k" },
        bubbles: true,
        composed: true,
      })
    );

    expect(callService).toHaveBeenCalledWith("light", "toggle", {}, undefined);
  });

  it("lets hass-more-info through for entities without a tap_action", async () => {
    const el = await makeCard({
      type: "custom:map-card-extended",
      entities: [{ entity: "person.a" }],
    });

    const ev = new CustomEvent("hass-more-info", {
      detail: { entityId: "person.a" },
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    const stop = jest.spyOn(ev, "stopPropagation");
    el.querySelector("hui-map-card").dispatchEvent(ev);

    // No custom action: we must not swallow the event.
    expect(stop).not.toHaveBeenCalled();
  });

  it("delegates getCardSize to the inner card", async () => {
    const el = await makeCard({ type: "custom:map-card-extended", entities: [] });
    expect(el.getCardSize()).toBe(7);
  });
});
