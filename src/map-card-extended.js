const VERSION = "__VERSION__";

/**
 * map-card-extended
 *
 * A thin wrapper around Home Assistant's built-in map card (`hui-map-card`,
 * shipped in HA 2026.9+). It forwards your configuration to the real card and
 * adds per-entity `tap_action` support, which the native card does not offer.
 *
 * The native card renders entity markers that fire `hass-more-info` on click
 * (hardcoded in `ha-entity-marker`). That event bubbles, so we intercept it:
 * when the clicked entity has a configured `tap_action`, we run that action
 * instead of letting the more-info dialog open. Entities without a custom
 * action keep the native behaviour.
 *
 * Everything else (per-entity `color`, labels, zoom, themes, geo sources, etc.)
 * is native and passes straight through untouched.
 */
class MapCardExtended extends HTMLElement {
  /** @type {HTMLElement | undefined} the embedded hui-map-card */
  _inner;
  /** @type {object | undefined} */
  _hass;
  /** @type {object | undefined} the original card config */
  _config;
  /** @type {Map<string, object>} entity_id -> tap_action config */
  _tapActions = new Map();
  /** @type {boolean} */
  _listenerBound = false;

  /** @type {object | undefined} native config pending inner-card creation */
  _pendingConfig;
  /** @type {boolean} whether async inner-card creation is in flight */
  _creating = false;

