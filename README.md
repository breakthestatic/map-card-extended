# Map Card Extended

A small extension of Home Assistant's built-in map card that adds one thing the
native card doesn't offer: **per-entity tap actions**.

Everything else is the native map card — all of its options pass straight
through. This card only lets you give individual entities a custom `tap_action`
(the rest keep the default behaviour of opening more-info).

> Requires Home Assistant **2026.9 or newer** (the version with the redesigned
> map card this builds on).

## Usage

```yaml
type: custom:map-card-extended
entities:
  - entity: person.chris
    tap_action:
      action: navigate
      navigation_path: /lovelace/chris
  - person.jenny          # no tap_action -> native more-info
```

To attach a `tap_action`, use the object form (`- entity: ...`). Entities
written as bare strings keep the native behaviour. Any native map card option
is still valid and is passed through unchanged.

### Supported `tap_action` values

`more-info`, `navigate`, `url`, `toggle`, `perform-action` (and the legacy
`call-service` alias), and `none`.

> Tap actions are configured in YAML. The visual editor shows the native map
> options; it does not manage tap actions.
