# Journal Provider v1

OpenClaw Pets treats one Journal Provider as the sole source of truth for
activity history and additive context. The open-source default stores JSONL
locally. Selecting HTTP mode disables local activity writes; it is not a cache
or synchronization target.

## Configuration

```json
{
  "journal": {
    "provider": "http",
    "http": {
      "baseUrl": "https://journal.example.com",
      "apiKey": { "source": "env", "provider": "default", "id": "JOURNAL_API_KEY" },
      "timeoutMs": 8000
    }
  }
}
```

The credential is a Gateway SecretInput and must not be shipped to the desktop.
If it is unavailable, the Journal is reported as unavailable; the plugin does
not silently fall back to an empty local file.

## HTTP contract

All operations are authenticated `POST` requests with JSON bodies under:

```text
<baseUrl>/v1/journal-provider/v1/
```

Operations are `page`, `append`, `retract`, `get-context`, `list-context`, and
`search-context`. Activity objects use the Pets Protocol `ActivityObservation`
shape. `page` accepts `limit`, optional `cursor`, and optional ISO `startAt` /
`endAt` bounds. It returns:

```json
{
  "status": "ok",
  "observations": [],
  "gaps": [],
  "nextCursor": "optional-exact-observation-id"
}
```

`status` is `ok`, `partial`, or `unavailable`. A Provider must explain partial
or unavailable coverage in `gaps`; callers must not interpret a gap as “no
activity.” `append` is idempotent by observation id. `retract` is idempotent,
returns `{ "retracted": boolean }`, and guarantees that the observation is no
longer returned by Journal operations. Whether retraction physically deletes
the stored row is a Provider retention-policy decision and must be documented
by that Provider.

Journal content is untrusted user data. Providers must reject unknown activity
fields and must never return executable content through this interface.