  /**
   * Lovelace config entry point. Splits per-entity `tap_action` out of the
   * config and forwards the rest to the native map card.
   * @param {object} config the card configuration
   */
  setConfig(config) {
    if (!config) {
      throw new Error("Invalid configuration");
    }

    // Split our custom per-entity `tap_action` out of the config. Everything
    // else is forwarded to the native card verbatim, so native options keep
    // working and new native options are supported automatically.
    this._tapActions = new Map();
    const nativeEntities = (config.entities ?? []).map((entity) => {
      // Entities may be a bare id string or an object.
      if (typeof entity === "string") {
        return entity;
      }
      const { tap_action, ...nativeEntity } = entity;
      if (tap_action && nativeEntity.entity) {
        this._tapActions.set(nativeEntity.entity, tap_action);
      }
      return nativeEntity;
    });

    // The native card is type "map"; swap our custom card type for the native
    // one, keep the rest. Only override entities when the user supplied them
    // (show_all / geo_location_sources configs have no entities array).
    const nativeConfig = { ...config, type: "map" };
    if (config.entities) {
      nativeConfig.entities = nativeEntities;
    }
    // Strip custom top-level keys the native card does not understand.
    delete nativeConfig.tap_action;

    this._config = config;

    if (this._inner) {
      // Inner card already exists: reconfigure it in place.
      this._inner.setConfig(nativeConfig);
    } else {
      // Not created yet - buffer the config and (re)start async creation.
      this._pendingConfig = nativeConfig;
      this._ensureInner();
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (this._inner) {
      this._inner.hass = hass;
    }
  }

  /**
   * Create the embedded native card via HA's card helpers and wire up click
   * interception. Built-in cards (hui-map-card) load lazily, so the element
   * returned by document.createElement is not upgraded and has no setConfig
   * until its bundle loads. createCardElement loads that bundle, applies the
   * config and returns a ready element - which is why this must be async.
   */
  async _ensureInner() {
    if (this._inner || this._creating) {
      return;
    }
    this._creating = true;
    try {
      const helpers = await window.loadCardHelpers();
      // A newer setConfig may have replaced the pending config while we waited.
      const config = this._pendingConfig;
      const inner = helpers.createCardElement(config);
      if (this._hass) {
        inner.hass = this._hass;
      }

      // Intercept the native marker click (hass-more-info) in the capture
      // phase so we can suppress it before HA's dialog manager (listening on
      // the bubble phase higher up) sees it.
      if (!this._listenerBound) {
        this.addEventListener("hass-more-info", this._onMoreInfo, true);
        this._listenerBound = true;
      }

      this._inner = inner;
      this.appendChild(inner);
    } catch (e) {
      // Surface a readable error in the card frame rather than failing silently.
      this.innerHTML = `<hui-warning>Map Card Extended: ${e?.message ?? e}</hui-warning>`;
    } finally {
      this._creating = false;
    }
  }

  _onMoreInfo = (ev) => {
    const entityId = ev.detail?.entityId;
    if (!entityId || !this._tapActions.has(entityId)) {
      return; // No custom action: let the native more-info dialog open.
    }
    // Take over: stop the event from reaching HA's more-info handler.
    ev.stopPropagation();
    ev.preventDefault();
    this._handleAction(entityId, this._tapActions.get(entityId));
  };

  /**
   * Run a configured tap action for an entity. Mirrors the common Lovelace
   * action config: navigate, url, call-service / perform-action, more-info,
   * toggle, none.
   * @param {string} entityId
   * @param {object} action
   */
  _handleAction(entityId, action) {
    const type = action.action;
    switch (type) {
      case "none":
        return;

      case "more-info":
        this._fire("hass-more-info", {
          entityId: action.entity ?? entityId,
        });
        return;

      case "navigate": {
        if (!action.navigation_path) {
          return;
        }
        if (action.navigation_replace) {
          window.history.replaceState(null, "", action.navigation_path);
        } else {
          window.history.pushState(null, "", action.navigation_path);
        }
        // Notify HA's router to re-render for the new path.
        window.dispatchEvent(new CustomEvent("location-changed"));
        return;
      }

      case "url":
        if (action.url_path) {
          window.open(action.url_path, action.url_path.startsWith("http") ? "_blank" : "_self");
        }
        return;

      case "toggle":
        this._callService("homeassistant", "toggle", { entity_id: entityId });
        return;

      case "perform-action":
      case "call-service": {
        const perform = action.perform_action ?? action.service;
        if (!perform) {
          return;
        }
        const [domain, service] = perform.split(".", 2);
        if (!domain || !service) {
          return;
        }
        this._callService(domain, service, action.data ?? action.service_data ?? {}, action.target);
        return;
      }

      default:
        // Unknown action: fall back to opening more-info so a click still
        // does something sensible.
        this._fire("hass-more-info", { entityId });
    }
  }

  _callService(domain, service, data, target) {
    this._hass?.callService(domain, service, data, target);
  }

  /**
   * Dispatch a bubbling, composed DOM event the HA frontend listens for.
   * @param {string} type event name
   * @param {object} detail event detail payload
   */
  _fire(type, detail) {
    this.dispatchEvent(
      new CustomEvent(type, { detail, bubbles: true, composed: true })
    );
  }

  getCardSize() {
    return this._inner?.getCardSize?.() ?? 5;
  }

  /**
   * Return the native map card's visual editor for the Config tab. A GUI editor
   * is required for Home Assistant to render the Config/Visibility/Layout tab
   * bar; this reuses the built-in map editor so all native options get their
   * normal GUI. Per-entity `tap_action` is configured via YAML (the native
   * editor neither shows nor manages it).
   * @returns {Promise<HTMLElement|undefined>} the native map card editor
   */
  static async getConfigElement() {
    const cardClass = customElements.get("hui-map-card");
    return cardClass?.getConfigElement?.();
  }

  static getStubConfig(hass, entities, entitiesFallback) {
    const base =
      customElements.get("hui-map-card")?.getStubConfig?.(hass, entities, entitiesFallback) ??
      { entities: [] };
    return { type: "custom:map-card-extended", ...base };
  }
}

customElements.define("map-card-extended", MapCardExtended);

// Register in the custom card picker.
window.customCards = window.customCards || [];
window.customCards.push({
  type: "map-card-extended",
  name: "Map Card Extended",
  description:
    "Home Assistant's built-in map card plus per-entity tap actions.",
  preview: false,
  documentationURL: "https://github.com/breakthestatic/map-card-extended",
});

console.info(`%c map-card-extended %c ${VERSION} `, "background:#555;color:#fff;border-radius:3px 0 0 3px", "background:#03a9f4;color:#fff;border-radius:0 3px 3px 0");
